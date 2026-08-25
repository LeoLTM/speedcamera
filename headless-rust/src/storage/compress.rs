use fast_image_resize as fir;
use fast_image_resize::images::Image;
use fast_image_resize::IntoImageView;
use image::{DynamicImage, GenericImageView, ImageFormat};
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};

// ponytail: lightweight query/resize param struct with sensible defaults
#[derive(Debug, Clone, Default)]
pub struct CompressParams {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub quality: Option<u8>,
    pub format: Option<String>,
}

#[derive(Clone)]
pub struct ImageCompressor {
    cache_dir: PathBuf,
}

impl ImageCompressor {
    pub fn new(images_dir: &Path) -> Self {
        // ponytail: store thumbnails in a dedicated sibling cache folder
        let cache_dir = images_dir.join(".thumbnails_cache");
        let _ = fs::create_dir_all(&cache_dir);
        Self { cache_dir }
    }

    /// Fast cache lookup or multicore SIMD compression
    pub fn process_image(
        &self,
        raw_bytes: &[u8],
        cache_identifier: &str,
        params: &CompressParams,
    ) -> Result<(Vec<u8>, &'static str), String> {
        let width = params.width;
        let height = params.height;
        let quality = params.quality.unwrap_or(80).clamp(10, 100);
        let requested_fmt = params.format.as_deref().unwrap_or("auto");

        // If no resizing or format conversion requested, return original directly
        if width.is_none() && height.is_none() && (requested_fmt == "auto" || requested_fmt == "original") {
            let mime = if raw_bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
                "image/jpeg"
            } else if raw_bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
                "image/png"
            } else if raw_bytes.starts_with(b"RIFF") && raw_bytes.len() > 12 && &raw_bytes[8..12] == b"WEBP" {
                "image/webp"
            } else {
                "image/jpeg"
            };
            return Ok((raw_bytes.to_vec(), mime));
        }

        // Generate deterministic cache filename
        let ext = match requested_fmt {
            "png" => "png",
            "webp" => "webp",
            _ => "jpg",
        };
        let sanitized_id = cache_identifier
            .chars()
            .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
            .collect::<String>();
        let cache_filename = format!(
            "{}_w{}_h{}_q{}.{}",
            sanitized_id,
            width.unwrap_or(0),
            height.unwrap_or(0),
            quality,
            ext
        );
        let cache_path = self.cache_dir.join(&cache_filename);

        // 1. Cache hit check (zero CPU overhead)
        if cache_path.exists() {
            if let Ok(cached_bytes) = fs::read(&cache_path) {
                let mime = match ext {
                    "png" => "image/png",
                    "webp" => "image/webp",
                    _ => "image/jpeg",
                };
                return Ok((cached_bytes, mime));
            }
        }

        // 2. Multicore SIMD resize and compress
        let img = image::load_from_memory(raw_bytes)
            .map_err(|e| format!("Failed to decode image: {}", e))?;
        let (orig_w, orig_h) = img.dimensions();

        let (target_w, target_h) = match (width, height) {
            (Some(w), Some(h)) => {
                let ratio = (w as f64 / orig_w as f64).min(h as f64 / orig_h as f64);
                let tw = (orig_w as f64 * ratio).round().max(1.0) as u32;
                let th = (orig_h as f64 * ratio).round().max(1.0) as u32;
                (tw, th)
            }
            (Some(w), None) => {
                if w >= orig_w {
                    (orig_w, orig_h)
                } else {
                    let ratio = w as f64 / orig_w as f64;
                    let th = (orig_h as f64 * ratio).round().max(1.0) as u32;
                    (w, th)
                }
            }
            (None, Some(h)) => {
                if h >= orig_h {
                    (orig_w, orig_h)
                } else {
                    let ratio = h as f64 / orig_h as f64;
                    let tw = (orig_w as f64 * ratio).round().max(1.0) as u32;
                    (tw, h)
                }
            }
            (None, None) => (orig_w, orig_h),
        };

        // Resize with fast_image_resize if dimensions changed
        let resized_img = if target_w != orig_w || target_h != orig_h {
            let mut dst_image = Image::new(
                target_w,
                target_h,
                img.pixel_type().ok_or("Unsupported pixel format")?,
            );
            let mut resizer = fir::Resizer::new();
            let options = fir::ResizeOptions::default()
                .resize_alg(fir::ResizeAlg::Convolution(fir::FilterType::CatmullRom));

            resizer
                .resize(&img, &mut dst_image, &options)
                .map_err(|e| format!("Resizing failed: {}", e))?;

            // Convert back to DynamicImage based on buffer format
            match img {
                DynamicImage::ImageRgb8(_) => {
                    DynamicImage::ImageRgb8(image::RgbImage::from_raw(target_w, target_h, dst_image.into_vec()).ok_or("Buffer mismatch")?)
                }
                DynamicImage::ImageRgba8(_) => {
                    DynamicImage::ImageRgba8(image::RgbaImage::from_raw(target_w, target_h, dst_image.into_vec()).ok_or("Buffer mismatch")?)
                }
                DynamicImage::ImageLuma8(_) => {
                    DynamicImage::ImageLuma8(image::GrayImage::from_raw(target_w, target_h, dst_image.into_vec()).ok_or("Buffer mismatch")?)
                }
                _ => {
                    let rgb = img.to_rgb8();
                    let mut fallback_dst = Image::new(target_w, target_h, fir::PixelType::U8x3);
                    resizer.resize(&rgb, &mut fallback_dst, &options).map_err(|e| format!("Resizing fallback failed: {}", e))?;
                    DynamicImage::ImageRgb8(image::RgbImage::from_raw(target_w, target_h, fallback_dst.into_vec()).ok_or("Buffer mismatch")?)
                }
            }
        } else {
            img
        };

        // Encode to target format
        let mut out_buffer = Cursor::new(Vec::new());
        let mime = match ext {
            "png" => {
                resized_img
                    .write_to(&mut out_buffer, ImageFormat::Png)
                    .map_err(|e| format!("PNG encode error: {}", e))?;
                "image/png"
            }
            "webp" => {
                // ponytail: fallback to JPEG if webp encoder fails
                if resized_img.write_to(&mut out_buffer, ImageFormat::WebP).is_ok() {
                    "image/webp"
                } else {
                    out_buffer.get_mut().clear();
                    let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out_buffer, quality);
                    enc.encode_image(&resized_img).map_err(|e| format!("JPEG fallback error: {}", e))?;
                    "image/jpeg"
                }
            }
            _ => {
                let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out_buffer, quality);
                enc.encode_image(&resized_img).map_err(|e| format!("JPEG encode error: {}", e))?;
                "image/jpeg"
            }
        };

        let result_bytes = out_buffer.into_inner();

        // Save to cache asynchronously or synchronously (atomic best effort)
        let _ = fs::write(&cache_path, &result_bytes);

        Ok((result_bytes, mime))
    }

    /// Clear cache directory
    #[allow(dead_code)]
    pub fn clear_cache(&self) -> std::io::Result<()> {
        if self.cache_dir.exists() {
            fs::remove_dir_all(&self.cache_dir)?;
            fs::create_dir_all(&self.cache_dir)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb};

    fn make_test_jpeg(width: u32, height: u32) -> Vec<u8> {
        let img: ImageBuffer<Rgb<u8>, Vec<u8>> = ImageBuffer::from_fn(width, height, |x, y| {
            Rgb([(x % 255) as u8, (y % 255) as u8, 128])
        });
        let mut buf = Cursor::new(Vec::new());
        img.write_to(&mut buf, ImageFormat::Jpeg).unwrap();
        buf.into_inner()
    }

    #[test]
    fn test_image_compressor_resize_and_cache() {
        let temp_dir = std::env::temp_dir().join(format!("speedcamera_test_{}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)));
        let compressor = ImageCompressor::new(&temp_dir);

        let raw = make_test_jpeg(1280, 720);
        let params = CompressParams {
            width: Some(320),
            quality: Some(75),
            format: Some("jpeg".to_string()),
            ..Default::default()
        };

        // First pass: compression & cache write
        let (compressed1, mime1) = compressor.process_image(&raw, "test_cap_1", &params).unwrap();
        assert_eq!(mime1, "image/jpeg");
        assert!(compressed1.len() < raw.len());

        let decoded = image::load_from_memory(&compressed1).unwrap();
        assert_eq!(decoded.dimensions().0, 320);
        assert_eq!(decoded.dimensions().1, 180);

        // Second pass: should hit cache with exact same bytes
        let (compressed2, mime2) = compressor.process_image(&raw, "test_cap_1", &params).unwrap();
        assert_eq!(mime2, "image/jpeg");
        assert_eq!(compressed1, compressed2);

        // Cleanup
        let _ = compressor.clear_cache();
        let _ = fs::remove_dir_all(&temp_dir);
    }
}
