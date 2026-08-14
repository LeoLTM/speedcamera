pub mod embedded;
pub mod routes;
pub mod rpc;
pub mod ws;

use crate::camera::CameraService;
use crate::config::AppConfig;
use crate::db::Database;
use crate::models::FlashProgressPayload;
use crate::serial::SerialService;
use crate::storage::FileStore;
use rocket::figment::Figment;
use rocket::{Build, Rocket};
use std::net::Ipv4Addr;
use std::sync::Arc;
use tokio::sync::broadcast;

pub fn build_rocket(
    config: AppConfig,
    db: Database,
    store: FileStore,
    camera: Arc<CameraService>,
    serial: Arc<SerialService>,
) -> Rocket<Build> {
    let (flash_tx, _) = broadcast::channel::<FlashProgressPayload>(32);

    let figment = Figment::from(rocket::Config::default())
        .merge(("port", config.port))
        .merge(("address", config.host.parse::<Ipv4Addr>().unwrap_or(Ipv4Addr::new(0, 0, 0, 0))));

    rocket::custom(figment)
        .manage(config)
        .manage(db)
        .manage(store)
        .manage(camera)
        .manage(serial)
        .manage(flash_tx)
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
