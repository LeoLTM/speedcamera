use crate::models::CameraStatusPayload;
use image::{ImageBuffer, Rgb};
use std::io::Cursor;

pub struct MockCamera {
    connected: bool,
}

impl MockCamera {
    pub fn new() -> Self {
        Self { connected: true }
    }

    pub fn status(&self) -> CameraStatusPayload {
        CameraStatusPayload {
            connected: self.connected,
            vendor: if self.connected {
                Some("HIKROBOT (MOCK)".to_string())
            } else {
                None
            },
            model: if self.connected {
                Some("MV-CA016-10GM".to_string())
            } else {
                None
            },
            serial: if self.connected {
                Some("MOCK12345678".to_string())
            } else {
                None
            },
        }
    }

    pub fn connect(&mut self) {
        self.connected = true;
    }

    pub fn disconnect(&mut self) {
        self.connected = false;
    }

    #[allow(dead_code)]
    pub fn capture_frame(&self) -> Option<Vec<u8>> {
        if !self.connected {
            return None;
        }

        // Generate synthetic 1280x1024 image with timestamp
        let width = 1280u32;
        let height = 1024u32;
        let mut img: ImageBuffer<Rgb<u8>, Vec<u8>> = ImageBuffer::new(width, height);

        let t = (chrono::Utc::now().timestamp_millis() % 255) as u8;
        for (x, y, pixel) in img.enumerate_pixels_mut() {
            let r = ((x * 255 / width) as u8).wrapping_add(t);
            let g = (y * 255 / height) as u8;
            let b = 128u8;
            *pixel = Rgb([r, g, b]);
        }

        let mut buf = Vec::new();
        let mut cursor = Cursor::new(&mut buf);
        img.write_to(&mut cursor, image::ImageFormat::Png).ok()?;

        Some(buf)
    }

    pub fn capture_jpeg_frame(&self) -> Option<Vec<u8>> {
        if !self.connected {
            return None;
        }

        let width = 1280u32;
        let height = 1024u32;
        let mut img: ImageBuffer<Rgb<u8>, Vec<u8>> = ImageBuffer::new(width, height);

        let t = (chrono::Utc::now().timestamp_millis() % 255) as u8;
        for (x, y, pixel) in img.enumerate_pixels_mut() {
            let r = ((x * 255 / width) as u8).wrapping_add(t);
            let g = (y * 255 / height) as u8;
            let b = 128u8;
            *pixel = Rgb([r, g, b]);
        }

        let mut buf = Vec::new();
        let mut cursor = Cursor::new(&mut buf);
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, 90);
        encoder.encode(img.as_raw(), width, height, image::ExtendedColorType::Rgb8).ok()?;

        Some(buf)
    }

    pub fn capture_jpeg_preview(&self) -> Option<Vec<u8>> {
        if !self.connected {
            return None;
        }

        let width = 800u32;
        let height = 600u32;
        let mut img: ImageBuffer<Rgb<u8>, Vec<u8>> = ImageBuffer::new(width, height);

        let t = (chrono::Utc::now().timestamp_millis() % 255) as u8;
        for (x, y, pixel) in img.enumerate_pixels_mut() {
            let r = ((x * 255 / width) as u8).wrapping_add(t);
            let g = (y * 255 / height) as u8;
            let b = 100u8;
            *pixel = Rgb([r, g, b]);
        }

        let mut buf = Vec::new();
        let mut cursor = Cursor::new(&mut buf);
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, 60);
        encoder.encode(img.as_raw(), width, height, image::ExtendedColorType::Rgb8).ok()?;

        Some(buf)
    }
}

