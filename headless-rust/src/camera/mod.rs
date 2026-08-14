pub mod ffi;
pub mod mock;

use crate::models::{AppSettings, CameraStatusPayload, MfsConfigResult};
use ffi::*;
use base64::Engine;
use image::{ImageBuffer, Luma, Rgb};
use std::ffi::{CStr, CString};
use std::io::Cursor;
use std::ptr::null_mut;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;

pub struct CameraService {
    mock_mode: bool,
    mock_camera: Mutex<mock::MockCamera>,
    camera_ptr: Mutex<*mut ArvCamera>,
    stream_ptr: Mutex<*mut ArvStream>,
    is_connected: AtomicBool,
    setup_stream_active: Arc<AtomicBool>,
    status_sender: broadcast::Sender<CameraStatusPayload>,
    frame_sender: broadcast::Sender<String>, // Base64 JPEG frames for preview
}

// Safety: Aravis C library calls are synchronized via internal Mutexes
unsafe impl Send for CameraService {}
unsafe impl Sync for CameraService {}

impl CameraService {
    pub fn new(mock_mode: bool) -> Arc<Self> {
        let (status_tx, _) = broadcast::channel(16);
        let (frame_tx, _) = broadcast::channel(32);

        let service = Arc::new(Self {
            mock_mode,
            mock_camera: Mutex::new(mock::MockCamera::new()),
            camera_ptr: Mutex::new(null_mut()),
            stream_ptr: Mutex::new(null_mut()),
            is_connected: AtomicBool::new(false),
            setup_stream_active: Arc::new(AtomicBool::new(false)),
            status_sender: status_tx,
            frame_sender: frame_tx,
        });

        if !mock_mode {
            // Auto connect if hardware is attached
            let svc = service.clone();
            std::thread::spawn(move || {
                let default_settings = AppSettings::default();
                svc.connect(&default_settings);
            });
        }

        service
    }

    pub fn subscribe_status(&self) -> broadcast::Receiver<CameraStatusPayload> {
        self.status_sender.subscribe()
    }

    pub fn subscribe_frames(&self) -> broadcast::Receiver<String> {
        self.frame_sender.subscribe()
    }

    pub fn get_status(&self) -> CameraStatusPayload {
        if self.mock_mode {
            return self.mock_camera.lock().unwrap().status();
        }

        let is_conn = self.is_connected.load(Ordering::SeqCst);
        let cam_guard = self.camera_ptr.lock().unwrap();
        let cam = *cam_guard;

        if is_conn && !cam.is_null() {
            unsafe {
                let mut err = null_mut();
                let vendor_ptr = arv_camera_get_vendor_name(cam, &mut err);
                let model_ptr = arv_camera_get_model_name(cam, &mut err);
                let id_ptr = arv_camera_get_device_id(cam, &mut err);

                let vendor = if !vendor_ptr.is_null() {
                    Some(CStr::from_ptr(vendor_ptr).to_string_lossy().to_string())
                } else {
                    None
                };
                let model = if !model_ptr.is_null() {
                    Some(CStr::from_ptr(model_ptr).to_string_lossy().to_string())
                } else {
                    None
                };
                let serial = if !id_ptr.is_null() {
                    Some(CStr::from_ptr(id_ptr).to_string_lossy().to_string())
                } else {
                    None
                };

                CameraStatusPayload {
                    connected: true,
                    vendor,
                    model,
                    serial,
                }
            }
        } else {
            CameraStatusPayload {
                connected: false,
                vendor: None,
                model: None,
                serial: None,
            }
        }
    }

