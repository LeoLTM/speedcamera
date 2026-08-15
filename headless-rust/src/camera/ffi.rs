#![allow(dead_code)]

use std::ffi::{c_char, c_void};

pub enum ArvCamera {}
pub enum ArvDevice {}
pub enum ArvStream {}
pub enum ArvBuffer {}

#[repr(C)]
pub struct GError {
    pub domain: u32,
    pub code: i32,
    pub message: *const c_char,
}

// ─── ArvBufferStatus Constants ────────────────────────────────────────────────
pub const ARV_BUFFER_STATUS_SUCCESS: i32 = 0;
pub const ARV_BUFFER_STATUS_CLEARED: i32 = 1;
pub const ARV_BUFFER_STATUS_TIMEOUT: i32 = 2;
pub const ARV_BUFFER_STATUS_MISSING_PACKETS: i32 = 3;
pub const ARV_BUFFER_STATUS_WRONG_PACKET_ID: i32 = 4;
pub const ARV_BUFFER_STATUS_SIZE_MISMATCH: i32 = 5;
pub const ARV_BUFFER_STATUS_FILLING: i32 = 6;
pub const ARV_BUFFER_STATUS_ABORTED: i32 = 7;

pub fn buffer_status_name(status: i32) -> &'static str {
    match status {
        ARV_BUFFER_STATUS_SUCCESS => "SUCCESS",
        ARV_BUFFER_STATUS_CLEARED => "CLEARED",
        ARV_BUFFER_STATUS_TIMEOUT => "TIMEOUT",
        ARV_BUFFER_STATUS_MISSING_PACKETS => "MISSING_PACKETS",
        ARV_BUFFER_STATUS_WRONG_PACKET_ID => "WRONG_PACKET_ID",
        ARV_BUFFER_STATUS_SIZE_MISMATCH => "SIZE_MISMATCH",
        ARV_BUFFER_STATUS_FILLING => "FILLING",
        ARV_BUFFER_STATUS_ABORTED => "ABORTED",
        _ => "UNKNOWN",
    }
}

// ─── GenICam PFNC Pixel Formats ───────────────────────────────────────────────
pub const ARV_PIXEL_FORMAT_MONO_8: u32 = 0x01080001;
pub const ARV_PIXEL_FORMAT_MONO_10: u32 = 0x01100003;
pub const ARV_PIXEL_FORMAT_MONO_12: u32 = 0x01100005;
pub const ARV_PIXEL_FORMAT_MONO_14: u32 = 0x01100025;
pub const ARV_PIXEL_FORMAT_MONO_16: u32 = 0x01100007;

pub const ARV_PIXEL_FORMAT_BAYER_GR_8: u32 = 0x01080008;
pub const ARV_PIXEL_FORMAT_BAYER_RG_8: u32 = 0x01080009;
pub const ARV_PIXEL_FORMAT_BAYER_GB_8: u32 = 0x0108000a;
pub const ARV_PIXEL_FORMAT_BAYER_BG_8: u32 = 0x0108000b;

pub const ARV_PIXEL_FORMAT_BAYER_GR_12: u32 = 0x01100010;
pub const ARV_PIXEL_FORMAT_BAYER_RG_12: u32 = 0x01100011;
pub const ARV_PIXEL_FORMAT_BAYER_GB_12: u32 = 0x01100012;
pub const ARV_PIXEL_FORMAT_BAYER_BG_12: u32 = 0x01100013;

pub const ARV_PIXEL_FORMAT_RGB_8_PACKED: u32 = 0x02180014;
pub const ARV_PIXEL_FORMAT_BGR_8_PACKED: u32 = 0x02180015;
pub const ARV_PIXEL_FORMAT_YUV_422_PACKED: u32 = 0x02100032;

