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

    let store = ctx.store.clone();
    let cache_id = path.clone();
    let file_path = path.clone();

    // Offload disk read + multicore SIMD resize and compression to blocking thread pool
    let res = tokio::task::spawn_blocking(move || -> Result<(Vec<u8>, &'static str), StatusCode> {
        let bytes = store.read_image(&file_path).ok_or(StatusCode::NOT_FOUND)?;
        store
            .compressor
            .process_image(&bytes, &cache_id, &params)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let (compressed_bytes, content_type) = res?;

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

    let store = ctx.store.clone();
    let db = ctx.db.clone();
    let cache_id = format!("skin_v{}", id);

    // Offload DB lookup, disk read, skin rendering, and compression to blocking thread pool
    let res = tokio::task::spawn_blocking(move || -> Result<(Vec<u8>, &'static str), StatusCode> {
        let (violation, measuring_location, image_bytes) = {
            let conn = db.lock();
            let violation = crate::db::violations::get_violation_by_id(&conn, id)
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
                .ok_or(StatusCode::NOT_FOUND)?;

            let settings = crate::db::settings::get_settings(&conn)
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            let image_bytes = store.read_image(&violation.image_path).ok_or(StatusCode::NOT_FOUND)?;
            (violation, settings.skin_measuring_location, image_bytes)
        };

        let rendered = render_poliscan_skin(
            &image_bytes,
            &violation,
            &measuring_location,
        )
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;

        store
            .compressor
            .process_image(&rendered, &cache_id, &params)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let (compressed_bytes, content_type) = res?;

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ETAG, etag)
        .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
        .body(Body::from(compressed_bytes))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

// ─── Fake Internet / Captive Portal Connectivity Probes ────────────────────────
// Pacify Windows, Fedora, Debian, Arch, Android, and macOS network managers
// so client laptops don't background-scan or drop connection thinking there's no internet.
pub async fn ncsi_handler() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/plain")],
        "Microsoft NCSI",
    )
}

pub async fn connecttest_handler() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/plain")],
        "Microsoft Connect Test",
    )
}

pub async fn hotspot_txt_handler() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/plain")],
        "OK\n",
    )
}

pub async fn ping_txt_handler() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/plain")],
        "OK\n",
    )
}

pub async fn generate_204_handler() -> impl IntoResponse {
    StatusCode::NO_CONTENT
}

pub async fn apple_hotspot_handler() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        "<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>",
    )
}

pub async fn static_handler(headers: HeaderMap, uri: Uri) -> impl IntoResponse {
    let path = uri.path();
    if let Some(host) = headers.get(header::HOST).and_then(|h| h.to_str().ok()) {
        if host.contains("ping.archlinux.org") {
            return Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "text/plain")
                .body(Body::from("OK\n"))
                .unwrap();
        }
    }
    serve_embedded_asset(path)
}
