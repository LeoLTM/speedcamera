use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LapSession {
    pub id: i64,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub lap_mode: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lap {
    pub id: i64,
    pub session_id: i64,
    pub lap_number: i64,
    pub start_timestamp: i64,
    pub end_timestamp: i64,
    pub duration_ms: i64,
    pub speed_at_start: f64,
    pub speed_at_end: f64,
    pub start_image_path: Option<String>,
    pub end_image_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LapSessionWithLaps {
    pub id: i64,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub lap_mode: String,
    pub created_at: String,
    pub laps: Vec<Lap>,
}

fn deserialize_duration_ms<'de, D>(deserializer: D) -> Result<i64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum IntOrFloat {
        Int(i64),
        Float(f64),
    }
    match IntOrFloat::deserialize(deserializer)? {
        IntOrFloat::Int(i) => Ok(i),
        IntOrFloat::Float(f) => Ok(f.round() as i64),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLapInput {
    pub session_id: i64,
    pub lap_number: i64,
    pub start_timestamp: i64,
    pub end_timestamp: i64,
    #[serde(deserialize_with = "deserialize_duration_ms")]
    pub duration_ms: i64,
    pub speed_at_start: f64,
    pub speed_at_end: f64,
    pub start_image_base64: Option<String>,
    pub end_image_base64: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncLapInput {
    pub lap: Lap,
    pub session: LapSession,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartLapSessionInput {
    #[serde(default = "default_lap_mode")]
    pub lap_mode: String,
    #[serde(default = "default_dir_filter")]
    pub dir_filter: String,
    #[serde(default = "default_save_images")]
    pub save_images: bool,
}

fn default_lap_mode() -> String {
    "single".to_string()
}
fn default_dir_filter() -> String {
    "both".to_string()
}
fn default_save_images() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveLapSessionResponse {
    pub session: Option<LapSessionWithLaps>,
    pub lap_state: String, // "idle" | "waiting" | "timing"
    pub lap_number: i64,
    pub lap_timing_started_at: Option<i64>,
    pub lap_mode: String,
    pub dir_filter: String,
    pub save_images: bool,
}