    pub fn connect(&self, settings: &AppSettings) {
        if self.mock_mode {
            self.mock_camera.lock().unwrap().connect();
            let _ = self.status_sender.send(self.get_status());
            return;
        }

        if self.is_connected.load(Ordering::SeqCst) {
            return;
        }

        unsafe {
            arv_update_device_list();
            let n = arv_get_n_devices();
            if n == 0 {
                println!("[camera] No GigE Vision cameras detected on network");
                return;
            }

            let mut target_id = None;
            for i in 0..n {
                let v_ptr = arv_get_device_vendor(i);
                let id_ptr = arv_get_device_id(i);
                if !v_ptr.is_null() && !id_ptr.is_null() {
                    let v = CStr::from_ptr(v_ptr).to_string_lossy();
                    let id = CStr::from_ptr(id_ptr).to_string_lossy();
                    println!("[camera] Found device [{}]: {} ({})", i, v, id);
                    if v.to_lowercase().contains("hikrobot") || target_id.is_none() {
                        target_id = Some(id.to_string());
                    }
                }
            }

            let mut err = null_mut();
            let cam_name = target_id.as_deref().and_then(|s| CString::new(s).ok());
            let cam_cstr = cam_name.as_ref().map(|s| s.as_ptr()).unwrap_or(null_mut());

            let cam = arv_camera_new(cam_cstr, &mut err);
            if cam.is_null() {
                if !err.is_null() {
                    let msg = CStr::from_ptr((*err).message).to_string_lossy();
                    println!("[camera] Failed to open camera: {}", msg);
                    g_error_free(err);
                }
                return;
            }

            arv_camera_gv_auto_packet_size(cam, &mut err);

            // Configure Trigger mode & strobe
            Self::set_feature_str_internal(cam, "AcquisitionMode", "Continuous");
            Self::set_feature_str_internal(cam, "TriggerMode", "On");
            Self::set_feature_str_internal(cam, "TriggerSource", "Software");

            Self::set_feature_str_internal(cam, "LineSelector", "Line1");
            Self::set_feature_str_internal(cam, "LineMode", "Strobe");
            Self::set_feature_str_internal(cam, "LineSource", "ExposureActive");
            Self::set_feature_bool_internal(cam, "StrobeEnable", true);
            Self::set_feature_int_internal(
                cam,
                "StrobeLineDuration",
                settings.strobe_line_duration as i64,
            );

            // Exposure & Gain
            Self::set_feature_str_internal(cam, "ExposureAuto", &settings.exposure_auto);
            if settings.exposure_auto == "Off" {
                Self::set_feature_float_internal(cam, "ExposureTime", settings.camera_exposure);
            }

            Self::set_feature_str_internal(cam, "GainAuto", &settings.gain_auto);
            if settings.gain_auto == "Off" {
                Self::set_feature_float_internal(cam, "Gain", settings.camera_gain);
            }

            if settings.frame_rate > 0.0 {
                Self::set_feature_bool_internal(cam, "AcquisitionFrameRateEnable", true);
                Self::set_feature_float_internal(
                    cam,
                    "AcquisitionFrameRate",
                    settings.frame_rate,
                );
            }

            // Create Stream with 5 pre-allocated buffers
            let stream = arv_camera_create_stream(cam, null_mut(), null_mut(), &mut err);
            if stream.is_null() {
                println!("[camera] Failed to create stream");
                g_object_unref(cam as *mut _);
                return;
            }

            let payload_size = Self::get_feature_int_internal(cam, "PayloadSize").max(1024 * 1024);
            for _ in 0..5 {
                let buf = arv_buffer_new_allocate(payload_size as usize);
                arv_stream_push_buffer(stream, buf);
            }

            *self.camera_ptr.lock().unwrap() = cam;
            *self.stream_ptr.lock().unwrap() = stream;
            self.is_connected.store(true, Ordering::SeqCst);

            println!("[camera] Connected successfully to industrial camera");
            let _ = self.status_sender.send(self.get_status());
        }
    }

    pub fn disconnect(&self) {
        if self.mock_mode {
            self.mock_camera.lock().unwrap().disconnect();
            let _ = self.status_sender.send(self.get_status());
            return;
        }

        self.setup_stream_active.store(false, Ordering::SeqCst);
        self.is_connected.store(false, Ordering::SeqCst);

        unsafe {
            let mut stream_guard = self.stream_ptr.lock().unwrap();
            if !stream_guard.is_null() {
                g_object_unref(*stream_guard as *mut _);
                *stream_guard = null_mut();
            }

            let mut cam_guard = self.camera_ptr.lock().unwrap();
            if !cam_guard.is_null() {
                g_object_unref(*cam_guard as *mut _);
                *cam_guard = null_mut();
            }
        }

        println!("[camera] Disconnected");
        let _ = self.status_sender.send(self.get_status());
    }

