pub mod ffi;
pub mod mock;

use crate::models::{AppSettings, CameraStatusPayload, MfsConfigResult};
use base64::Engine;
use ffi::*;
use image::{DynamicImage, ImageBuffer, Luma, Rgb};
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
        let is_streaming = self.setup_stream_active.load(Ordering::SeqCst);
        if self.mock_mode {
            return self.mock_camera.lock().unwrap().status(is_streaming);
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
                    is_streaming,
                }
            }
        } else {
            CameraStatusPayload {
                connected: false,
                vendor: None,
                model: None,
                serial: None,
                is_streaming: false,
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

            // Configure packet size & delay if GigE Vision device
            if arv_camera_is_gv_device(cam) != 0 {
                let packet_size = arv_camera_gv_auto_packet_size(cam, &mut err);
                if !err.is_null() {
                    g_error_free(err);
                } else {
                    println!("[camera] GigE Vision auto packet size set to: {} bytes", packet_size);
                }

                // Set GevSCPD (Stream Channel Packet Delay) to 2000 ticks
                // This spaces out UDP packets to prevent NIC packet storms and SSH stalls
                let mut delay_err = null_mut();
                arv_camera_gv_set_packet_delay(cam, 2000, &mut delay_err);
                if !delay_err.is_null() {
                    g_error_free(delay_err);
                    Self::set_feature_int_internal(cam, "GevSCPD", 2000);
                }
                println!("[camera] GigE Vision GevSCPD packet delay set to: 2000");
            }

            // Set PixelFormat
            Self::set_pixel_format_internal(cam, &settings.pixel_format);

            // ── ROI (Width/Height must be set before payload calculation) ─────
            if settings.camera_width > 0 {
                Self::set_feature_int_internal(cam, "Width", settings.camera_width);
            }
            if settings.camera_height > 0 {
                Self::set_feature_int_internal(cam, "Height", settings.camera_height);
            }
            if settings.black_level >= 0.0 {
                Self::set_black_level_internal(cam, settings.black_level);
            }

            // ── Exposure & Gain (set before trigger so auto-exposure can initialize) ──
            Self::set_feature_str_internal(cam, "ExposureAuto", &settings.exposure_auto);
            if settings.exposure_auto == "Off" {
                Self::set_exposure_internal(cam, settings.camera_exposure);
            }

            Self::set_feature_str_internal(cam, "GainAuto", &settings.gain_auto);
            if settings.gain_auto == "Off" {
                Self::set_gain_internal(cam, settings.camera_gain);
            }

            // ── Line & Strobe Flash Configuration ──────────────────────────────
            // Configure Line1 strobe wiring. In electronbun this works flawlessly
            // and does not strobe permanently as long as TriggerMode is properly set.
            Self::configure_strobe_internal(cam, settings);

            // ── Trigger Mode & Acquisition ────────────────────────────────────
            if Self::is_feature_available_internal(cam, "AcquisitionMode") {
                Self::set_feature_str_internal(cam, "AcquisitionMode", "Continuous");
            }
            // Explicitly set burst frame count to 1 (one frame per trigger)
            Self::set_feature_int_internal(cam, "AcquisitionBurstFrameCount", 1);
            Self::set_trigger_mode_internal(cam, "Software");

            // ── Frame Rate ─────────────────────────────────────
            // Frame rate limit must be disabled in triggered mode.
            // Enabling it forces the camera's internal frame generator to run,
            // which causes the flash to fire continuously!
            Self::set_frame_rate_enable_internal(cam, false);
            println!("[camera] Frame rate limiting disabled (triggered mode)");

            // Create Stream with 24 pre-allocated buffers for robust throughput without underruns
            let stream = arv_camera_create_stream(cam, null_mut(), null_mut(), &mut err);
            if stream.is_null() {
                println!("[camera] Failed to create stream");
                g_object_unref(cam as *mut _);
                return;
            }

            let mut payload_err = null_mut();
            let payload_size = (arv_camera_get_payload(cam, &mut payload_err) as usize)
                .max(Self::get_feature_int_internal(cam, "PayloadSize") as usize)
                .max(1024 * 1024);
            if !payload_err.is_null() {
                g_error_free(payload_err);
            }

            for _ in 0..24 {
                let buf = arv_buffer_new_allocate(payload_size);
                arv_stream_push_buffer(stream, buf);
            }

            // ── Start Acquisition ─────────────────────────────────────────────
            // Critical: Tells camera and Aravis engine to start receiving packets
            arv_camera_start_acquisition(cam, &mut err);
            if !err.is_null() {
                let msg = CStr::from_ptr((*err).message).to_string_lossy();
                println!("[camera] Warning: arv_camera_start_acquisition returned error: {}", msg);
                g_error_free(err);
            }

            *self.camera_ptr.lock().unwrap() = cam;
            *self.stream_ptr.lock().unwrap() = stream;
            self.is_connected.store(true, Ordering::SeqCst);

            println!("[camera] Connected and acquisition started successfully");
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
            let mut cam_guard = self.camera_ptr.lock().unwrap();
            let cam = *cam_guard;

            if !cam.is_null() {
                let mut err = null_mut();
                arv_camera_stop_acquisition(cam, &mut err);
                if !err.is_null() {
                    g_error_free(err);
                }
            }

            let mut stream_guard = self.stream_ptr.lock().unwrap();
            if !stream_guard.is_null() {
                g_object_unref(*stream_guard as *mut _);
                *stream_guard = null_mut();
            }

            if !cam.is_null() {
                g_object_unref(cam as *mut _);
                *cam_guard = null_mut();
            }
        }

        println!("[camera] Disconnected");
        let _ = self.status_sender.send(self.get_status());
    }

    #[allow(dead_code)]
    pub fn capture_frame(&self) -> Option<Vec<u8>> {
        self.capture_frame_jpeg(90)
    }


    pub fn capture_frame_jpeg(&self, quality: u8) -> Option<Vec<u8>> {
        if self.mock_mode {
            return self.mock_camera.lock().unwrap().capture_jpeg_frame();
        }

        if !self.is_connected.load(Ordering::SeqCst) {
            return None;
        }

        // Grab buffer & raw pixel data with minimal mutex holding time
        let (raw_vec, width, height, pixel_format) = {
            let cam = *self.camera_ptr.lock().unwrap();
            let stream = *self.stream_ptr.lock().unwrap();
            if cam.is_null() || stream.is_null() {
                return None;
            }

            unsafe {
                // Flush any stale buffers lingering in stream output queue
                loop {
                    let stale = arv_stream_try_pop_buffer(stream);
                    if stale.is_null() {
                        break;
                    }
                    arv_stream_push_buffer(stream, stale);
                }

                // Software trigger
                Self::fire_software_trigger_internal(cam);

                // Wait up to 2.0 seconds for completed frame
                let buffer = arv_stream_timeout_pop_buffer(stream, 2_000_000);

                if buffer.is_null() {
                    println!("[camera] Capture frame timed out");
                    return None;
                }

                let status = arv_buffer_get_status(buffer);
                if status != ARV_BUFFER_STATUS_SUCCESS {
                    println!(
                        "[camera] Capture buffer failed with status: {} ({})",
                        buffer_status_name(status),
                        status
                    );
                    arv_stream_push_buffer(stream, buffer);
                    return None;
                }

                let width = arv_buffer_get_image_width(buffer) as u32;
                let height = arv_buffer_get_image_height(buffer) as u32;
                let pixel_format = arv_buffer_get_image_pixel_format(buffer);
                let mut size: usize = 0;
                let data_ptr = arv_buffer_get_data(buffer, &mut size);

                let raw_vec = std::slice::from_raw_parts(data_ptr, size).to_vec();

                // Recycle buffer immediately back to stream pool
                arv_stream_push_buffer(stream, buffer);

                (raw_vec, width, height, pixel_format)
            }
        }; // Mutex on camera_ptr and stream_ptr is released immediately here!

        // Perform fast JPEG conversion outside of camera mutex lock (<10ms)
        Self::raw_buffer_to_jpeg(&raw_vec, width, height, pixel_format, quality)
    }

    pub fn start_setup_stream(self: &Arc<Self>) {
        if self.setup_stream_active.load(Ordering::SeqCst) {
            return;
        }

        self.setup_stream_active.store(true, Ordering::SeqCst);
        let _ = self.status_sender.send(self.get_status());
        let this = self.clone();

        tokio::task::spawn_blocking(move || {
            println!("[camera] Setup preview stream starting...");

            if !this.mock_mode {
                let cam = *this.camera_ptr.lock().unwrap();
                if !cam.is_null() {
                    // 1. Stop acquisition before reconfiguring
                    unsafe {
                        let mut err = null_mut();
                        arv_camera_stop_acquisition(cam, &mut err);
                        if !err.is_null() {
                            g_error_free(err);
                        }
                    }

                    // 2. Flush any pending buffers
                    Self::flush_stream_buffers(&this);

                    // 3. Disable strobe during setup preview
                    Self::disable_strobe_internal(cam);

                    // 4. Switch to free-running mode (disable triggers)
                    // Must use direct device features — arv_camera_clear_triggers
                    // uses wrong TriggerSelector for Hikrobot
                    Self::clear_triggers_internal(cam);

                    // 5. Enable auto exposure/gain for preview
                    Self::set_feature_str_internal(cam, "ExposureAuto", "Continuous");
                    Self::set_feature_str_internal(cam, "GainAuto", "Continuous");

                    // 6. Enable frame rate limiting BEFORE setting the rate
                    Self::set_frame_rate_enable_internal(cam, true);
                    Self::set_frame_rate_internal(cam, 10.0);

                    // 7. Verify frame rate took effect — if not, camera will flood Pi
                    Self::verify_frame_rate(cam, 10.0);

                    // 8. Start acquisition in free-run mode
                    unsafe {
                        let mut err = null_mut();
                        arv_camera_start_acquisition(cam, &mut err);
                        if !err.is_null() {
                            let msg = CStr::from_ptr((*err).message).to_string_lossy();
                            println!("[camera] Error restarting acquisition for setup stream: {}", msg);
                            g_error_free(err);
                        }
                    }
                }
            }

            println!("[camera] Setup preview stream active");

            let is_encoding = Arc::new(AtomicBool::new(false));

            while this.setup_stream_active.load(Ordering::SeqCst) {
                if this.mock_mode {
                    if let Some(jpeg) = this.mock_camera.lock().unwrap().capture_jpeg_preview() {
                        let b64 = base64::engine::general_purpose::STANDARD.encode(&jpeg);
                        let _ = this.frame_sender.send(b64);
                    }
                    std::thread::sleep(std::time::Duration::from_millis(80));
                    continue;
                }

                let stream = *this.stream_ptr.lock().unwrap();
                if stream.is_null() {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                    continue;
                }

                unsafe {
                    let buffer = arv_stream_try_pop_buffer(stream);
                    if !buffer.is_null() {
                        let status = arv_buffer_get_status(buffer);
                        if status == ARV_BUFFER_STATUS_SUCCESS {
                            // If previous frame is still encoding, drop intermediate frame to keep queue empty
                            if !is_encoding.swap(true, Ordering::SeqCst) {
                                let width = arv_buffer_get_image_width(buffer) as u32;
                                let height = arv_buffer_get_image_height(buffer) as u32;
                                let pixel_format = arv_buffer_get_image_pixel_format(buffer);
                                let mut size: usize = 0;
                                let data_ptr = arv_buffer_get_data(buffer, &mut size);

                                let slice_vec = std::slice::from_raw_parts(data_ptr, size).to_vec();

                                // Recycle buffer immediately back to Aravis pool
                                arv_stream_push_buffer(stream, buffer);

                                let encoder_flag = is_encoding.clone();
                                let tx = this.frame_sender.clone();
                                tokio::task::spawn_blocking(move || {
                                    if let Some(jpeg) = Self::raw_buffer_to_downscaled_jpeg(
                                        &slice_vec,
                                        width,
                                        height,
                                        pixel_format,
                                    ) {
                                        let b64 = base64::engine::general_purpose::STANDARD.encode(&jpeg);
                                        let _ = tx.send(b64);
                                    }
                                    encoder_flag.store(false, Ordering::SeqCst);
                                });
                            } else {
                                // Encoder busy: recycle buffer instantly to prevent underruns
                                arv_stream_push_buffer(stream, buffer);
                            }
                        } else {
                            // Status not SUCCESS: recycle buffer back to pool
                            arv_stream_push_buffer(stream, buffer);
                        }
                    } else {
                        // No buffer ready, brief yield to prevent tight spin
                        std::thread::sleep(std::time::Duration::from_millis(5));
                    }
                }
            }

            println!("[camera] Setup preview stream thread exited");
        });
    }

    pub fn stop_setup_stream(&self, settings: &AppSettings) {
        if !self.setup_stream_active.swap(false, Ordering::SeqCst) {
            return;
        }

        // Wait 60ms for stream thread to exit pump loop cleanly
        std::thread::sleep(std::time::Duration::from_millis(60));

        if !self.mock_mode {
            let cam = *self.camera_ptr.lock().unwrap();
            if !cam.is_null() {
                // 1. Stop acquisition
                unsafe {
                    let mut err = null_mut();
                    arv_camera_stop_acquisition(cam, &mut err);
                    if !err.is_null() {
                        g_error_free(err);
                    }
                }

                // 2. Flush stream buffers
                Self::flush_stream_buffers(self);

                // 3. Restore trigger mode
                Self::set_trigger_mode_internal(cam, "Software");

                // 4. Restore strobe configuration
                Self::configure_strobe_internal(cam, settings);

                // 5. Restore exposure & gain
                Self::set_feature_str_internal(cam, "ExposureAuto", &settings.exposure_auto);
                if settings.exposure_auto == "Off" {
                    Self::set_exposure_internal(cam, settings.camera_exposure);
                }
                Self::set_feature_str_internal(cam, "GainAuto", &settings.gain_auto);
                if settings.gain_auto == "Off" {
                    Self::set_gain_internal(cam, settings.camera_gain);
                }

                // 6. Disable frame rate limiting in triggered mode
                Self::set_frame_rate_enable_internal(cam, false);

                // 7. Restart acquisition in triggered mode
                unsafe {
                    let mut err = null_mut();
                    arv_camera_start_acquisition(cam, &mut err);
                    if !err.is_null() {
                        g_error_free(err);
                    }
                }
            }
        }
        println!("[camera] Setup preview stream stopped, restored triggered capture mode");
        let _ = self.status_sender.send(self.get_status());
    }

    pub fn save_user_set(&self, user_set_name: &str, set_as_default: bool) -> bool {
        if self.mock_mode {
            return true;
        }
        let cam = *self.camera_ptr.lock().unwrap();
        if cam.is_null() {
            return false;
        }
        Self::set_feature_str_internal(cam, "UserSetSelector", user_set_name);
        Self::execute_command_internal(cam, "UserSetSave");
        if set_as_default {
            Self::set_feature_str_internal(cam, "UserSetDefault", user_set_name);
        }
        true
    }

    pub fn apply_mfs_config(&self, mfs_content: &str, save_as_default: bool) -> MfsConfigResult {
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

        let mut pending: Vec<(String, String)> = Vec::new();
        for line in mfs_content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }

            let pair = if let Some((k, v)) = line.split_once('=') {
                Some((k.trim().to_string(), v.trim().to_string()))
            } else {
                let mut parts = line.split_whitespace();
                if let Some(feature) = parts.next() {
                    let value = parts.collect::<Vec<_>>().join(" ");
                    if !value.is_empty() {
                        Some((feature.to_string(), value))
                    } else {
                        None
                    }
                } else {
                    None
                }
            };

            if let Some((k, v)) = pair {
                pending.push((k, v));
            }
        }

        // Multi-pass application (up to 3 passes to resolve GenICam feature dependencies)
        for _pass in 0..3 {
            let mut failed_this_pass = Vec::new();
            let prev_len = pending.len();
            for (feature, value) in pending {
                if Self::set_any_feature_internal(cam, &feature, &value) {
                    applied.push(format!("{}\t{}", feature, value));
                } else {
                    failed_this_pass.push((feature, value));
                }
            }

            if failed_this_pass.len() == prev_len {
                pending = failed_this_pass;
                break;
            }

            pending = failed_this_pass;
            if pending.is_empty() {
                break;
            }
        }

        for (feature, value) in pending {
            failed.push(format!("{}\t{}", feature, value));
        }

        if save_as_default {
            self.save_user_set("UserSet1", true);
        }

        MfsConfigResult { applied, failed }
    }

    pub fn set_exposure(&self, val: f64) {
        if !self.mock_mode {
            let cam = *self.camera_ptr.lock().unwrap();
            if !cam.is_null() {
                Self::set_exposure_internal(cam, val);
            }
        }
    }

    pub fn set_gain(&self, val: f64) {
        if !self.mock_mode {
            let cam = *self.camera_ptr.lock().unwrap();
            if !cam.is_null() {
                Self::set_gain_internal(cam, val);
            }
        }
    }

    pub fn set_strobe_duration(&self, val: i64) {
        if !self.mock_mode {
            let cam = *self.camera_ptr.lock().unwrap();
            if !cam.is_null() {
                Self::set_feature_str_internal(cam, "LineSelector", "Line1");
                Self::set_feature_int_internal(cam, "StrobeLineDuration", val);
            }
        }
    }

    pub fn set_pixel_format(&self, format: &str) {
        if !self.mock_mode {
            let cam = *self.camera_ptr.lock().unwrap();
            if !cam.is_null() {
                Self::set_pixel_format_internal(cam, format);
            }
        }
    }

    pub fn set_feature_str(&self, feature: &str, value: &str) -> bool {
        if self.mock_mode {
            return true;
        }
        let cam = *self.camera_ptr.lock().unwrap();
        if !cam.is_null() {
            Self::set_feature_str_internal(cam, feature, value)
        } else {
            false
        }
    }

    pub fn set_feature_int(&self, feature: &str, value: i64) -> bool {
        if self.mock_mode {
            return true;
        }
        let cam = *self.camera_ptr.lock().unwrap();
        if !cam.is_null() {
            Self::set_feature_int_internal(cam, feature, value)
        } else {
            false
        }
    }

    #[allow(dead_code)]
    pub fn set_feature_float(&self, feature: &str, value: f64) -> bool {
        if self.mock_mode {
            return true;
        }
        let cam = *self.camera_ptr.lock().unwrap();
        if !cam.is_null() {
            Self::set_feature_float_internal(cam, feature, value)
        } else {
            false
        }
    }

    #[allow(dead_code)]
    pub fn set_feature_bool(&self, feature: &str, value: bool) -> bool {
        if self.mock_mode {
            return true;
        }
        let cam = *self.camera_ptr.lock().unwrap();
        if !cam.is_null() {
            Self::set_feature_bool_internal(cam, feature, value)
        } else {
            false
        }
    }

    // ── Pixel Format & Image Decoding ──────────────────────────────────────────
    fn raw_to_dynamic_image(
        raw: &[u8],
        width: u32,
        height: u32,
        pixel_format: u32,
    ) -> Option<DynamicImage> {
        let w = width as usize;
        let h = height as usize;
        let total_pixels = w * h;

        match pixel_format {
            ARV_PIXEL_FORMAT_RGB_8_PACKED => {
                if raw.len() >= total_pixels * 3 {
                    let img: ImageBuffer<Rgb<u8>, Vec<u8>> =
                        ImageBuffer::from_raw(width, height, raw[..total_pixels * 3].to_vec())?;
                    Some(DynamicImage::ImageRgb8(img))
                } else {
                    None
                }
            }
            ARV_PIXEL_FORMAT_BGR_8_PACKED => {
                if raw.len() >= total_pixels * 3 {
                    let mut rgb = vec![0u8; total_pixels * 3];
                    for i in 0..total_pixels {
                        rgb[i * 3] = raw[i * 3 + 2];     // R
                        rgb[i * 3 + 1] = raw[i * 3 + 1]; // G
                        rgb[i * 3 + 2] = raw[i * 3];     // B
                    }
                    let img: ImageBuffer<Rgb<u8>, Vec<u8>> =
                        ImageBuffer::from_raw(width, height, rgb)?;
                    Some(DynamicImage::ImageRgb8(img))
                } else {
                    None
                }
            }
            ARV_PIXEL_FORMAT_BAYER_RG_8
            | ARV_PIXEL_FORMAT_BAYER_BG_8
            | ARV_PIXEL_FORMAT_BAYER_GR_8
            | ARV_PIXEL_FORMAT_BAYER_GB_8 => {
                let rgb_bytes = Self::debayer_8bit(raw, w, h, pixel_format)?;
                let img: ImageBuffer<Rgb<u8>, Vec<u8>> =
                    ImageBuffer::from_raw(width, height, rgb_bytes)?;
                Some(DynamicImage::ImageRgb8(img))
            }
            ARV_PIXEL_FORMAT_MONO_10
            | ARV_PIXEL_FORMAT_MONO_12
            | ARV_PIXEL_FORMAT_MONO_14
            | ARV_PIXEL_FORMAT_MONO_16 => {
                if raw.len() >= total_pixels * 2 {
                    let mut mono8 = vec![0u8; total_pixels];
                    for i in 0..total_pixels {
                        // Take most significant byte (little endian)
                        mono8[i] = raw[i * 2 + 1];
                    }
                    let img: ImageBuffer<Luma<u8>, Vec<u8>> =
                        ImageBuffer::from_raw(width, height, mono8)?;
                    Some(DynamicImage::ImageLuma8(img))
                } else {
                    None
                }
            }
            ARV_PIXEL_FORMAT_MONO_8 | _ => {
                // Fallback: If 3-channel size, treat as RGB, else Mono
                if raw.len() >= total_pixels * 3 {
                    let img: ImageBuffer<Rgb<u8>, Vec<u8>> =
                        ImageBuffer::from_raw(width, height, raw[..total_pixels * 3].to_vec())?;
                    Some(DynamicImage::ImageRgb8(img))
                } else if raw.len() >= total_pixels {
                    let img: ImageBuffer<Luma<u8>, Vec<u8>> =
                        ImageBuffer::from_raw(width, height, raw[..total_pixels].to_vec())?;
                    Some(DynamicImage::ImageLuma8(img))
                } else {
                    None
                }
            }
        }
    }

    /// Fast 2x2 bilinear debayering for Bayer raw sensor arrays
    fn debayer_8bit(raw: &[u8], width: usize, height: usize, format: u32) -> Option<Vec<u8>> {
        if raw.len() < width * height || width < 2 || height < 2 {
            return None;
        }

        let mut rgb = vec![0u8; width * height * 3];

        // Offsets determine sensor pattern at (y%2, x%2)
        // RG8: (0,0)=R, (0,1)=G, (1,0)=G, (1,1)=B
        // BG8: (0,0)=B, (0,1)=G, (1,0)=G, (1,1)=R
        // GR8: (0,0)=G, (0,1)=R, (1,0)=B, (1,1)=G
        // GB8: (0,0)=G, (0,1)=B, (1,0)=R, (1,1)=G

        for y in 0..height {
            let y_prev = if y > 0 { y - 1 } else { y + 1 };
            let y_next = if y + 1 < height { y + 1 } else { y - 1 };

            for x in 0..width {
                let x_prev = if x > 0 { x - 1 } else { x + 1 };
                let x_next = if x + 1 < width { x + 1 } else { x - 1 };

                let idx = y * width + x;
                let c = raw[idx] as u32;

                let (r, g, b) = match format {
                    ARV_PIXEL_FORMAT_BAYER_RG_8 => {
                        match (y % 2, x % 2) {
                            (0, 0) => {
                                // Red pixel
                                let r = c;
                                let g = (raw[y_prev * width + x] as u32
                                    + raw[y_next * width + x] as u32
                                    + raw[y * width + x_prev] as u32
                                    + raw[y * width + x_next] as u32)
                                    / 4;
                                let b = (raw[y_prev * width + x_prev] as u32
                                    + raw[y_prev * width + x_next] as u32
                                    + raw[y_next * width + x_prev] as u32
                                    + raw[y_next * width + x_next] as u32)
                                    / 4;
                                (r, g, b)
                            }
                            (0, 1) => {
                                // Green on Red row
                                let g = c;
                                let r = (raw[y * width + x_prev] as u32 + raw[y * width + x_next] as u32) / 2;
                                let b = (raw[y_prev * width + x] as u32 + raw[y_next * width + x] as u32) / 2;
                                (r, g, b)
                            }
                            (1, 0) => {
                                // Green on Blue row
                                let g = c;
                                let b = (raw[y * width + x_prev] as u32 + raw[y * width + x_next] as u32) / 2;
                                let r = (raw[y_prev * width + x] as u32 + raw[y_next * width + x] as u32) / 2;
                                (r, g, b)
                            }
                            (1, 1) => {
                                // Blue pixel
                                let b = c;
                                let g = (raw[y_prev * width + x] as u32
                                    + raw[y_next * width + x] as u32
                                    + raw[y * width + x_prev] as u32
                                    + raw[y * width + x_next] as u32)
                                    / 4;
                                let r = (raw[y_prev * width + x_prev] as u32
                                    + raw[y_prev * width + x_next] as u32
                                    + raw[y_next * width + x_prev] as u32
                                    + raw[y_next * width + x_next] as u32)
                                    / 4;
                                (r, g, b)
                            }
                            _ => unreachable!(),
                        }
                    }
                    ARV_PIXEL_FORMAT_BAYER_BG_8 => {
                        match (y % 2, x % 2) {
                            (0, 0) => {
                                // Blue pixel
                                let b = c;
                                let g = (raw[y_prev * width + x] as u32
                                    + raw[y_next * width + x] as u32
                                    + raw[y * width + x_prev] as u32
                                    + raw[y * width + x_next] as u32)
                                    / 4;
                                let r = (raw[y_prev * width + x_prev] as u32
                                    + raw[y_prev * width + x_next] as u32
                                    + raw[y_next * width + x_prev] as u32
                                    + raw[y_next * width + x_next] as u32)
                                    / 4;
                                (r, g, b)
                            }
                            (0, 1) => {
                                // Green on Blue row
                                let g = c;
                                let b = (raw[y * width + x_prev] as u32 + raw[y * width + x_next] as u32) / 2;
                                let r = (raw[y_prev * width + x] as u32 + raw[y_next * width + x] as u32) / 2;
                                (r, g, b)
                            }
                            (1, 0) => {
                                // Green on Red row
                                let g = c;
                                let r = (raw[y * width + x_prev] as u32 + raw[y * width + x_next] as u32) / 2;
                                let b = (raw[y_prev * width + x] as u32 + raw[y_next * width + x] as u32) / 2;
                                (r, g, b)
                            }
                            (1, 1) => {
                                // Red pixel
                                let r = c;
                                let g = (raw[y_prev * width + x] as u32
                                    + raw[y_next * width + x] as u32
                                    + raw[y * width + x_prev] as u32
                                    + raw[y * width + x_next] as u32)
                                    / 4;
                                let b = (raw[y_prev * width + x_prev] as u32
                                    + raw[y_prev * width + x_next] as u32
                                    + raw[y_next * width + x_prev] as u32
                                    + raw[y_next * width + x_next] as u32)
                                    / 4;
                                (r, g, b)
                            }
                            _ => unreachable!(),
                        }
                    }
                    _ => {
                        // Default GR8 / GB8 simple interpolation
                        (c, c, c)
                    }
                };

                let out_idx = idx * 3;
                rgb[out_idx] = r.min(255) as u8;
                rgb[out_idx + 1] = g.min(255) as u8;
                rgb[out_idx + 2] = b.min(255) as u8;
            }
        }

        Some(rgb)
    }

    #[allow(dead_code)]
    fn raw_buffer_to_png(
        raw: &[u8],
        width: u32,
        height: u32,
        pixel_format: u32,
    ) -> Option<Vec<u8>> {
        let dynamic_img = Self::raw_to_dynamic_image(raw, width, height, pixel_format)?;
        let mut buf = Vec::new();
        let mut cursor = Cursor::new(&mut buf);
        dynamic_img.write_to(&mut cursor, image::ImageFormat::Png).ok()?;
        Some(buf)
    }

    fn raw_buffer_to_jpeg(
        raw: &[u8],
        width: u32,
        height: u32,
        pixel_format: u32,
        quality: u8,
    ) -> Option<Vec<u8>> {
        let dynamic_img = Self::raw_to_dynamic_image(raw, width, height, pixel_format)?;
        let mut buf = Vec::new();
        let mut cursor = Cursor::new(&mut buf);
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, quality);
        match dynamic_img {
            DynamicImage::ImageRgb8(rgb) => {
                encoder.encode(rgb.as_raw(), width, height, image::ExtendedColorType::Rgb8).ok()?;
            }
            DynamicImage::ImageLuma8(luma) => {
                encoder.encode(luma.as_raw(), width, height, image::ExtendedColorType::L8).ok()?;
            }
            _ => {
                let rgb = dynamic_img.to_rgb8();
                encoder.encode(rgb.as_raw(), width, height, image::ExtendedColorType::Rgb8).ok()?;
            }
        }
        Some(buf)
    }

    fn raw_buffer_to_downscaled_jpeg(
        raw: &[u8],
        width: u32,
        height: u32,
        pixel_format: u32,
    ) -> Option<Vec<u8>> {
        let dynamic_img = Self::raw_to_dynamic_image(raw, width, height, pixel_format)?;
        let resized = dynamic_img.resize(800, 600, image::imageops::FilterType::Nearest);

        let mut buf = Vec::new();
        let mut cursor = Cursor::new(&mut buf);
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, 60);
        match resized {
            DynamicImage::ImageRgb8(rgb) => {
                encoder.encode(rgb.as_raw(), rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8).ok()?;
            }
            DynamicImage::ImageLuma8(luma) => {
                encoder.encode(luma.as_raw(), luma.width(), luma.height(), image::ExtendedColorType::L8).ok()?;
            }
            _ => {
                let rgb = resized.to_rgb8();
                encoder.encode(rgb.as_raw(), rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8).ok()?;
            }
        }

        Some(buf)
    }


    // ── Shared Helper Functions ────────────────────────────────────────────────

    /// Configure Line1 as strobe output with full settings from AppSettings.
    fn configure_strobe_internal(cam: *mut ArvCamera, settings: &AppSettings) {
        if cam.is_null() {
            return;
        }
        if !Self::is_feature_available_internal(cam, "LineSelector") {
            return;
        }
        Self::set_feature_str_internal(cam, "LineSelector", "Line1");
        Self::set_feature_str_internal(cam, "LineMode", "Strobe");
        
        // Match electronbun: prefer ExposureActive to limit flash strictly to the exposure window
        if Self::is_enumeration_entry_available_internal(cam, "LineSource", "ExposureActive") {
            Self::set_feature_str_internal(cam, "LineSource", "ExposureActive");
        } else if Self::is_enumeration_entry_available_internal(cam, "LineSource", "FrameStartActive") {
            Self::set_feature_str_internal(cam, "LineSource", "FrameStartActive");
        } else if Self::is_enumeration_entry_available_internal(cam, "LineSource", "Strobe") {
            Self::set_feature_str_internal(cam, "LineSource", "Strobe");
        }
        Self::set_line_inverter_internal(cam, false);
        Self::set_feature_int_internal(cam, "LineDebouncerTime", 50);

        if Self::is_feature_available_internal(cam, "StrobeEnable") {
            if !Self::set_feature_bool_internal(cam, "StrobeEnable", true) {
                Self::set_feature_int_internal(cam, "StrobeEnable", 1);
            }
            Self::set_feature_int_internal(
                cam,
                "StrobeLineDuration",
                settings.strobe_line_duration as i64,
            );
            Self::set_feature_int_internal(cam, "StrobeLineDelay", 0);
            Self::set_feature_int_internal(cam, "StrobeLinePreDelay", 0);
        }
        println!("[camera] Strobe configured on Line1 (StrobeEnable=true)");
    }

    /// Disable strobe output during setup preview to prevent flash from firing.
    fn disable_strobe_internal(cam: *mut ArvCamera) {
        if cam.is_null() {
            return;
        }
        // Just disable strobe — don't try to set LineSource to 'Off' as Hikrobot
        // doesn't support that value (confirmed from logs: "'Off' not an entry")
        Self::set_feature_bool_internal(cam, "StrobeEnable", false);
        println!("[camera] Strobe disabled for preview mode");
    }

    /// Flush all pending buffers from the stream output queue back to the input pool.
    fn flush_stream_buffers(&self) {
        let stream = *self.stream_ptr.lock().unwrap();
        if stream.is_null() {
            return;
        }
        unsafe {
            let mut flushed = 0u32;
            loop {
                let stale = arv_stream_try_pop_buffer(stream);
                if stale.is_null() {
                    break;
                }
                arv_stream_push_buffer(stream, stale);
                flushed += 1;
            }
            if flushed > 0 {
                println!("[camera] Flushed {} stale buffers", flushed);
            }
        }
    }

    /// Read back AcquisitionFrameRate and warn if it doesn't match the target.
    fn verify_frame_rate(cam: *mut ArvCamera, target_fps: f64) {
        if cam.is_null() {
            return;
        }
        unsafe {
            let mut err = null_mut();
            let actual = arv_camera_get_frame_rate(cam, &mut err);
            if !err.is_null() {
                g_error_free(err);
                println!("[camera] WARNING: Could not read back frame rate for verification");
                return;
            }
            let diff = (actual - target_fps).abs();
            if diff > 1.0 {
                println!(
                    "[camera] WARNING: Frame rate readback {:.1} FPS differs from target {:.1} FPS — camera may not be respecting frame rate limit!",
                    actual, target_fps
                );
            } else {
                println!("[camera] Frame rate verified: {:.1} FPS (target: {:.1})", actual, target_fps);
            }
        }
    }

    pub fn is_feature_available_internal(cam: *mut ArvCamera, feature: &str) -> bool {
        if cam.is_null() {
            return false;
        }
        unsafe {
            let f_cstr = match CString::new(feature) {
                Ok(s) => s,
                Err(_) => return false,
            };
            let mut err = null_mut();
            let res = arv_camera_is_feature_available(cam, f_cstr.as_ptr(), &mut err);
            if !err.is_null() {
                g_error_free(err);
                false
            } else {
                res != 0
            }
        }
    }

    pub fn execute_command_internal(cam: *mut ArvCamera, command: &str) -> bool {
        if cam.is_null() {
            return false;
        }
        unsafe {
            let cmd_cstr = match CString::new(command) {
                Ok(s) => s,
                Err(_) => return false,
            };
            let mut err = null_mut();
            arv_camera_execute_command(cam, cmd_cstr.as_ptr(), &mut err);
            if !err.is_null() {
                let msg = CStr::from_ptr((*err).message).to_string_lossy();
                println!("[camera] Warning: execute_command({}) failed: {}", command, msg);
                g_error_free(err);
                false
            } else {
                println!("[camera] execute_command({}) succeeded", command);
                true
            }
        }
    }

    fn set_feature_str_internal(cam: *mut ArvCamera, feature: &str, value: &str) -> bool {
        if cam.is_null() {
            return false;
        }
        unsafe {
            let dev = arv_camera_get_device(cam);
            if dev.is_null() {
                return false;
            }
            let f_cstr = match CString::new(feature) {
                Ok(s) => s,
                Err(_) => return false,
            };
            let v_cstr = match CString::new(value) {
                Ok(s) => s,
                Err(_) => return false,
            };
            let mut err = null_mut();
            arv_device_set_string_feature_value(dev, f_cstr.as_ptr(), v_cstr.as_ptr(), &mut err);
            if !err.is_null() {
                let msg = CStr::from_ptr((*err).message).to_string_lossy();
                println!("[camera] Warning: set_feature_str({}, {}) failed: {}", feature, value, msg);
                g_error_free(err);
                false
            } else {
                println!("[camera] set_feature_str({}, {}) succeeded", feature, value);
                true
            }
        }
    }

    fn get_feature_str_internal(cam: *mut ArvCamera, feature: &str) -> Option<String> {
        if cam.is_null() {
            return None;
        }
        unsafe {
            let dev = arv_camera_get_device(cam);
            if dev.is_null() {
                return None;
            }
            let f_cstr = match CString::new(feature) {
                Ok(s) => s,
                Err(_) => return None,
            };
            let mut err = null_mut();
            let res_ptr = arv_device_get_string_feature_value(dev, f_cstr.as_ptr(), &mut err);
            if !err.is_null() {
                g_error_free(err);
                None
            } else if !res_ptr.is_null() {
                Some(CStr::from_ptr(res_ptr).to_string_lossy().to_string())
            } else {
                None
            }
        }
    }

    fn set_feature_int_internal(cam: *mut ArvCamera, feature: &str, value: i64) -> bool {
        if cam.is_null() {
            return false;
        }
        unsafe {
            let dev = arv_camera_get_device(cam);
            if dev.is_null() {
                return false;
            }
            let f_cstr = match CString::new(feature) {
                Ok(s) => s,
                Err(_) => return false,
            };
            let mut err = null_mut();
            arv_device_set_integer_feature_value(dev, f_cstr.as_ptr(), value, &mut err);
            if !err.is_null() {
                let msg = CStr::from_ptr((*err).message).to_string_lossy();
                println!("[camera] Warning: set_feature_int({}, {}) failed: {}", feature, value, msg);
                g_error_free(err);
                false
            } else {
                println!("[camera] set_feature_int({}, {}) succeeded", feature, value);
                true
            }
        }
    }

    fn get_feature_int_internal(cam: *mut ArvCamera, feature: &str) -> i64 {
        if cam.is_null() {
            return 0;
        }
        unsafe {
            let dev = arv_camera_get_device(cam);
            if dev.is_null() {
                return 0;
            }
            let f_cstr = match CString::new(feature) {
                Ok(s) => s,
                Err(_) => return 0,
            };
            let mut err = null_mut();
            let res = arv_device_get_integer_feature_value(dev, f_cstr.as_ptr(), &mut err);
            if !err.is_null() {
                g_error_free(err);
                0
            } else {
                res
            }
        }
    }

    fn set_feature_float_internal(cam: *mut ArvCamera, feature: &str, value: f64) -> bool {
        if cam.is_null() {
            return false;
        }
        unsafe {
            let dev = arv_camera_get_device(cam);
            if dev.is_null() {
                return false;
            }
            let f_cstr = match CString::new(feature) {
                Ok(s) => s,
                Err(_) => return false,
            };
            let mut err = null_mut();
            arv_device_set_float_feature_value(dev, f_cstr.as_ptr(), value, &mut err);
            if !err.is_null() {
                let msg = CStr::from_ptr((*err).message).to_string_lossy();
                println!("[camera] Warning: set_feature_float({}, {}) failed: {}", feature, value, msg);
                g_error_free(err);
                false
            } else {
                println!("[camera] set_feature_float({}, {}) succeeded", feature, value);
                true
            }
        }
    }

    fn set_feature_bool_internal(cam: *mut ArvCamera, feature: &str, value: bool) -> bool {
        if cam.is_null() {
            return false;
        }
        unsafe {
            let dev = arv_camera_get_device(cam);
            if dev.is_null() {
                return false;
            }
            let f_cstr = match CString::new(feature) {
                Ok(s) => s,
                Err(_) => return false,
            };
            let mut err = null_mut();
            arv_device_set_boolean_feature_value(
                dev,
                f_cstr.as_ptr(),
                if value { 1 } else { 0 },
                &mut err,
            );
            if !err.is_null() {
                let msg = CStr::from_ptr((*err).message).to_string_lossy();
                println!("[camera] Warning: set_feature_bool({}, {}) failed: {}", feature, value, msg);
                g_error_free(err);
                false
            } else {
                println!("[camera] set_feature_bool({}, {}) succeeded", feature, value);
                true
            }
        }
    }

    fn set_exposure_internal(cam: *mut ArvCamera, us: f64) -> bool {
        if cam.is_null() {
            return false;
        }
        unsafe {
            let mut err = null_mut();
            arv_camera_set_exposure_time(cam, us, &mut err);
            if !err.is_null() {
                let msg = CStr::from_ptr((*err).message).to_string_lossy();
                println!("[camera] Warning: arv_camera_set_exposure_time({}) failed: {}", us, msg);
                g_error_free(err);
                false
            } else {
                println!("[camera] Set exposure time to {} µs", us);
                true
            }
        }
    }

    fn set_gain_internal(cam: *mut ArvCamera, gain: f64) -> bool {
        if cam.is_null() {
            return false;
        }
        unsafe {
            let mut err = null_mut();
            arv_camera_set_gain(cam, gain, &mut err);
            if !err.is_null() {
                let msg = CStr::from_ptr((*err).message).to_string_lossy();
                println!("[camera] Warning: arv_camera_set_gain({}) failed: {}", gain, msg);
                g_error_free(err);
                false
            } else {
                println!("[camera] Set gain to {}", gain);
                true
            }
        }
    }

    fn set_frame_rate_internal(cam: *mut ArvCamera, fps: f64) -> bool {
        if cam.is_null() {
            return false;
        }
        unsafe {
            let mut err = null_mut();
            arv_camera_set_frame_rate(cam, fps, &mut err);
            if !err.is_null() {
                let msg = CStr::from_ptr((*err).message).to_string_lossy();
                println!("[camera] Warning: arv_camera_set_frame_rate({}) failed: {}", fps, msg);
                g_error_free(err);
                false
            } else {
                println!("[camera] Set frame rate to {} FPS", fps);
                true
            }
        }
    }

    pub fn is_enumeration_entry_available_internal(
        cam: *mut ArvCamera,
        feature: &str,
        entry: &str,
    ) -> bool {
        if cam.is_null() {
            return false;
        }
        unsafe {
            let f_cstr = match CString::new(feature) {
                Ok(s) => s,
                Err(_) => return false,
            };
            let e_cstr = match CString::new(entry) {
                Ok(s) => s,
                Err(_) => return false,
            };
            let mut err = null_mut();
            let res = arv_camera_is_enumeration_entry_available(
                cam,
                f_cstr.as_ptr(),
                e_cstr.as_ptr(),
                &mut err,
            );
            if !err.is_null() {
                g_error_free(err);
                false
            } else {
                res != 0
            }
        }
    }

    /// Configure triggered capture mode using direct GenICam device features.
    ///
    /// Avoids `arv_camera_set_trigger()` which uses TriggerSelector=AcquisitionStart
    /// internally — wrong for Hikrobot cameras that use FrameBurstStart.
    /// Uses explicit 3-step sequence: TriggerSelector → TriggerMode → TriggerSource.
    fn set_trigger_mode_internal(cam: *mut ArvCamera, trigger_source: &str) -> bool {
        if cam.is_null() {
            return false;
        }

        // IMPORTANT: FrameStart must be preferred over FrameBurstStart.
        // If FrameBurstStart is set to On but FrameStart remains Off (free-run),
        // the camera will continuously expose and strobe the flash indefinitely!
        let selectors = ["FrameStart", "FrameBurstStart", "AcquisitionStart"];
        for sel in selectors {
            if Self::set_feature_str_internal(cam, "TriggerSelector", sel) {
                let mode_ok = Self::set_feature_str_internal(cam, "TriggerMode", "On");
                let src_ok = Self::set_feature_str_internal(cam, "TriggerSource", trigger_source);
                if mode_ok && src_ok {
                    println!(
                        "[camera] Trigger configured: Selector={}, Mode=On, Source={}",
                        sel, trigger_source
                    );
                    // Verify TriggerMode actually stuck
                    if let Some(readback) = Self::get_feature_str_internal(cam, "TriggerMode") {
                        if readback != "On" {
                            println!(
                                "[camera] WARNING: TriggerMode readback is '{}' (expected 'On')",
                                readback
                            );
                        }
                    }
                    return true;
                }
            }
        }

        println!("[camera] ERROR: Failed to configure trigger mode on any selector");
        false
    }

    /// Disable triggers for free-running (continuous) mode using direct GenICam features.
    ///
    /// Avoids `arv_camera_clear_triggers()` which may use wrong selectors for Hikrobot.
    fn clear_triggers_internal(cam: *mut ArvCamera) -> bool {
        if cam.is_null() {
            return false;
        }

        // Disable triggers on all known selectors to ensure free-run
        let mut any_success = false;
        for sel in ["FrameBurstStart", "FrameStart", "AcquisitionStart"] {
            if Self::set_feature_str_internal(cam, "TriggerSelector", sel) {
                if Self::set_feature_str_internal(cam, "TriggerMode", "Off") {
                    println!("[camera] Trigger disabled: Selector={}, Mode=Off", sel);
                    any_success = true;
                }
            }
        }

        if any_success {
            println!("[camera] Triggers cleared — camera in free-running mode");
        } else {
            println!("[camera] WARNING: Could not clear triggers on any selector");
        }
        any_success
    }

    fn fire_software_trigger_internal(cam: *mut ArvCamera) -> bool {
        if cam.is_null() {
            return false;
        }
        unsafe {
            let mut err = null_mut();
            arv_camera_software_trigger(cam, &mut err);
            if err.is_null() {
                true
            } else {
                let msg = CStr::from_ptr((*err).message).to_string_lossy();
                println!("[camera] arv_camera_software_trigger returned: {}. Trying command execution fallback...", msg);
                g_error_free(err);
                Self::execute_command_internal(cam, "TriggerSoftware")
            }
        }
    }

    fn set_line_inverter_internal(cam: *mut ArvCamera, inverted: bool) -> bool {
        if cam.is_null() {
            return false;
        }
        if Self::set_feature_bool_internal(cam, "LineInverter", inverted) {
            return true;
        }
        if Self::set_feature_int_internal(cam, "LineInverter", if inverted { 1 } else { 0 }) {
            return true;
        }
        false
    }

    fn set_black_level_internal(cam: *mut ArvCamera, val: f64) -> bool {
        if cam.is_null() {
            return false;
        }
        if Self::is_feature_available_internal(cam, "BlackLevelEnable") {
            Self::set_feature_bool_internal(cam, "BlackLevelEnable", val > 0.0);
        }
        if Self::set_feature_float_internal(cam, "BlackLevel", val) {
            return true;
        }
        if Self::set_feature_int_internal(cam, "BlackLevel", val as i64) {
            return true;
        }
        false
    }

    /// Enable or disable the camera's internal frame rate limiter.
    ///
    /// Uses direct GenICam device feature access only.
    /// The Aravis C API does NOT have an `arv_camera_set_frame_rate_enable` function.
    fn set_frame_rate_enable_internal(cam: *mut ArvCamera, enable: bool) -> bool {
        if cam.is_null() {
            return false;
        }
        let ok = Self::set_feature_bool_internal(cam, "AcquisitionFrameRateEnable", enable);
        if !ok {
            // Some cameras expose it as integer (0/1) rather than boolean
            return Self::set_feature_int_internal(
                cam,
                "AcquisitionFrameRateEnable",
                if enable { 1 } else { 0 },
            );
        }
        println!(
            "[camera] AcquisitionFrameRateEnable = {}",
            if enable { "true" } else { "false" }
        );
        ok
    }

    fn set_pixel_format_internal(cam: *mut ArvCamera, format: &str) -> bool {
        if cam.is_null() {
            return false;
        }
        let candidates: Vec<&str> = if format.eq_ignore_ascii_case("color") {
            vec![
                "BayerRG8",
                "BayerBG8",
                "BayerGR8",
                "BayerGB8",
                "RGB8Packed",
                "BGR8Packed",
                "RGB8",
                "Mono8",
            ]
        } else if format.eq_ignore_ascii_case("mono") || format.eq_ignore_ascii_case("mono8") {
            vec![
                "Mono8",
                "BayerRG8",
                "BayerBG8",
                "BayerGR8",
                "BayerGB8",
                "RGB8Packed",
            ]
        } else {
            vec![format, "BayerRG8", "BayerBG8", "Mono8"]
        };

        for fmt in candidates {
            unsafe {
                let fmt_cstr = match CString::new(fmt) {
                    Ok(s) => s,
                    Err(_) => continue,
                };
                let mut err = null_mut();
                arv_camera_set_pixel_format_from_string(cam, fmt_cstr.as_ptr(), &mut err);
                if err.is_null() {
                    println!("[camera] PixelFormat set to {}", fmt);
                    return true;
                } else {
                    g_error_free(err);
                }
            }
            if Self::set_feature_str_internal(cam, "PixelFormat", fmt) {
                println!("[camera] PixelFormat set to {}", fmt);
                return true;
            }
        }
        println!("[camera] Warning: Could not configure requested PixelFormat {}, retaining current format", format);
        false
    }

    fn set_any_feature_internal(cam: *mut ArvCamera, feature: &str, value: &str) -> bool {
        if cam.is_null() {
            return false;
        }
        // 1. Try String / Enumeration
        if Self::set_feature_str_internal(cam, feature, value) {
            return true;
        }
        // 2. Try Boolean
        if value.eq_ignore_ascii_case("true") || value.eq_ignore_ascii_case("false") {
            if Self::set_feature_bool_internal(cam, feature, value.eq_ignore_ascii_case("true")) {
                return true;
            }
        }
        // 3. Try Integer
        if let Ok(int_val) = value.parse::<i64>() {
            if Self::set_feature_int_internal(cam, feature, int_val) {
                return true;
            }
            if int_val == 0 || int_val == 1 {
                if Self::set_feature_bool_internal(cam, feature, int_val != 0) {
                    return true;
                }
            }
        }
        // 4. Try Float
        if let Ok(float_val) = value.parse::<f64>() {
            if Self::set_feature_float_internal(cam, feature, float_val) {
                return true;
            }
        }
        false
    }
}
