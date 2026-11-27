//! Kart link: connects the lap timer to the asl-gokart telemetry stack.
//!
//! Over the phone hotspot it follows the kart's retained status and live GPS on the telemetry
//! broker, judges every barrier crossing against the kart's position (the laptimer's
//! [`KartGate`]), and publishes each stored crossing as `kart.timing.v1.LapCrossing` on
//! `kart/{id}/laps`. Crossings wait in the `lap_crossings` outbox until the broker acknowledged
//! them, so a hotspot dropout loses nothing.
//!
//! Through the lab's border Nginx (`wss://`) the link needs a device certificate and its own
//! broker login, both from enrollment (see [`enroll`]).

pub mod clock;
pub mod enroll;
pub mod mqtt;
pub mod tracker;

use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::Notify;

use crate::db::Database;
use crate::models::AppSettings;
use crate::plugins::laptimer::engine::Verdict;
use crate::plugins::laptimer::models::LapCrossingRecord;
use crate::plugins::laptimer::{GateContext, GateResult, KartGate};
use crate::plugins::{BoxFuture, Plugin, PluginContext, RpcRegistry};
use tracker::{Gate, Tracker};

/// Wire types vendored from asl-gokart (`proto/`).
pub mod proto {
    pub mod telemetry {
        include!(concat!(env!("OUT_DIR"), "/kart.telemetry.v1.rs"));
    }
    pub mod timing {
        include!(concat!(env!("OUT_DIR"), "/kart.timing.v1.rs"));
    }
}

/// The gate waits for kart samples this far past the crossing, so the fixes around it are in.
const WAIT_PAST_US: i64 = 500_000;
/// Longest a verdict waits for those samples (the kart's uplink may lag).
const MAX_WAIT: Duration = Duration::from_secs(3);
/// "Use kart position" needs a fix at most this old.
const MAX_FIX_AGE_US: i64 = 5_000_000;

/// The kart link settings from `AppSettings`.
#[derive(Debug, Clone, PartialEq)]
pub struct LinkSettings {
    pub enabled: bool,
    pub broker_url: String,
    pub username: String,
    pub password: String,
    pub kart_id: String,
    pub device_id: String,
    pub barrier: Option<(f64, f64)>,
    pub radius_m: f64,
    pub require_nearby: bool,
    /// Certificate and broker login from enrollment; replaces username and password.
    pub identity: Option<enroll::Identity>,
}

impl LinkSettings {
    pub fn from_app(s: &AppSettings) -> Self {
        let barrier = match (s.barrier_lat.parse::<f64>(), s.barrier_lon.parse::<f64>()) {
            (Ok(lat), Ok(lon)) => Some((lat, lon)),
            _ => None,
        };
        Self {
            enabled: s.kart_link_enabled == "true",
            broker_url: s.kart_link_broker_url.trim().to_string(),
            username: s.kart_link_username.clone(),
            password: s.kart_link_password.clone(),
            kart_id: s.kart_link_kart_id.trim().to_string(),
            device_id: s.kart_link_device_id.trim().to_string(),
            barrier,
            radius_m: s.gate_radius_m,
            require_nearby: s.require_kart_nearby != "false",
            identity: None,
        }
    }

    /// The broker user and client ID this speedcamera enrolls as.
    pub fn enroll_id(&self) -> String {
        if self.device_id.starts_with(enroll::TIMING_PREFIX) {
            self.device_id.clone()
        } else {
            format!("{}{}", enroll::TIMING_PREFIX, self.device_id)
        }
    }

    /// Everything that needs a new broker connection when it changes.
    fn same_connection(&self, other: &Self) -> bool {
        (&self.enabled, &self.broker_url, &self.username, &self.password, &self.kart_id, &self.device_id)
            == (&other.enabled, &other.broker_url, &other.username, &other.password, &other.kart_id, &other.device_id)
            && self.identity == other.identity
    }
}

#[derive(Default)]
struct LinkState {
    connected: bool,
    last_error: Option<String>,
}

/// A running enrollment request, or why the last one failed.
#[derive(Default)]
struct EnrollView {
    pending: Option<enroll::Ticket>,
    error: Option<String>,
    task: Option<tokio::task::JoinHandle<()>>,
}

