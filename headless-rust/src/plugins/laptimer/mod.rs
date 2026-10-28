pub mod db;
pub mod engine;
pub mod models;
pub mod rpc;

use crate::models::SerialStatusPayload;
use crate::plugins::{BoxFuture, Plugin, PluginContext, RpcRegistry};
use engine::{Crossing, EngineConfig, LapEngine, Verdict};
use models::{LapCrossingRecord, LapSession, SaveLapInput};
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

// ponytail: in-memory state mirrored for getActiveLapSession; the engine task owns the laps
#[derive(Debug, Clone)]
pub struct LapTimerState {
    pub active_session: Option<LapSession>,
    pub lap_state: String, // "idle" | "waiting" | "timing"
    pub lap_number: i64,
    pub lap_timing_started_at: Option<i64>,
    pub lap_mode: String,
    pub dir_filter: String,
    pub save_images: bool,
}

impl Default for LapTimerState {
    fn default() -> Self {
        Self {
            active_session: None,
            lap_state: "idle".to_string(),
            lap_number: 0,
            lap_timing_started_at: None,
            lap_mode: "single".to_string(),
            dir_filter: "both".to_string(),
            save_images: true,
        }
    }
}

/// What the kart link knew when a crossing happened; stored with the crossing.
#[derive(Debug, Clone, Default)]
pub struct GateContext {
    /// The kart's telemetry session.
    pub kart_session_id: Option<String>,
    /// The host clock was NTP-synced, so `wall_us` lines up with kart samples.
    pub clock_synced: bool,
    pub barrier: Option<(f64, f64)>,
    /// The kart link is on: the crossing goes into the outbox.
    pub publish: bool,
}

/// The kart gate's answer for one crossing.
#[derive(Debug, Clone)]
pub struct GateResult {
    pub verdict: Verdict,
    pub distance_m: Option<f64>,
    pub context: GateContext,
}

/// Decides whether the kart was at the barrier when it was crossed. The kart link implements it;
/// without one every crossing that passes the local checks counts.
pub trait KartGate: Send + Sync {
    /// Called once per crossing that passed the local checks; may wait for kart GPS samples.
    fn judge(&self, wall_us: i64) -> BoxFuture<'static, GateResult>;
    /// The link's state now, for crossings rejected before the gate.
    fn context(&self) -> GateContext;
    /// A crossing was stored; publish it if it is in the outbox.
    fn on_recorded(&self, crossing: &LapCrossingRecord);
}

pub(crate) enum EngineCmd {
    Start { session: LapSession, cfg: EngineConfig },
    Stop,
    Crossing {
        id: String,
        crossing: Crossing,
        image: Option<JoinHandle<Option<String>>>,
    },
}

pub struct LapTimerPlugin {
    state: Arc<Mutex<LapTimerState>>,
    gate: Option<Arc<dyn KartGate>>,
    cmd_tx: mpsc::UnboundedSender<EngineCmd>,
    cmd_rx: Mutex<Option<mpsc::UnboundedReceiver<EngineCmd>>>,
}

impl LapTimerPlugin {
    pub fn new(gate: Option<Arc<dyn KartGate>>) -> Self {
        let (cmd_tx, cmd_rx) = mpsc::unbounded_channel();
        Self {
            state: Arc::new(Mutex::new(LapTimerState::default())),
            gate,
            cmd_tx,
            cmd_rx: Mutex::new(Some(cmd_rx)),
        }
    }
}

