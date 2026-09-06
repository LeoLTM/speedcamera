pub mod db;
pub mod models;
pub mod rpc;

use crate::models::SerialStatusPayload;
use crate::plugins::{Plugin, PluginContext, RpcRegistry};
use models::{LapSession, SaveLapInput};
use std::sync::{Arc, Mutex};

// ponytail: in-memory state tracking active session and hardware lap triggers
#[derive(Debug, Clone)]
pub struct LapTimerState {
    pub active_session: Option<LapSession>,
    pub lap_state: String, // "idle" | "waiting" | "timing"
    pub lap_number: i64,
    pub lap_timing_started_at: Option<i64>,
    pub start_image_path: Option<String>,
    pub lap_mode: String,
    pub dir_filter: String,
    pub save_images: bool,
}

impl Default for LapTimerState {
    fn default() -> Self {
        Self {
            active_session: None,
            lap_state: "idle".to_string(),
            lap_number: 0,
            lap_timing_started_at: None,
            start_image_path: None,
            lap_mode: "single".to_string(),
            dir_filter: "both".to_string(),
            save_images: true,
        }
    }
}

pub struct LapTimerPlugin {
    state: Arc<Mutex<LapTimerState>>,
}

impl LapTimerPlugin {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(LapTimerState::default())),
        }
    }
}

