//! The MQTT side of the kart link: one connection to the telemetry broker that follows the
//! kart's status and GPS, and an outbox flusher that publishes stored crossings.

use std::time::Duration;

use prost::Message;
use rumqttc::{AsyncClient, Event, EventLoop, MqttOptions, Packet, Publish, QoS};
use tokio::sync::mpsc;

use super::proto::{telemetry, timing};
use super::tracker::Sample;
use super::{KartLink, LinkSettings};
use crate::db::Database;
use crate::plugins::laptimer::db as lapdb;
use crate::plugins::laptimer::engine::Verdict;
use crate::plugins::laptimer::models::LapCrossingRecord;

/// How often settings are re-read; a changed broker or kart id reconnects.
const SETTINGS_POLL: Duration = Duration::from_secs(2);
/// Without a PubAck by then the crossing stays in the outbox for the next attempt.
const ACK_TIMEOUT: Duration = Duration::from_secs(5);
/// The outbox is retried this often even without a new crossing.
const OUTBOX_RETRY: Duration = Duration::from_secs(10);
/// After a broker restart every client reconnects at once; give the subscribers (ingest)
/// time to subscribe again before the outbox flushes, or the broker drops what it accepts.
const FLUSH_AFTER_CONNECT: Duration = Duration::from_secs(3);

pub fn status_topic(kart_id: &str) -> String {
    format!("kart/{kart_id}/status")
}
pub fn live_topic(kart_id: &str) -> String {
    format!("kart/{kart_id}/live")
}
pub fn laps_topic(kart_id: &str) -> String {
    format!("kart/{kart_id}/laps")
}

/// Keeps the link connected according to the stored settings, forever.
pub async fn supervise(link: KartLink, db: Database) {
    loop {
        let settings = link.reload_settings(&db);
        if !settings.enabled || settings.broker_url.is_empty() {
            link.set_connected(false, None);
            tokio::time::sleep(SETTINGS_POLL).await;
            continue;
        }
        match options(&settings) {
            Ok(opts) => run_connection(&link, &db, &settings, opts).await,
            Err(e) => {
                link.set_connected(false, Some(e));
                tokio::time::sleep(SETTINGS_POLL).await;
            }
        }
    }
}

fn options(s: &LinkSettings) -> Result<MqttOptions, String> {
    let client_id = format!("speedcamera-{}", s.device_id);
    let mut opts = MqttOptions::parse_url(format!("{}?client_id={client_id}", s.broker_url))
        .map_err(|e| format!("Invalid broker URL: {e}"))?;
    opts.set_keep_alive(Duration::from_secs(5));
    // A fresh session drops anything in flight; unacknowledged crossings are resent from the outbox.
    opts.set_clean_session(true);
    if !s.username.is_empty() {
        opts.set_credentials(&s.username, &s.password);
    }
    Ok(opts)
}

