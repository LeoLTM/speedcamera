use crate::models::{EspPongConfig, SerialStatusPayload};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::broadcast;

struct MockState {
    /// Lap crossing reports on (`startLapSession` / `setMode laptimer`), like the firmware.
    lap_active: bool,
    alignment_active: bool,
    max_speed: f64,
}

pub struct MockSerial {
    #[allow(dead_code)]
    running: Arc<AtomicBool>,
    state: Arc<Mutex<MockState>>,
}

impl MockSerial {
    pub fn new(tx: broadcast::Sender<SerialStatusPayload>) -> Self {
        let running = Arc::new(AtomicBool::new(true));
        let state = Arc::new(Mutex::new(MockState {
            lap_active: false,
            alignment_active: false,
            max_speed: 30.0,
        }));
        // Like the firmware: µs since "boot" and a per-boot id
        let booted = Instant::now();
        let boot_id = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(1);

        let r = running.clone();
        let s = state.clone();

        let r_align = running.clone();
        let s_align = state.clone();
        let tx_align = tx.clone();
        tokio::spawn(async move {
            let mut tick = 0u64;
            while r_align.load(Ordering::SeqCst) {
                tokio::time::sleep(tokio::time::Duration::from_millis(400)).await;
                let is_active = s_align.lock().unwrap().alignment_active;
                if is_active {
                    tick += 1;
                    let s1 = (tick % 8) == 0;
                    let s2 = (tick % 12) == 0;
                    let _ = tx_align.send(SerialStatusPayload::BarrierStatus {
                        sensor1_interrupted: s1,
                        sensor2_interrupted: s2,
                        timestamp: chrono::Utc::now().timestamp_millis(),
                    });
                }
            }
        });

        tokio::spawn(async move {
            let mut counter = 0;
            while r.load(Ordering::SeqCst) {
                tokio::time::sleep(tokio::time::Duration::from_secs(4)).await;
                counter += 1;

                let now = chrono::Utc::now().timestamp_millis();
                let speed = 35.0 + (counter % 15) as f64;

                // Every 7th pass is someone walking through the barrier
                let speed = if counter % 7 == 0 { 4.5 } else { speed };
                let (lap_active, max_speed) = {
                    let guard = s.lock().unwrap();
                    (guard.lap_active, guard.max_speed)
                };

                let payload = if speed > max_speed {
                    SerialStatusPayload::Speeding {
                        value: speed,
                        tolerance: 0.5,
                        direction: "forward".to_string(),
                        timestamp: now,
                    }
                } else {
                    SerialStatusPayload::Ok {
                        value: speed,
                        tolerance: 0.5,
                        direction: "forward".to_string(),
                        timestamp: now,
                    }
                };
                let _ = tx.send(payload);

                if lap_active {
                    let wall_us = chrono::Utc::now().timestamp_micros();
                    let _ = tx.send(SerialStatusPayload::LapCrossing {
                        boundary_us: booted.elapsed().as_micros() as u64,
                        wall_us,
                        esp_boot: boot_id,
                        speed,
                        direction: "forward".to_string(),
                        timestamp: wall_us / 1000,
                    });
                }
            }
        });

        Self { running, state }
    }

    pub fn send_command(&self, json: &str, tx: &broadcast::Sender<SerialStatusPayload>) {
        if let Ok(v) = serde_json::from_str::<Value>(json) {
            let cmd = v["command"].as_str().unwrap_or("");
            match cmd {
                "startLapSession" => {
                    self.state.lock().unwrap().lap_active = true;
                    let _ = tx.send(SerialStatusPayload::LapWaiting);
                }
                "stopLapSession" => {
                    self.state.lock().unwrap().lap_active = false;
                    let _ = tx.send(SerialStatusPayload::LapStopped);
                }
                "setMode" => {
                    let laps = v["mode"].as_str() == Some("laptimer");
                    let mut guard = self.state.lock().unwrap();
                    guard.lap_active = laps;
                    if laps {
                        let _ = tx.send(SerialStatusPayload::LapWaiting);
                    } else {
                        guard.alignment_active = v["mode"].as_str() == Some("alignment");
                    }
                }
                "startAlignment" => {
                    let mut guard = self.state.lock().unwrap();
                    guard.alignment_active = true;
                    let _ = tx.send(SerialStatusPayload::BarrierStatus {
                        sensor1_interrupted: false,
                        sensor2_interrupted: false,
                        timestamp: chrono::Utc::now().timestamp_millis(),
                    });
                }
                "stopAlignment" => {
                    let mut guard = self.state.lock().unwrap();
                    guard.alignment_active = false;
                }
                "setMaxSpeed" => {
                    let val = v["value"].as_f64().unwrap_or(30.0);
                    {
                        let mut guard = self.state.lock().unwrap();
                        guard.max_speed = val;
                    }
                    let _ = tx.send(SerialStatusPayload::Config {
                        key: "maxSpeed".to_string(),
                        value: val,
                    });
                }
                "ping" => {
                    let guard = self.state.lock().unwrap();
                    let _ = tx.send(SerialStatusPayload::Pong {
                        config: EspPongConfig {
                            max_speed: guard.max_speed,
                            flash_delay: Some(0.0),
                            flash_duration: Some(5000.0),
                            sensor_distance: 1.0,
                            debug_enabled: false,
                            lap_mode: "host".to_string(),
                            lap_active: guard.lap_active,
                            lap_auto_flash: None,
                            lap_dir_filter: "both".to_string(),
                            lap_crossing: true,
                        },
                    });
                }
                _ => {}
            }
        }
    }
}
