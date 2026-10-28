use crate::models::{EspPongConfig, SerialStatusPayload};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status")]
pub enum EspMessage {
    #[serde(rename = "speeding")]
    Speeding {
        value: f64,
        tolerance: f64,
        direction: String,
    },
    #[serde(rename = "legal")]
    Legal {
        value: f64,
        tolerance: f64,
        direction: String,
    },
    #[serde(rename = "pong")]
    Pong { config: EspPongConfig },
    #[serde(rename = "lapStart")]
    LapStart {
        #[serde(rename = "lapNumber")]
        lap_number: i64,
        #[serde(rename = "speedAtStart")]
        speed_at_start: f64,
    },
    #[serde(rename = "lapEnd")]
    LapEnd {
        #[serde(rename = "lapNumber")]
        lap_number: i64,
        #[serde(rename = "durationMs")]
        duration_ms: f64,
        #[serde(default, rename = "durationUs")]
        duration_us: Option<u64>,
        #[serde(rename = "speedAtStart")]
        speed_at_start: f64,
        #[serde(rename = "speedAtEnd")]
        speed_at_end: f64,
    },
    #[serde(rename = "lapCrossing")]
    LapCrossing {
        t: u64,
        age: u32,
        boot: u32,
        speed: f64,
        direction: String,
    },
    #[serde(rename = "lapWaiting")]
    LapWaiting,
    #[serde(rename = "lapStopped")]
    LapStopped,
    #[serde(rename = "barrierStatus")]
    BarrierStatus {
        s1: bool,
        s2: bool,
    },
    #[serde(rename = "config")]
    Config {
        key: String,
        value: f64,
    },
    #[serde(rename = "configError")]
    ConfigError { message: String },
    #[serde(other)]
    Unknown,
}

/// Time to shift one line of `line_len` bytes plus newline through the 115200-baud UART
/// (10 bits per byte). The ESP stamps `age` before writing, so the line was this much older.
pub fn wire_time_us(line_len: usize) -> i64 {
    ((line_len as i64 + 1) * 10 * 1_000_000) / 115_200
}

impl EspMessage {
    /// `rx_us` is the host wall clock (µs) when the line was read; `line_len` its length in bytes.
    pub fn to_serial_status(&self, rx_us: i64, line_len: usize) -> Option<SerialStatusPayload> {
        let timestamp = rx_us / 1000;
        match self {
            Self::Speeding {
                value,
                tolerance,
                direction,
            } => Some(SerialStatusPayload::Speeding {
                value: *value,
                tolerance: *tolerance,
                direction: direction.clone(),
                timestamp,
            }),
            Self::Legal {
                value,
                tolerance,
                direction,
            } => Some(SerialStatusPayload::Ok {
                value: *value,
                tolerance: *tolerance,
                direction: direction.clone(),
                timestamp,
            }),
            Self::Pong { config } => Some(SerialStatusPayload::Pong {
                config: config.clone(),
            }),
            Self::LapStart {
                lap_number,
                speed_at_start,
            } => Some(SerialStatusPayload::LapStart {
                lap_number: *lap_number,
                speed_at_start: *speed_at_start,
                timestamp,
            }),
            Self::LapEnd {
                lap_number,
                duration_ms,
                duration_us,
                speed_at_start,
                speed_at_end,
            } => Some(SerialStatusPayload::LapEnd {
                lap_number: *lap_number,
                duration_ms: *duration_ms,
                duration_us: *duration_us,
                speed_at_start: *speed_at_start,
                speed_at_end: *speed_at_end,
                timestamp,
            }),
            Self::LapCrossing {
                t,
                age,
                boot,
                speed,
                direction,
            } => {
                let wall_us = rx_us - *age as i64 - wire_time_us(line_len);
                Some(SerialStatusPayload::LapCrossing {
                    boundary_us: *t,
                    wall_us,
                    esp_boot: *boot,
                    speed: *speed,
                    direction: direction.clone(),
                    timestamp: wall_us / 1000,
                })
            }
            Self::LapWaiting => Some(SerialStatusPayload::LapWaiting),
            Self::LapStopped => Some(SerialStatusPayload::LapStopped),
            Self::BarrierStatus { s1, s2 } => Some(SerialStatusPayload::BarrierStatus {
                sensor1_interrupted: *s1,
                sensor2_interrupted: *s2,
                timestamp,
            }),
            Self::Config { key, value } => Some(SerialStatusPayload::Config {
                key: key.clone(),
                value: *value,
            }),
            Self::ConfigError { .. } | Self::Unknown => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lap_crossing_is_backdated_by_age_and_wire_time() {
        let line = r#"{"status":"lapCrossing","t":5000000000,"age":1200,"boot":42,"speed":38.4,"direction":"forward"}"#;
        let msg: EspMessage = serde_json::from_str(line).unwrap();
        let rx_us = 1_700_000_000_000_000;
        match msg.to_serial_status(rx_us, line.len()) {
            Some(SerialStatusPayload::LapCrossing {
                boundary_us,
                wall_us,
                esp_boot,
                speed,
                direction,
                timestamp,
            }) => {
                assert_eq!(boundary_us, 5_000_000_000);
                assert_eq!(wall_us, rx_us - 1200 - wire_time_us(line.len()));
                assert_eq!(timestamp, wall_us / 1000);
                assert_eq!(esp_boot, 42);
                assert_eq!(speed, 38.4);
                assert_eq!(direction, "forward");
            }
            other => panic!("unexpected {:?}", other),
        }
    }

    #[test]
    fn wire_time_matches_115200_baud() {
        // 95 bytes + newline = 960 bits ≈ 8.33 ms
        assert_eq!(wire_time_us(95), 8333);
    }

    #[test]
    fn pong_without_lap_crossing_flag_is_old_firmware() {
        let line = r#"{"status":"pong","config":{"maxSpeed":30,"sensorDistance":135,"debugEnabled":false,"lapMode":"single","lapActive":false,"lapDirFilter":"both"}}"#;
        match serde_json::from_str::<EspMessage>(line).unwrap() {
            EspMessage::Pong { config } => assert!(!config.lap_crossing),
            other => panic!("unexpected {:?}", other),
        }
    }
}