    pub fn capture_frame(&self) -> Option<Vec<u8>> {
        if self.mock_mode {
            return self.mock_camera.lock().unwrap().capture_frame();
        }

        if !self.is_connected.load(Ordering::SeqCst) {
            return None;
        }

        let cam = *self.camera_ptr.lock().unwrap();
        let stream = *self.stream_ptr.lock().unwrap();
        if cam.is_null() || stream.is_null() {
            return None;
        }

        unsafe {
            // Discard stale buffers
            loop {
                let stale = arv_stream_try_pop_buffer(stream);
                if stale.is_null() {
                    break;
                }
                arv_stream_push_buffer(stream, stale);
            }

            // Software trigger
            let mut err = null_mut();
            let trigger_cmd = CString::new("TriggerSoftware").unwrap();
            arv_camera_execute_command(cam, trigger_cmd.as_ptr(), &mut err);

            // Wait up to 2 seconds for frame
            let buffer = arv_stream_timeout_pop_buffer(stream, 2_000_000);
            if buffer.is_null() {
                println!("[camera] Capture frame timed out");
                return None;
            }

            if arv_buffer_get_status(buffer) != ARV_BUFFER_STATUS_SUCCESS {
                println!("[camera] Capture buffer status != SUCCESS");
                arv_stream_push_buffer(stream, buffer);
                return None;
            }

            let width = arv_buffer_get_image_width(buffer) as u32;
            let height = arv_buffer_get_image_height(buffer) as u32;
            let pixel_format = arv_buffer_get_image_pixel_format(buffer);
            let mut size: usize = 0;
            let data_ptr = arv_buffer_get_data(buffer, &mut size);

            let raw_slice = std::slice::from_raw_parts(data_ptr, size);

            // Convert to PNG buffer
            let png_bytes = Self::raw_buffer_to_png(raw_slice, width, height, pixel_format);

            // Return buffer back to stream pool
            arv_stream_push_buffer(stream, buffer);

            png_bytes
        }
    }

    pub fn start_setup_stream(self: &Arc<Self>) {
        if self.setup_stream_active.load(Ordering::SeqCst) {
            return;
        }

        self.setup_stream_active.store(true, Ordering::SeqCst);
        let this = self.clone();

        tokio::task::spawn_blocking(move || {
            println!("[camera] Setup preview stream started");

            if !this.mock_mode {
                let cam = *this.camera_ptr.lock().unwrap();
                if !cam.is_null() {
                    Self::set_feature_str_internal(cam, "TriggerMode", "Off");
                    Self::set_feature_str_internal(cam, "ExposureAuto", "Continuous");
                    Self::set_feature_str_internal(cam, "GainAuto", "Continuous");
                    Self::set_feature_bool_internal(cam, "AcquisitionFrameRateEnable", true);
                    Self::set_feature_float_internal(cam, "AcquisitionFrameRate", 10.0);
                }
            }

            while this.setup_stream_active.load(Ordering::SeqCst) {
                if this.mock_mode {
                    if let Some(jpeg) = this.mock_camera.lock().unwrap().capture_jpeg_preview() {
                        let b64 = base64::engine::general_purpose::STANDARD.encode(&jpeg);
                        let _ = this.frame_sender.send(b64);
                    }
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    continue;
                }

                let stream = *this.stream_ptr.lock().unwrap();
                if stream.is_null() {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    continue;
                }

                unsafe {
                    let buffer = arv_stream_timeout_pop_buffer(stream, 100_000);
                    if !buffer.is_null() {
                        if arv_buffer_get_status(buffer) == ARV_BUFFER_STATUS_SUCCESS {
                            let width = arv_buffer_get_image_width(buffer) as u32;
                            let height = arv_buffer_get_image_height(buffer) as u32;
                            let pixel_format = arv_buffer_get_image_pixel_format(buffer);
                            let mut size: usize = 0;
                            let data_ptr = arv_buffer_get_data(buffer, &mut size);

                            let slice = std::slice::from_raw_parts(data_ptr, size);

                            if let Some(jpeg) =
                                Self::raw_buffer_to_downscaled_jpeg(slice, width, height, pixel_format)
                            {
                                let b64 =
                                    base64::engine::general_purpose::STANDARD.encode(&jpeg);
                                let _ = this.frame_sender.send(b64);
                            }
                        }
                        arv_stream_push_buffer(stream, buffer);
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(40));
            }

            println!("[camera] Setup preview stream stopped");
        });
    }

    pub fn stop_setup_stream(&self, settings: &AppSettings) {
        self.setup_stream_active.store(false, Ordering::SeqCst);

        if !self.mock_mode {
            let cam = *self.camera_ptr.lock().unwrap();
            if !cam.is_null() {
                Self::set_feature_str_internal(cam, "TriggerMode", "On");
                Self::set_feature_str_internal(cam, "ExposureAuto", &settings.exposure_auto);
                if settings.exposure_auto == "Off" {
                    Self::set_feature_float_internal(cam, "ExposureTime", settings.camera_exposure);
                }
                Self::set_feature_str_internal(cam, "GainAuto", &settings.gain_auto);
                if settings.gain_auto == "Off" {
                    Self::set_feature_float_internal(cam, "Gain", settings.camera_gain);
                }
                if settings.frame_rate > 0.0 {
                    Self::set_feature_float_internal(
                        cam,
                        "AcquisitionFrameRate",
                        settings.frame_rate,
                    );
                }
            }
        }
    }

    pub fn apply_mfs_config(&self, mfs_content: &str) -> MfsConfigResult {
        let mut applied = Vec::new();
        let mut failed = Vec::new();

        if self.mock_mode {
            for line in mfs_content.lines() {
                let trimmed = line.trim();
                if !trimmed.is_empty() && !trimmed.starts_with('#') {
                    applied.push(trimmed.to_string());
                }
            }
            return MfsConfigResult { applied, failed };
        }

        let cam = *self.camera_ptr.lock().unwrap();
        if cam.is_null() {
            return MfsConfigResult { applied, failed };
        }

        for line in mfs_content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }

            if let Some((k, v)) = line.split_once('=') {
                let key = k.trim();
                let val = v.trim();

                let ok = if let Ok(int_val) = val.parse::<i64>() {
                    Self::set_feature_int_internal(cam, key, int_val)
                } else if let Ok(float_val) = val.parse::<f64>() {
                    Self::set_feature_float_internal(cam, key, float_val)
                } else {
                    Self::set_feature_str_internal(cam, key, val)
                };

                if ok {
                    applied.push(line.to_string());
                } else {
                    failed.push(line.to_string());
                }
            }
        }

