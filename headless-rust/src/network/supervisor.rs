use super::state::{
    next_state, EthernetMode, NetworkEvent, NetworkStateSnapshot, TransitionEffect, WifiState,
};
use crate::models::{ApplyNetworkModeInput, NetworkOperationResult};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, mpsc};

// ponytail: single background async supervisor actor with serialized command queue
pub struct NetworkSupervisor {
    snapshot: Arc<RwLock<NetworkStateSnapshot>>,
    cmd_tx: mpsc::Sender<SupervisorCmd>,
    broadcast_tx: broadcast::Sender<NetworkStateSnapshot>,
    #[allow(dead_code)]
    is_mock: Arc<AtomicBool>,
}

#[derive(Debug)]
#[allow(dead_code)]
enum SupervisorCmd {
    Event(NetworkEvent),
    ApplyMode {
        input: ApplyNetworkModeInput,
        reply: tokio::sync::oneshot::Sender<NetworkOperationResult>,
    },
}

impl NetworkSupervisor {
    pub fn new(is_mock: bool) -> Arc<Self> {
        let (broadcast_tx, _) = broadcast::channel(32);
        let (cmd_tx, mut cmd_rx) = mpsc::channel::<SupervisorCmd>(32);
        let snapshot = Arc::new(RwLock::new(NetworkStateSnapshot::default()));
        let is_mock = Arc::new(AtomicBool::new(is_mock));

        let supervisor = Arc::new(Self {
            snapshot: snapshot.clone(),
            cmd_tx: cmd_tx.clone(),
            broadcast_tx: broadcast_tx.clone(),
            is_mock: is_mock.clone(),
        });

        // Spawn background supervisor loop
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(1));
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

            let mut current_wifi = WifiState::ApSetup;
            let mut current_eth = EthernetMode::CameraLan;
            let mut mock_retry_counter: u32 = 0;
            let mut attempt_countdown_secs: u64 = super::state::RETRY_INTERVAL_SECS;

            // Initial detection on boot (skip on mock mode to avoid shell script / sudo latency)
            if !is_mock.load(Ordering::Relaxed) {
                let initial_summary = super::get_system_network_summary();
                if let Some(ref client) = initial_summary.wifi_client {
                    if let Some(ref ip) = client.ip {
                        let ssid = client.ssid.clone().unwrap_or_else(|| "SavedWiFi".to_string());
                        current_wifi = WifiState::StationConnected {
                            ssid,
                            ip: ip.clone(),
                            gateway: client.gateway.clone(),
                            signal: client.signal_dbm,
                        };
                    }
                } else if initial_summary.wifi_mode == "ap" || initial_summary.hotspot_ap.status == "ok" {
                    current_wifi = WifiState::ApSetup;
                }

                if initial_summary.ethernet_mode == "dhcp" {
                    current_eth = EthernetMode::Dhcp;
                }
            }

            Self::update_snapshot(
                &snapshot,
                &current_wifi,
                current_eth,
                None,
                &broadcast_tx,
            );

            let cmd_tx_inner = cmd_tx.clone();
            let mut last_tick = Instant::now();

