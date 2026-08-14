#![allow(dead_code)]

use std::ffi::{c_char, c_void};

pub enum ArvCamera {}
pub enum ArvStream {}
pub enum ArvBuffer {}

#[repr(C)]
pub struct GError {
    pub domain: u32,
    pub code: i32,
    pub message: *const c_char,
}

pub const ARV_BUFFER_STATUS_SUCCESS: i32 = 0;

unsafe extern "C" {
    pub fn arv_update_device_list();
    pub fn arv_get_n_devices() -> u32;
    pub fn arv_get_device_id(index: u32) -> *const c_char;
    pub fn arv_get_device_vendor(index: u32) -> *const c_char;
    pub fn arv_get_device_model(index: u32) -> *const c_char;
    pub fn arv_get_device_serial_nbr(index: u32) -> *const c_char;
    pub fn arv_get_device_address(index: u32) -> *const c_char;

    pub fn arv_camera_new(name: *const c_char, err: *mut *mut GError) -> *mut ArvCamera;
    pub fn arv_camera_get_vendor_name(cam: *mut ArvCamera, err: *mut *mut GError) -> *const c_char;
    pub fn arv_camera_get_model_name(cam: *mut ArvCamera, err: *mut *mut GError) -> *const c_char;
    pub fn arv_camera_get_device_id(cam: *mut ArvCamera, err: *mut *mut GError) -> *const c_char;

    pub fn arv_camera_is_feature_available(
        cam: *mut ArvCamera,
        feature: *const c_char,
        err: *mut *mut GError,
    ) -> i32;

    pub fn arv_camera_set_string(
        cam: *mut ArvCamera,
        feature: *const c_char,
        value: *const c_char,
        err: *mut *mut GError,
    );
    pub fn arv_camera_get_string(
        cam: *mut ArvCamera,
        feature: *const c_char,
        err: *mut *mut GError,
    ) -> *const c_char;

    pub fn arv_camera_set_integer(
        cam: *mut ArvCamera,
        feature: *const c_char,
        value: i64,
        err: *mut *mut GError,
    );
    pub fn arv_camera_get_integer(
        cam: *mut ArvCamera,
        feature: *const c_char,
        err: *mut *mut GError,
    ) -> i64;

    pub fn arv_camera_set_float(
        cam: *mut ArvCamera,
        feature: *const c_char,
        value: f64,
        err: *mut *mut GError,
    );
    pub fn arv_camera_get_float(
        cam: *mut ArvCamera,
        feature: *const c_char,
        err: *mut *mut GError,
    ) -> f64;

    pub fn arv_camera_set_boolean(
        cam: *mut ArvCamera,
        feature: *const c_char,
        value: i32,
        err: *mut *mut GError,
    );
    pub fn arv_camera_get_boolean(
        cam: *mut ArvCamera,
        feature: *const c_char,
        err: *mut *mut GError,
    ) -> i32;

    pub fn arv_camera_execute_command(
        cam: *mut ArvCamera,
        feature: *const c_char,
        err: *mut *mut GError,
    );

    pub fn arv_camera_gv_auto_packet_size(cam: *mut ArvCamera, err: *mut *mut GError) -> u32;

    pub fn arv_camera_create_stream(
        cam: *mut ArvCamera,
        callback: *const c_void,
        user_data: *const c_void,
        err: *mut *mut GError,
    ) -> *mut ArvStream;

    pub fn arv_stream_push_buffer(stream: *mut ArvStream, buffer: *mut ArvBuffer);
    pub fn arv_stream_try_pop_buffer(stream: *mut ArvStream) -> *mut ArvBuffer;
    pub fn arv_stream_timeout_pop_buffer(stream: *mut ArvStream, timeout_us: u64) -> *mut ArvBuffer;

    pub fn arv_buffer_new_allocate(size: usize) -> *mut ArvBuffer;
    pub fn arv_buffer_get_data(buffer: *mut ArvBuffer, size: *mut usize) -> *const u8;
    pub fn arv_buffer_get_image_width(buffer: *mut ArvBuffer) -> i32;
    pub fn arv_buffer_get_image_height(buffer: *mut ArvBuffer) -> i32;
    pub fn arv_buffer_get_image_pixel_format(buffer: *mut ArvBuffer) -> u32;
    pub fn arv_buffer_get_status(buffer: *mut ArvBuffer) -> i32;

    pub fn g_object_unref(ptr: *mut c_void);
    pub fn g_error_free(ptr: *mut GError);
}
