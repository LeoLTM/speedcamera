pub mod compress;
pub mod skin;

use base64::Engine;
use chrono::Utc;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone)]
pub struct FileStore {
    pub images_dir: PathBuf,
    pub compressor: compress::ImageCompressor,
}

impl FileStore {
    pub fn new(images_dir: &Path) -> Self {
        let _ = fs::create_dir_all(images_dir);
        let compressor = compress::ImageCompressor::new(images_dir);
        Self {
            images_dir: images_dir.to_path_buf(),
            compressor,
        }
    }

    pub fn save_image_bytes(&self, bytes: &[u8], extension: &str) -> std::io::Result<String> {
        let ts = Utc::now().format("%Y%m%d_%H%M%S_%3f").to_string();
        let filename = format!("capture_{}.{}", ts, extension);
        let target_path = self.images_dir.join(&filename);

        fs::write(&target_path, bytes)?;
        Ok(target_path.to_string_lossy().to_string())
    }

    pub fn save_base64_image(&self, b64_raw: &str) -> std::io::Result<String> {
        // Strip optional data:image/png;base64, prefix
        let clean_b64 = if let Some(pos) = b64_raw.find(",") {
            &b64_raw[pos + 1..]
        } else {
            b64_raw
        };

        let decoded = base64::engine::general_purpose::STANDARD
            .decode(clean_b64.trim())
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;

        let ext = if decoded.starts_with(&[0xFF, 0xD8, 0xFF]) {
            "jpg"
        } else {
            "png"
        };

        self.save_image_bytes(&decoded, ext)
    }

    pub fn read_image(&self, path_str: &str) -> Option<Vec<u8>> {
        let path = Path::new(path_str);
        if path.exists() {
            fs::read(path).ok()
        } else {
            // Check inside images_dir directly if relative or basename
            let inside = self.images_dir.join(path_str);
            if inside.exists() {
                fs::read(inside).ok()
            } else {
                None
            }
        }
    }

    pub fn delete_image(&self, path_str: &str) -> bool {
        let path = Path::new(path_str);
        if path.exists() {
            fs::remove_file(path).is_ok()
        } else {
            let inside = self.images_dir.join(path_str);
            if inside.exists() {
                fs::remove_file(inside).is_ok()
            } else {
                false
            }
        }
    }
}
