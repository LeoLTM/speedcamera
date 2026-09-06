use super::db;
use super::models::{ActiveLapSessionResponse, Lap, LapSessionWithLaps, SaveLapInput, StartLapSessionInput, SyncLapInput};
use super::LapTimerState;
use crate::plugins::RpcRegistry;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

// ponytail: register lap timer methods directly without dynamic reflection or macro bloat
pub fn register_rpc_methods(registry: &mut RpcRegistry, state: Arc<Mutex<LapTimerState>>) {
    // ─── startLapSession ──────────────────────────────────────────────────────
    let state_start = state.clone();
    registry.register("startLapSession", move |ctx, params| {
        let state = state_start.clone();
        async move {
            let input: StartLapSessionInput = serde_json::from_value(params).unwrap_or(StartLapSessionInput {
                lap_mode: "single".to_string(),
                dir_filter: "both".to_string(),
                save_images: true,
            });

            let db = ctx.db.clone();
            let lap_mode_clone = input.lap_mode.clone();
            let session = tokio::task::spawn_blocking(move || {
                let conn = db.lock();
                // Close any existing active session before starting a new one
                if let Ok(Some(prev)) = db::get_active_session(&conn) {
                    let _ = db::close_lap_session(&conn, prev.id);
                }
                db::create_lap_session(&conn, &lap_mode_clone)
            })
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;

            {
                let mut s = state.lock().unwrap();
                s.active_session = Some(session.clone());
                s.lap_state = "waiting".to_string();
                s.lap_number = 0;
                s.lap_timing_started_at = None;
                s.start_image_path = None;
                s.lap_mode = input.lap_mode.clone();
                s.dir_filter = input.dir_filter.clone();
                s.save_images = input.save_images;
            }

            // Command serial hardware to enter lap session
            let cmd = json!({
                "command": "startLapSession",
                "mode": input.lap_mode,
                "autoFlash": true,
                "dirFilter": input.dir_filter,
            });
            ctx.serial.send_command(&cmd.to_string());
            tracing::info!("[plugin:laptimer] Started session #{} (mode: {})", session.id, input.lap_mode);

            Ok(serde_json::to_value(session).unwrap())
        }
    });

    // ─── stopLapSession ───────────────────────────────────────────────────────
    let state_stop = state.clone();
    registry.register("stopLapSession", move |ctx, _params| {
        let state = state_stop.clone();
        async move {
            let active_id = {
                let mut s = state.lock().unwrap();
                let id = s.active_session.as_ref().map(|sess| sess.id);
                s.active_session = None;
                s.lap_state = "idle".to_string();
                s.lap_timing_started_at = None;
                s.start_image_path = None;
                id
            };

            if let Some(id) = active_id {
                let db = ctx.db.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    let conn = db.lock();
                    db::close_lap_session(&conn, id)
                })
                .await;
                tracing::info!("[plugin:laptimer] Stopped session #{}", id);
            }

            ctx.serial.send_command(r#"{"command":"stopLapSession"}"#);
            Ok(Value::Null)
        }
    });

    // ─── getActiveLapSession ──────────────────────────────────────────────────
    let state_get = state.clone();
    registry.register("getActiveLapSession", move |ctx, _params| {
        let state = state_get.clone();
        async move {
            let (active_sess, lap_state, lap_num, lap_timing_started, mode, dir, save_img) = {
                let s = state.lock().unwrap();
                (
                    s.active_session.clone(),
                    s.lap_state.clone(),
                    s.lap_number,
                    s.lap_timing_started_at,
                    s.lap_mode.clone(),
                    s.dir_filter.clone(),
                    s.save_images,
                )
            };

            let session_with_laps = if let Some(sess) = active_sess {
                let db = ctx.db.clone();
                let sid = sess.id;
                let laps = tokio::task::spawn_blocking(move || {
                    let conn = db.lock();
                    db::get_laps_for_session(&conn, sid).unwrap_or_default()
                })
                .await
                .unwrap_or_default();

                Some(LapSessionWithLaps {
                    id: sess.id,
                    started_at: sess.started_at,
                    ended_at: sess.ended_at,
                    lap_mode: sess.lap_mode,
                    created_at: sess.created_at,
                    laps,
                })
            } else {
                None
            };

            let resp = ActiveLapSessionResponse {
                session: session_with_laps,
                lap_state,
                lap_number: lap_num,
                lap_timing_started_at: lap_timing_started,
                lap_mode: mode,
                dir_filter: dir,
                save_images: save_img,
            };

            Ok(serde_json::to_value(resp).unwrap())
        }
    });

    // ─── createLapSession (compat) ────────────────────────────────────────────
    registry.register("createLapSession", |ctx, params| async move {
        let lap_mode = params["lapMode"].as_str().unwrap_or("single").to_string();
        let db = ctx.db.clone();
        let session = tokio::task::spawn_blocking(move || {
            let conn = db.lock();
            db::create_lap_session(&conn, &lap_mode)
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
        Ok(serde_json::to_value(session).unwrap())
    });

    // ─── closeLapSession (compat) ─────────────────────────────────────────────
    registry.register("closeLapSession", |ctx, params| async move {
        let id = params["id"].as_i64().ok_or("Missing id parameter")?;
        let db = ctx.db.clone();
        tokio::task::spawn_blocking(move || {
            let conn = db.lock();
            db::close_lap_session(&conn, id)
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
        Ok(Value::Null)
    });

    // ─── saveLap (compat) ─────────────────────────────────────────────────────
    registry.register("saveLap", |ctx, params| async move {
        let input: SaveLapInput = serde_json::from_value(params).map_err(|e| e.to_string())?;
        let store = ctx.store.clone();
        let db = ctx.db.clone();
        let lap = tokio::task::spawn_blocking(move || -> Result<Lap, String> {
            let start_img_path = if let Some(ref b64) = input.start_image_base64 {
                store.save_base64_image(b64).ok()
            } else {
                None
            };

            let end_img_path = if let Some(ref b64) = input.end_image_base64 {
                store.save_base64_image(b64).ok()
            } else {
                None
            };

            let conn = db.lock();
            db::insert_lap(
                &conn,
                &input,
                start_img_path.as_deref(),
                end_img_path.as_deref(),
            )
            .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())??;

        Ok(serde_json::to_value(lap).unwrap())
    });

    // ─── getLapSessions ───────────────────────────────────────────────────────
    registry.register("getLapSessions", |ctx, params| async move {
        let page = params["page"].as_i64().unwrap_or(1);
        let limit = params["limit"].as_i64().unwrap_or(20);
        let db = ctx.db.clone();
        let (sessions, total) = tokio::task::spawn_blocking(move || {
            let conn = db.lock();
            db::get_lap_sessions(&conn, page, limit)
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;

        Ok(json!({
            "sessions": sessions,
            "total": total
        }))
    });

    // ─── getLapSessionById ────────────────────────────────────────────────────
    registry.register("getLapSessionById", |ctx, params| async move {
        let id = params["id"].as_i64().ok_or("Missing id parameter")?;
        let db = ctx.db.clone();
        let session = tokio::task::spawn_blocking(move || {
            let conn = db.lock();
            db::get_lap_session_by_id(&conn, id)
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
        Ok(serde_json::to_value(session).unwrap())
    });

    // ─── deleteLapSession ─────────────────────────────────────────────────────
    registry.register("deleteLapSession", |ctx, params| async move {
        let id = params["id"].as_i64().ok_or("Missing id parameter")?;
        let db = ctx.db.clone();
        let store = ctx.store.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let img_paths = {
                let conn = db.lock();
                db::get_lap_image_paths_for_session(&conn, id).unwrap_or_default()
            };
            {
                let conn = db.lock();
                db::delete_lap_session(&conn, id).map_err(|e| e.to_string())?;
            }
            for p in img_paths {
                store.delete_image(&p);
            }
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())??;
        Ok(Value::Null)
    });

    // ─── deleteLap ────────────────────────────────────────────────────────────
    registry.register("deleteLap", |ctx, params| async move {
        let id = params["id"].as_i64().ok_or("Missing id parameter")?;
        let db = ctx.db.clone();
        let store = ctx.store.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let img_paths = {
                let conn = db.lock();
                db::get_lap_image_paths_for_lap(&conn, id).unwrap_or_default()
            };
            {
                let conn = db.lock();
                db::delete_lap(&conn, id).map_err(|e| e.to_string())?;
            }
            for p in img_paths {
                store.delete_image(&p);
            }
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())??;
        Ok(Value::Null)
    });

    // ─── syncLapToTeable ──────────────────────────────────────────────────────
    registry.register("syncLapToTeable", |ctx, params| async move {
        let input: SyncLapInput = serde_json::from_value(params).map_err(|e| e.to_string())?;
        let db = ctx.db.clone();
        let settings = tokio::task::spawn_blocking(move || {
            let conn = db.lock();
            crate::db::settings::get_settings(&conn)
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;

        let teable = crate::integrations::teable::TeableClient::new();
        let core_input = crate::models::SyncLapInput {
            lap: crate::models::Lap {
                id: input.lap.id,
                session_id: input.lap.session_id,
                lap_number: input.lap.lap_number,
                start_timestamp: input.lap.start_timestamp,
                end_timestamp: input.lap.end_timestamp,
                duration_ms: input.lap.duration_ms,
                duration_us: input.lap.duration_us,
                speed_at_start: input.lap.speed_at_start,
                speed_at_end: input.lap.speed_at_end,
                start_image_path: input.lap.start_image_path,
                end_image_path: input.lap.end_image_path,
            },
            session: crate::models::LapSession {
                id: input.session.id,
                started_at: input.session.started_at,
                ended_at: input.session.ended_at,
                lap_mode: input.session.lap_mode,
                created_at: input.session.created_at,
            },
        };

        teable
            .sync_lap(
                &settings.teable_url,
                &settings.teable_token,
                &settings.teable_table_id,
                &core_input,
            )
            .await?;
        Ok(Value::Null)
    });
}

