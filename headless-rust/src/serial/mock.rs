use crate::models::{EspPongConfig, SerialStatusPayload};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::broadcast;

pub struct MockSerial {
    #[allow(dead_code)]
    running: Arc<AtomicBool>,
}

impl MockSerial {
    pub fn new(tx: broadcast::Sender<SerialStatusPayload>) -> Self {
        let running = Arc::new(AtomicBool::new(true));
        let r = running.clone();

        tokio::spawn(async move {
            let mut counter = 0;
            while r.load(Ordering::SeqCst) {
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                counter += 1;

                let now = chrono::Utc::now().timestamp_millis();
                let speed = 35.0 + (counter % 15) as f64;

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
        });

        Self { running }
    }

    pub fn send_command(&self, json: &str, tx: &broadcast::Sender<SerialStatusPayload>) {
        if json.to_lowercase().contains("\"ping\"") {
            let _ = tx.send(SerialStatusPayload::Pong {
                config: EspPongConfig {
                    max_speed: 30.0,
                    flash_delay: Some(0.0),
                    flash_duration: Some(5000.0),
                    sensor_distance: 1.0,
                    debug_enabled: false,
                    lap_mode: "single".to_string(),
                    lap_active: false,
                    lap_auto_flash: Some(true),
                    lap_dir_filter: "both".to_string(),
                },
            });
        }
    }
}
