use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub host: String,
    pub port: u16,
    pub data_dir: PathBuf,
    pub images_dir: PathBuf,
    pub db_path: PathBuf,
    pub mock_mode: bool,
    pub disabled_plugins: Vec<String>,
}

impl AppConfig {
    pub fn new(
        mock: bool,
        port_override: Option<u16>,
        host_override: Option<String>,
        disable_plugins_override: Option<String>,
    ) -> Self {
        let host = host_override
            .or_else(|| std::env::var("HOST").ok())
            .unwrap_or_else(|| "0.0.0.0".to_string());
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

        let disabled_plugins: Vec<String> = disable_plugins_override
            .or_else(|| std::env::var("DISABLED_PLUGINS").ok())
            .map(|s| {
                s.split(',')
                    .map(|p| p.trim().to_lowercase())
                    .filter(|p| !p.is_empty())
                    .collect()
            })
            .unwrap_or_default();

        Self {
            host,
            port,
            data_dir,
            images_dir,
            db_path,
            mock_mode,
            disabled_plugins,
        }
    }

    pub fn is_plugin_disabled(&self, name: &str) -> bool {
        self.disabled_plugins.iter().any(|p| p == name)
    }
}
