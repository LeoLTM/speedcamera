use super::db;
use super::models::{Lap, SaveLapInput, SyncLapInput};
use crate::plugins::RpcRegistry;
use serde_json::{json, Value};

// ponytail: register lap timer methods directly without dynamic reflection or macro bloat
pub fn register_rpc_methods(registry: &mut RpcRegistry) {
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
        // Convert to core SyncLapInput representation if needed
        let core_input = crate::models::SyncLapInput {
            lap: crate::models::Lap {
                id: input.lap.id,
                session_id: input.lap.session_id,
                lap_number: input.lap.lap_number,
                start_timestamp: input.lap.start_timestamp,
                end_timestamp: input.lap.end_timestamp,
                duration_ms: input.lap.duration_ms,
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
