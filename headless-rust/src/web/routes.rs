use crate::camera::CameraService;
use crate::config::AppConfig;
use crate::db::Database;
use crate::network::get_system_network_summary;
use crate::storage::skin::render_poliscan_skin;
use crate::storage::FileStore;
use crate::web::embedded::{get_asset, EmbeddedFile};
use rocket::http::{ContentType, Status};
use rocket::serde::json::Json;
use rocket::State;
use serde_json::json;
use std::sync::Arc;

#[rocket::get("/api/health")]
pub fn health(
    config: &State<AppConfig>,
    camera: &State<Arc<CameraService>>,
) -> Json<serde_json::Value> {
    Json(json!({
        "status": "ok",
        "platform": std::env::consts::OS,
        "camera": camera.get_status(),
        "network": get_system_network_summary(),
        "mockMode": config.mock_mode,
    }))
}

#[rocket::get("/api/network")]
pub fn network() -> Json<crate::models::SystemNetworkSummary> {
    Json(get_system_network_summary())
}

#[rocket::get("/image?<path>")]
pub fn get_image(
    path: Option<String>,
    store: &State<FileStore>,
) -> Result<(ContentType, Vec<u8>), Status> {
    let p = path.ok_or(Status::BadRequest)?;
    let bytes = store.read_image(&p).ok_or(Status::NotFound)?;
    let content_type = if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        ContentType::JPEG
    } else {
        ContentType::PNG
    };
    Ok((content_type, bytes))
}

#[rocket::get("/skinned-image?<violationId>")]
pub fn get_skinned_image(
    #[allow(non_snake_case)] violationId: Option<i64>,
    db: &State<Database>,
    store: &State<FileStore>,
) -> Result<(ContentType, Vec<u8>), Status> {
    let id = violationId.ok_or(Status::BadRequest)?;
    let conn = db.lock();

    let violation = crate::db::violations::get_violation_by_id(&conn, id)
        .map_err(|_| Status::InternalServerError)?
        .ok_or(Status::NotFound)?;

    let settings = crate::db::settings::get_settings(&conn).map_err(|_| Status::InternalServerError)?;
    let image_bytes = store.read_image(&violation.image_path).ok_or(Status::NotFound)?;

    let rendered = render_poliscan_skin(
        &image_bytes,
        &violation,
        &settings.skin_measuring_location,
    )
    .ok_or(Status::InternalServerError)?;

    let content_type = if rendered.starts_with(&[0xFF, 0xD8, 0xFF]) {
        ContentType::JPEG
    } else {
        ContentType::PNG
    };

    Ok((content_type, rendered))
}


#[rocket::get("/<file..>", rank = 20)]
pub fn static_assets(file: std::path::PathBuf) -> Result<EmbeddedFile, Status> {
    let path_str = file.to_string_lossy().to_string();
    get_asset(&path_str).ok_or(Status::NotFound)
}

#[rocket::get("/", rank = 10)]
pub fn index() -> Result<EmbeddedFile, Status> {
    get_asset("index.html").ok_or(Status::NotFound)
}