impl Plugin for LapTimerPlugin {
    fn id(&self) -> &'static str {
        "laptimer"
    }

    fn name(&self) -> &'static str {
        "Lap Timer"
    }

    fn init(&mut self, ctx: &PluginContext) -> Result<(), Box<dyn std::error::Error>> {
        let conn = ctx.db.lock();
        db::init_tables(&conn)?;

        // Close any dangling sessions from previous runs
        if let Ok(Some(s)) = db::get_active_session(&conn) {
            let _ = db::close_lap_session(&conn, s.id);
            tracing::info!("[plugin:laptimer] Closed leftover unclosed session #{}", s.id);
        }

        // Load configured defaults into memory
        let settings = crate::db::settings::get_settings(&conn).unwrap_or_default();
        let mut state = self.state.lock().unwrap();
        state.lap_mode = if settings.lap_mode == "multi" { "multi".to_string() } else { "single".to_string() };
        state.dir_filter = if settings.lap_dir_filter == "forward" || settings.lap_dir_filter == "reverse" {
            settings.lap_dir_filter
        } else {
            "both".to_string()
        };
        state.save_images = settings.lap_save_images != "false";
        drop(state);

        if let Some(rx) = self.cmd_rx.lock().unwrap().take() {
            tokio::spawn(run_engine(rx, ctx.clone(), self.state.clone(), self.gate.clone()));
        }

        tracing::info!("[plugin:laptimer] Initialized database tables and state");
        Ok(())
    }

    fn register_rpc(&self, registry: &mut RpcRegistry) {
        rpc::register_rpc_methods(registry, self.state.clone(), self.cmd_tx.clone());
        tracing::info!("[plugin:laptimer] Registered RPC methods");
    }

    fn mode_id(&self) -> Option<&'static str> {
        Some("laptimer")
    }

    fn is_available(&self, ctx: &PluginContext) -> Result<(), String> {
        if !ctx.config.mock_mode && !ctx.serial.get_status().connected {
            return Err("Serial radar connection required for lap timer".to_string());
        }
        if !ctx.serial.supports_lap_crossing() {
            return Err("Firmware update required: this ESP firmware does not report lap crossings".to_string());
        }
        Ok(())
    }

    fn on_leave_mode(&self, ctx: &PluginContext, _force: bool) -> Result<(), String> {
        let active_id = {
            let mut s = self.state.lock().unwrap();
            let id = s.active_session.as_ref().map(|sess| sess.id);
            s.active_session = None;
            s.lap_state = "idle".to_string();
            s.lap_timing_started_at = None;
            id
        };
        let _ = self.cmd_tx.send(EngineCmd::Stop);

        if let Some(id) = active_id {
            let conn = ctx.db.lock();
            let _ = db::close_lap_session(&conn, id);
            tracing::info!("[plugin:laptimer] Closed active session #{} on mode leave", id);
        }

        ctx.serial.send_command(r#"{"command":"stopLapSession"}"#);
        Ok(())
    }

    // ponytail: photo starts right here on the serial pipeline; the engine decides later whether it counts
    fn on_serial_event(&self, msg: &SerialStatusPayload, ctx: &PluginContext) {
        let SerialStatusPayload::LapCrossing {
            boundary_us,
            wall_us,
            esp_boot,
            speed,
            direction,
            ..
        } = msg
        else {
            return;
        };

        let save_images = {
            let s = self.state.lock().unwrap();
            if s.active_session.is_none() {
                return;
            }
            s.save_images
        };

        let image = save_images.then(|| {
            let cam = ctx.camera.clone();
            let store = ctx.store.clone();
            tokio::task::spawn_blocking(move || capture_photo(&cam, &store))
        });

        let _ = self.cmd_tx.send(EngineCmd::Crossing {
            id: uuid::Uuid::now_v7().to_string(),
            crossing: Crossing {
                boundary_us: *boundary_us,
                wall_us: *wall_us,
                esp_boot: *esp_boot,
                speed: *speed,
                direction: direction.clone(),
            },
            image,
        });
    }
}

fn capture_photo(cam: &crate::camera::CameraService, store: &crate::storage::FileStore) -> Option<String> {
    let jpg_bytes = cam.capture_frame_jpeg(90)?;
    let img_path = store.save_image_bytes(&jpg_bytes, "jpg").ok()?;

    // ponytail: pre-cache thumbnails in background across multicore pool
    let store_pre = store.clone();
    let pre_path = img_path.clone();
    rayon::spawn(move || {
        let p_grid = crate::storage::compress::CompressParams {
            width: Some(400),
            quality: Some(80),
            ..Default::default()
        };
        let p_row = crate::storage::compress::CompressParams {
            width: Some(160),
            quality: Some(75),
            ..Default::default()
        };
        let _ = store_pre.compressor.process_image(&jpg_bytes, &pre_path, &p_grid);
        let _ = store_pre.compressor.process_image(&jpg_bytes, &pre_path, &p_row);
    });
    Some(img_path)
}

struct ActiveRun {
    session_id: i64,
    engine: LapEngine,
    /// Photo of the crossing that opened the running lap.
    open_image: Option<String>,
}

