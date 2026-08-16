mod camera;
mod config;
mod db;
mod integrations;
mod models;
mod network;
mod serial;
mod storage;
mod web;

use camera::CameraService;
use clap::Parser;
use config::AppConfig;
use db::Database;
use models::SaveViolationInput;
use serial::SerialService;
use storage::FileStore;

#[derive(Parser, Debug)]
#[command(name = "speedcamera-rust")]
#[command(about = "High-performance headless Speedcamera daemon for Raspberry Pi 5", long_about = None)]
struct Args {
    #[arg(short, long, help = "Run in mock hardware mode (no physical camera/serial required)")]
    mock: bool,

    #[arg(short, long, help = "HTTP server port (default: 3000)")]
    port: Option<u16>,

    #[arg(short = 'H', long, help = "HTTP server bind address (default: 0.0.0.0)")]
    host: Option<String>,
}

#[rocket::main]
async fn main() -> Result<(), rocket::Error> {
    // Non-blocking logging: tracing-appender writes on dedicated thread.
    // Prevents journald/SSH backpressure from stalling tokio workers.
    let (nb_writer, _guard) = tracing_appender::non_blocking(std::io::stdout());
    tracing_subscriber::fmt()
        .with_writer(nb_writer)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_target(false)
        .init();

    let args = Args::parse();
    let config = AppConfig::new(args.mock, args.port, args.host);

    tracing::info!("─────────────────────────────────────────────────────────────────");
    tracing::info!("  ⚡ Speedcamera Headless Daemon (Rust & Rocket)");
    tracing::info!("  • Port:       http://{}:{}", config.host, config.port);
    tracing::info!("  • Data Dir:   {}", config.data_dir.display());
    tracing::info!("  • Mock Mode:  {}", config.mock_mode);
    tracing::info!("─────────────────────────────────────────────────────────────────");

    let network_summary = network::get_system_network_summary();
    tracing::info!("  • Camera LAN [{}]: {} -> [{}]",
        network_summary.camera_lan.interface_name.as_deref().unwrap_or("eth0"),
        network_summary.camera_lan.ip.as_deref().unwrap_or("Not configured"),
        network_summary.camera_lan.status.to_uppercase()
    );
    tracing::info!("  • Hotspot AP [{}]: {} -> [{}]",
        network_summary.hotspot_ap.interface_name.as_deref().unwrap_or("wlan0"),
        network_summary.hotspot_ap.ip.as_deref().unwrap_or("Not configured"),
        network_summary.hotspot_ap.status.to_uppercase()
    );
    tracing::info!("─────────────────────────────────────────────────────────────────");

    // Initialize Database
    let db = Database::new(&config.db_path).expect("Failed to initialize SQLite database");

    // Initialize FileStore
    let store = FileStore::new(&config.images_dir);

    // Initialize Camera Service
    let camera = CameraService::new(config.mock_mode);

    // Initialize Serial Service
    let serial = SerialService::new(config.mock_mode);

    // Auto-connect configured serial port if present
    if !config.mock_mode {
        let conn = db.lock();
        if let Ok(settings) = db::settings::get_settings(&conn) {
            if !settings.selected_port.is_empty() {
                tracing::info!("[serial] Auto-connecting configured port: {}", settings.selected_port);
                serial.open_port(&settings.selected_port);
            }
        }
    }

    // ─── Armed System State ──────────────────────────────────────────────────
    let armed = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let (armed_tx, _) = tokio::sync::broadcast::channel::<bool>(32);
    let pipeline_armed = armed.clone();

    // ─── Instant Shutter Trigger Pipeline (<10ms latency) ─────────────────────
    let (violation_tx, _) = tokio::sync::broadcast::channel::<models::Violation>(32);
    let pipeline_violation_tx = violation_tx.clone();
    let pipeline_cam = camera.clone();
    let pipeline_db = db.clone();
    let pipeline_store = store.clone();
    let mut serial_rx = serial.subscribe();

    tokio::spawn(async move {
        loop {
            match serial_rx.recv().await {
                Ok(msg) => {
                    if let models::SerialStatusPayload::Speeding { value, direction, .. } = msg {
                        if !pipeline_armed.load(std::sync::atomic::Ordering::SeqCst) {
                            tracing::debug!("[trigger-pipeline] Speeding detected ({} km/h) but system is DISARMED — skipping capture", value);
                            continue;
                        }

                        tracing::info!("[trigger-pipeline] Speeding detected ({} km/h) -> Triggering camera shutter!", value);

                        let cam = pipeline_cam.clone();
                        let db_clone = pipeline_db.clone();
                        let store_clone = pipeline_store.clone();
                        let v_tx = pipeline_violation_tx.clone();

                        tokio::task::spawn_blocking(move || {
                            if let Some(jpg_bytes) = cam.capture_frame_jpeg(90) {
                                if let Ok(img_path) = store_clone.save_image_bytes(&jpg_bytes, "jpg") {
                                    let conn = db_clone.lock();
                                    let settings = db::settings::get_settings(&conn).unwrap_or_default();
                                    let input = SaveViolationInput {
                                        image_base64: None,
                                        measured_speed: value,
                                        max_speed: settings.max_speed,
                                        direction,
                                    };
                                    if let Ok(v) = db::violations::insert_violation(&conn, &input, &img_path) {
                                        tracing::info!("[trigger-pipeline] Recorded violation #{} ({} km/h)", v.id, v.measured_speed);
                                        let _ = v_tx.send(v);
                                    }
                                }
                            } else {
                                tracing::warn!("[trigger-pipeline] Failed to capture frame during speeding event");
                            }
                        });
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(missed)) => {
                    tracing::warn!("[trigger-pipeline] Serial receiver lagged by {} messages", missed);
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    tracing::info!("[trigger-pipeline] Serial channel closed, exiting pipeline task");
                    break;
                }
            }
        }
    });

    // Build and launch Rocket web server
    let server = web::build_rocket(config, db, store, camera, serial, violation_tx, armed, armed_tx);
    server.launch().await?;

    Ok(())
}
