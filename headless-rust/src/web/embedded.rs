use rocket::http::ContentType;
use rocket::response::{self, Responder, Response};
use rocket::Request;
use rust_embed::RustEmbed;
use std::io::Cursor;

#[derive(RustEmbed)]
#[folder = "dist/"]
pub struct Asset;

pub struct EmbeddedFile {
    pub data: Vec<u8>,
    pub content_type: ContentType,
}

impl<'r> Responder<'r, 'static> for EmbeddedFile {
    fn respond_to(self, _: &'r Request<'_>) -> response::Result<'static> {
        Response::build()
            .header(self.content_type)
            .sized_body(self.data.len(), Cursor::new(self.data))
            .ok()
    }
}

pub fn get_asset(path: &str) -> Option<EmbeddedFile> {
    let clean_path = path.trim_start_matches('/');
    let target = if clean_path.is_empty() {
        "index.html"
    } else {
        clean_path
    };

    if let Some(file) = Asset::get(target) {
        let ext = std::path::Path::new(target)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        let content_type = ContentType::from_extension(ext).unwrap_or(ContentType::HTML);
        Some(EmbeddedFile {
            data: file.data.into_owned(),
            content_type,
        })
    } else if let Some(index) = Asset::get("index.html") {
        // SPA Fallback: Return index.html for client-side routing
        Some(EmbeddedFile {
            data: index.data.into_owned(),
            content_type: ContentType::HTML,
        })
    } else {
        None
    }
}
