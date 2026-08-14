use crate::camera::CameraService;
use crate::db::Database;
use crate::integrations::teable::TeableClient;
use crate::models::FlashProgressPayload;
use crate::serial::SerialService;
use crate::storage::FileStore;
use crate::web::rpc::{handle_rpc, RpcContext, RpcRequest};
use futures::{SinkExt, StreamExt};
use rocket::State;
use rocket_ws::stream::DuplexStream;
use rocket_ws::{Channel, Message, WebSocket};
use serde_json::json;
use std::sync::Arc;
use tokio::sync::broadcast;

#[rocket::get("/ws/rpc")]
pub fn ws_rpc(
    ws: WebSocket,
    db: &State<Database>,
    store: &State<FileStore>,
    camera: &State<Arc<CameraService>>,
    serial: &State<Arc<SerialService>>,
    flash_tx: &State<broadcast::Sender<FlashProgressPayload>>,
) -> Channel<'static> {
    let ctx = Arc::new(RpcContext {
        db: (*db).clone(),
        store: (*store).clone(),
        camera: (*camera).clone(),
        serial: (*serial).clone(),
        teable: TeableClient::new(),
        flash_tx: (*flash_tx).clone(),
    });

    let mut serial_rx = serial.subscribe();
    let mut camera_status_rx = camera.subscribe_status();
    let mut live_frame_rx = camera.subscribe_frames();
    let mut flash_rx = flash_tx.subscribe();

    ws.channel(move |mut stream: DuplexStream| {
        Box::pin(async move {
            println!("[ws] Client connected");

            // Push initial camera status immediately
            let init_status = json!({
                "event": "cameraStatus",
                "payload": ctx.camera.get_status()
            });
            let _ = stream.send(Message::Text(init_status.to_string())).await;

            loop {
                tokio::select! {
                    // Incoming message from client
                    Some(msg) = stream.next() => {
                        match msg {
                            Ok(Message::Text(text)) => {
                                if let Ok(req) = serde_json::from_str::<RpcRequest>(&text) {
                                    let resp = handle_rpc(&ctx, req).await;
                                    let resp_json = serde_json::to_string(&resp).unwrap_or_default();
                                    if stream.send(Message::Text(resp_json)).await.is_err() {
                                        break;
                                    }
                                }
                            }
                            Ok(Message::Close(_)) => break,
                            Err(_) => break,
                            _ => {}
                        }
                    }

                    // Serial telemetry broadcast
                    Ok(payload) = serial_rx.recv() => {
                        let msg = json!({
                            "event": "serialStatus",
                            "payload": payload
                        });
                        if stream.send(Message::Text(msg.to_string())).await.is_err() {
                            break;
                        }
                    }

                    // Camera status broadcast
                    Ok(payload) = camera_status_rx.recv() => {
                        let msg = json!({
                            "event": "cameraStatus",
                            "payload": payload
                        });
                        if stream.send(Message::Text(msg.to_string())).await.is_err() {
                            break;
                        }
                    }

                    // Live frame broadcast
                    Ok(b64_frame) = live_frame_rx.recv() => {
                        let msg = json!({
                            "event": "liveFrame",
                            "payload": b64_frame
                        });
                        if stream.send(Message::Text(msg.to_string())).await.is_err() {
                            break;
                        }
                    }

                    // Flash progress broadcast
                    Ok(payload) = flash_rx.recv() => {
                        let msg = json!({
                            "event": "flashProgress",
                            "payload": payload
                        });
                        if stream.send(Message::Text(msg.to_string())).await.is_err() {
                            break;
                        }
                    }
                }
            }

            println!("[ws] Client disconnected");
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
) -> Channel<'static> {
    ws_rpc(ws, db, store, camera, serial, flash_tx)
}
