pub mod embedded;
pub mod routes;
pub mod rpc;
pub mod ws;

use crate::camera::CameraService;
use crate::config::AppConfig;
use crate::db::Database;
use crate::models::{FlashProgressPayload, Violation};
use crate::serial::SerialService;
use crate::storage::FileStore;
use rocket::fairing::{Fairing, Info, Kind};
use rocket::http::Header;
use rocket::{Build, Request, Response, Rocket};
use std::sync::Arc;
use tokio::sync::broadcast;

pub struct Cors;

#[rocket::async_trait]
impl Fairing for Cors {
    fn info(&self) -> Info {
        Info {
            name: "Add CORS Headers",
            kind: Kind::Response,
        }
    }

    async fn on_response<'r>(&self, _request: &'r Request<'_>, response: &mut Response<'r>) {
        response.set_header(Header::new("Access-Control-Allow-Origin", "*"));
        response.set_header(Header::new(
            "Access-Control-Allow-Methods",
            "GET, POST, PUT, DELETE, OPTIONS, HEAD",
        ));
        response.set_header(Header::new("Access-Control-Allow-Headers", "*"));
        response.set_header(Header::new("Access-Control-Allow-Credentials", "true"));
    }
}

pub fn build_rocket(
    config: AppConfig,
    db: Database,
    store: FileStore,
    camera: Arc<CameraService>,
    serial: Arc<SerialService>,
    violation_tx: broadcast::Sender<Violation>,
) -> Rocket<Build> {
    let (flash_tx, _) = broadcast::channel::<FlashProgressPayload>(32);

    let figment = rocket::Config::figment()
        .merge(("address", config.host.as_str()))
        .merge(("port", config.port));

    rocket::custom(figment)
        .attach(Cors)
        .manage(config)
        .manage(db)
        .manage(store)
        .manage(camera)
        .manage(serial)
        .manage(flash_tx)
        .manage(violation_tx)
        .mount(
            "/",
            rocket::routes![
                routes::health,
                routes::network,
                routes::get_image,
                routes::get_skinned_image,
                ws::ws_rpc,
                ws::ws_alias,
                routes::index,
                routes::static_assets,
            ],
        )
}