        MfsConfigResult { applied, failed }
    }

    pub fn set_exposure(&self, val: f64) {
        if !self.mock_mode {
            let cam = *self.camera_ptr.lock().unwrap();
            if !cam.is_null() {
                Self::set_feature_float_internal(cam, "ExposureTime", val);
            }
        }
    }

    pub fn set_gain(&self, val: f64) {
        if !self.mock_mode {
            let cam = *self.camera_ptr.lock().unwrap();
            if !cam.is_null() {
                Self::set_feature_float_internal(cam, "Gain", val);
            }
        }
    }

    pub fn set_strobe_duration(&self, val: i64) {
        if !self.mock_mode {
            let cam = *self.camera_ptr.lock().unwrap();
            if !cam.is_null() {
                Self::set_feature_int_internal(cam, "StrobeLineDuration", val);
            }
        }
    }

    pub fn set_pixel_format(&self, format: &str) {
        if !self.mock_mode {
            let cam = *self.camera_ptr.lock().unwrap();
            if !cam.is_null() {
                if format == "Color" {
                    for fmt in ["BayerBG8", "BayerRG8", "RGB8Packed", "RGB8"] {
                        if Self::set_feature_str_internal(cam, "PixelFormat", fmt) {
                            break;
                        }
                    }
                } else {
                    Self::set_feature_str_internal(cam, "PixelFormat", "Mono8");
                }
            }
        }
    }

    // Helper functions for raw buffer decoding
    fn raw_buffer_to_png(raw: &[u8], width: u32, height: u32, _pixel_format: u32) -> Option<Vec<u8>> {
        let expected_mono = (width * height) as usize;
        let expected_rgb = (width * height * 3) as usize;

        let mut buf = Vec::new();
        let mut cursor = Cursor::new(&mut buf);

        if raw.len() >= expected_rgb {
            let img: ImageBuffer<Rgb<u8>, &[u8]> =
                ImageBuffer::from_raw(width, height, &raw[..expected_rgb])?;
            img.write_to(&mut cursor, image::ImageFormat::Png).ok()?;
        } else if raw.len() >= expected_mono {
            let img: ImageBuffer<Luma<u8>, &[u8]> =
                ImageBuffer::from_raw(width, height, &raw[..expected_mono])?;
            img.write_to(&mut cursor, image::ImageFormat::Png).ok()?;
        } else {
            return None;
        }

        Some(buf)
    }

    fn raw_buffer_to_downscaled_jpeg(
        raw: &[u8],
        width: u32,
        height: u32,
        _pixel_format: u32,
    ) -> Option<Vec<u8>> {
        let expected_mono = (width * height) as usize;
        let expected_rgb = (width * height * 3) as usize;

        let dynamic_img = if raw.len() >= expected_rgb {
            let img: ImageBuffer<Rgb<u8>, Vec<u8>> =
                ImageBuffer::from_raw(width, height, raw[..expected_rgb].to_vec())?;
            image::DynamicImage::ImageRgb8(img)
        } else if raw.len() >= expected_mono {
            let img: ImageBuffer<Luma<u8>, Vec<u8>> =
                ImageBuffer::from_raw(width, height, raw[..expected_mono].to_vec())?;
            image::DynamicImage::ImageLuma8(img)
        } else {
            return None;
        };

        // Resize down to 800px width max for fast preview bandwidth over Wi-Fi
        let resized = dynamic_img.resize(800, 600, image::imageops::FilterType::Nearest);

        let mut buf = Vec::new();
        let mut cursor = Cursor::new(&mut buf);
        resized.write_to(&mut cursor, image::ImageFormat::Jpeg).ok()?;

        Some(buf)
    }

    fn set_feature_str_internal(cam: *mut ArvCamera, feature: &str, value: &str) -> bool {
        unsafe {
            let f_cstr = match CString::new(feature) {
                Ok(s) => s,
                Err(_) => return false,
            };
            let v_cstr = match CString::new(value) {
                Ok(s) => s,
                Err(_) => return false,
            };
            let mut err = null_mut();
            arv_camera_set_string(cam, f_cstr.as_ptr(), v_cstr.as_ptr(), &mut err);
            if !err.is_null() {
                g_error_free(err);
                false
            } else {
                true
            }
        }
    }

    fn set_feature_int_internal(cam: *mut ArvCamera, feature: &str, value: i64) -> bool {
        unsafe {
            let f_cstr = match CString::new(feature) {
                Ok(s) => s,
                Err(_) => return false,
            };
            let mut err = null_mut();
            arv_camera_set_integer(cam, f_cstr.as_ptr(), value, &mut err);
            if !err.is_null() {
                g_error_free(err);
                false
            } else {
                true
            }
        }
    }

    fn set_feature_float_internal(cam: *mut ArvCamera, feature: &str, value: f64) -> bool {
        unsafe {
            let f_cstr = match CString::new(feature) {
                Ok(s) => s,
                Err(_) => return false,
            };
            let mut err = null_mut();
            arv_camera_set_float(cam, f_cstr.as_ptr(), value, &mut err);
            if !err.is_null() {
                g_error_free(err);
                false
            } else {
                true
            }
        }
    }

    fn set_feature_bool_internal(cam: *mut ArvCamera, feature: &str, value: bool) -> bool {
        unsafe {
            let f_cstr = match CString::new(feature) {
                Ok(s) => s,
                Err(_) => return false,
            };
            let mut err = null_mut();
            arv_camera_set_boolean(
                cam,
                f_cstr.as_ptr(),
                if value { 1 } else { 0 },
                &mut err,
            );
            if !err.is_null() {
                g_error_free(err);
                false
            } else {
                true
            }
        }
    }

    fn get_feature_int_internal(cam: *mut ArvCamera, feature: &str) -> i64 {
        unsafe {
            let f_cstr = match CString::new(feature) {
                Ok(s) => s,
                Err(_) => return 0,
            };
            let mut err = null_mut();
            let res = arv_camera_get_integer(cam, f_cstr.as_ptr(), &mut err);
            if !err.is_null() {
                g_error_free(err);
                0
            } else {
                res
            }
        }
    }
}