struct Inner {
    settings: RwLock<Option<LinkSettings>>,
    tracker: Mutex<Tracker>,
    state: Mutex<LinkState>,
    outbox: Notify,
    identity_dir: OnceLock<PathBuf>,
    enrollment: Mutex<EnrollView>,
}

/// Shared handle; the laptimer holds one as its [`KartGate`].
#[derive(Clone)]
pub struct KartLink {
    inner: Arc<Inner>,
}

impl KartLink {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Inner {
                settings: RwLock::new(None),
                tracker: Mutex::new(Tracker::default()),
                state: Mutex::new(LinkState::default()),
                outbox: Notify::new(),
                identity_dir: OnceLock::new(),
                enrollment: Mutex::new(EnrollView::default()),
            }),
        }
    }

    pub fn settings(&self) -> LinkSettings {
        self.inner
            .settings
            .read()
            .unwrap()
            .clone()
            .unwrap_or_else(|| LinkSettings::from_app(&AppSettings::default()))
    }

    fn reload_settings(&self, db: &Database) -> LinkSettings {
        let app = crate::db::settings::get_settings(&db.lock()).unwrap_or_default();
        let mut fresh = LinkSettings::from_app(&app);
        fresh.identity = self.inner.identity_dir.get().and_then(|d| enroll::Identity::load(d));
        let mut current = self.inner.settings.write().unwrap();
        if current.as_ref().is_some_and(|c| c.kart_id != fresh.kart_id) {
            // Another kart: its status and fixes start from scratch
            *self.inner.tracker.lock().unwrap() = Tracker::default();
        }
        *current = Some(fresh.clone());
        fresh
    }

    fn with_tracker<R>(&self, f: impl FnOnce(&mut Tracker) -> R) -> R {
        f(&mut self.inner.tracker.lock().unwrap())
    }

    fn set_connected(&self, connected: bool, error: Option<String>) {
        let mut s = self.inner.state.lock().unwrap();
        s.connected = connected;
        if connected || error.is_some() {
            s.last_error = error;
        }
    }

    fn is_connected(&self) -> bool {
        self.inner.state.lock().unwrap().connected
    }

    fn kick_outbox(&self) {
        self.inner.outbox.notify_one();
    }

    async fn outbox_kicked(&self) {
        self.inner.outbox.notified().await;
    }

    fn status(&self, outbox_pending: i64) -> Value {
        let s = self.settings();
        let state = self.inner.state.lock().unwrap();
        let t = self.inner.tracker.lock().unwrap();
        let now_us = chrono::Utc::now().timestamp_micros();
        let fix = t.latest_fix();
        let distance = match (fix, s.barrier) {
            (Some(f), Some((lat, lon))) => Some(tracker::distance_m(f.lat, f.lon, lat, lon)),
            _ => None,
        };
        json!({
            "enabled": s.enabled,
            "connected": state.connected,
            "lastError": state.last_error,
            "kartId": s.kart_id,
            "kartOnline": t.online,
            "kartSessionId": t.session_id,
            "gpsFix": t.gps_fix.map(|f| f > 0.0),
            "fixAgeMs": fix.map(|f| (now_us - f.t_us) / 1000),
            "distanceToBarrierM": distance,
            "barrier": s.barrier.map(|(lat, lon)| json!({ "lat": lat, "lon": lon })),
            "clockSynced": clock::synced(),
            "kartClockOffsetMs": t.clock_offset_us.map(|o| o / 1000),
            "outboxPending": outbox_pending,
            "enrollment": self.enrollment_json(&s),
        })
    }

    fn enrollment_json(&self, s: &LinkSettings) -> Value {
        let view = self.inner.enrollment.lock().unwrap();
        let state = if view.pending.is_some() {
            "pending"
        } else if s.identity.is_some() {
            "enrolled"
        } else {
            "none"
        };
        json!({
            "state": state,
            "deviceId": s.identity.as_ref().map(|i| i.device_id.clone()),
            "notAfterS": s.identity.as_ref().map(|i| i.not_after_s),
            "requestedId": s.enroll_id(),
            "code": view.pending.as_ref().map(|t| t.code.clone()),
            "expiresAtS": view.pending.as_ref().map(|t| t.expires_at_s),
            "error": view.error,
        })
    }

    /// Requests a certificate; resolves once the code to show is known.
    async fn start_enrollment(&self, db: &Database) -> Result<Value, String> {
        let s = self.reload_settings(db);
        let origin = enroll::origin_of(&s.broker_url)
            .ok_or("Set the broker URL to wss://<server>/mqtt first")?;
        let dir = self.inner.identity_dir.get().cloned().ok_or("kart link not started")?;
        if let Some(t) = self.inner.enrollment.lock().unwrap().task.take() {
            t.abort();
        }
        let requested = s.enroll_id();
        let (ticket, key_pem) = match enroll::request(&origin, &requested).await {
            Ok(r) => r,
            Err(e) => {
                let mut view = self.inner.enrollment.lock().unwrap();
                view.pending = None;
                view.error = Some(e.clone());
                return Err(e);
            }
        };
        tracing::info!("[plugin:kartlink] Enrollment requested as {requested}, code {}", ticket.code);
        let link = self.clone();
        let db = db.clone();
        let waiting = ticket.clone();
        let task = tokio::spawn(async move {
            let outcome = enroll::wait(&origin, &waiting, &key_pem, &dir).await;
            {
                let mut view = link.inner.enrollment.lock().unwrap();
                view.pending = None;
                view.task = None;
                view.error = outcome.as_ref().err().cloned();
            }
            match outcome {
                Ok(id) => {
                    tracing::info!("[plugin:kartlink] Enrolled as {}", id.device_id);
                    // The supervisor sees the new identity and reconnects.
                    link.reload_settings(&db);
                }
                Err(e) => tracing::warn!("[plugin:kartlink] Enrollment: {e}"),
            }
        });
        {
            let mut view = self.inner.enrollment.lock().unwrap();
            view.pending = Some(ticket);
            view.error = None;
            view.task = Some(task);
        }
        Ok(self.enrollment_json(&s))
    }

    fn cancel_enrollment(&self) -> Value {
        let mut view = self.inner.enrollment.lock().unwrap();
        if let Some(t) = view.task.take() {
            t.abort();
        }
        view.pending = None;
        view.error = None;
        drop(view);
        self.enrollment_json(&self.settings())
    }
}

