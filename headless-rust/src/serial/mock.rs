use crate::models::{EspPongConfig, SerialStatusPayload};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::broadcast;

#[derive(Clone, Copy, PartialEq, Eq)]
enum MockLapState {
    Idle,
    Waiting,
    Timing,
}

struct MockState {
    lap_state: MockLapState,
    lap_mode: String,
    lap_number: i64,
    lap_start_time: Option<Instant>,
    lap_start_speed: f64,
    alignment_active: bool,
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
            lap_state: MockLapState::Idle,
            lap_mode: "single".to_string(),
            lap_number: 1,
            lap_start_time: None,
            lap_start_speed: 0.0,
            alignment_active: false,
        }));

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

                let mut guard = s.lock().unwrap();
                match guard.lap_state {
                    MockLapState::Idle => {
                        let payload = if speed > 40.0 {
                            SerialStatusPayload::Speeding {
                                value: speed,
                                tolerance: 3.0,
                                direction: "forward".to_string(),
                                timestamp: now,
                            }
                        } else {
                            SerialStatusPayload::Ok {
                                value: speed,
                                tolerance: 3.0,
                                direction: "forward".to_string(),
                                timestamp: now,
                            }
                        };
                        let _ = tx.send(payload);
                    }
                    MockLapState::Waiting => {
                        // First car pass starts the lap
                        let _ = tx.send(SerialStatusPayload::Ok {
                            value: speed,
                            tolerance: 0.5,
                            direction: "forward".to_string(),
                            timestamp: now,
                        });
                        guard.lap_state = MockLapState::Timing;
                        guard.lap_start_time = Some(Instant::now());
                        guard.lap_start_speed = speed;
                        let _ = tx.send(SerialStatusPayload::LapStart {
                            lap_number: guard.lap_number,
                            speed_at_start: speed,
                            timestamp: now,
                        });
                    }
                    MockLapState::Timing => {
                        // Second car pass finishes the lap
                        let start_time = guard.lap_start_time.unwrap_or_else(Instant::now);
                        let duration_ms = start_time.elapsed().as_secs_f64() * 1000.0;
                        let start_speed = guard.lap_start_speed;
                        let end_speed = speed;
                        let lap_num = guard.lap_number;

                        let _ = tx.send(SerialStatusPayload::Ok {
                            value: end_speed,
                            tolerance: 0.5,
                            direction: "forward".to_string(),
                            timestamp: now,
                        });

                        let _ = tx.send(SerialStatusPayload::LapEnd {
                            lap_number: lap_num,
                            duration_ms,
                            duration_us: Some(start_time.elapsed().as_micros() as u64),
                            speed_at_start: start_speed,
                            speed_at_end: end_speed,
                            timestamp: now,
                        });

                        if guard.lap_mode == "multi" {
                            guard.lap_number += 1;
                            guard.lap_start_time = Some(Instant::now());
                            guard.lap_start_speed = end_speed;
                            let _ = tx.send(SerialStatusPayload::LapStart {
                                lap_number: guard.lap_number,
                                speed_at_start: end_speed,
                                timestamp: now,
                            });
                        } else {
                            guard.lap_state = MockLapState::Waiting;
                            guard.lap_number = 1;
                            guard.lap_start_time = None;
                            guard.lap_start_speed = 0.0;
                        }
                    }
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
                    let mode = v["mode"].as_str().unwrap_or("single").to_string();
                    let mut guard = self.state.lock().unwrap();
                    guard.lap_state = MockLapState::Waiting;
                    guard.lap_mode = mode;
                    guard.lap_number = 1;
                    guard.lap_start_time = None;
                    guard.lap_start_speed = 0.0;
                    let _ = tx.send(SerialStatusPayload::LapWaiting);
                }
                "stopLapSession" => {
                    let mut guard = self.state.lock().unwrap();
                    guard.lap_state = MockLapState::Idle;
                    guard.lap_start_time = None;
                    guard.lap_start_speed = 0.0;
                    let _ = tx.send(SerialStatusPayload::LapStopped);
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
                "ping" => {
                    let guard = self.state.lock().unwrap();
                    let _ = tx.send(SerialStatusPayload::Pong {
                        config: EspPongConfig {
                            max_speed: 30.0,
                            flash_delay: Some(0.0),
                            flash_duration: Some(5000.0),
                            sensor_distance: 1.0,
                            debug_enabled: false,
                            lap_mode: guard.lap_mode.clone(),
                            lap_active: guard.lap_state != MockLapState::Idle,
                            lap_auto_flash: Some(true),
                            lap_dir_filter: "both".to_string(),
                        },
                    });
                }
                _ => {}
            }
        }
    }
}