/// Runs one connection until the connection settings change.
async fn run_connection(link: &KartLink, db: &Database, settings: &LinkSettings, opts: MqttOptions) {
    let (client, mut eventloop) = AsyncClient::new(opts, 32);
    let (ack_tx, ack_rx) = mpsc::unbounded_channel::<u16>();
    let flusher = tokio::spawn(flush_outbox(link.clone(), db.clone(), client.clone(), ack_rx));
    tracing::info!("[plugin:kartlink] Connecting to {} for {}", settings.broker_url, settings.kart_id);

    let mut poll = tokio::time::interval(SETTINGS_POLL);
    loop {
        tokio::select! {
            ev = eventloop.poll() => {
                if !handle_event(link, &client, settings, &ack_tx, ev).await {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
            }
            _ = poll.tick() => {
                if !link.reload_settings(db).same_connection(settings) {
                    tracing::info!("[plugin:kartlink] Settings changed, reconnecting");
                    break;
                }
            }
        }
    }

    flusher.abort();
    let _ = client.disconnect().await;
    drain(&mut eventloop).await;
    link.set_connected(false, None);
}

/// Lets the eventloop send the DISCONNECT queued above.
async fn drain(eventloop: &mut EventLoop) {
    let _ = tokio::time::timeout(Duration::from_millis(500), async {
        while eventloop.poll().await.is_ok() {}
    })
    .await;
}

/// Returns false on a connection error.
async fn handle_event(
    link: &KartLink,
    client: &AsyncClient,
    settings: &LinkSettings,
    ack_tx: &mpsc::UnboundedSender<u16>,
    ev: Result<Event, rumqttc::ConnectionError>,
) -> bool {
    match ev {
        Ok(Event::Incoming(Packet::ConnAck(_))) => {
            tracing::info!("[plugin:kartlink] Connected to broker");
            // Subscribe on every (re)connect: the session is clean
            let _ = client.subscribe(status_topic(&settings.kart_id), QoS::AtLeastOnce).await;
            let _ = client.subscribe(live_topic(&settings.kart_id), QoS::AtMostOnce).await;
            link.set_connected(true, None);
            let link = link.clone();
            tokio::spawn(async move {
                tokio::time::sleep(FLUSH_AFTER_CONNECT).await;
                link.kick_outbox();
            });
        }
        Ok(Event::Incoming(Packet::Publish(p))) => handle_publish(link, &p),
        Ok(Event::Incoming(Packet::PubAck(ack))) => {
            let _ = ack_tx.send(ack.pkid);
        }
        Ok(_) => {}
        Err(e) => {
            if link.is_connected() {
                tracing::warn!("[plugin:kartlink] Connection lost: {e}");
            }
            link.set_connected(false, Some(e.to_string()));
            return false;
        }
    }
    true
}

fn handle_publish(link: &KartLink, p: &Publish) {
    let rx_us = chrono::Utc::now().timestamp_micros();
    if p.topic.ends_with("/live") {
        let Ok(batch) = telemetry::Batch::decode(p.payload.as_ref()) else {
            return;
        };
        let samples: Vec<Sample> = batch
            .samples
            .iter()
            .map(|s| Sample { signal_id: s.signal_id, t_us: s.t_us, value: s.value })
            .collect();
        link.with_tracker(|t| t.ingest(&samples, rx_us));
    } else if p.topic.ends_with("/status") {
        if p.payload.is_empty() {
            return; // retained status cleared
        }
        if let Ok(status) = telemetry::Status::decode(p.payload.as_ref()) {
            link.with_tracker(|t| t.set_status(status.online, status.session_id));
        }
    }
}

/// Publishes stored crossings one at a time and marks each one on its PubAck. This is the only
/// QoS 1 publisher on the connection, so the next PubAck belongs to the crossing in flight.
async fn flush_outbox(
    link: KartLink,
    db: Database,
    client: AsyncClient,
    mut acks: mpsc::UnboundedReceiver<u16>,
) {
    loop {
        let _ = tokio::time::timeout(OUTBOX_RETRY, link.outbox_kicked()).await;
        if !link.is_connected() {
            continue;
        }
        let settings = link.settings();
        loop {
            let pending = {
                let db = db.clone();
                tokio::task::spawn_blocking(move || {
                    lapdb::get_unpublished_crossings(&db.lock(), 1).unwrap_or_default()
                })
                .await
                .unwrap_or_default()
            };
            let Some(row) = pending.into_iter().next() else {
                break;
            };

            while acks.try_recv().is_ok() {} // stale acks of an earlier attempt
            let payload = encode(&row, &settings);
            if client
                .publish(laps_topic(&settings.kart_id), QoS::AtLeastOnce, false, payload)
                .await
                .is_err()
            {
                break;
            }
            if !matches!(tokio::time::timeout(ACK_TIMEOUT, acks.recv()).await, Ok(Some(_))) {
                break; // retried on the next kick or timeout
            }

            let now_ms = chrono::Utc::now().timestamp_millis();
            let id = row.id.clone();
            let db = db.clone();
            let _ = tokio::task::spawn_blocking(move || {
                lapdb::mark_crossing_published(&db.lock(), &id, now_ms)
            })
            .await;
            tracing::debug!("[plugin:kartlink] Published crossing {}", row.id);
        }
    }
}

pub fn encode(row: &LapCrossingRecord, settings: &LinkSettings) -> Vec<u8> {
    timing::LapCrossing {
        crossing_id: row.id.clone(),
        device_id: settings.device_id.clone(),
        kart_id: settings.kart_id.clone(),
        kart_session_id: row.kart_session_id.clone().unwrap_or_default(),
        t_us: row.wall_us,
        lap_number: row.lap_number.max(0) as u32,
        lap_us: row.lap_us,
        speed_kmh: row.speed,
        verdict: proto_verdict(row.verdict) as i32,
        distance_m: row.distance_m,
        barrier_lat: row.barrier_lat.unwrap_or_default(),
        barrier_lon: row.barrier_lon.unwrap_or_default(),
        clock_synced: row.clock_synced,
    }
    .encode_to_vec()
}

fn proto_verdict(v: Verdict) -> timing::Verdict {
    match v {
        Verdict::Accepted => timing::Verdict::Accepted,
        Verdict::AcceptedUnverified => timing::Verdict::AcceptedUnverified,
        Verdict::RejectedFar => timing::Verdict::RejectedFar,
        Verdict::RejectedSlow => timing::Verdict::RejectedSlow,
        Verdict::RejectedDuplicate => timing::Verdict::RejectedDuplicate,
        Verdict::RejectedKartOffline => timing::Verdict::RejectedKartOffline,
        Verdict::RejectedDirection => timing::Verdict::RejectedDirection,
    }
}
