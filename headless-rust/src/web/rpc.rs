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
    pub plugins: Arc<crate::plugins::PluginRegistry>,
    pub state_machine: Arc<crate::state_machine::SystemStateMachine>,
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
            let db = ctx.db.clone();
            let page = tokio::task::spawn_blocking(move || {
                let conn = db.lock();
                crate::db::violations::query_violations(&conn, &q)
            })
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(page).unwrap())
        }

        "getViolationById" => {
            let id = params["id"].as_i64().ok_or("Missing id parameter")?;
            let db = ctx.db.clone();
            let violation = tokio::task::spawn_blocking(move || {
                let conn = db.lock();
                crate::db::violations::get_violation_by_id(&conn, id)
            })
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(violation).unwrap())
        }

        "deleteViolation" => {
            let id = params["id"].as_i64().ok_or("Missing id parameter")?;
            let db = ctx.db.clone();
            let store = ctx.store.clone();
            tokio::task::spawn_blocking(move || {
                let conn = db.lock();
                if let Ok(Some(v)) = crate::db::violations::get_violation_by_id(&conn, id) {
                    let _ = crate::db::violations::remove_violation(&conn, id);
                    store.delete_image(&v.image_path);
                }
            })
            .await
            .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }

        "exportViolationsCsv" => {
            let date_from = params["dateFrom"].as_str().map(|s| s.to_string());
            let date_to = params["dateTo"].as_str().map(|s| s.to_string());
            let min_speed = params["minSpeed"].as_f64();
            let db = ctx.db.clone();
            let csv = tokio::task::spawn_blocking(move || {
                let conn = db.lock();
                crate::db::violations::export_csv(&conn, date_from.as_deref(), date_to.as_deref(), min_speed)
            })
            .await
            .map_err(|e| e.to_string())?
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

        // ─── Plugins ──────────────────────────────────────────────────────────
        "getPlugins" => {
            let plugins = ctx.plugins.list_plugins();
            Ok(serde_json::to_value(plugins).unwrap())
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
            if is_armed && ctx.state_machine.current_mode() != crate::state_machine::OperatingMode::SpeedCamera {
                let _ = ctx.state_machine.transition_to(crate::state_machine::OperatingMode::SpeedCamera, true);
            }
            ctx.armed.store(is_armed, std::sync::atomic::Ordering::SeqCst);
            let _ = ctx.armed_tx.send(is_armed);
            tracing::info!("[system] Armed state updated: {}", is_armed);
            Ok(json!({ "armed": is_armed }))
        }

        // ─── Operating Mode State Machine ──────────────────────────────────────
        "getOperatingMode" => {
            let status = ctx.state_machine.get_status();
            Ok(serde_json::to_value(status).unwrap())
        }

        "setOperatingMode" => {
            let mode_str = params["targetMode"]
                .as_str()
                .or_else(|| params["mode"].as_str())
                .ok_or("Missing targetMode parameter")?;
            let force = params["force"].as_bool().unwrap_or(false);

            let target = crate::state_machine::OperatingMode::from_str(mode_str)
                .ok_or_else(|| format!("Unknown operating mode '{}'", mode_str))?;

            match ctx.state_machine.transition_to(target, force) {
                Ok(status) => Ok(json!({
                    "success": true,
                    "status": status,
                    "mode": status.current_mode
                })),
                Err(rejection) => Ok(json!({
                    "success": false,
                    "safeguard": rejection.safeguard,
                    "message": rejection.message
                })),
            }
        }


        // ─── Settings ─────────────────────────────────────────────────────────
        "getSettings" => {
            let db = ctx.db.clone();
            let settings = tokio::task::spawn_blocking(move || {
                let conn = db.lock();
                crate::db::settings::get_settings(&conn)
            })
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(settings).unwrap())
        }

        "saveSetting" => {
            let key = params["key"].as_str().ok_or("Missing key")?.to_string();
            let value = params["value"].as_str().ok_or("Missing value")?.to_string();
            let db = ctx.db.clone();
            tokio::task::spawn_blocking(move || {
                let conn = db.lock();
                crate::db::settings::save_setting(&conn, &key, &value)
            })
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }

        // ─── Serial ───────────────────────────────────────────────────────────
        "listPorts" => {
            let serial = ctx.serial.clone();
            let ports = tokio::task::spawn_blocking(move || serial.list_ports())
                .await
                .map_err(|e| e.to_string())?;
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
            let json_cmd = params["json"].as_str().ok_or("Missing json command")?.to_string();
            let serial = ctx.serial.clone();
            tokio::task::spawn_blocking(move || serial.send_command(&json_cmd))
                .await
                .map_err(|e| e.to_string())?;
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
            let cam = ctx.camera.clone();
            tokio::task::spawn_blocking(move || cam.set_exposure(val))
                .await
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }

        "setCameraGain" => {
            let val = params["value"].as_f64().ok_or("Missing gain value")?;
            let cam = ctx.camera.clone();
            tokio::task::spawn_blocking(move || cam.set_gain(val))
                .await
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }

        "setCameraFeatureStr" => {
            let feature = params["feature"].as_str().ok_or("Missing feature name")?.to_string();
            let value = params["value"].as_str().ok_or("Missing feature value")?.to_string();
            let cam = ctx.camera.clone();
            tokio::task::spawn_blocking(move || cam.set_feature_str(&feature, &value))
                .await
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }

        "setCameraFeatureInt" => {
            let feature = params["feature"].as_str().ok_or("Missing feature name")?.to_string();
            let value = params["value"].as_i64().ok_or("Missing feature value")?;
            let cam = ctx.camera.clone();
            tokio::task::spawn_blocking(move || cam.set_feature_int(&feature, value))
                .await
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }

        "applyMfsConfig" => {
            let mfs = params["mfsContent"].as_str().ok_or("Missing mfsContent")?.to_string();
            let save_default = params["saveAsDefault"].as_bool().unwrap_or(false);
            let cam = ctx.camera.clone();
            let res = tokio::task::spawn_blocking(move || cam.apply_mfs_config(&mfs, save_default))
                .await
                .map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(res).unwrap())
        }

        "startSetupStream" => {
            let cam = ctx.camera.clone();
            tokio::task::spawn_blocking(move || cam.start_setup_stream())
                .await
                .map_err(|e| e.to_string())?;
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
            let fmt = params["format"].as_str().ok_or("Missing format")?.to_string();
            let cam = ctx.camera.clone();
            tokio::task::spawn_blocking(move || cam.set_pixel_format(&fmt))
                .await
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }

        "getCameraPixelFormat" => {
            let db = ctx.db.clone();
            let format = tokio::task::spawn_blocking(move || {
                let conn = db.lock();
                crate::db::settings::get_settings(&conn).unwrap_or_default().pixel_format
            })
            .await
            .map_err(|e| e.to_string())?;
            Ok(Value::String(format))
        }

        "setCameraStrobeDuration" => {
            let val = params["value"].as_i64().ok_or("Missing value")?;
            let cam = ctx.camera.clone();
            tokio::task::spawn_blocking(move || cam.set_strobe_duration(val))
                .await
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }

        // ─── System & Network ─────────────────────────────────────────────────
        "getPlatform" => Ok(Value::String(std::env::consts::OS.to_string())),

        "getNetworkInfo" => {
            let summary = get_system_network_summary();
            Ok(serde_json::to_value(summary).unwrap())
        }

        "scanWifiNetworks" => {
            let results = tokio::task::spawn_blocking(move || crate::network::scan_wifi_networks())
                .await
                .map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(results).unwrap())
        }

        "applyNetworkMode" => {
            let input: ApplyNetworkModeInput =
                serde_json::from_value(params).map_err(|e| e.to_string())?;
            let res = tokio::task::spawn_blocking(move || crate::network::apply_network_mode(&input))
                .await
                .map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(res).unwrap())
        }

        "forgetWifi" => {
            let input = ApplyNetworkModeInput {
                mode: "forget".to_string(),
                ssid: None,
                password: None,
            };
            let res = tokio::task::spawn_blocking(move || crate::network::apply_network_mode(&input))
                .await
                .map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(res).unwrap())
        }

        "setEthernetMode" => {
            let mode = params["mode"].as_str().unwrap_or("camera-lan").to_string();
            let input = ApplyNetworkModeInput {
                mode,
                ssid: None,
                password: None,
            };
            let res = tokio::task::spawn_blocking(move || crate::network::apply_network_mode(&input))
                .await
                .map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(res).unwrap())
        }

        // ─── Teable ───────────────────────────────────────────────────────────
        "testTeableConnection" => {
            let url = params["url"].as_str().ok_or("Missing url")?;
            let token = params["token"].as_str().ok_or("Missing token")?;
            let user = ctx.teable.test_connection(url, token).await?;
            Ok(serde_json::to_value(user).unwrap())
        }

        "saveTeableConfig" => {
            let url = params["url"].as_str().unwrap_or("").to_string();
            let token = params["token"].as_str().unwrap_or("").to_string();
            let name = params["userName"].as_str().unwrap_or("").to_string();
            let email = params["userEmail"].as_str().unwrap_or("").to_string();
            let avatar = params["userAvatar"].as_str().unwrap_or("").to_string();

            let db = ctx.db.clone();
            tokio::task::spawn_blocking(move || {
                let conn = db.lock();
                let _ = crate::db::settings::save_setting(&conn, "teableUrl", &url);
                let _ = crate::db::settings::save_setting(&conn, "teableToken", &token);
                let _ = crate::db::settings::save_setting(&conn, "teableUserName", &name);
                let _ = crate::db::settings::save_setting(&conn, "teableUserEmail", &email);
                let _ = crate::db::settings::save_setting(&conn, "teableUserAvatar", &avatar);
            })
            .await
            .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }

        "removeTeableConfig" => {
            let db = ctx.db.clone();
            tokio::task::spawn_blocking(move || {
                let conn = db.lock();
                let _ = crate::db::settings::save_setting(&conn, "teableUrl", "");
                let _ = crate::db::settings::save_setting(&conn, "teableToken", "");
                let _ = crate::db::settings::save_setting(&conn, "teableUserName", "");
                let _ = crate::db::settings::save_setting(&conn, "teableUserEmail", "");
                let _ = crate::db::settings::save_setting(&conn, "teableUserAvatar", "");
                let _ = crate::db::settings::save_setting(&conn, "teableSpaceId", "");
                let _ = crate::db::settings::save_setting(&conn, "teableBaseId", "");
                let _ = crate::db::settings::save_setting(&conn, "teableTableId", "");
                let _ = crate::db::settings::save_setting(&conn, "teableSyncEnabled", "false");
            })
            .await
            .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }

        "saveTeableTarget" => {
            let space_id = params["spaceId"].as_str().unwrap_or("").to_string();
            let base_id = params["baseId"].as_str().unwrap_or("").to_string();
            let table_id = params["tableId"].as_str().unwrap_or("").to_string();

            let db = ctx.db.clone();
            tokio::task::spawn_blocking(move || {
                let conn = db.lock();
                let _ = crate::db::settings::save_setting(&conn, "teableSpaceId", &space_id);
                let _ = crate::db::settings::save_setting(&conn, "teableBaseId", &base_id);
                let _ = crate::db::settings::save_setting(&conn, "teableTableId", &table_id);
            })
            .await
            .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }

        "listTeableSpaces" => {
            let db = ctx.db.clone();
            let settings = tokio::task::spawn_blocking(move || {
                let conn = db.lock();
                crate::db::settings::get_settings(&conn)
            })
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;

            let spaces = ctx
                .teable
                .list_spaces(&settings.teable_url, &settings.teable_token)
                .await?;
            Ok(serde_json::to_value(spaces).unwrap())
        }

        "listTeableBases" => {
            let space_id = params["spaceId"].as_str().ok_or("Missing spaceId")?;
            let db = ctx.db.clone();
            let settings = tokio::task::spawn_blocking(move || {
                let conn = db.lock();
                crate::db::settings::get_settings(&conn)
            })
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;

            let bases = ctx
                .teable
                .list_bases(&settings.teable_url, &settings.teable_token, space_id)
                .await?;
            Ok(serde_json::to_value(bases).unwrap())
        }

        "listTeableTables" => {
            let base_id = params["baseId"].as_str().ok_or("Missing baseId")?;
            let db = ctx.db.clone();
            let settings = tokio::task::spawn_blocking(move || {
                let conn = db.lock();
                crate::db::settings::get_settings(&conn)
            })
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;

            let tables = ctx
                .teable
                .list_tables(&settings.teable_url, &settings.teable_token, base_id)
                .await?;
            Ok(serde_json::to_value(tables).unwrap())
        }

        "verifyTeableTable" => {
            let table_id = params["tableId"].as_str().ok_or("Missing tableId")?;
            let db = ctx.db.clone();
            let settings = tokio::task::spawn_blocking(move || {
                let conn = db.lock();
                crate::db::settings::get_settings(&conn)
            })
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;

            let check = ctx
                .teable
                .verify_table(&settings.teable_url, &settings.teable_token, table_id)
                .await?;
            Ok(serde_json::to_value(check).unwrap())
        }

        "ensureTeableFields" => {
            let table_id = params["tableId"].as_str().ok_or("Missing tableId")?;
            let db = ctx.db.clone();
            let settings = tokio::task::spawn_blocking(move || {
                let conn = db.lock();
                crate::db::settings::get_settings(&conn)
            })
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;

            let created = ctx
                .teable
                .ensure_fields(&settings.teable_url, &settings.teable_token, table_id)
                .await?;
            Ok(serde_json::to_value(created).unwrap())
        }

        "createTeableTable" => {
            let base_id = params["baseId"].as_str().ok_or("Missing baseId")?;
            let table_name = params["tableName"].as_str().ok_or("Missing tableName")?;
            let db = ctx.db.clone();
            let settings = tokio::task::spawn_blocking(move || {
                let conn = db.lock();
                crate::db::settings::get_settings(&conn)
            })
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;

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

        // ─── Firmware Flasher ─────────────────────────────────────────────────
        "testGithubToken" => {
            let token = params["token"].as_str().unwrap_or("");
            let (valid, login) = test_github_token(token).await?;
            Ok(json!({ "valid": valid, "login": login }))
        }

        "listFirmwareReleases" => {
            let db = ctx.db.clone();
            let settings = tokio::task::spawn_blocking(move || {
                let conn = db.lock();
                crate::db::settings::get_settings(&conn).unwrap_or_default()
            })
            .await
            .map_err(|e| e.to_string())?;

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

            let db = ctx.db.clone();
            let settings = tokio::task::spawn_blocking(move || {
                let conn = db.lock();
                crate::db::settings::get_settings(&conn).unwrap_or_default()
            })
            .await
            .map_err(|e| e.to_string())?;

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

        _ => {
            if let Some(res) = ctx.plugins.handle_rpc(method, params).await {
                res
            } else {
                Err(format!("Method '{}' not found", method))
            }
        }
    }
}

mod urlencoding {
    pub fn encode(s: &str) -> String {
        url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
    }
}