impl KartGate for KartLink {
    fn context(&self) -> GateContext {
        let s = self.settings();
        GateContext {
            kart_session_id: s.enabled.then(|| self.with_tracker(|t| t.session_id.clone())).flatten(),
            clock_synced: clock::synced(),
            barrier: s.barrier,
            publish: s.enabled,
        }
    }

    fn judge(&self, wall_us: i64) -> BoxFuture<'static, GateResult> {
        let link = self.clone();
        Box::pin(async move {
            let s = link.settings();
            if !s.enabled || !s.require_nearby {
                return GateResult {
                    verdict: Verdict::Accepted,
                    distance_m: None,
                    context: link.context(),
                };
            }

            // The kart's fixes around the crossing arrive a little later over its own uplink
            let deadline = tokio::time::Instant::now() + MAX_WAIT;
            while tokio::time::Instant::now() < deadline {
                let ready = link.with_tracker(|t| {
                    t.online == Some(false) || t.has_data_after(wall_us + WAIT_PAST_US)
                });
                if ready {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }

            let context = link.context();
            let gate = Gate {
                barrier: s.barrier,
                radius_m: s.radius_m,
                clock_synced: context.clock_synced,
            };
            let check = link.with_tracker(|t| t.check(wall_us, gate));
            GateResult {
                verdict: check.verdict,
                distance_m: check.distance_m,
                context,
            }
        })
    }

    fn on_recorded(&self, crossing: &LapCrossingRecord) {
        if crossing.published_at.is_none() {
            self.kick_outbox();
        }
    }
}

pub struct KartLinkPlugin {
    link: KartLink,
}

impl KartLinkPlugin {
    pub fn new(link: KartLink) -> Self {
        Self { link }
    }
}

