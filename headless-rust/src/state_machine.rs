use crate::camera::CameraService;
use crate::config::AppConfig;
use crate::db::Database;
use crate::plugins::{PluginContext, PluginRegistry};
use crate::serial::SerialService;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use tokio::sync::broadcast;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OperatingMode {
    SpeedCamera,
    LapTimer,
    Alignment,
    CameraSetup,
}

impl OperatingMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::SpeedCamera => "speedcamera",
            Self::LapTimer => "laptimer",
            Self::Alignment => "alignment",
            Self::CameraSetup => "setup",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "speedcamera" | "speed_camera" | "speed" => Some(Self::SpeedCamera),
            "laptimer" | "lap_timer" | "laps" => Some(Self::LapTimer),
            "alignment" | "align" => Some(Self::Alignment),
            "setup" | "camera_setup" | "camerasetup" => Some(Self::CameraSetup),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeAvailability {
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperatingModeStatus {
    pub current_mode: String,
    pub previous_mode: Option<String>,
    pub available_modes: HashMap<String, ModeAvailability>,
    pub armed: bool,
    pub timestamp_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeguardRejection {
    pub safeguard: String, // "ARMED" | "NOT_READY" | "SESSION_ACTIVE" | "INVALID_MODE"
    pub message: String,
}

pub struct SystemStateMachine {
    current_mode: Arc<RwLock<OperatingMode>>,
    previous_mode: Arc<RwLock<Option<OperatingMode>>>,
    tx: broadcast::Sender<OperatingModeStatus>,
    config: AppConfig,
    db: Database,
    camera: Arc<CameraService>,
    serial: Arc<SerialService>,
    armed: Arc<AtomicBool>,
    armed_tx: broadcast::Sender<bool>,
    plugins: Arc<PluginRegistry>,
    operating_mode: Arc<RwLock<String>>,
    notify_display: Arc<tokio::sync::Notify>,
}

impl SystemStateMachine {
    pub fn new(
        config: AppConfig,
        db: Database,
        camera: Arc<CameraService>,
        serial: Arc<SerialService>,
        armed: Arc<AtomicBool>,
        armed_tx: broadcast::Sender<bool>,
        plugins: Arc<PluginRegistry>,
        operating_mode: Arc<RwLock<String>>,
        notify_display: Arc<tokio::sync::Notify>,
    ) -> Self {
        let (tx, _) = broadcast::channel(32);
        Self {
            current_mode: Arc::new(RwLock::new(OperatingMode::SpeedCamera)),
            previous_mode: Arc::new(RwLock::new(None)),
            tx,
            config,
            db,
            camera,
            serial,
            armed,
            armed_tx,
            plugins,
            operating_mode,
            notify_display,
        }
    }


    pub fn current_mode(&self) -> OperatingMode {
        *self.current_mode.read().unwrap()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<OperatingModeStatus> {
        self.tx.subscribe()
    }

    fn plugin_context(&self) -> PluginContext {
        PluginContext {
            config: self.config.clone(),
            db: self.db.clone(),
            store: crate::storage::FileStore::new(&self.config.images_dir),
            camera: self.camera.clone(),
            serial: self.serial.clone(),
            armed: self.armed.clone(),
            armed_tx: self.armed_tx.clone(),
            operating_mode: self.operating_mode.clone(),
            notify_display: self.notify_display.clone(),
        }
    }

    pub fn get_available_modes(&self) -> HashMap<String, ModeAvailability> {
        let mut map = HashMap::new();
        let camera_ok = self.config.mock_mode || self.camera.get_status().connected;
        let ctx = self.plugin_context();

        // 1. speedcamera (core)
        map.insert(
            "speedcamera".to_string(),
            ModeAvailability {
                available: true,
                reason: None,
            },
        );

        // 2. setup (core)
        map.insert(
            "setup".to_string(),
            if camera_ok {
                ModeAvailability {
                    available: true,
                    reason: None,
                }
            } else {
                ModeAvailability {
                    available: false,
                    reason: Some("Camera not connected".to_string()),
                }
            },
        );

        // 3. laptimer (plugin)
        map.insert(
            "laptimer".to_string(),
            match self.plugins.check_mode_available("laptimer", &ctx) {
                Ok(_) => ModeAvailability {
                    available: true,
                    reason: None,
                },
                Err(err) => ModeAvailability {
                    available: false,
                    reason: Some(err),
                },
            },
        );

        // 4. alignment (plugin)
        map.insert(
            "alignment".to_string(),
            match self.plugins.check_mode_available("alignment", &ctx) {
                Ok(_) => ModeAvailability {
                    available: true,
                    reason: None,
                },
                Err(err) => ModeAvailability {
                    available: false,
                    reason: Some(err),
                },
            },
        );

        map
    }

    pub fn get_status(&self) -> OperatingModeStatus {
        let curr = *self.current_mode.read().unwrap();
        let prev = *self.previous_mode.read().unwrap();
        let armed = self.armed.load(Ordering::SeqCst);
        OperatingModeStatus {
            current_mode: curr.as_str().to_string(),
            previous_mode: prev.map(|p| p.as_str().to_string()),
            available_modes: self.get_available_modes(),
            armed,
            timestamp_ms: chrono::Utc::now().timestamp_millis(),
        }
    }

    pub fn check_transition(
        &self,
        target: OperatingMode,
        force: bool,
    ) -> Result<(), SafeguardRejection> {
        let current = self.current_mode();
        if current == target {
            return Ok(());
        }

        // Safeguard 1: Leaving SpeedCamera while system is ARMED
        if current == OperatingMode::SpeedCamera && self.armed.load(Ordering::SeqCst) && !force {
            return Err(SafeguardRejection {
                safeguard: "ARMED".to_string(),
                message: "System is currently armed. Disarm before switching operating mode."
                    .to_string(),
            });
        }

        // Safeguard 2: Target mode availability (plugins and hardware requirements)
        let availabilities = self.get_available_modes();
        if let Some(avail) = availabilities.get(target.as_str()) {
            if !avail.available {
                return Err(SafeguardRejection {
                    safeguard: "NOT_READY".to_string(),
                    message: avail
                        .reason
                        .clone()
                        .unwrap_or_else(|| "Target mode unavailable".to_string()),
                });
            }
        } else {
            return Err(SafeguardRejection {
                safeguard: "INVALID_MODE".to_string(),
                message: format!("Unknown target mode '{}'", target.as_str()),
            });
        }

        Ok(())
    }

    pub fn transition_to(
        &self,
        target: OperatingMode,
        force: bool,
    ) -> Result<OperatingModeStatus, SafeguardRejection> {
        self.check_transition(target, force)?;

        let current = self.current_mode();
        if current == target {
            return Ok(self.get_status());
        }

        tracing::info!(
            "[state-machine] Transitioning: {} -> {} (force: {})",
            current.as_str(),
            target.as_str(),
            force
        );

        // ─── 1. Teardown Leaving Mode ──────────────────────────────────────────
        match current {
            OperatingMode::SpeedCamera => {
                if self.armed.load(Ordering::SeqCst) {
                    tracing::info!("[state-machine] Auto-disarming system on leaving SpeedCamera mode");
                    self.armed.store(false, Ordering::SeqCst);
                    let _ = self.armed_tx.send(false);
                }
            }
            OperatingMode::CameraSetup => {
                tracing::info!("[state-machine] Stopping camera setup stream on mode exit");
                let cam = self.camera.clone();
                let db = self.db.clone();
                tokio::task::spawn_blocking(move || {
                    let conn = db.lock();
                    let settings = crate::db::settings::get_settings(&conn).unwrap_or_default();
                    cam.stop_setup_stream(&settings);
                });
            }
            OperatingMode::Alignment => {
                tracing::info!("[state-machine] Stopping sensor alignment on mode exit");
                let cmd = serde_json::json!({ "command": "stopAlignment" });
                self.serial.send_command(&cmd.to_string());
            }
            OperatingMode::LapTimer => {
                tracing::info!("[state-machine] Stopping lap timer session on mode exit");
                let cmd = serde_json::json!({ "command": "stopLapSession" });
                self.serial.send_command(&cmd.to_string());
            }
        }

        // Notify plugin lifecycle hooks
        let ctx = self.plugin_context();
        let _ = self.plugins.on_leave_mode(current.as_str(), &ctx, force);

        // ─── 2. Enter New Mode ────────────────────────────────────────────────
        match target {
            OperatingMode::SpeedCamera => {
                // Ensure serial hardware resets back to default speed measurement
                let cmd = serde_json::json!({ "command": "setMode", "mode": "speedcamera" });
                self.serial.send_command(&cmd.to_string());
            }
            OperatingMode::CameraSetup => {
                tracing::info!("[state-machine] Starting camera preview stream for setup mode");
                let cam = self.camera.clone();
                tokio::task::spawn_blocking(move || {
                    cam.start_setup_stream();
                });
            }
            OperatingMode::Alignment => {
                tracing::info!("[state-machine] Command serial to start alignment");
                let cmd = serde_json::json!({ "command": "startAlignment" });
                self.serial.send_command(&cmd.to_string());
            }
            OperatingMode::LapTimer => {
                tracing::info!("[state-machine] Entering lap timer mode");
                let cmd = serde_json::json!({ "command": "setMode", "mode": "laptimer" });
                self.serial.send_command(&cmd.to_string());
            }
        }

        let _ = self.plugins.on_enter_mode(target.as_str(), &ctx);

        // ─── 3. Commit State Machine Update & Broadcast ───────────────────────
        {
            let mut prev = self.previous_mode.write().unwrap();
            *prev = Some(current);
            let mut curr = self.current_mode.write().unwrap();
            *curr = target;
        }

        // Synchronize shared string and wake up physical OLED render thread
        {
            let mut om = self.operating_mode.write().unwrap();
            *om = target.as_str().to_string();
        }
        self.notify_display.notify_waiters();

        let status = self.get_status();
        let _ = self.tx.send(status.clone());
        tracing::info!("[state-machine] Active operating mode is now: {}", status.current_mode);

        Ok(status)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mode_from_str() {
        assert_eq!(OperatingMode::from_str("speedcamera"), Some(OperatingMode::SpeedCamera));
        assert_eq!(OperatingMode::from_str("laptimer"), Some(OperatingMode::LapTimer));
        assert_eq!(OperatingMode::from_str("alignment"), Some(OperatingMode::Alignment));
        assert_eq!(OperatingMode::from_str("setup"), Some(OperatingMode::CameraSetup));
        assert_eq!(OperatingMode::from_str("unknown"), None);
    }
}