            loop {
                tokio::select! {
                    _ = ticker.tick() => {
                        let elapsed = last_tick.elapsed().as_secs();
                        if elapsed == 0 {
                            continue;
                        }
                        last_tick = Instant::now();

                        // ─── 1. Health & Link Polling ────────────────────────
                        let is_mock_now = is_mock.load(Ordering::Relaxed);
                        if is_mock_now {
                            // In mock mode, advance retry counters in real-time
                            match &current_wifi {
                                WifiState::StationConnecting { ssid: _, attempt, max_attempts } => {
                                    attempt_countdown_secs = attempt_countdown_secs.saturating_sub(elapsed);
                                    let time_to_action = attempt_countdown_secs + (max_attempts.saturating_sub(*attempt) as u64) * super::state::RETRY_INTERVAL_SECS;

                                    mock_retry_counter += 1;
                                    if mock_retry_counter >= 3 {
                                        let (next, _) = next_state(
                                            &current_wifi,
                                            NetworkEvent::ConnectionSucceeded {
                                                ip: "192.168.1.150".to_string(),
                                                gateway: Some("192.168.1.1".to_string()),
                                                signal: Some(-52),
                                            },
                                        );
                                        current_wifi = next;
                                        attempt_countdown_secs = super::state::RETRY_INTERVAL_SECS;
                                        mock_retry_counter = 0;
                                        Self::update_snapshot(&snapshot, &current_wifi, current_eth, None, &broadcast_tx);
                                    } else {
                                        Self::update_snapshot(&snapshot, &current_wifi, current_eth, Some(time_to_action), &broadcast_tx);
                                    }
                                }
                                WifiState::StationReconnecting { ssid: _, attempt, max_attempts } => {
                                    attempt_countdown_secs = attempt_countdown_secs.saturating_sub(elapsed);
                                    let time_to_action = attempt_countdown_secs + (max_attempts.saturating_sub(*attempt) as u64) * super::state::RETRY_INTERVAL_SECS;

                                    if attempt_countdown_secs == 0 {
                                        let (next, _) = next_state(&current_wifi, NetworkEvent::ConnectionAttemptFailed);
                                        current_wifi = next;
                                        attempt_countdown_secs = super::state::RETRY_INTERVAL_SECS;
                                        Self::update_snapshot(&snapshot, &current_wifi, current_eth, None, &broadcast_tx);
                                    } else {
                                        Self::update_snapshot(&snapshot, &current_wifi, current_eth, Some(time_to_action), &broadcast_tx);
                                    }
                                }
                                WifiState::FallbackAp { .. } => {
                                    let (next, _) = next_state(&current_wifi, NetworkEvent::Tick(elapsed));
                                    if next != current_wifi {
                                        current_wifi = next;
                                        attempt_countdown_secs = super::state::RETRY_INTERVAL_SECS;
                                    }
                                    Self::update_snapshot(&snapshot, &current_wifi, current_eth, None, &broadcast_tx);
                                }
                                _ => {}
                            }
                            continue;
                        }

                        // Physical Hardware Polling
                        match &current_wifi {
                            WifiState::StationConnected { ssid, .. } => {
                                let client_ip = super::get_wifi_client_ip();
                                if client_ip.is_none() {
                                    tracing::warn!("[network-supervisor] Wi-Fi link lost for SSID: {}", ssid);
                                    let (next, effect) = next_state(&current_wifi, NetworkEvent::LinkLost);
                                    current_wifi = next;
                                    attempt_countdown_secs = super::state::RETRY_INTERVAL_SECS;
                                    Self::apply_effect_background(&effect, false);
                                    Self::update_snapshot(&snapshot, &current_wifi, current_eth, None, &broadcast_tx);
                                }
                            }

                            WifiState::StationConnecting { ssid, attempt, max_attempts } => {
                                if let Some(ip) = super::get_wifi_client_ip() {
                                    tracing::info!("[network-supervisor] Connected to {} (IP: {})", ssid, ip);
                                    let summary = super::get_system_network_summary();
                                    let (next, _) = next_state(
                                        &current_wifi,
                                        NetworkEvent::ConnectionSucceeded {
                                            ip,
                                            gateway: summary.wifi_client.as_ref().and_then(|c| c.gateway.clone()),
                                            signal: summary.wifi_client.as_ref().and_then(|c| c.signal_dbm),
                                        },
                                    );
                                    current_wifi = next;
                                    attempt_countdown_secs = super::state::RETRY_INTERVAL_SECS;
                                    Self::update_snapshot(&snapshot, &current_wifi, current_eth, None, &broadcast_tx);
                                    continue;
                                }

                                attempt_countdown_secs = attempt_countdown_secs.saturating_sub(elapsed);
                                let time_to_action = attempt_countdown_secs + (max_attempts.saturating_sub(*attempt) as u64) * super::state::RETRY_INTERVAL_SECS;

                                if attempt_countdown_secs == 0 {
                                    let (next, effect) = next_state(&current_wifi, NetworkEvent::ConnectionAttemptFailed);
                                    current_wifi = next;
                                    attempt_countdown_secs = super::state::RETRY_INTERVAL_SECS;
                                    Self::apply_effect_background(&effect, false);
                                    Self::update_snapshot(&snapshot, &current_wifi, current_eth, None, &broadcast_tx);
                                } else {
                                    Self::update_snapshot(&snapshot, &current_wifi, current_eth, Some(time_to_action), &broadcast_tx);
                                }
                            }

                            WifiState::StationReconnecting { ssid, attempt, max_attempts } => {
                                if let Some(ip) = super::get_wifi_client_ip() {
                                    tracing::info!("[network-supervisor] Reconnected to {} (IP: {})", ssid, ip);
                                    let summary = super::get_system_network_summary();
                                    let (next, _) = next_state(
                                        &current_wifi,
                                        NetworkEvent::ConnectionSucceeded {
                                            ip,
                                            gateway: summary.wifi_client.as_ref().and_then(|c| c.gateway.clone()),
                                            signal: summary.wifi_client.as_ref().and_then(|c| c.signal_dbm),
                                        },
                                    );
                                    current_wifi = next;
                                    attempt_countdown_secs = super::state::RETRY_INTERVAL_SECS;
                                    Self::update_snapshot(&snapshot, &current_wifi, current_eth, None, &broadcast_tx);
                                    continue;
                                }

                                attempt_countdown_secs = attempt_countdown_secs.saturating_sub(elapsed);
                                let time_to_action = attempt_countdown_secs + (max_attempts.saturating_sub(*attempt) as u64) * super::state::RETRY_INTERVAL_SECS;

                                if attempt_countdown_secs == 0 {
                                    let (next, effect) = next_state(&current_wifi, NetworkEvent::ConnectionAttemptFailed);
                                    current_wifi = next;
                                    attempt_countdown_secs = super::state::RETRY_INTERVAL_SECS;
                                    Self::apply_effect_background(&effect, false);
                                    Self::update_snapshot(&snapshot, &current_wifi, current_eth, None, &broadcast_tx);
                                } else {
                                    Self::update_snapshot(&snapshot, &current_wifi, current_eth, Some(time_to_action), &broadcast_tx);
                                }
                            }

                            WifiState::FallbackAp { .. } => {
                                let stations = tokio::task::spawn_blocking(Self::query_ap_stations_count).await.unwrap_or(0);
                                let (next, _) = next_state(&current_wifi, NetworkEvent::StationsUpdated(stations));
                                current_wifi = next;

                                let (next, effect) = next_state(&current_wifi, NetworkEvent::Tick(elapsed));
                                if next != current_wifi {
                                    current_wifi = next;
                                    attempt_countdown_secs = super::state::RETRY_INTERVAL_SECS;
                                    Self::apply_effect_background(&effect, false);
                                }
                                Self::update_snapshot(&snapshot, &current_wifi, current_eth, None, &broadcast_tx);
                            }

                            WifiState::ApSetup => {
                                let stations = tokio::task::spawn_blocking(Self::query_ap_stations_count).await.unwrap_or(0);
                                {
                                    let mut s = snapshot.write().unwrap();
                                    s.connected_stations = stations;
                                }
                            }
                        }
                    }

                    Some(cmd) = cmd_rx.recv() => {
                        match cmd {
                            SupervisorCmd::Event(ev) => {
                                let (next, effect) = next_state(&current_wifi, ev);
                                current_wifi = next;
                                attempt_countdown_secs = super::state::RETRY_INTERVAL_SECS;
                                let is_mock_now = is_mock.load(Ordering::Relaxed);
                                Self::apply_effect_background(&effect, is_mock_now);
                                let time_override = match &current_wifi {
                                    WifiState::StationConnecting { attempt, max_attempts, .. }
                                    | WifiState::StationReconnecting { attempt, max_attempts, .. } => {
                                        Some(attempt_countdown_secs + (max_attempts.saturating_sub(*attempt) as u64) * super::state::RETRY_INTERVAL_SECS)
                                    }
                                    _ => None,
                                };
                                Self::update_snapshot(&snapshot, &current_wifi, current_eth, time_override, &broadcast_tx);
                            }

                            SupervisorCmd::ApplyMode { input, reply } => {
                                let is_mock_now = is_mock.load(Ordering::Relaxed);
                                let mode = input.mode.to_lowercase();
                                match mode.as_str() {
                                    "ap" | "hotspot" | "field" => {
                                        let (next, _effect) = next_state(&current_wifi, NetworkEvent::UserForget);
                                        current_wifi = next;
                                        Self::update_snapshot(&snapshot, &current_wifi, current_eth, None, &broadcast_tx);
                                        tokio::spawn(async move {
                                            let res = Self::execute_script(&["ap"], is_mock_now).await;
                                            let _ = reply.send(res);
                                        });
                                    }
                                    "client" | "wifi-client" | "wifi" => {
                                        let ssid = input.ssid.clone().unwrap_or_default();
                                        let pass = input.password.clone();
                                        if ssid.is_empty() {
                                            let _ = reply.send(NetworkOperationResult {
                                                success: false,
                                                mode: "client".to_string(),
                                                message: "SSID is required".to_string(),
                                                details: None,
                                            });
                                            continue;
                                        }

                                        let (next, _) = next_state(
                                            &current_wifi,
                                            NetworkEvent::UserConnect {
                                                ssid: ssid.clone(),
                                                password: pass.clone(),
                                            },
                                        );
                                        current_wifi = next;
                                        attempt_countdown_secs = super::state::RETRY_INTERVAL_SECS;
                                        let total_time = attempt_countdown_secs + (super::state::MAX_RETRY_ATTEMPTS.saturating_sub(1) as u64) * super::state::RETRY_INTERVAL_SECS;
                                        Self::update_snapshot(&snapshot, &current_wifi, current_eth, Some(total_time), &broadcast_tx);

                                        let mut args = vec!["client".to_string(), ssid];
                                        if let Some(ref p) = pass {
                                            if !p.is_empty() {
                                                args.push(p.clone());
                                            }
                                        }
                                        let cmd_tx_clone = cmd_tx_inner.clone();
                                        tokio::spawn(async move {
                                            let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
                                            let res = Self::execute_script(&args_ref, is_mock_now).await;
                                            if res.success {
                                                let summary = super::get_system_network_summary();
                                                let ip = summary.wifi_client.as_ref().and_then(|c| c.ip.clone()).unwrap_or_else(|| "Waiting DHCP".to_string());
                                                let _ = cmd_tx_clone.send(SupervisorCmd::Event(NetworkEvent::ConnectionSucceeded {
                                                    ip,
                                                    gateway: summary.wifi_client.as_ref().and_then(|c| c.gateway.clone()),
                                                    signal: summary.wifi_client.as_ref().and_then(|c| c.signal_dbm),
                                                })).await;
                                            } else {
                                                let _ = cmd_tx_clone.send(SupervisorCmd::Event(NetworkEvent::ConnectionAttemptFailed)).await;
                                            }
                                            let _ = reply.send(res);
                                        });
                                    }
                                    "forget" | "reset-wifi" => {
                                        let (next, _) = next_state(&current_wifi, NetworkEvent::UserForget);
                                        current_wifi = next;
                                        Self::update_snapshot(&snapshot, &current_wifi, current_eth, None, &broadcast_tx);
                                        tokio::spawn(async move {
                                            let res = Self::execute_script(&["forget"], is_mock_now).await;
                                            let _ = reply.send(res);
                                        });
                                    }
                                    "camera-lan" | "lan-camera" => {
                                        current_eth = EthernetMode::CameraLan;
                                        Self::update_snapshot(&snapshot, &current_wifi, current_eth, None, &broadcast_tx);
                                        tokio::spawn(async move {
                                            let res = Self::execute_script(&["lan-camera"], is_mock_now).await;
                                            let _ = reply.send(res);
                                        });
                                    }
                                    "lan-dhcp" | "ethernet-dhcp" => {
                                        current_eth = EthernetMode::Dhcp;
                                        Self::update_snapshot(&snapshot, &current_wifi, current_eth, None, &broadcast_tx);
                                        tokio::spawn(async move {
                                            let res = Self::execute_script(&["lan-dhcp"], is_mock_now).await;
                                            let _ = reply.send(res);
                                        });
                                    }
                                    other => {
                                        let _ = reply.send(NetworkOperationResult {
                                            success: false,
                                            mode: other.to_string(),
                                            message: format!("Unknown mode: {}", other),
                                            details: None,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        supervisor
    }

    pub fn snapshot(&self) -> NetworkStateSnapshot {
        self.snapshot.read().unwrap().clone()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<NetworkStateSnapshot> {
        self.broadcast_tx.subscribe()
    }

    pub async fn apply_mode(&self, input: ApplyNetworkModeInput) -> Result<NetworkOperationResult, String> {
        let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
        self.cmd_tx
            .send(SupervisorCmd::ApplyMode { input, reply: reply_tx })
            .await
            .map_err(|e| format!("Supervisor channel closed: {}", e))?;

        reply_rx.await.map_err(|e| format!("Supervisor dropped reply: {}", e))
    }

    #[allow(dead_code)]
    pub async fn send_event(&self, event: NetworkEvent) {
        let _ = self.cmd_tx.send(SupervisorCmd::Event(event)).await;
    }

    fn update_snapshot(
        snapshot: &Arc<RwLock<NetworkStateSnapshot>>,
        wifi: &WifiState,
        eth: EthernetMode,
        custom_time_to_action: Option<u64>,
        broadcast_tx: &broadcast::Sender<NetworkStateSnapshot>,
    ) {
        let mut s = snapshot.write().unwrap();
        s.wifi_state = wifi.clone();
        s.ethernet_mode = eth;
        s.timestamp_ms = chrono::Utc::now().timestamp_millis();

        match wifi {
            WifiState::ApSetup => {
                s.active_ssid = Some("speedcamera".to_string());
                s.client_ip = None;
                s.retry_attempt = 0;
                s.time_to_next_action = custom_time_to_action.unwrap_or(0);
            }
            WifiState::StationConnecting { ssid, attempt, max_attempts } => {
                s.active_ssid = Some(ssid.clone());
                s.client_ip = None;
                s.retry_attempt = *attempt;
                s.max_attempts = *max_attempts;
                s.time_to_next_action = custom_time_to_action.unwrap_or_else(|| {
                    (max_attempts.saturating_sub(*attempt) + 1) as u64 * super::state::RETRY_INTERVAL_SECS
                });
            }
            WifiState::StationConnected { ssid, ip, .. } => {
                s.active_ssid = Some(ssid.clone());
                s.client_ip = Some(ip.clone());
                s.retry_attempt = 0;
                s.time_to_next_action = custom_time_to_action.unwrap_or(0);
            }
            WifiState::StationReconnecting { ssid, attempt, max_attempts } => {
                s.active_ssid = Some(ssid.clone());
                s.client_ip = None;
                s.retry_attempt = *attempt;
                s.max_attempts = *max_attempts;
                s.time_to_next_action = custom_time_to_action.unwrap_or_else(|| {
                    (max_attempts.saturating_sub(*attempt) + 1) as u64 * super::state::RETRY_INTERVAL_SECS
                });
            }
            WifiState::FallbackAp { stations_connected, probe_countdown_secs, target_ssid } => {
                s.active_ssid = Some("speedcamera".to_string());
                s.client_ip = None;
                s.connected_stations = *stations_connected;
                s.time_to_next_action = custom_time_to_action.unwrap_or_else(|| {
                    if target_ssid.is_some() {
                        *probe_countdown_secs
                    } else {
                        0
                    }
                });
            }
        }

        let snap_clone = s.clone();
        drop(s);
        let _ = broadcast_tx.send(snap_clone);
    }

    fn apply_effect_background(effect: &TransitionEffect, is_mock: bool) {
        if is_mock {
            tracing::debug!("[network-supervisor] Mock mode active — skipping shell script execution for effect: {:?}", effect);
            return;
        }

        match effect {
            TransitionEffect::None => {}
            TransitionEffect::ApplyApMode => {
                tracing::info!("[network-supervisor] Applying AP Fallback Mode");
                tokio::spawn(async move {
                    Self::execute_script_guarded(&["ap"], false).await;
                });
            }
            TransitionEffect::ApplyClientMode { ssid, password } => {
                tracing::info!("[network-supervisor] Connecting to Wi-Fi client: {}", ssid);
                let mut args = vec!["client".to_string(), ssid.clone()];
                if let Some(p) = password {
                    if !p.is_empty() {
                        args.push(p.clone());
                    }
                }
                tokio::spawn(async move {
                    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
                    Self::execute_script_guarded(&args_ref, false).await;
                });
            }
            TransitionEffect::ProbeConnect { ssid } => {
                tracing::info!("[network-supervisor] Background probe connect to: {}", ssid);
                tokio::spawn(async move {
                    Self::execute_script_guarded(&["auto"], false).await;
                });
            }
            TransitionEffect::ApplyCameraLan => {
                tokio::spawn(async move {
                    Self::execute_script_guarded(&["lan-camera"], false).await;
                });
            }
            TransitionEffect::ApplyEthernetDhcp => {
                tokio::spawn(async move {
                    Self::execute_script_guarded(&["lan-dhcp"], false).await;
                });
            }
        }
    }

    #[allow(dead_code)]
    async fn apply_effect(effect: &TransitionEffect) {
        Self::apply_effect_background(effect, false);
    }

    async fn execute_script_guarded(args: &[&str], is_mock: bool) -> Option<NetworkOperationResult> {
        if is_mock {
            return Some(Self::execute_script(args, true).await);
        }
        static SCRIPT_MUTEX: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
        let _guard = match SCRIPT_MUTEX.try_lock() {
            Ok(g) => g,
            Err(_) => {
                tracing::warn!("[network-supervisor] Script execution already in progress, skipping concurrent run");
                return None;
            }
        };
        Some(Self::execute_script(args, false).await)
    }

    fn query_ap_stations_count() -> usize {
        // Query station dump via iw
        if let Ok(output) = Command::new("iw").args(["dev", "wlan0", "station", "dump"]).output() {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                return text.lines().filter(|l| l.starts_with("Station ")).count();
            }
        }
        0
    }

    async fn execute_script(args: &[&str], is_mock: bool) -> NetworkOperationResult {
        if is_mock {
            tracing::info!("[network-supervisor] Mock execution of script with args: {:?}", args);
            return NetworkOperationResult {
                success: true,
                mode: args.first().cloned().unwrap_or_default().to_string(),
                message: "Mock script execution succeeded".to_string(),
                details: None,
            };
        }

        let script_paths = [
            Path::new("./scripts/setup-network.sh"),
            Path::new("../scripts/setup-network.sh"),
            Path::new("/home/pi/speedcamera/headless-rust/scripts/setup-network.sh"),
        ];

        let script = script_paths
            .iter()
            .find(|p| p.exists())
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("./scripts/setup-network.sh"));

        let args_owned: Vec<String> = args.iter().map(|s| s.to_string()).collect();

        tokio::task::spawn_blocking(move || {
            let mut cmd = Command::new("sudo");
            cmd.arg(&script);
            for a in &args_owned {
                cmd.arg(a);
            }

            tracing::info!("[network-supervisor] Executing: {:?}", cmd);
            match cmd.output() {
                Ok(out) => {
                    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                    let details = if stderr.is_empty() { stdout } else { format!("{}\n{}", stdout, stderr) };

                    NetworkOperationResult {
                        success: out.status.success(),
                        mode: args_owned.first().cloned().unwrap_or_default(),
                        message: if out.status.success() {
                            "Network operation succeeded".to_string()
                        } else {
                            "Network operation failed".to_string()
                        },
                        details: Some(details),
                    }
                }
                Err(err) => NetworkOperationResult {
                    success: false,
                    mode: args_owned.first().cloned().unwrap_or_default(),
                    message: format!("Execution failed: {}", err),
                    details: None,
                },
            }
        })
        .await
        .unwrap_or_else(|e| NetworkOperationResult {
            success: false,
            mode: "error".to_string(),
            message: format!("Join error: {}", e),
            details: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_supervisor_mock_reconnecting_countdown_ticks() {
        let sup = NetworkSupervisor::new(true);
        // Connect flow: UserConnect -> ConnectionSucceeded -> StationConnected
        sup.send_event(NetworkEvent::UserConnect {
            ssid: "TestWiFi".to_string(),
            password: None,
        }).await;
        tokio::time::sleep(Duration::from_millis(50)).await;

        sup.send_event(NetworkEvent::ConnectionSucceeded {
            ip: "192.168.1.50".to_string(),
            gateway: Some("192.168.1.1".to_string()),
            signal: Some(-60),
        }).await;
        tokio::time::sleep(Duration::from_millis(50)).await;

        // LinkLost triggers StationReconnecting
        sup.send_event(NetworkEvent::LinkLost).await;
        tokio::time::sleep(Duration::from_millis(50)).await;

        let snap1 = sup.snapshot();
        assert_eq!(snap1.wifi_state.as_str(), "reconnecting");
        assert_eq!(snap1.time_to_next_action, 60);

        // Wait ~1.1s for one tick
        tokio::time::sleep(Duration::from_millis(1100)).await;
        let snap2 = sup.snapshot();
        assert_eq!(snap2.wifi_state.as_str(), "reconnecting");
        assert_eq!(snap2.time_to_next_action, 59);
    }

    #[tokio::test]
    async fn test_supervisor_mock_fallback_ap_countdown_ticks() {
        let sup = NetworkSupervisor::new(true);
        // Connect flow: UserConnect -> ConnectionSucceeded -> StationConnected
        sup.send_event(NetworkEvent::UserConnect {
            ssid: "TestWiFi".to_string(),
            password: None,
        }).await;
        tokio::time::sleep(Duration::from_millis(50)).await;

        sup.send_event(NetworkEvent::ConnectionSucceeded {
            ip: "192.168.1.50".to_string(),
            gateway: Some("192.168.1.1".to_string()),
            signal: Some(-60),
        }).await;
        tokio::time::sleep(Duration::from_millis(50)).await;

        // Disconnect to enter reconnecting
        sup.send_event(NetworkEvent::LinkLost).await;
        tokio::time::sleep(Duration::from_millis(50)).await;

        // Exhaust all 6 attempts to enter FallbackAp
        for _ in 0..6 {
            sup.send_event(NetworkEvent::ConnectionAttemptFailed).await;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;

        let snap1 = sup.snapshot();
        assert_eq!(snap1.wifi_state.as_str(), "fallback_ap");
        assert_eq!(snap1.time_to_next_action, 60);

        // Wait ~1.1s for one tick
        tokio::time::sleep(Duration::from_millis(1100)).await;
        let snap2 = sup.snapshot();
        assert_eq!(snap2.wifi_state.as_str(), "fallback_ap");
        assert_eq!(snap2.time_to_next_action, 59);
    }
}

