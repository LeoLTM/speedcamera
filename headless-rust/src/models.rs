use serde::{Deserialize, Serialize};

// ─── Domain Models ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInterfaceDetail {
    pub name: string_or_empty::StringOrEmpty,
    pub role: String, // "camera-lan" | "hotspot-ap" | "other" | "loopback"
    pub address: String,
    pub family: String,
    pub netmask: String,
    pub mac: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_ip: Option<String>,
    pub is_configured: bool,
}

mod string_or_empty {
    pub type StringOrEmpty = String;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubnetInfo {
    pub interface_name: Option<String>,
    pub ip: Option<String>,
    pub expected_ip: String,
    pub subnet: String,
    pub status: String, // "ok" | "ip_mismatch" | "missing"
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemNetworkSummary {
    pub camera_lan: SubnetInfo,
    pub hotspot_ap: SubnetInfo,
    pub interfaces: Vec<NetworkInterfaceDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Violation {
    pub id: i64,
    pub timestamp: String,
    pub measured_speed: f64,
    pub max_speed: f64,
    pub direction: String, // "forward" | "reverse"
    pub image_path: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveViolationInput {
    #[serde(default)]
    pub image_base64: Option<String>,
    pub measured_speed: f64,
    pub max_speed: f64,
    #[serde(default = "default_direction")]
    pub direction: String,
}

fn default_direction() -> String {
    "forward".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub max_speed: f64,
    pub selected_port: String,
    // Industrial Camera Settings
    pub camera_exposure: f64,
    pub camera_gain: f64,
    pub strobe_line_duration: f64,
    pub pixel_format: String,
    pub exposure_auto: String,
    pub gain_auto: String,
    pub frame_rate: f64,
    pub camera_width: i64,
    pub camera_height: i64,
    pub black_level: f64,
    // Lap timer settings
    pub lap_mode: String,
    pub lap_save_images: String,
    pub lap_dir_filter: String,
    // Teable integration
    pub teable_url: String,
    pub teable_token: String,
    pub teable_user_name: String,
    pub teable_user_email: String,
    pub teable_user_avatar: String,
    pub teable_space_id: String,
    pub teable_base_id: String,
    pub teable_table_id: String,
    pub teable_sync_enabled: String,
    // GitHub
    pub github_token: String,
    // Poliscan skin
    pub skin_measuring_location: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            max_speed: 30.0,
            selected_port: String::new(),
            camera_exposure: 5000.0,
            camera_gain: 0.0,
            strobe_line_duration: 5000.0,
            pixel_format: "Mono".to_string(),
            exposure_auto: "Off".to_string(),
            gain_auto: "Off".to_string(),
            frame_rate: 30.0,
            camera_width: 1280,
            camera_height: 1024,
            black_level: 0.0,
            lap_mode: "single".to_string(),
            lap_save_images: "true".to_string(),
            lap_dir_filter: "both".to_string(),
            teable_url: String::new(),
            teable_token: String::new(),
            teable_user_name: String::new(),
            teable_user_email: String::new(),
            teable_user_avatar: String::new(),
            teable_space_id: String::new(),
            teable_base_id: String::new(),
            teable_table_id: String::new(),
            teable_sync_enabled: "false".to_string(),
            github_token: String::new(),
            skin_measuring_location: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortInfo {
    pub path: String,
    pub manufacturer: Option<String>,
    pub serial_number: Option<String>,
    pub pnp_id: Option<String>,
    pub location_id: Option<String>,
    pub product_id: Option<String>,
    pub vendor_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraStatusPayload {
    pub connected: bool,
    pub vendor: Option<String>,
    pub model: Option<String>,
    pub serial: Option<String>,
    pub is_streaming: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MfsConfigResult {
    pub applied: Vec<String>,
    pub failed: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViolationQuery {
    pub page: i64,
    pub limit: i64,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub min_speed: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViolationPage {
    pub violations: Vec<Violation>,
    pub total: i64,
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EspPongConfig {
    pub max_speed: f64,
    #[serde(default)]
    pub flash_delay: Option<f64>,
    #[serde(default)]
    pub flash_duration: Option<f64>,
    pub sensor_distance: f64,
    pub debug_enabled: bool,
    pub lap_mode: String,
    pub lap_active: bool,
    #[serde(default)]
    pub lap_auto_flash: Option<bool>,
    pub lap_dir_filter: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialStatusInfo {
    pub connected: bool,
    pub port: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status")]
pub enum SerialStatusPayload {
    #[serde(rename = "SPEEDING")]
    Speeding {
        value: f64,
        tolerance: f64,
        direction: String,
        timestamp: i64,
    },
    #[serde(rename = "OK")]
    Ok {
        value: f64,
        tolerance: f64,
        direction: String,
        timestamp: i64,
    },
    #[serde(rename = "PONG")]
    Pong { config: EspPongConfig },
    #[serde(rename = "LAPSTART")]
    LapStart {
        #[serde(rename = "lapNumber")]
        lap_number: i64,
        #[serde(rename = "speedAtStart")]
        speed_at_start: f64,
        timestamp: i64,
    },
    #[serde(rename = "LAPEND")]
    LapEnd {
        #[serde(rename = "lapNumber")]
        lap_number: i64,
        #[serde(rename = "durationMs")]
        duration_ms: f64,
        #[serde(rename = "speedAtStart")]
        speed_at_start: f64,
        #[serde(rename = "speedAtEnd")]
        speed_at_end: f64,
        timestamp: i64,
    },
    #[serde(rename = "LAPWAITING")]
    LapWaiting,
    #[serde(rename = "LAPSTOPPED")]
    LapStopped,
    #[serde(rename = "CONNECTED")]
    Connected {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        port: Option<String>,
    },
    #[serde(rename = "DISCONNECTED")]
    Disconnected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum FlashProgressPayload {
    #[serde(rename = "downloading")]
    Downloading,
    #[serde(rename = "output")]
    Output { line: String },
    #[serde(rename = "done")]
    Done,
    #[serde(rename = "error")]
    Error { message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubRelease {
    pub tag: String,
    pub name: String,
    pub published_at: String,
    pub prerelease: bool,
    pub firmware_asset_api_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeableUser {
    pub id: String,
    pub name: String,
    pub email: String,
    pub avatar: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeableSpace {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeableBase {
    pub id: String,
    pub name: String,
    pub space_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeableTable {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct TeableSchemaCheck {
    pub missing_fields: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncLapInput {
    pub lap: Lap,
    pub session: LapSession,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportSkinnedResult {
    pub exported: usize,
    pub failed: usize,
}
