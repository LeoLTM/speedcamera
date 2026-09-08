use serde::{Deserialize, Serialize};

// ponytail: lean models with camelCase serde serialization for web UI interoperability

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedUiConfig {
    pub unit: String,      // "kmh" | "mph"
    pub style: String,     // "large" | "detailed"
    pub hold_secs: u32,    // Hold measurement on screen
}

impl Default for SpeedUiConfig {
    fn default() -> Self {
        Self {
            unit: "kmh".to_string(),
            style: "large".to_string(),
            hold_secs: 5,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LapTimerUiConfig {
    pub style: String,     // "split" | "compact"
    pub show_speed: bool,
}

impl Default for LapTimerUiConfig {
    fn default() -> Self {
        Self {
            style: "split".to_string(),
            show_speed: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentUiConfig {
    pub style: String,     // "bars" | "text"
}

impl Default for AlignmentUiConfig {
    fn default() -> Self {
        Self {
            style: "bars".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayConfig {
    pub enabled: bool,
    pub i2c_bus: String,
    pub i2c_address: u8,
    pub rotation: u16,     // 0, 90, 180, 270
    pub contrast: u8,     // 0-255
    pub mode: String,      // "auto" | "speedcamera" | "laptimer" | "alignment" | "system" | "off"
    pub screen_timeout_secs: u32,
    pub speed_ui: SpeedUiConfig,
    pub laptimer_ui: LapTimerUiConfig,
    pub alignment_ui: AlignmentUiConfig,
}

impl Default for DisplayConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            i2c_bus: "/dev/i2c-1".to_string(),
            i2c_address: 0x3C,
            rotation: 0,
            contrast: 255,
            mode: "auto".to_string(),
            screen_timeout_secs: 0,
            speed_ui: SpeedUiConfig::default(),
            laptimer_ui: LapTimerUiConfig::default(),
            alignment_ui: AlignmentUiConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayStatus {
    pub connected: bool,
    pub mock_mode: bool,
    pub active_screen: String,
    pub bus: String,
    pub address: String,
    pub width: u32,
    pub height: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetDisplayModeInput {
    pub mode: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetDisplayPowerInput {
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayPreviewResponse {
    pub width: u32,
    pub height: u32,
    pub bitmap_base64: String,
    pub active_screen: String,
}
