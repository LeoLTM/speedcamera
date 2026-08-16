use crate::camera::CameraService;
use crate::db::Database;
use crate::integrations::teable::TeableClient;
use crate::models::{FlashProgressPayload, Violation};
use crate::serial::SerialService;
use crate::storage::FileStore;
use crate::web::rpc::{handle_rpc, RpcContext, RpcRequest};
use futures::{SinkExt, StreamExt};
use rocket::State;
use rocket_ws::stream::DuplexStream;
use rocket_ws::{Channel, Message, WebSocket};
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{broadcast, mpsc};

#[rocket::get("/ws/rpc")]
pub fn ws_rpc(
    ws: WebSocket,
    db: &State<Database>,
    store: &State<FileStore>,
    camera: &State<Arc<CameraService>>,
    serial: &State<Arc<SerialService>>,
    flash_tx: &State<broadcast::Sender<FlashProgressPayload>>,
    violation_tx: &State<broadcast::Sender<Violation>>,
) -> Channel<'static> {
    let ctx = Arc::new(RpcContext {
        db: (*db).clone(),
        store: (*store).clone(),
        camera: (*camera).clone(),
        serial: (*serial).clone(),
        teable: TeableClient::new(),
        flash_tx: (*flash_tx).clone(),
        violation_tx: (*violation_tx).clone(),
    });

    ws.channel(move |stream: DuplexStream| {
        let ctx = ctx.clone();
        Box::pin(async move {
            tracing::info!("[ws] Client connected");

            let (mut ws_sink, mut ws_stream) = stream.split();

            // MPSC channel for multiplexing outgoing messages onto the WebSocket sink
            let (out_tx, mut out_rx) = mpsc::channel::<Message>(128);

            // Dedicated Writer Task
            let writer_handle = tokio::spawn(async move {
                while let Some(msg) = out_rx.recv().await {
                    if let Err(e) = ws_sink.send(msg).await {
                        tracing::warn!("[ws-writer] Send error or client disconnected: {}", e);
                        break;
                    }
                }
                let _ = ws_sink.close().await;
            });

            // Push initial camera status immediately (with isStreaming state)
            let init_camera = json!({
                "event": "cameraStatus",
                "payload": ctx.camera.get_status()
            });
            let _ = out_tx.send(Message::Text(init_camera.to_string())).await;

            // Push initial serial status immediately
            let init_serial = json!({
                "event": "serialStatus",
                "payload": ctx.serial.get_status_payload()
            });
            let _ = out_tx.send(Message::Text(init_serial.to_string())).await;

            // Subscribe to all backend event channels
            let mut serial_rx = ctx.serial.subscribe();
            let mut camera_status_rx = ctx.camera.subscribe_status();
            let mut live_frame_rx = ctx.camera.subscribe_frames();
            let mut flash_rx = ctx.flash_tx.subscribe();
            let mut violation_rx = ctx.violation_tx.subscribe();

            // Heartbeat ping interval
            let mut ping_interval = tokio::time::interval(Duration::from_secs(15));
            ping_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

            loop {
                tokio::select! {
                    // Incoming message from client
                    incoming = ws_stream.next() => {
                        match incoming {
                            Some(Ok(Message::Text(text))) => {
                                if let Ok(req) = serde_json::from_str::<RpcRequest>(&text) {
                                    if req.method == "ping" || req.method == "heartbeat" {
                                        let resp = json!({
                                            "id": req.id,
                                            "result": { "pong": true, "timestamp": chrono::Utc::now().timestamp_millis() }
                                        });
                                        let _ = out_tx.send(Message::Text(resp.to_string())).await;
                                        continue;
                                    }

                                    let ctx_clone = ctx.clone();
                                    let out_tx_clone = out_tx.clone();
                                    // Handle RPC asynchronously in independent task to prevent blocking the select loop
                                    tokio::spawn(async move {
                                        let resp = handle_rpc(&ctx_clone, req).await;
                                        if let Ok(resp_json) = serde_json::to_string(&resp) {
                                            let _ = out_tx_clone.send(Message::Text(resp_json)).await;
                                        }
                                    });
                                }
                            }
                            Some(Ok(Message::Ping(payload))) => {
                                let _ = out_tx.send(Message::Pong(payload)).await;
                            }
                            Some(Ok(Message::Pong(_))) => {}
                            Some(Ok(Message::Close(_))) | None => {
                                tracing::info!("[ws] Client disconnected cleanly");
                                break;
                            }
                            Some(Err(e)) => {
                                tracing::warn!("[ws] Error reading from stream: {}", e);
                                break;
                            }
                            _ => {}
                        }
                    }

                    // Periodic Ping keepalive
                    _ = ping_interval.tick() => {
                        if out_tx.send(Message::Ping(Vec::new())).await.is_err() {
                            break;
                        }
                    }

                    // Serial telemetry broadcast (drop on slow client — next update follows soon)
                    res = serial_rx.recv() => {
                        match res {
                            Ok(payload) => {
                                let msg = json!({
                                    "event": "serialStatus",
                                    "payload": payload
                                });
                                let _ = out_tx.try_send(Message::Text(msg.to_string()));
                            }
                            Err(broadcast::error::RecvError::Lagged(n)) => {
                                tracing::debug!("[ws] Serial broadcast lagged by {} messages", n);
                            }
                            Err(broadcast::error::RecvError::Closed) => break,
                        }
                    }

                    // Camera status broadcast (drop on slow client — status is re-sent on change)
                    res = camera_status_rx.recv() => {
                        match res {
                            Ok(payload) => {
                                let msg = json!({
                                    "event": "cameraStatus",
                                    "payload": payload
                                });
                                let _ = out_tx.try_send(Message::Text(msg.to_string()));
                            }
                            Err(broadcast::error::RecvError::Lagged(n)) => {
                                tracing::debug!("[ws] Camera status broadcast lagged by {} messages", n);
                            }
                            Err(broadcast::error::RecvError::Closed) => break,
                        }
                    }

                    // Live frame broadcast (conflated: drop frame if channel is busy to prevent backpressure stalls)
                    res = live_frame_rx.recv() => {
                        match res {
                            Ok(b64_frame) => {
                                let msg = json!({
                                    "event": "liveFrame",
                                    "payload": b64_frame
                                });
                                // Use try_send so slow WebSocket consumers never stall critical telemetry or RPCs
                                let _ = out_tx.try_send(Message::Text(msg.to_string()));
                            }
                            Err(broadcast::error::RecvError::Lagged(_)) => {
                                // Frame skipping is normal when preview rate exceeds network bandwidth
                            }
                            Err(broadcast::error::RecvError::Closed) => break,
                        }
                    }

                    // Violation broadcast (high priority — retry briefly, then drop rather than stall)
                    res = violation_rx.recv() => {
                        match res {
                            Ok(v) => {
                                tracing::info!("[ws] Broadcasting violation #{} to client", v.id);
                                let msg = json!({
                                    "event": "violation",
                                    "payload": v
                                });
                                let text = Message::Text(msg.to_string());
                                // Try a few times with tiny yields; never block the select loop
                                let mut sent = false;
                                for _ in 0..10 {
                                    match out_tx.try_send(text.clone()) {
                                        Ok(_) => { sent = true; break; }
                                        Err(mpsc::error::TrySendError::Full(_)) => {
                                            tokio::time::sleep(Duration::from_millis(20)).await;
                                        }
                                        Err(_) => break,
                                    }
                                }
                                if !sent {
                                    tracing::warn!("[ws] Dropped violation #{} — client too slow", v.id);
                                }
                            }
                            Err(broadcast::error::RecvError::Lagged(n)) => {
                                tracing::debug!("[ws] Violation broadcast lagged by {} messages", n);
                            }
                            Err(broadcast::error::RecvError::Closed) => break,
                        }
                    }

                    // Flash progress broadcast (drop on slow client)
                    res = flash_rx.recv() => {
                        match res {
                            Ok(payload) => {
                                let msg = json!({
                                    "event": "flashProgress",
                                    "payload": payload
                                });
                                let _ = out_tx.try_send(Message::Text(msg.to_string()));
                            }
                            Err(broadcast::error::RecvError::Lagged(n)) => {
                                tracing::debug!("[ws] Flash progress broadcast lagged by {} messages", n);
                            }
                            Err(broadcast::error::RecvError::Closed) => break,
                        }
                    }
                }
            }

            // Drop out_tx so writer task finishes
            drop(out_tx);
            let _ = writer_handle.await;

            tracing::info!("[ws] Client session ended");
            Ok(())
        })
    })
}

#[rocket::get("/ws")]
pub fn ws_alias(
    ws: WebSocket,
    db: &State<Database>,
    store: &State<FileStore>,
    camera: &State<Arc<CameraService>>,
    serial: &State<Arc<SerialService>>,
    flash_tx: &State<broadcast::Sender<FlashProgressPayload>>,
    violation_tx: &State<broadcast::Sender<Violation>>,
) -> Channel<'static> {
    ws_rpc(ws, db, store, camera, serial, flash_tx, violation_tx)
}
