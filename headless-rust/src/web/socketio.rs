use crate::web::rpc::{handle_rpc, RpcContext, RpcRequest};
use serde_json::json;
use socketioxide::extract::{AckSender, Data, SocketRef};
use socketioxide::socket::DisconnectReason;
use socketioxide::SocketIo;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tokio::sync::broadcast;

pub async fn on_connect(s: SocketRef, ctx: Arc<RpcContext>) {
    tracing::info!("[socketio] Client connected: {}", s.id);

    // Push initial states directly to the newly connected client
    let _ = s.emit("cameraStatus", &ctx.camera.get_status());
    let _ = s.emit("serialStatus", &ctx.serial.get_status_payload());
    let _ = s.emit("armedStatus", &json!({ "armed": ctx.armed.load(Ordering::SeqCst) }));

    // Register RPC handler with AckSender for request-response RPC over Socket.io
    let ctx_rpc = ctx.clone();
    s.on(
        "rpc",
        move |_s: SocketRef, Data(req): Data<RpcRequest>, ack: AckSender| {
            let ctx = ctx_rpc.clone();
            async move {
                let resp = handle_rpc(&ctx, req).await;
                ack.send(&resp).ok();
            }
        },
    );

    // Heartbeat ping handler
    s.on("ping", |ack: AckSender| async move {
        ack.send(&json!({
            "pong": true,
            "timestamp": chrono::Utc::now().timestamp_millis()
        }))
        .ok();
    });

    s.on_disconnect(|s: SocketRef, reason: DisconnectReason| async move {
        tracing::info!("[socketio] Client disconnected: {} ({:?})", s.id, reason);
    });
}

pub fn spawn_event_broadcaster(io: SocketIo, ctx: Arc<RpcContext>) {
    tokio::spawn(async move {
        let mut serial_rx = ctx.serial.subscribe();
        let mut camera_status_rx = ctx.camera.subscribe_status();
        let mut live_frame_rx = ctx.camera.subscribe_frames();
        let mut flash_rx = ctx.flash_tx.subscribe();
        let mut violation_rx = ctx.violation_tx.subscribe();
        let mut armed_rx = ctx.armed_tx.subscribe();

        loop {
            tokio::select! {
                res = serial_rx.recv() => {
                    match res {
                        Ok(payload) => {
                            if let Err(e) = io.emit("serialStatus", &payload).await {
                                tracing::debug!("[socketio] Emit serialStatus error: {:?}", e);
                            }
                        }
                        Err(broadcast::error::RecvError::Lagged(n)) => {
                            tracing::debug!("[socketio] Serial broadcast lagged by {} messages", n);
                        }
                        Err(broadcast::error::RecvError::Closed) => {
                            tracing::warn!("[socketio] Serial broadcast channel closed");
                            break;
                        }
                    }
                }

                res = camera_status_rx.recv() => {
                    match res {
                        Ok(payload) => {
                            if let Err(e) = io.emit("cameraStatus", &payload).await {
                                tracing::debug!("[socketio] Emit cameraStatus error: {:?}", e);
                            }
                        }
                        Err(broadcast::error::RecvError::Lagged(n)) => {
                            tracing::debug!("[socketio] Camera status broadcast lagged by {} messages", n);
                        }
                        Err(broadcast::error::RecvError::Closed) => {
                            tracing::warn!("[socketio] Camera status broadcast channel closed");
                            break;
                        }
                    }
                }

                res = live_frame_rx.recv() => {
                    match res {
                        Ok(b64_frame) => {
                            // Volatile / drop if congested so live preview doesn't buffer stale frames
                            if let Err(e) = io.volatile().emit("liveFrame", &b64_frame).await {
                                tracing::debug!("[socketio] Emit liveFrame error: {:?}", e);
                            }
                        }
                        Err(broadcast::error::RecvError::Lagged(_)) => {
                            // Frame skipping is expected under high framerate or low bandwidth
                        }
                        Err(broadcast::error::RecvError::Closed) => {
                            tracing::warn!("[socketio] Live frame channel closed");
                            break;
                        }
                    }
                }

                res = violation_rx.recv() => {
                    match res {
                        Ok(v) => {
                            tracing::info!("[socketio] Broadcasting violation #{} to all clients", v.id);
                            if let Err(e) = io.emit("violation", &v).await {
                                tracing::warn!("[socketio] Emit violation error: {:?}", e);
                            }
                        }
                        Err(broadcast::error::RecvError::Lagged(n)) => {
                            tracing::debug!("[socketio] Violation broadcast lagged by {} messages", n);
                        }
                        Err(broadcast::error::RecvError::Closed) => {
                            tracing::warn!("[socketio] Violation channel closed");
                            break;
                        }
                    }
                }

                res = flash_rx.recv() => {
                    match res {
                        Ok(payload) => {
                            if let Err(e) = io.emit("flashProgress", &payload).await {
                                tracing::debug!("[socketio] Emit flashProgress error: {:?}", e);
                            }
                        }
                        Err(broadcast::error::RecvError::Lagged(n)) => {
                            tracing::debug!("[socketio] Flash progress broadcast lagged by {} messages", n);
                        }
                        Err(broadcast::error::RecvError::Closed) => {
                            tracing::warn!("[socketio] Flash progress channel closed");
                            break;
                        }
                    }
                }

                res = armed_rx.recv() => {
                    match res {
                        Ok(is_armed) => {
                            if let Err(e) = io.emit("armedStatus", &json!({ "armed": is_armed })).await {
                                tracing::debug!("[socketio] Emit armedStatus error: {:?}", e);
                            }
                        }
                        Err(broadcast::error::RecvError::Lagged(n)) => {
                            tracing::debug!("[socketio] Armed status broadcast lagged by {} messages", n);
                        }
                        Err(broadcast::error::RecvError::Closed) => {
                            tracing::warn!("[socketio] Armed status channel closed");
                            break;
                        }
                    }
                }
            }
        }

        tracing::info!("[socketio] Event broadcaster task exiting");
    });
}
