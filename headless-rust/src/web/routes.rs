use crate::network::get_system_network_summary;
use crate::storage::compress::CompressParams;
use crate::storage::skin::render_poliscan_skin;
use crate::web::embedded::serve_embedded_asset;
use crate::web::rpc::RpcContext;
use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::{header, HeaderMap, Response, StatusCode, Uri};
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

// ponytail: unified query params for dynamic resizing and compression
#[derive(Deserialize, Debug, Clone)]
pub struct ImageQuery {
    pub path: Option<String>,
    pub w: Option<u32>,
    pub width: Option<u32>,
    pub h: Option<u32>,
    pub height: Option<u32>,
    pub q: Option<u8>,
    pub quality: Option<u8>,
    pub fmt: Option<String>,
    pub format: Option<String>,
}

impl ImageQuery {
    fn to_params(&self) -> CompressParams {
        CompressParams {
            width: self.w.or(self.width),
            height: self.h.or(self.height),
            quality: self.q.or(self.quality),
            format: self.fmt.clone().or_else(|| self.format.clone()),
        }
    }
}

pub async fn get_image(
    headers: HeaderMap,
    Query(query): Query<ImageQuery>,
    State(ctx): State<Arc<RpcContext>>,
) -> Result<Response<Body>, StatusCode> {
    let path = query.path.clone().ok_or(StatusCode::BAD_REQUEST)?;
    let params = query.to_params();

    // Generate lightweight ETag
    let etag = format!(
        "\"img-{}-w{}-h{}-q{}\"",
        path.replace('/', "_"),
        params.width.unwrap_or(0),
        params.height.unwrap_or(0),
        params.quality.unwrap_or(0)
    );

    // 304 Not Modified check to save Wi-Fi network bandwidth
    if let Some(if_none_match) = headers.get(header::IF_NONE_MATCH) {
        if if_none_match.as_bytes() == etag.as_bytes() {
            return Response::builder()
                .status(StatusCode::NOT_MODIFIED)
                .body(Body::empty())
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR);
        }
    }

    let bytes = ctx.store.read_image(&path).ok_or(StatusCode::NOT_FOUND)?;
    let store = ctx.store.clone();
    let cache_id = path.clone();

    // Offload multicore SIMD resize and compression to blocking thread pool
    let (compressed_bytes, content_type) = tokio::task::spawn_blocking(move || {
        store.compressor.process_image(&bytes, &cache_id, &params)
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ETAG, etag)
        .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
        .body(Body::from(compressed_bytes))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

#[derive(Deserialize, Debug, Clone)]
pub struct SkinnedImageQuery {
    #[serde(rename = "violationId")]
    pub violation_id: Option<i64>,
    pub w: Option<u32>,
    pub width: Option<u32>,
    pub h: Option<u32>,
    pub height: Option<u32>,
    pub q: Option<u8>,
    pub quality: Option<u8>,
    pub fmt: Option<String>,
    pub format: Option<String>,
}

impl SkinnedImageQuery {
    fn to_params(&self) -> CompressParams {
        CompressParams {
            width: self.w.or(self.width),
            height: self.h.or(self.height),
            quality: self.q.or(self.quality),
            format: self.fmt.clone().or_else(|| self.format.clone()),
        }
    }
}

pub async fn get_skinned_image(
    headers: HeaderMap,
    Query(query): Query<SkinnedImageQuery>,
    State(ctx): State<Arc<RpcContext>>,
) -> Result<Response<Body>, StatusCode> {
    let id = query.violation_id.ok_or(StatusCode::BAD_REQUEST)?;
    let params = query.to_params();

    let etag = format!(
        "\"skin-{}-w{}-h{}-q{}\"",
        id,
        params.width.unwrap_or(0),
        params.height.unwrap_or(0),
        params.quality.unwrap_or(0)
    );

    if let Some(if_none_match) = headers.get(header::IF_NONE_MATCH) {
        if if_none_match.as_bytes() == etag.as_bytes() {
            return Response::builder()
                .status(StatusCode::NOT_MODIFIED)
                .body(Body::empty())
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR);
        }
    }

    // ponytail: query db in separate scope so MutexGuard does not cross .await
    let (violation, measuring_location, image_bytes) = {
        let conn = ctx.db.lock();
        let violation = crate::db::violations::get_violation_by_id(&conn, id)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .ok_or(StatusCode::NOT_FOUND)?;

        let settings = crate::db::settings::get_settings(&conn)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let image_bytes = ctx.store.read_image(&violation.image_path).ok_or(StatusCode::NOT_FOUND)?;
        (violation, settings.skin_measuring_location, image_bytes)
    };

    let store = ctx.store.clone();
    let cache_id = format!("skin_v{}", id);

    let (compressed_bytes, content_type) = tokio::task::spawn_blocking(move || {
        let rendered = render_poliscan_skin(
            &image_bytes,
            &violation,
            &measuring_location,
        )
        .ok_or_else(|| "Failed to render skin".to_string())?;

        store.compressor.process_image(&rendered, &cache_id, &params)
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ETAG, etag)
        .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
        .body(Body::from(compressed_bytes))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

pub async fn static_handler(uri: Uri) -> impl IntoResponse {
    let path = uri.path();
    serve_embedded_asset(path)
}