pub fn pixel_format_name(format: u32) -> &'static str {
    match format {
        ARV_PIXEL_FORMAT_MONO_8 => "Mono8",
        ARV_PIXEL_FORMAT_MONO_10 => "Mono10",
        ARV_PIXEL_FORMAT_MONO_12 => "Mono12",
        ARV_PIXEL_FORMAT_MONO_14 => "Mono14",
        ARV_PIXEL_FORMAT_MONO_16 => "Mono16",
        ARV_PIXEL_FORMAT_BAYER_GR_8 => "BayerGR8",
        ARV_PIXEL_FORMAT_BAYER_RG_8 => "BayerRG8",
        ARV_PIXEL_FORMAT_BAYER_GB_8 => "BayerGB8",
        ARV_PIXEL_FORMAT_BAYER_BG_8 => "BayerBG8",
        ARV_PIXEL_FORMAT_BAYER_GR_12 => "BayerGR12",
        ARV_PIXEL_FORMAT_BAYER_RG_12 => "BayerRG12",
        ARV_PIXEL_FORMAT_BAYER_GB_12 => "BayerGB12",
        ARV_PIXEL_FORMAT_BAYER_BG_12 => "BayerBG12",
        ARV_PIXEL_FORMAT_RGB_8_PACKED => "RGB8Packed",
        ARV_PIXEL_FORMAT_BGR_8_PACKED => "BGR8Packed",
        ARV_PIXEL_FORMAT_YUV_422_PACKED => "YUV422Packed",
        _ => "UnknownPixelFormat",
    }
}