impl Plugin for KartLinkPlugin {
    fn id(&self) -> &'static str {
        "kartlink"
    }

    fn name(&self) -> &'static str {
        "Kart Link"
    }

    fn init(&mut self, ctx: &PluginContext) -> Result<(), Box<dyn std::error::Error>> {
        let _ = self.link.inner.identity_dir.set(enroll::identity_dir(&ctx.config.data_dir));
        tokio::spawn(mqtt::supervise(self.link.clone(), ctx.db.clone()));
        tracing::info!("[plugin:kartlink] Started");
        Ok(())
    }

    fn register_rpc(&self, registry: &mut RpcRegistry) {
        let link = self.link.clone();
        registry.register("getKartLinkStatus", move |ctx, _params| {
            let link = link.clone();
            async move {
                let db = ctx.db.clone();
                let pending = tokio::task::spawn_blocking(move || {
                    crate::plugins::laptimer::db::count_unpublished_crossings(&db.lock()).unwrap_or(0)
                })
                .await
                .unwrap_or(0);
                Ok(link.status(pending))
            }
        });

        let link = self.link.clone();
        registry.register("startKartLinkEnrollment", move |ctx, _params| {
            let link = link.clone();
            async move { link.start_enrollment(&ctx.db).await }
        });

        let link = self.link.clone();
        registry.register("cancelKartLinkEnrollment", move |_ctx, _params| {
            let link = link.clone();
            async move { Ok(link.cancel_enrollment()) }
        });

        let link = self.link.clone();
        registry.register("setBarrierFromKart", move |ctx, _params| {
            let link = link.clone();
            async move {
                let now_us = chrono::Utc::now().timestamp_micros();
                let fix = link
                    .with_tracker(|t| t.latest_fix())
                    .filter(|f| now_us - f.t_us <= MAX_FIX_AGE_US)
                    .ok_or("No recent GPS fix from the kart. Is it online with a fix?")?;
                let db = ctx.db.clone();
                tokio::task::spawn_blocking(move || {
                    let conn = db.lock();
                    crate::db::settings::save_setting(&conn, "barrierLat", &format!("{:.7}", fix.lat))?;
                    crate::db::settings::save_setting(&conn, "barrierLon", &format!("{:.7}", fix.lon))
                })
                .await
                .map_err(|e| e.to_string())?
                .map_err(|e| e.to_string())?;
                // The gate reads settings from the link; refresh it now rather than on the next poll
                link.reload_settings(&ctx.db);
                tracing::info!("[plugin:kartlink] Barrier set from kart position {:.7}, {:.7}", fix.lat, fix.lon);
                Ok(json!({ "lat": fix.lat, "lon": fix.lon }))
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use prost::Message;

    #[test]
    fn settings_parse_barrier_and_flags() {
        let s = LinkSettings::from_app(&AppSettings::default());
        assert!(!s.enabled);
        assert_eq!(s.barrier, None);
        assert!(s.require_nearby);

        let s = LinkSettings::from_app(&AppSettings {
            kart_link_enabled: "true".into(),
            barrier_lat: "48.1234567".into(),
            barrier_lon: "11.5".into(),
            require_kart_nearby: "false".into(),
            ..Default::default()
        });
        assert!(s.enabled && !s.require_nearby);
        assert_eq!(s.barrier, Some((48.1234567, 11.5)));

        let mut moved = s.clone();
        moved.barrier = None;
        assert!(s.same_connection(&moved), "moving the barrier must not reconnect");
        moved.kart_id = "kart-02".into();
        assert!(!s.same_connection(&moved));
    }

    #[test]
    fn crossing_encodes_as_lap_crossing() {
        let settings = LinkSettings::from_app(&AppSettings {
            kart_link_device_id: "speedcamera-01".into(),
            ..Default::default()
        });
        let row = LapCrossingRecord {
            id: "0190a0e0-0000-7000-8000-000000000001".into(),
            session_id: 1,
            wall_us: 1_700_000_000_000_000,
            boundary_us: 42,
            esp_boot: 7,
            speed: 38.4,
            direction: "forward".into(),
            verdict: Verdict::RejectedFar,
            distance_m: Some(140.0),
            kart_session_id: Some("s1".into()),
            lap_number: 0,
            lap_us: None,
            image_path: None,
            clock_synced: true,
            barrier_lat: Some(48.1),
            barrier_lon: Some(11.5),
            published_at: None,
        };
        let msg = proto::timing::LapCrossing::decode(mqtt::encode(&row, &settings).as_slice()).unwrap();
        assert_eq!(msg.device_id, "speedcamera-01");
        assert_eq!(msg.kart_id, "kart-01");
        assert_eq!(msg.kart_session_id, "s1");
        assert_eq!(msg.verdict(), proto::timing::Verdict::RejectedFar);
        assert_eq!(msg.distance_m, Some(140.0));
        assert_eq!(msg.lap_us, None);
        assert_eq!(mqtt::laps_topic(&msg.kart_id), "kart/kart-01/laps");
    }
}
