use crate::camera::CameraService;
use crate::db::Database;
use crate::integrations::flasher::{flash_firmware, list_firmware_releases, test_github_token};
use crate::integrations::teable::TeableClient;
use crate::models::*;
use crate::network::get_system_network_summary;
use crate::serial::SerialService;
use crate::storage::skin::render_poliscan_skin;
use crate::storage::FileStore;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::Arc;
use tokio::sync::broadcast;

#[derive(Debug, Deserialize)]
pub struct RpcRequest {
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize)]
pub struct RpcResponse {
    pub id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub struct RpcContext {
    pub config: crate::config::AppConfig,
    pub db: Database,
    pub store: FileStore,
    pub camera: Arc<CameraService>,
    pub serial: Arc<SerialService>,
    pub teable: TeableClient,
    pub flash_tx: broadcast::Sender<FlashProgressPayload>,
    pub violation_tx: broadcast::Sender<Violation>,
    pub armed: Arc<std::sync::atomic::AtomicBool>,
    pub armed_tx: broadcast::Sender<bool>,
}

pub async fn handle_rpc(ctx: &RpcContext, req: RpcRequest) -> RpcResponse {
    let id = req.id;
    let res = dispatch_method(ctx, &req.method, req.params).await;

    match res {
        Ok(val) => RpcResponse {
            id,
            result: Some(val),
            error: None,
        },
        Err(e) => RpcResponse {
            id,
            result: None,
            error: Some(e),
        },
    }
}

async fn dispatch_method(ctx: &RpcContext, method: &str, params: Value) -> Result<Value, String> {
    match method {
        // ─── Violations ───────────────────────────────────────────────────────
        "getViolations" => {
            let q: ViolationQuery = serde_json::from_value(params).map_err(|e| e.to_string())?;
            let conn = ctx.db.lock();
            let page = crate::db::violations::query_violations(&conn, &q).map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(page).unwrap())
        }

        "getViolationById" => {
            let id = params["id"].as_i64().ok_or("Missing id parameter")?;
            let conn = ctx.db.lock();
            let violation =
                crate::db::violations::get_violation_by_id(&conn, id).map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(violation).unwrap())
        }

        "deleteViolation" => {
            let id = params["id"].as_i64().ok_or("Missing id parameter")?;
            let conn = ctx.db.lock();
            if let Ok(Some(v)) = crate::db::violations::get_violation_by_id(&conn, id) {
                let _ = crate::db::violations::remove_violation(&conn, id);
                ctx.store.delete_image(&v.image_path);
            }
            Ok(Value::Null)
        }

        "exportViolationsCsv" => {
            let date_from = params["dateFrom"].as_str();
            let date_to = params["dateTo"].as_str();
            let min_speed = params["minSpeed"].as_f64();
            let conn = ctx.db.lock();
            let csv = crate::db::violations::export_csv(&conn, date_from, date_to, min_speed)
                .map_err(|e| e.to_string())?;
            Ok(Value::String(csv))
        }

        "saveViolation" => {
            let input: SaveViolationInput =
                serde_json::from_value(params).map_err(|e| e.to_string())?;

            let cam = ctx.camera.clone();
            let store = ctx.store.clone();
            let db = ctx.db.clone();
            let v_tx = ctx.violation_tx.clone();

            let v = tokio::task::spawn_blocking(move || -> Result<Violation, String> {
                let (raw_bytes, ext) = if let Some(ref b64) = input.image_base64 {
                    let clean = if let Some(pos) = b64.find(',') {
                        &b64[pos + 1..]
                    } else {
                        b64
                    };
                    let decoded = base64::engine::general_purpose::STANDARD
                        .decode(clean.trim())
                        .map_err(|e| e.to_string())?;
                    let ext = if decoded.starts_with(&[0xFF, 0xD8, 0xFF]) {
                        "jpg"
                    } else {
                        "png"
                    };
                    (decoded, ext)
                } else {
                    let jpg = cam
                        .capture_frame_jpeg(90)
                        .ok_or_else(|| "Failed to capture frame from industrial camera".to_string())?;
                    (jpg, "jpg")
                };

                let image_path = store
                    .save_image_bytes(&raw_bytes, ext)
                    .map_err(|e| e.to_string())?;

                let conn = db.lock();
                let violation = crate::db::violations::insert_violation(&conn, &input, &image_path)
                    .map_err(|e| e.to_string())?;
                let _ = v_tx.send(violation.clone());
                Ok(violation)
            })
            .await
            .map_err(|e| e.to_string())??;

            Ok(serde_json::to_value(v).unwrap())
        }