impl Plugin for LapTimerPlugin {
    fn id(&self) -> &'static str {
        "laptimer"
    }

    fn name(&self) -> &'static str {
        "Lap Timer"
    }

    fn init(&mut self, ctx: &PluginContext) -> Result<(), Box<dyn std::error::Error>> {
        let conn = ctx.db.lock();
        db::init_tables(&conn)?;

        // Close any dangling sessions from previous runs
        if let Ok(Some(s)) = db::get_active_session(&conn) {
            let _ = db::close_lap_session(&conn, s.id);
            tracing::info!("[plugin:laptimer] Closed leftover unclosed session #{}", s.id);
        }

        // Load configured defaults into memory
        let settings = crate::db::settings::get_settings(&conn).unwrap_or_default();
        let mut state = self.state.lock().unwrap();
        state.lap_mode = if settings.lap_mode == "multi" { "multi".to_string() } else { "single".to_string() };
        state.dir_filter = if settings.lap_dir_filter == "forward" || settings.lap_dir_filter == "reverse" {
            settings.lap_dir_filter
        } else {
            "both".to_string()
        };
        state.save_images = settings.lap_save_images != "false";

        tracing::info!("[plugin:laptimer] Initialized database tables and state");
        Ok(())
    }

    fn register_rpc(&self, registry: &mut RpcRegistry) {
        rpc::register_rpc_methods(registry, self.state.clone());
        tracing::info!("[plugin:laptimer] Registered RPC methods");
    }

    // ponytail: instant sub-10ms hardware camera capture right from serial pipeline
    fn on_serial_event(&self, msg: &SerialStatusPayload, ctx: &PluginContext) {
        match msg {
            SerialStatusPayload::LapStart {
                lap_number,
                speed_at_start: _,
                timestamp,
            } => {
                let (has_session, save_images) = {
                    let mut s = self.state.lock().unwrap();
                    if s.active_session.is_none() {
                        return;
                    }
                    s.lap_state = "timing".to_string();
                    s.lap_number = *lap_number;
                    s.lap_timing_started_at = Some(*timestamp);
                    (true, s.save_images)
                };

                if has_session && save_images {
                    let cam = ctx.camera.clone();
                    let store = ctx.store.clone();
                    let state_clone = self.state.clone();
                    tokio::task::spawn_blocking(move || {
                        if let Some(jpg_bytes) = cam.capture_frame_jpeg(90) {
                            if let Ok(img_path) = store.save_image_bytes(&jpg_bytes, "jpg") {
                                let store_pre = store.clone();
                                let pre_bytes = jpg_bytes.clone();
                                let pre_path = img_path.clone();
                                rayon::spawn(move || {
                                    let p_grid = crate::storage::compress::CompressParams {
                                        width: Some(400),
                                        quality: Some(80),
                                        ..Default::default()
                                    };
                                    let p_row = crate::storage::compress::CompressParams {
                                        width: Some(160),
                                        quality: Some(75),
                                        ..Default::default()
                                    };
                                    let _ = store_pre.compressor.process_image(&pre_bytes, &pre_path, &p_grid);
                                    let _ = store_pre.compressor.process_image(&pre_bytes, &pre_path, &p_row);
                                });

                                let mut s = state_clone.lock().unwrap();
                                s.start_image_path = Some(img_path);
                            }
                        }
                    });
                }
            }
            SerialStatusPayload::LapEnd {
                lap_number,
                duration_ms,
                duration_us,
                speed_at_start,
                speed_at_end,
                timestamp,
            } => {
                let (session_id, start_img, save_images, start_ts) = {
                    let s = self.state.lock().unwrap();
                    let sid = match s.active_session {
                        Some(ref sess) => sess.id,
                        None => return,
                    };
                    let st = s.lap_timing_started_at.unwrap_or(*timestamp - *duration_ms as i64);
                    (sid, s.start_image_path.clone(), s.save_images, st)
                };

                let cam = ctx.camera.clone();
                let store = ctx.store.clone();
                let db = ctx.db.clone();
                let state_clone = self.state.clone();
                let dur_ms = *duration_ms;
                let dur_us = duration_us.map(|u| u as i64);
                let lap_num = *lap_number;
                let spd_start = *speed_at_start;
                let spd_end = *speed_at_end;
                let end_ts = *timestamp;

                tokio::task::spawn_blocking(move || {
                    let end_img = if save_images {
                        if let Some(jpg_bytes) = cam.capture_frame_jpeg(90) {
                            if let Ok(img_path) = store.save_image_bytes(&jpg_bytes, "jpg") {
                                let store_pre = store.clone();
                                let pre_bytes = jpg_bytes.clone();
                                let pre_path = img_path.clone();
                                rayon::spawn(move || {
                                    let p_grid = crate::storage::compress::CompressParams {
                                        width: Some(400),
                                        quality: Some(80),
                                        ..Default::default()
                                    };
                                    let p_row = crate::storage::compress::CompressParams {
                                        width: Some(160),
                                        quality: Some(75),
                                        ..Default::default()
                                    };
                                    let _ = store_pre.compressor.process_image(&pre_bytes, &pre_path, &p_grid);
                                    let _ = store_pre.compressor.process_image(&pre_bytes, &pre_path, &p_row);
                                });
                                Some(img_path)
                            } else {
                                None
                            }
                        } else {
                            None
                        }
                    } else {
                        None
                    };

                    let input = SaveLapInput {
                        session_id,
                        lap_number: lap_num,
                        start_timestamp: start_ts,
                        end_timestamp: end_ts,
                        duration_ms: dur_ms,
                        duration_us: dur_us,
                        speed_at_start: spd_start,
                        speed_at_end: spd_end,
                        start_image_base64: None,
                        end_image_base64: None,
                    };

                    let conn = db.lock();
                    match db::insert_lap(&conn, &input, start_img.as_deref(), end_img.as_deref()) {
                        Ok(lap) => {
                            tracing::info!(
                                "[plugin:laptimer] Recorded lap #{} for session #{} ({:.3} ms)",
                                lap.lap_number,
                                lap.session_id,
                                lap.duration_ms
                            );

                            let mut s = state_clone.lock().unwrap();
                            if s.lap_mode == "multi" {
                                s.start_image_path = end_img;
                                s.lap_state = "timing".to_string();
                            } else {
                                s.start_image_path = None;
                                s.lap_state = "waiting".to_string();
                            }
                        }
                        Err(e) => {
                            tracing::error!("[plugin:laptimer] Failed to insert lap: {}", e);
                        }
                    }
                });
            }
            SerialStatusPayload::LapWaiting => {
                let mut s = self.state.lock().unwrap();
                if s.active_session.is_some() {
                    s.lap_state = "waiting".to_string();
                }
            }
            SerialStatusPayload::LapStopped => {
                let mut s = self.state.lock().unwrap();
                s.lap_state = "idle".to_string();
                s.lap_timing_started_at = None;
                s.start_image_path = None;
            }
            _ => {}
        }
    }
}
