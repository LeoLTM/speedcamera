pub mod embedded;
pub mod routes;
pub mod rpc;
pub mod socketio;

use crate::camera::CameraService;
use crate::config::AppConfig;
use crate::db::Database;
use crate::integrations::teable::TeableClient;
use crate::models::{FlashProgressPayload, Violation};
use crate::serial::SerialService;
use crate::storage::FileStore;
use crate::web::rpc::RpcContext;
use axum::routing::get;
use axum::Router;
use socketioxide::extract::SocketRef;
use socketioxide::SocketIo;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast;
use tower_http::cors::{Any, CorsLayer};

pub fn build_app(
    config: AppConfig,
    db: Database,
    store: FileStore,
    camera: Arc<CameraService>,
    serial: Arc<SerialService>,
    violation_tx: broadcast::Sender<Violation>,
    armed: Arc<AtomicBool>,
    armed_tx: broadcast::Sender<bool>,
    plugins: Arc<crate::plugins::PluginRegistry>,
    state_machine: Arc<crate::state_machine::SystemStateMachine>,
    network: Arc<crate::network::NetworkSupervisor>,
) -> Router {
    let (flash_tx, _) = broadcast::channel::<FlashProgressPayload>(32);

    let ctx = Arc::new(RpcContext {
        config,
        db,
        store,
        camera,
        serial,
        teable: TeableClient::new(),
        flash_tx,
        violation_tx,
        armed,
        armed_tx,
        plugins: plugins.clone(),
        state_machine,
        network,
    });


    // 10 MB payload capacity, 5s keepalive ping interval to keep Wi-Fi sleep-disabled,
    // widened 20s ping timeout to tolerate Wi-Fi jitter, and large 4096 buffer size for live stream bursts.
    let (layer, io) = SocketIo::builder()
        .max_payload(10_000_000)
        .max_buffer_size(4096)
        .ping_interval(Duration::from_secs(5))
        .ping_timeout(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(10))
        .upgrade_timeout(Duration::from_secs(10))
        .ack_timeout(Duration::from_secs(20))
        .build_layer();

    let ctx_connect = ctx.clone();
    io.ns("/", move |s: SocketRef| {
        let ctx = ctx_connect.clone();
        async move {
            socketio::on_connect(s, ctx).await;
        }
    });
    socketio::spawn_event_broadcaster(io, ctx.clone());

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let mut router = Router::new()
        .route("/api/health", get(routes::health))
        .route("/api/network", get(routes::network))
        .route("/image", get(routes::get_image))
        .route("/skinned-image", get(routes::get_skinned_image))
        // Windows NCSI & Connect Test
        .route("/ncsi.txt", get(routes::ncsi_handler))
        .route("/connecttest.txt", get(routes::connecttest_handler))
        // Fedora / Linux / NetworkManager probes
        .route("/static/hotspot.txt", get(routes::hotspot_txt_handler))
        .route("/hotspot.txt", get(routes::hotspot_txt_handler))
        .route("/ping.txt", get(routes::ping_txt_handler))
        .route("/check_network_status.txt", get(routes::hotspot_txt_handler))
        .route("/nm", get(routes::hotspot_txt_handler))
        // Android / Chromium / Google probe
        .route("/generate_204", get(routes::generate_204_handler))
        .route("/gen_204", get(routes::generate_204_handler))
        // Apple / macOS captive portal probe
        .route("/hotspot-detect.html", get(routes::apple_hotspot_handler));

    router = plugins.register_routes(router);

    router
        .fallback(routes::static_handler)
        .layer(layer)
        .layer(cors)
        .with_state(ctx)
}
