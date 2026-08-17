use crate::network::get_system_network_summary;
use crate::storage::skin::render_poliscan_skin;
use crate::web::embedded::serve_embedded_asset;
use crate::web::rpc::RpcContext;
use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::{header, Response, StatusCode, Uri};
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use std::sync::atomic::Ordering;
use std::sync::Arc;

pub async fn health(State(ctx): State<Arc<RpcContext>>) -> impl IntoResponse {
    Json(json!({
        "status": "ok",
        "platform": std::env::consts::OS,
        "camera": ctx.camera.get_status(),
        "network": get_system_network_summary(),
        "mockMode": ctx.config.mock_mode,
        "armed": ctx.armed.load(Ordering::SeqCst),
    }))
}

pub async fn network() -> impl IntoResponse {
    Json(get_system_network_summary())
}

#[derive(Deserialize)]
pub struct ImageQuery {
    pub path: Option<String>,
}

pub async fn get_image(
    State(ctx): State<Arc<RpcContext>>,
    Query(query): Query<ImageQuery>,
) -> Result<Response<Body>, StatusCode> {
    let path = query.path.ok_or(StatusCode::BAD_REQUEST)?;
    let bytes = ctx.store.read_image(&path).ok_or(StatusCode::NOT_FOUND)?;
    let content_type = if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else {
        "image/png"
    };

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .body(Body::from(bytes))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

#[derive(Deserialize)]
pub struct SkinnedImageQuery {
    #[serde(rename = "violationId")]
    pub violation_id: Option<i64>,
}

pub async fn get_skinned_image(
    State(ctx): State<Arc<RpcContext>>,
    Query(query): Query<SkinnedImageQuery>,
) -> Result<Response<Body>, StatusCode> {
    let id = query.violation_id.ok_or(StatusCode::BAD_REQUEST)?;
    let conn = ctx.db.lock();

    let violation = crate::db::violations::get_violation_by_id(&conn, id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    let settings = crate::db::settings::get_settings(&conn)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let image_bytes = ctx.store.read_image(&violation.image_path).ok_or(StatusCode::NOT_FOUND)?;

    let rendered = render_poliscan_skin(
        &image_bytes,
        &violation,
        &settings.skin_measuring_location,
    )
    .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;

    let content_type = if rendered.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else {
        "image/png"
    };

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .body(Body::from(rendered))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

pub async fn static_handler(uri: Uri) -> impl IntoResponse {
    let path = uri.path();
    serve_embedded_asset(path)
}