// ─── Aravis C Functions ───────────────────────────────────────────────────────
unsafe extern "C" {
    pub fn arv_update_device_list();
    pub fn arv_get_n_devices() -> u32;
    pub fn arv_get_device_id(index: u32) -> *const c_char;
    pub fn arv_get_device_vendor(index: u32) -> *const c_char;
    pub fn arv_get_device_model(index: u32) -> *const c_char;
    pub fn arv_get_device_serial_nbr(index: u32) -> *const c_char;
    pub fn arv_get_device_address(index: u32) -> *const c_char;

    // ----- ArvCamera: construction & info -----
    pub fn arv_camera_new(name: *const c_char, err: *mut *mut GError) -> *mut ArvCamera;
    pub fn arv_camera_get_vendor_name(cam: *mut ArvCamera, err: *mut *mut GError) -> *const c_char;
    pub fn arv_camera_get_model_name(cam: *mut ArvCamera, err: *mut *mut GError) -> *const c_char;
    pub fn arv_camera_get_device_id(cam: *mut ArvCamera, err: *mut *mut GError) -> *const c_char;
    pub fn arv_camera_get_device(cam: *mut ArvCamera) -> *mut ArvDevice;

    pub fn arv_camera_is_feature_available(
        cam: *mut ArvCamera,
        feature: *const c_char,
        err: *mut *mut GError,
    ) -> i32;
    pub fn arv_camera_execute_command(
        cam: *mut ArvCamera,
        feature: *const c_char,
        err: *mut *mut GError,
    );

    // ----- ArvCamera: exposure, gain, framerate, format, payload -----
    pub fn arv_camera_set_exposure_time(cam: *mut ArvCamera, us: f64, err: *mut *mut GError);
    pub fn arv_camera_get_exposure_time(cam: *mut ArvCamera, err: *mut *mut GError) -> f64;
    pub fn arv_camera_set_gain(cam: *mut ArvCamera, gain: f64, err: *mut *mut GError);
    pub fn arv_camera_get_gain(cam: *mut ArvCamera, err: *mut *mut GError) -> f64;
    pub fn arv_camera_set_frame_rate(cam: *mut ArvCamera, fps: f64, err: *mut *mut GError);
    pub fn arv_camera_get_frame_rate(cam: *mut ArvCamera, err: *mut *mut GError) -> f64;
    pub fn arv_camera_set_frame_rate_enable(cam: *mut ArvCamera, enable: i32, err: *mut *mut GError);
    pub fn arv_camera_set_pixel_format(cam: *mut ArvCamera, format: u32, err: *mut *mut GError);
    pub fn arv_camera_set_pixel_format_from_string(cam: *mut ArvCamera, format: *const c_char, err: *mut *mut GError);
    pub fn arv_camera_get_pixel_format(cam: *mut ArvCamera, err: *mut *mut GError) -> u32;
    pub fn arv_camera_get_payload(cam: *mut ArvCamera, err: *mut *mut GError) -> u32;

    // ----- ArvCamera: Trigger control -----
    pub fn arv_camera_set_trigger(cam: *mut ArvCamera, source: *const c_char, err: *mut *mut GError);
    pub fn arv_camera_set_trigger_source(cam: *mut ArvCamera, source: *const c_char, err: *mut *mut GError);
    pub fn arv_camera_clear_triggers(cam: *mut ArvCamera, err: *mut *mut GError);
    pub fn arv_camera_software_trigger(cam: *mut ArvCamera, err: *mut *mut GError);
    pub fn arv_camera_is_software_trigger_supported(cam: *mut ArvCamera, err: *mut *mut GError) -> i32;
    pub fn arv_camera_is_enumeration_entry_available(
        cam: *mut ArvCamera,
        feature: *const c_char,
        entry: *const c_char,
        err: *mut *mut GError,
    ) -> i32;

    // ----- ArvDevice: generic GenICam feature access -----
    pub fn arv_device_set_string_feature_value(
        device: *mut ArvDevice,
        feature: *const c_char,
        value: *const c_char,
        err: *mut *mut GError,
    );
    pub fn arv_device_get_string_feature_value(
        device: *mut ArvDevice,
        feature: *const c_char,
        err: *mut *mut GError,
    ) -> *const c_char;

    pub fn arv_device_set_integer_feature_value(
        device: *mut ArvDevice,
        feature: *const c_char,
        value: i64,
        err: *mut *mut GError,
    );
    pub fn arv_device_get_integer_feature_value(
        device: *mut ArvDevice,
        feature: *const c_char,
        err: *mut *mut GError,
    ) -> i64;

    pub fn arv_device_set_float_feature_value(
        device: *mut ArvDevice,
        feature: *const c_char,
        value: f64,
        err: *mut *mut GError,
    );
    pub fn arv_device_get_float_feature_value(
        device: *mut ArvDevice,
        feature: *const c_char,
        err: *mut *mut GError,
    ) -> f64;

    pub fn arv_device_set_boolean_feature_value(
        device: *mut ArvDevice,
        feature: *const c_char,
        value: i32,
        err: *mut *mut GError,
    );
    pub fn arv_device_get_boolean_feature_value(
        device: *mut ArvDevice,
        feature: *const c_char,
        err: *mut *mut GError,
    ) -> i32;

    pub fn arv_device_set_features_from_string(
        device: *mut ArvDevice,
        string: *const c_char,
        err: *mut *mut GError,
    ) -> i32;

    // ----- GigE Vision specifics -----
    pub fn arv_camera_is_gv_device(cam: *mut ArvCamera) -> i32;
    pub fn arv_camera_gv_auto_packet_size(cam: *mut ArvCamera, err: *mut *mut GError) -> u32;
    pub fn arv_camera_gv_set_packet_size(
        cam: *mut ArvCamera,
        packet_size: i32,
        err: *mut *mut GError,
    );
    pub fn arv_camera_gv_get_packet_size(cam: *mut ArvCamera, err: *mut *mut GError) -> i32;
    pub fn arv_camera_gv_set_packet_delay(
        cam: *mut ArvCamera,
        packet_delay: i64,
        err: *mut *mut GError,
    );

    // ----- Stream & Acquisition -----
    pub fn arv_camera_create_stream(
        cam: *mut ArvCamera,
        callback: *const c_void,
        user_data: *const c_void,
        err: *mut *mut GError,
    ) -> *mut ArvStream;

    pub fn arv_camera_start_acquisition(cam: *mut ArvCamera, err: *mut *mut GError);
    pub fn arv_camera_stop_acquisition(cam: *mut ArvCamera, err: *mut *mut GError);

    pub fn arv_stream_push_buffer(stream: *mut ArvStream, buffer: *mut ArvBuffer);
    pub fn arv_stream_try_pop_buffer(stream: *mut ArvStream) -> *mut ArvBuffer;
    pub fn arv_stream_timeout_pop_buffer(stream: *mut ArvStream, timeout_us: u64) -> *mut ArvBuffer;
    pub fn arv_stream_get_statistics(
        stream: *mut ArvStream,
        n_completed_buffers: *mut u64,
        n_failures: *mut u64,
        n_underruns: *mut u64,
    );

    pub fn arv_buffer_new_allocate(size: usize) -> *mut ArvBuffer;
    pub fn arv_buffer_get_data(buffer: *mut ArvBuffer, size: *mut usize) -> *const u8;
    pub fn arv_buffer_get_image_width(buffer: *mut ArvBuffer) -> i32;
    pub fn arv_buffer_get_image_height(buffer: *mut ArvBuffer) -> i32;
    pub fn arv_buffer_get_image_pixel_format(buffer: *mut ArvBuffer) -> u32;
    pub fn arv_buffer_get_status(buffer: *mut ArvBuffer) -> i32;

    pub fn g_object_unref(ptr: *mut c_void);
    pub fn g_error_free(ptr: *mut GError);
}
