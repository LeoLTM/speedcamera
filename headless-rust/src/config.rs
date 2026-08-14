use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub host: String,
    pub port: u16,
    pub data_dir: PathBuf,
    pub images_dir: PathBuf,
    pub db_path: PathBuf,
    pub mock_mode: bool,
}

impl AppConfig {
    pub fn new(mock: bool, port_override: Option<u16>) -> Self {
        let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
        let port = port_override.unwrap_or_else(|| {
            std::env::var("PORT")
                .ok()
                .and_then(|p| p.parse::<u16>().ok())
                .unwrap_or(3000)
        });

        let data_dir = if let Ok(custom) = std::env::var("DATA_DIR") {
            PathBuf::from(custom)
        } else if let Ok(home) = std::env::var("HOME") {
            PathBuf::from(home).join(".speedcamera")
        } else {
            PathBuf::from(".speedcamera")
        };

        let images_dir = data_dir.join("images");
        let db_path = data_dir.join("speedcamera.db");

        // Ensure directories exist
        let _ = std::fs::create_dir_all(&data_dir);
        let _ = std::fs::create_dir_all(&images_dir);

        let mock_mode = mock
            || std::env::var("MOCK_MODE").map(|v| v == "true" || v == "1").unwrap_or(false)
            || std::env::var("SPEEDCAMERA_MOCK").map(|v| v == "true" || v == "1").unwrap_or(false);

        Self {
            host,
            port,
            data_dir,
            images_dir,
            db_path,
            mock_mode,
        }
    }
}