        // ─── Lap Sessions ─────────────────────────────────────────────────────
        "createLapSession" => {
            let lap_mode = params["lapMode"].as_str().unwrap_or("single");
            let conn = ctx.db.lock();
            let session =
                crate::db::laps::create_lap_session(&conn, lap_mode).map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(session).unwrap())
        }

        "closeLapSession" => {
            let id = params["id"].as_i64().ok_or("Missing id parameter")?;
            let conn = ctx.db.lock();
            crate::db::laps::close_lap_session(&conn, id).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }

        "saveLap" => {
            let input: SaveLapInput = serde_json::from_value(params).map_err(|e| e.to_string())?;

            let start_img_path = if let Some(ref b64) = input.start_image_base64 {
                ctx.store.save_base64_image(b64).ok()
            } else {
                None
            };

            let end_img_path = if let Some(ref b64) = input.end_image_base64 {
                ctx.store.save_base64_image(b64).ok()
            } else {
                None
            };

            let conn = ctx.db.lock();
            let lap = crate::db::laps::insert_lap(
                &conn,
                &input,
                start_img_path.as_deref(),
                end_img_path.as_deref(),
            )
            .map_err(|e| e.to_string())?;

            Ok(serde_json::to_value(lap).unwrap())
        }

        "getLapSessions" => {
            let page = params["page"].as_i64().unwrap_or(1);
            let limit = params["limit"].as_i64().unwrap_or(20);
            let conn = ctx.db.lock();
            let (sessions, total) =
                crate::db::laps::get_lap_sessions(&conn, page, limit).map_err(|e| e.to_string())?;

            Ok(json!({
                "sessions": sessions,
                "total": total
            }))
        }

        "getLapSessionById" => {
            let id = params["id"].as_i64().ok_or("Missing id parameter")?;
            let conn = ctx.db.lock();
            let session =
                crate::db::laps::get_lap_session_by_id(&conn, id).map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(session).unwrap())
        }

        "deleteLapSession" => {
            let id = params["id"].as_i64().ok_or("Missing id parameter")?;
            let img_paths = {
                let conn = ctx.db.lock();
                crate::db::laps::get_lap_image_paths_for_session(&conn, id).unwrap_or_default()
            };
            {
                let conn = ctx.db.lock();
                crate::db::laps::delete_lap_session(&conn, id).map_err(|e| e.to_string())?;
            }
            for p in img_paths {
                ctx.store.delete_image(&p);
            }
            Ok(Value::Null)
        }

        "deleteLap" => {
            let id = params["id"].as_i64().ok_or("Missing id parameter")?;
            let img_paths = {
                let conn = ctx.db.lock();
                crate::db::laps::get_lap_image_paths_for_lap(&conn, id).unwrap_or_default()
            };
            {
                let conn = ctx.db.lock();
                crate::db::laps::delete_lap(&conn, id).map_err(|e| e.to_string())?;
            }
            for p in img_paths {
                ctx.store.delete_image(&p);
            }
            Ok(Value::Null)
        }

        // ─── Images ───────────────────────────────────────────────────────────
        "getImageData" => {
            let image_path = params["imagePath"].as_str().unwrap_or("");
            if image_path.is_empty() {
                return Ok(Value::String(String::new()));
            }
            let mut url = format!("/image?path={}", urlencoding::encode(image_path));
            if let Some(w) = params["width"].as_u64().or_else(|| params["w"].as_u64()) {
                url.push_str(&format!("&w={}", w));
            }
            if let Some(h) = params["height"].as_u64().or_else(|| params["h"].as_u64()) {
                url.push_str(&format!("&h={}", h));
            }
            if let Some(q) = params["quality"].as_u64().or_else(|| params["q"].as_u64()) {
                url.push_str(&format!("&q={}", q));
            }
            if let Some(fmt) = params["format"].as_str().or_else(|| params["fmt"].as_str()) {
                url.push_str(&format!("&fmt={}", fmt));
            }
            Ok(Value::String(url))
        }

        "getSkinnedImageData" => {
            let violation_id = params["violationId"].as_i64().ok_or("Missing violationId")?;
            let mut url = format!("/skinned-image?violationId={}", violation_id);
            if let Some(w) = params["width"].as_u64().or_else(|| params["w"].as_u64()) {
                url.push_str(&format!("&w={}", w));
            }
            if let Some(h) = params["height"].as_u64().or_else(|| params["h"].as_u64()) {
                url.push_str(&format!("&h={}", h));
            }
            if let Some(q) = params["quality"].as_u64().or_else(|| params["q"].as_u64()) {
                url.push_str(&format!("&q={}", q));
            }
            if let Some(fmt) = params["format"].as_str().or_else(|| params["fmt"].as_str()) {
                url.push_str(&format!("&fmt={}", fmt));
            }
            Ok(Value::String(url))
        }

        "exportSkinnedImages" => {
            let ids = params["violationIds"]
                .as_array()
                .ok_or("Missing violationIds")?
                .clone();
            let target_dir = params["targetDir"].as_str().ok_or("Missing targetDir")?.to_string();

            let db = ctx.db.clone();
            let store = ctx.store.clone();

            let res = tokio::task::spawn_blocking(move || -> Result<ExportSkinnedResult, String> {
                let conn = db.lock();
                let settings = crate::db::settings::get_settings(&conn).map_err(|e| e.to_string())?;

                let mut exported = 0;
                let mut failed = 0;

                for val in ids {
                    if let Some(id) = val.as_i64() {
                        if let Ok(Some(v)) = crate::db::violations::get_violation_by_id(&conn, id) {
                            if let Some(bytes) = store.read_image(&v.image_path) {
                                if let Some(skinned) = render_poliscan_skin(
                                    &bytes,
                                    &v,
                                    &settings.skin_measuring_location,
                                ) {
                                    let ext = if skinned.starts_with(&[0xFF, 0xD8, 0xFF]) {
                                        "jpg"
                                    } else {
                                        "png"
                                    };
                                    let out_path = Path::new(&target_dir)
                                        .join(format!("violation-{}-{}.{}", v.id, v.timestamp.replace(":", "-"), ext));
                                    if std::fs::write(out_path, skinned).is_ok() {
                                        exported += 1;
                                        continue;
                                    }
                                }
                            }
                        }
                        failed += 1;
                    }
                }

                Ok(ExportSkinnedResult { exported, failed })
            })
            .await
            .map_err(|e| e.to_string())??;

            Ok(serde_json::to_value(res).unwrap())
        }

        // ─── Armed / System State ─────────────────────────────────────────────
        "getArmedState" => {
            let is_armed = ctx.armed.load(std::sync::atomic::Ordering::SeqCst);
            Ok(json!({ "armed": is_armed }))
        }

        "setArmed" => {
            let is_armed = params["armed"]
                .as_bool()
                .ok_or("Missing armed parameter")?;
            ctx.armed.store(is_armed, std::sync::atomic::Ordering::SeqCst);
            let _ = ctx.armed_tx.send(is_armed);
            tracing::info!("[system] Armed state updated: {}", is_armed);
            Ok(json!({ "armed": is_armed }))
        }

        // ─── Settings ─────────────────────────────────────────────────────────
        "getSettings" => {
            let conn = ctx.db.lock();
            let settings = crate::db::settings::get_settings(&conn).map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(settings).unwrap())
        }

        "saveSetting" => {
            let key = params["key"].as_str().ok_or("Missing key")?;
            let value = params["value"].as_str().ok_or("Missing value")?;
            let conn = ctx.db.lock();
            crate::db::settings::save_setting(&conn, key, value).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }

        // ─── Serial ───────────────────────────────────────────────────────────
        "listPorts" => {
            let ports = ctx.serial.list_ports();
            Ok(serde_json::to_value(ports).unwrap())
        }

        "getSerialStatus" => {
            let status = ctx.serial.get_status();
            Ok(serde_json::to_value(status).unwrap())
        }

        "openPort" => {
            let path = params["path"].as_str().ok_or("Missing port path")?;
            ctx.serial.open_port(path);
            Ok(Value::Null)
        }

        "closePort" => {
            ctx.serial.close_port();
            Ok(Value::Null)
        }

        "sendCommand" => {
            let json_cmd = params["json"].as_str().ok_or("Missing json command")?;
            ctx.serial.send_command(json_cmd);
            Ok(Value::Null)
        }

        // ─── Camera HW ────────────────────────────────────────────────────────
        "connectCamera" => {
            let cam = ctx.camera.clone();
            let db = ctx.db.clone();
            tokio::task::spawn_blocking(move || {
                let conn = db.lock();
                let settings = crate::db::settings::get_settings(&conn).unwrap_or_default();
                cam.connect(&settings);
            })
            .await
            .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }

        "disconnectCamera" => {
            let cam = ctx.camera.clone();
            tokio::task::spawn_blocking(move || {
                cam.disconnect();
            })
            .await
            .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }

        "getCameraStatus" => {
            let status = ctx.camera.get_status();
            Ok(serde_json::to_value(status).unwrap())
        }

        "captureFrame" => {
            let cam = ctx.camera.clone();
            let b64 = tokio::task::spawn_blocking(move || {
                if let Some(jpg_bytes) = cam.capture_frame_jpeg(90) {
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&jpg_bytes);
                    Some(format!("data:image/jpeg;base64,{}", b64))
                } else {
                    None
                }
            })
            .await
            .map_err(|e| e.to_string())?;

            if let Some(data) = b64 {
                Ok(Value::String(data))
            } else {
                Ok(Value::Null)
            }
        }

        "setCameraExposure" => {
            let val = params["value"].as_f64().ok_or("Missing exposure value")?;
            ctx.camera.set_exposure(val);
            Ok(Value::Null)
        }

        "setCameraGain" => {
            let val = params["value"].as_f64().ok_or("Missing gain value")?;
            ctx.camera.set_gain(val);
            Ok(Value::Null)
        }

        "setCameraFeatureStr" => {
            let feature = params["feature"].as_str().ok_or("Missing feature name")?;
            let value = params["value"].as_str().ok_or("Missing feature value")?;
            ctx.camera.set_feature_str(feature, value);
            Ok(Value::Null)
        }

        "setCameraFeatureInt" => {
            let feature = params["feature"].as_str().ok_or("Missing feature name")?;
            let value = params["value"].as_i64().ok_or("Missing feature value")?;
            ctx.camera.set_feature_int(feature, value);
            Ok(Value::Null)
        }

        "applyMfsConfig" => {
            let mfs = params["mfsContent"].as_str().ok_or("Missing mfsContent")?;
            let save_default = params["saveAsDefault"].as_bool().unwrap_or(false);
            let res = ctx.camera.apply_mfs_config(mfs, save_default);
            Ok(serde_json::to_value(res).unwrap())
        }

        "startSetupStream" => {
            ctx.camera.start_setup_stream();
            Ok(Value::Null)
        }

        "stopSetupStream" => {
            let cam = ctx.camera.clone();
            let db = ctx.db.clone();
            tokio::task::spawn_blocking(move || {
                let conn = db.lock();
                let settings = crate::db::settings::get_settings(&conn).unwrap_or_default();
                cam.stop_setup_stream(&settings);
            })
            .await
            .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }

        "setCameraPixelFormat" => {
            let fmt = params["format"].as_str().ok_or("Missing format")?;
            ctx.camera.set_pixel_format(fmt);
            Ok(Value::Null)
        }

        "getCameraPixelFormat" => {
            let conn = ctx.db.lock();
            let settings = crate::db::settings::get_settings(&conn).unwrap_or_default();
            Ok(Value::String(settings.pixel_format))
        }

        "setCameraStrobeDuration" => {
            let val = params["value"].as_i64().ok_or("Missing value")?;
            ctx.camera.set_strobe_duration(val);
            Ok(Value::Null)
        }

        // ─── System & Network ─────────────────────────────────────────────────
        "getPlatform" => Ok(Value::String(std::env::consts::OS.to_string())),

        "getNetworkInfo" => {
            let summary = get_system_network_summary();
            Ok(serde_json::to_value(summary).unwrap())
        }

        // ─── Teable ───────────────────────────────────────────────────────────
        "testTeableConnection" => {
            let url = params["url"].as_str().ok_or("Missing url")?;
            let token = params["token"].as_str().ok_or("Missing token")?;
            let user = ctx.teable.test_connection(url, token).await?;
            Ok(serde_json::to_value(user).unwrap())
        }

        "saveTeableConfig" => {
            let url = params["url"].as_str().unwrap_or("");
            let token = params["token"].as_str().unwrap_or("");
            let name = params["userName"].as_str().unwrap_or("");
            let email = params["userEmail"].as_str().unwrap_or("");
            let avatar = params["userAvatar"].as_str().unwrap_or("");

            let conn = ctx.db.lock();
            let _ = crate::db::settings::save_setting(&conn, "teableUrl", url);
            let _ = crate::db::settings::save_setting(&conn, "teableToken", token);
            let _ = crate::db::settings::save_setting(&conn, "teableUserName", name);
            let _ = crate::db::settings::save_setting(&conn, "teableUserEmail", email);
            let _ = crate::db::settings::save_setting(&conn, "teableUserAvatar", avatar);
            Ok(Value::Null)
        }

        "removeTeableConfig" => {
            let conn = ctx.db.lock();
            let _ = crate::db::settings::save_setting(&conn, "teableUrl", "");
            let _ = crate::db::settings::save_setting(&conn, "teableToken", "");
            let _ = crate::db::settings::save_setting(&conn, "teableUserName", "");
            let _ = crate::db::settings::save_setting(&conn, "teableUserEmail", "");
            let _ = crate::db::settings::save_setting(&conn, "teableUserAvatar", "");
            let _ = crate::db::settings::save_setting(&conn, "teableSpaceId", "");
            let _ = crate::db::settings::save_setting(&conn, "teableBaseId", "");
            let _ = crate::db::settings::save_setting(&conn, "teableTableId", "");
            let _ = crate::db::settings::save_setting(&conn, "teableSyncEnabled", "false");
            Ok(Value::Null)
        }

        "saveTeableTarget" => {
            let space_id = params["spaceId"].as_str().unwrap_or("");
            let base_id = params["baseId"].as_str().unwrap_or("");
            let table_id = params["tableId"].as_str().unwrap_or("");

            let conn = ctx.db.lock();
            let _ = crate::db::settings::save_setting(&conn, "teableSpaceId", space_id);
            let _ = crate::db::settings::save_setting(&conn, "teableBaseId", base_id);
            let _ = crate::db::settings::save_setting(&conn, "teableTableId", table_id);
            Ok(Value::Null)
        }

        "listTeableSpaces" => {
            let settings = {
                let conn = ctx.db.lock();
                crate::db::settings::get_settings(&conn).map_err(|e| e.to_string())?
            };
            let spaces = ctx
                .teable
                .list_spaces(&settings.teable_url, &settings.teable_token)
                .await?;
            Ok(serde_json::to_value(spaces).unwrap())
        }

        "listTeableBases" => {
            let space_id = params["spaceId"].as_str().ok_or("Missing spaceId")?;
            let settings = {
                let conn = ctx.db.lock();
                crate::db::settings::get_settings(&conn).map_err(|e| e.to_string())?
            };
            let bases = ctx
                .teable
                .list_bases(&settings.teable_url, &settings.teable_token, space_id)
                .await?;
            Ok(serde_json::to_value(bases).unwrap())
        }

        "listTeableTables" => {
            let base_id = params["baseId"].as_str().ok_or("Missing baseId")?;
            let settings = {
                let conn = ctx.db.lock();
                crate::db::settings::get_settings(&conn).map_err(|e| e.to_string())?
            };
            let tables = ctx
                .teable
                .list_tables(&settings.teable_url, &settings.teable_token, base_id)
                .await?;
            Ok(serde_json::to_value(tables).unwrap())
        }

        "verifyTeableTable" => {
            let table_id = params["tableId"].as_str().ok_or("Missing tableId")?;
            let settings = {
                let conn = ctx.db.lock();
                crate::db::settings::get_settings(&conn).map_err(|e| e.to_string())?
            };
            let check = ctx
                .teable
                .verify_table(&settings.teable_url, &settings.teable_token, table_id)
                .await?;
            Ok(serde_json::to_value(check).unwrap())
        }

        "ensureTeableFields" => {
            let table_id = params["tableId"].as_str().ok_or("Missing tableId")?;
            let settings = {
                let conn = ctx.db.lock();
                crate::db::settings::get_settings(&conn).map_err(|e| e.to_string())?
            };
            let created = ctx
                .teable
                .ensure_fields(&settings.teable_url, &settings.teable_token, table_id)
                .await?;
            Ok(serde_json::to_value(created).unwrap())
        }

        "createTeableTable" => {
            let base_id = params["baseId"].as_str().ok_or("Missing baseId")?;
            let table_name = params["tableName"].as_str().ok_or("Missing tableName")?;
            let settings = {
                let conn = ctx.db.lock();
                crate::db::settings::get_settings(&conn).map_err(|e| e.to_string())?
            };
            let table = ctx
                .teable
                .create_table(
                    &settings.teable_url,
                    &settings.teable_token,
                    base_id,
                    table_name,
                )
                .await?;
            Ok(serde_json::to_value(table).unwrap())
        }

        "syncLapToTeable" => {
            let input: SyncLapInput = serde_json::from_value(params).map_err(|e| e.to_string())?;
            let settings = {
                let conn = ctx.db.lock();
                crate::db::settings::get_settings(&conn).map_err(|e| e.to_string())?
            };
            ctx.teable
                .sync_lap(
                    &settings.teable_url,
                    &settings.teable_token,
                    &settings.teable_table_id,
                    &input,
                )
                .await?;
            Ok(Value::Null)
        }

        // ─── Firmware Flasher ─────────────────────────────────────────────────
        "testGithubToken" => {
            let token = params["token"].as_str().unwrap_or("");
            let (valid, login) = test_github_token(token).await?;
            Ok(json!({ "valid": valid, "login": login }))
        }

        "listFirmwareReleases" => {
            let settings = {
                let conn = ctx.db.lock();
                crate::db::settings::get_settings(&conn).unwrap_or_default()
            };
            let releases = list_firmware_releases(&settings.github_token).await?;
            Ok(serde_json::to_value(releases).unwrap())
        }

        "flashFirmware" => {
            let release_tag = params["releaseTag"].as_str().unwrap_or("").to_string();
            let port = params["port"].as_str().unwrap_or("").to_string();
            let asset_url = params["firmwareAssetApiUrl"]
                .as_str()
                .unwrap_or("")
                .to_string();

            let conn = ctx.db.lock();
            let settings = crate::db::settings::get_settings(&conn).unwrap_or_default();
            let token = settings.github_token;
            let tx = ctx.flash_tx.clone();

            ctx.serial.close_port();

            tokio::spawn(async move {
                flash_firmware(&release_tag, &port, &asset_url, &token, tx).await;
            });

            Ok(Value::Null)
        }

        // ─── Stubs for Window & Updater ───────────────────────────────────────
        "minimizeWindow" | "maximizeWindow" | "closeWindow" | "cancelFlash" | "applyUpdate" => {
            Ok(Value::Null)
        }

        "getLocalVersion" => Ok(json!({
            "version": "0.5.0-rust",
            "channel": "rust",
            "hash": "rpi5-native"
        })),

        "checkForUpdate" => Ok(json!({
            "version": "0.5.0-rust",
            "hash": "rpi5-native",
            "updateAvailable": false,
            "updateReady": false,
            "error": "Native binary managed by system"
        })),

        "downloadUpdate" => Ok(json!({
            "ok": true
        })),

        _ => Err(format!("Method '{}' not found", method)),
    }
}

mod urlencoding {
    pub fn encode(s: &str) -> String {
        url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
    }
}
