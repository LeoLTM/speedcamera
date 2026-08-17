use axum::body::Body;
use axum::http::{header, Response, StatusCode};
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "dist/"]
pub struct Asset;

pub fn serve_embedded_asset(path: &str) -> Response<Body> {
    let clean_path = path.trim_start_matches('/');
    let target = if clean_path.is_empty() {
        "index.html"
    } else {
        clean_path
    };

    if let Some(file) = Asset::get(target) {
        let mime = mime_guess::from_path(target).first_or_octet_stream();
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime.as_ref())
            .body(Body::from(file.data.into_owned()))
            .unwrap()
    } else if !target.contains('.') {
        // SPA Fallback: Return index.html for client-side navigation routes
        if let Some(index) = Asset::get("index.html") {
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
                .body(Body::from(index.data.into_owned()))
                .unwrap()
        } else {
            Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(Body::from("404 Not Found"))
                .unwrap()
        }
    } else {
        Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("404 Not Found"))
            .unwrap()
    }
}
