use super::models::AlignmentStatus;
use super::AlignmentState;
use crate::plugins::RpcRegistry;
use serde_json::json;
use std::sync::{Arc, Mutex};

// ponytail: register alignment RPC handlers directly without boilerplate
pub fn register_rpc_methods(registry: &mut RpcRegistry, state: Arc<Mutex<AlignmentState>>) {
    // ─── startAlignment ───────────────────────────────────────────────────────
    let state_start = state.clone();
    registry.register("startAlignment", move |ctx, _params| {
        let state = state_start.clone();
        async move {
            {
                let mut s = state.lock().unwrap();
                s.active = true;
            }

            let cmd = json!({ "command": "startAlignment" });
            ctx.serial.send_command(&cmd.to_string());
            tracing::info!("[plugin:alignment] Alignment monitoring started");

            Ok(json!({ "success": true, "active": true }))
        }
    });

    // ─── stopAlignment ────────────────────────────────────────────────────────
    let state_stop = state.clone();
    registry.register("stopAlignment", move |ctx, _params| {
        let state = state_stop.clone();
        async move {
            {
                let mut s = state.lock().unwrap();
                s.active = false;
            }

            let cmd = json!({ "command": "stopAlignment" });
            ctx.serial.send_command(&cmd.to_string());
            tracing::info!("[plugin:alignment] Alignment monitoring stopped");

            Ok(json!({ "success": true, "active": false }))
        }
    });

    // ─── getAlignmentStatus ───────────────────────────────────────────────────
    let state_status = state.clone();
    registry.register("getAlignmentStatus", move |_ctx, _params| {
        let state = state_status.clone();
        async move {
            let s = state.lock().unwrap();
            let status = AlignmentStatus {
                active: s.active,
                sensor1_interrupted: s.sensor1_interrupted,
                sensor2_interrupted: s.sensor2_interrupted,
                last_update_ms: s.last_update_ms,
            };
            Ok(serde_json::to_value(status).unwrap())
        }
    });
}