/// Processes crossings strictly in order: a verdict can take seconds (the gate waits for kart GPS),
/// and lap chaining depends on the order.
async fn run_engine(
    mut rx: mpsc::UnboundedReceiver<EngineCmd>,
    ctx: PluginContext,
    state: Arc<Mutex<LapTimerState>>,
    gate: Option<Arc<dyn KartGate>>,
) {
    let mut run: Option<ActiveRun> = None;

    while let Some(cmd) = rx.recv().await {
        match cmd {
            EngineCmd::Start { session, cfg } => {
                run = Some(ActiveRun {
                    session_id: session.id,
                    engine: LapEngine::new(cfg),
                    open_image: None,
                });
            }
            EngineCmd::Stop => run = None,
            EngineCmd::Crossing { id, crossing, image } => {
                let Some(active) = run.as_mut() else {
                    continue;
                };

                let result = match active.engine.precheck(&crossing) {
                    Some(verdict) => GateResult {
                        verdict,
                        distance_m: None,
                        context: gate.as_ref().map(|g| g.context()).unwrap_or_default(),
                    },
                    None => match &gate {
                        Some(g) => g.judge(crossing.wall_us).await,
                        None => GateResult {
                            verdict: Verdict::Accepted,
                            distance_m: None,
                            context: GateContext::default(),
                        },
                    },
                };
                let ctx_at = result.context;

                let outcome = active
                    .engine
                    .apply(&crossing, result.verdict, ctx_at.kart_session_id.as_deref());

                let image_path = match image {
                    Some(handle) => handle.await.ok().flatten(),
                    None => None,
                };

                let record = LapCrossingRecord {
                    id,
                    session_id: active.session_id,
                    wall_us: crossing.wall_us,
                    boundary_us: crossing.boundary_us,
                    esp_boot: crossing.esp_boot,
                    speed: crossing.speed,
                    direction: crossing.direction.clone(),
                    verdict: outcome.verdict,
                    distance_m: result.distance_m,
                    kart_session_id: ctx_at.kart_session_id,
                    lap_number: outcome.started.unwrap_or(0),
                    lap_us: outcome.completed.as_ref().map(|l| l.duration_us),
                    image_path: image_path.clone(),
                    clock_synced: ctx_at.clock_synced,
                    barrier_lat: ctx_at.barrier.map(|b| b.0),
                    barrier_lon: ctx_at.barrier.map(|b| b.1),
                    published_at: (!ctx_at.publish).then_some(db::NOT_PUBLISHED),
                };

                let start_image = if outcome.completed.is_some() || outcome.started.is_some() {
                    std::mem::replace(
                        &mut active.open_image,
                        outcome.started.and(image_path.clone()),
                    )
                } else {
                    None
                };

                if let Err(e) = persist(&ctx, &record, outcome.completed.as_ref(), start_image, image_path).await {
                    tracing::error!("[plugin:laptimer] Failed to store crossing {}: {}", record.id, e);
                }

                tracing::info!(
                    "[plugin:laptimer] Crossing {} at {:.1} km/h: {}{}",
                    record.id,
                    record.speed,
                    record.verdict.as_str(),
                    record.lap_us.map(|us| format!(", lap {:.3} s", us as f64 / 1e6)).unwrap_or_default()
                );

                publish_outcome(&ctx, &state, &record, &outcome);

                if let Some(g) = &gate {
                    g.on_recorded(&record);
                }
            }
        }
    }
}

async fn persist(
    ctx: &PluginContext,
    record: &LapCrossingRecord,
    completed: Option<&engine::CompletedLap>,
    start_image: Option<String>,
    end_image: Option<String>,
) -> Result<(), String> {
    let db = ctx.db.clone();
    let record = record.clone();
    let lap = completed.map(|l| SaveLapInput {
        session_id: record.session_id,
        lap_number: l.number,
        start_timestamp: l.start_wall_us / 1000,
        end_timestamp: record.wall_us / 1000,
        duration_ms: l.duration_us as f64 / 1000.0,
        duration_us: Some(l.duration_us as i64),
        speed_at_start: l.speed_at_start,
        speed_at_end: record.speed,
        start_image_base64: None,
        end_image_base64: None,
    });
    tokio::task::spawn_blocking(move || {
        let conn = db.lock();
        db::insert_crossing(&conn, &record)?;
        if let Some(lap) = lap {
            db::insert_lap(&conn, &lap, start_image.as_deref(), end_image.as_deref())?;
        }
        Ok::<_, rusqlite::Error>(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

/// Updates the mirrored state and tells the UI and display, in the same LAPSTART/LAPEND shapes
/// the ESP used to send.
fn publish_outcome(
    ctx: &PluginContext,
    state: &Arc<Mutex<LapTimerState>>,
    record: &LapCrossingRecord,
    outcome: &engine::Outcome,
) {
    let timestamp = record.wall_us / 1000;
    {
        let mut s = state.lock().unwrap();
        if let Some(n) = outcome.started {
            s.lap_state = "timing".to_string();
            s.lap_number = n;
            s.lap_timing_started_at = Some(timestamp);
        } else if outcome.completed.is_some() {
            s.lap_state = "waiting".to_string();
            s.lap_timing_started_at = None;
        }
    }

    ctx.serial.emit(SerialStatusPayload::LapVerdict {
        crossing_id: record.id.clone(),
        verdict: record.verdict,
        distance_m: record.distance_m,
        lap_number: record.lap_number,
        speed: record.speed,
        timestamp,
    });
    if let Some(lap) = &outcome.completed {
        ctx.serial.emit(SerialStatusPayload::LapEnd {
            lap_number: lap.number,
            duration_ms: lap.duration_us as f64 / 1000.0,
            duration_us: Some(lap.duration_us),
            speed_at_start: lap.speed_at_start,
            speed_at_end: record.speed,
            timestamp,
        });
    }
    if let Some(n) = outcome.started {
        ctx.serial.emit(SerialStatusPayload::LapStart {
            lap_number: n,
            speed_at_start: record.speed,
            timestamp,
        });
    }
}
