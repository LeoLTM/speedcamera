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

impl EspMessage {
    pub fn to_serial_status(&self, timestamp: i64) -> Option<SerialStatusPayload> {
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
