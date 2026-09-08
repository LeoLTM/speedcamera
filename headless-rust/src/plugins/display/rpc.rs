use super::db;
use super::models::*;
use super::renderer::FrameBuffer;
use crate::plugins::{PluginContext, RpcRegistry};
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::Notify;

// ponytail: lightweight rpc handlers reporting live dynamic connection status and real hardware errors
pub fn register_rpc_methods(
    registry: &mut RpcRegistry,
    config: Arc<Mutex<DisplayConfig>>,
    framebuffer: Arc<Mutex<FrameBuffer>>,
    active_mode: Arc<Mutex<String>>,
    is_connected: Arc<AtomicBool>,
    is_mock_mode: bool,
    last_error: Arc<Mutex<Option<String>>>,
    notify_render: Arc<Notify>,
) {
    // getDisplayConfig
    let cfg_clone = config.clone();
    let mode_clone = active_mode.clone();
    let connected_clone = is_connected.clone();
    let error_clone = last_error.clone();

    registry.register("getDisplayConfig", move |_ctx, _params| {
        let cfg = cfg_clone.lock().unwrap().clone();
        let act = mode_clone.lock().unwrap().clone();
        let conn = connected_clone.load(Ordering::Relaxed);
        let err = error_clone.lock().unwrap().clone();

        let status = DisplayStatus {
            connected: conn,
            mock_mode: is_mock_mode,
            active_screen: act,
            bus: cfg.i2c_bus.clone(),
            address: format!("0x{:02X}", cfg.i2c_address),
            width: 128,
            height: 64,
            error: err,
        };
        async move {
            Ok(json!({
                "config": cfg,
                "status": status,
            }))
        }
    });

    // updateDisplayConfig
    let cfg_clone = config.clone();
    let notify_clone = notify_render.clone();
    registry.register("updateDisplayConfig", move |ctx: PluginContext, params| {
        let cfg_arc = cfg_clone.clone();
        let notify = notify_clone.clone();
        async move {
            let new_cfg: DisplayConfig = serde_json::from_value(params)
                .map_err(|e| format!("Invalid display config: {}", e))?;

            // Persist to SQLite
            let db = ctx.db.clone();
            let cfg_save = new_cfg.clone();
            tokio::task::spawn_blocking(move || {
                let conn = db.lock();
                db::save_config(&conn, &cfg_save)
            })
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;

            {
                let mut c = cfg_arc.lock().unwrap();
                *c = new_cfg.clone();
            }

            notify.notify_one();

            Ok(json!({
                "success": true,
                "config": new_cfg
            }))
        }
    });

    // setDisplayMode
    let cfg_clone = config.clone();
    let mode_clone = active_mode.clone();
    let notify_clone = notify_render.clone();
    registry.register("setDisplayMode", move |ctx: PluginContext, params| {
        let cfg_arc = cfg_clone.clone();
        let mode_arc = mode_clone.clone();
        let notify = notify_clone.clone();
        async move {
            let input: SetDisplayModeInput = serde_json::from_value(params)
                .map_err(|e| format!("Invalid mode input: {}", e))?;

            {
                let mut c = cfg_arc.lock().unwrap();
                c.mode = input.mode.clone();
            }
            {
                let mut m = mode_arc.lock().unwrap();
                *m = input.mode.clone();
            }

            // Persist
            let db = ctx.db.clone();
            let cfg_snapshot = cfg_arc.lock().unwrap().clone();
            let _ = tokio::task::spawn_blocking(move || {
                let conn = db.lock();
                let _ = db::save_config(&conn, &cfg_snapshot);
            }).await;

            notify.notify_one();

            Ok(json!({
                "success": true,
                "mode": input.mode
            }))
        }
    });

    // setDisplayPower
    let cfg_clone = config.clone();
    let notify_clone = notify_render.clone();
    registry.register("setDisplayPower", move |ctx: PluginContext, params| {
        let cfg_arc = cfg_clone.clone();
        let notify = notify_clone.clone();
        async move {
            let input: SetDisplayPowerInput = serde_json::from_value(params)
                .map_err(|e| format!("Invalid power input: {}", e))?;

            {
                let mut c = cfg_arc.lock().unwrap();
                c.enabled = input.enabled;
            }

            // Persist
            let db = ctx.db.clone();
            let cfg_snapshot = cfg_arc.lock().unwrap().clone();
            let _ = tokio::task::spawn_blocking(move || {
                let conn = db.lock();
                let _ = db::save_config(&conn, &cfg_snapshot);
            }).await;

            notify.notify_one();

            Ok(json!({
                "success": true,
                "enabled": input.enabled
            }))
        }
    });

    // getDisplayPreview
    let fb_clone = framebuffer.clone();
    let mode_clone = active_mode.clone();
    registry.register("getDisplayPreview", move |_ctx, _params| {
        let b64 = fb_clone.lock().unwrap().to_base64();
        let act = mode_clone.lock().unwrap().clone();
        async move {
            Ok(json!(DisplayPreviewResponse {
                width: 128,
                height: 64,
                bitmap_base64: b64,
                active_screen: act,
            }))
        }
    });
}
