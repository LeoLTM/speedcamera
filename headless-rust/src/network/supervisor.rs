use super::state::{
    next_state, EthernetMode, NetworkEvent, NetworkStateSnapshot, TransitionEffect, WifiState,
    MAX_RETRY_ATTEMPTS,
};
use crate::models::{ApplyNetworkModeInput, NetworkOperationResult};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, mpsc};

// ponytail: single background async supervisor actor with serialized command queue
pub struct NetworkSupervisor {
    snapshot: Arc<RwLock<NetworkStateSnapshot>>,
    cmd_tx: mpsc::Sender<SupervisorCmd>,
    broadcast_tx: broadcast::Sender<NetworkStateSnapshot>,
    is_mock: Arc<AtomicBool>,
}

#[derive(Debug)]
enum SupervisorCmd {
    Event(NetworkEvent),
    ApplyMode {
        input: ApplyNetworkModeInput,
        reply: tokio::sync::oneshot::Sender<NetworkOperationResult>,
    },
}

impl NetworkSupervisor {
    pub fn new(is_mock: bool) -> Arc<Self> {
        let (broadcast_tx, _) = broadcast::channel(32);
        let (cmd_tx, mut cmd_rx) = mpsc::channel::<SupervisorCmd>(32);
        let snapshot = Arc::new(RwLock::new(NetworkStateSnapshot::default()));
        let is_mock = Arc::new(AtomicBool::new(is_mock));

        let supervisor = Arc::new(Self {
            snapshot: snapshot.clone(),
            cmd_tx,
            broadcast_tx: broadcast_tx.clone(),
            is_mock: is_mock.clone(),
        });

        // Spawn background supervisor loop
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(3));
            let mut last_tick = Instant::now();
            let mut current_wifi = WifiState::ApSetup;
            let mut current_eth = EthernetMode::CameraLan;
            let mut mock_retry_counter: u32 = 0;

            // Initial detection on boot
            let initial_summary = super::get_system_network_summary();
            if let Some(ref client) = initial_summary.wifi_client {
                if let Some(ref ip) = client.ip {
                    let ssid = client.ssid.clone().unwrap_or_else(|| "SavedWiFi".to_string());
                    current_wifi = WifiState::StationConnected {
                        ssid,
                        ip: ip.clone(),
                        gateway: client.gateway.clone(),
                        signal: client.signal_dbm,
                    };
                }
            } else if initial_summary.wifi_mode == "ap" || initial_summary.hotspot_ap.status == "ok" {
                current_wifi = WifiState::ApSetup;
            }

            if initial_summary.ethernet_mode == "dhcp" {
                current_eth = EthernetMode::Dhcp;
            }

            Self::update_snapshot(
                &snapshot,
                &current_wifi,
                current_eth,
                &broadcast_tx,
            );

            loop {
                tokio::select! {
                    _ = ticker.tick() => {
                        let elapsed = last_tick.elapsed().as_secs();
                        last_tick = Instant::now();

                        // ─── 1. Health & Link Polling ────────────────────────
                        let is_mock_now = is_mock.load(Ordering::Relaxed);
                        if is_mock_now {
                            // In mock mode, advance retry counters if connecting
                            match &current_wifi {
                                WifiState::StationConnecting { ssid, attempt, max_attempts } => {
                                    mock_retry_counter += 1;
                                    if mock_retry_counter > 2 {
                                        // Simulate successful connect after 2 retries
                                        let (next, _) = next_state(
                                            &current_wifi,
                                            NetworkEvent::ConnectionSucceeded {
                                                ip: "192.168.1.150".to_string(),
                                                gateway: Some("192.168.1.1".to_string()),
                                                signal: Some(-52),
                                            },
                                        );
                                        current_wifi = next;
                                        mock_retry_counter = 0;
                                        Self::update_snapshot(&snapshot, &current_wifi, current_eth, &broadcast_tx);
                                    } else {
                                        let (next, _) = next_state(&current_wifi, NetworkEvent::ConnectionAttemptFailed);
                                        current_wifi = next;
                                        Self::update_snapshot(&snapshot, &current_wifi, current_eth, &broadcast_tx);
                                    }
                                }
                                WifiState::StationReconnecting { .. } => {
                                    mock_retry_counter += 1;
                                    if mock_retry_counter >= 6 {
                                        // Fallback to AP after 6 retries
                                        let (next, _) = next_state(&current_wifi, NetworkEvent::ConnectionAttemptFailed);
                                        current_wifi = next;
                                        mock_retry_counter = 0;
                                        Self::update_snapshot(&snapshot, &current_wifi, current_eth, &broadcast_tx);
                                    }
                                }
                                WifiState::FallbackAp { .. } => {
                                    let (next, _) = next_state(&current_wifi, NetworkEvent::Tick(elapsed));
                                    if next != current_wifi {
                                        current_wifi = next;
                                        Self::update_snapshot(&snapshot, &current_wifi, current_eth, &broadcast_tx);
                                    }
                                }
                                _ => {}
                            }
                            continue;
                        }

                        // Physical Hardware Polling
                        match &current_wifi {
                            WifiState::StationConnected { ssid, .. } => {
                                // Verify client interface is still alive and has an IP
                                let summary = super::get_system_network_summary();
                                let still_connected = summary.wifi_client.as_ref().map(|c| c.ip.is_some()).unwrap_or(false);
                                if !still_connected {
                                    tracing::warn!("[network-supervisor] Wi-Fi link lost for SSID: {}", ssid);
                                    let (next, effect) = next_state(&current_wifi, NetworkEvent::LinkLost);
                                    current_wifi = next;
                                    Self::apply_effect(&effect).await;
                                    Self::update_snapshot(&snapshot, &current_wifi, current_eth, &broadcast_tx);
                                }
                            }

                            WifiState::StationConnecting { ssid, attempt, max_attempts } => {
                                let summary = super::get_system_network_summary();
                                if let Some(ref client) = summary.wifi_client {
                                    if let Some(ref ip) = client.ip {
                                        tracing::info!("[network-supervisor] Connected to {} (IP: {})", ssid, ip);
                                        let (next, _) = next_state(
                                            &current_wifi,
                                            NetworkEvent::ConnectionSucceeded {
                                                ip: ip.clone(),
                                                gateway: client.gateway.clone(),
                                                signal: client.signal_dbm,
                                            },
                                        );
                                        current_wifi = next;
                                        Self::update_snapshot(&snapshot, &current_wifi, current_eth, &broadcast_tx);
                                        continue;
                                    }
                                }

                                // If not yet connected, trigger attempt failed to step retry counter
                                let (next, effect) = next_state(&current_wifi, NetworkEvent::ConnectionAttemptFailed);
                                current_wifi = next;
                                Self::apply_effect(&effect).await;
                                Self::update_snapshot(&snapshot, &current_wifi, current_eth, &broadcast_tx);
                            }

                            WifiState::StationReconnecting { ssid, .. } => {
                                let summary = super::get_system_network_summary();
                                if let Some(ref client) = summary.wifi_client {
                                    if let Some(ref ip) = client.ip {
                                        tracing::info!("[network-supervisor] Reconnected to {} (IP: {})", ssid, ip);
                                        let (next, _) = next_state(
                                            &current_wifi,
                                            NetworkEvent::ConnectionSucceeded {
                                                ip: ip.clone(),
                                                gateway: client.gateway.clone(),
                                                signal: client.signal_dbm,
                                            },
                                        );
                                        current_wifi = next;
                                        Self::update_snapshot(&snapshot, &current_wifi, current_eth, &broadcast_tx);
                                        continue;
                                    }
                                }

                                let (next, effect) = next_state(&current_wifi, NetworkEvent::ConnectionAttemptFailed);
                                current_wifi = next;
                                Self::apply_effect(&effect).await;
                                Self::update_snapshot(&snapshot, &current_wifi, current_eth, &broadcast_tx);
                            }

                            WifiState::FallbackAp { .. } => {
                                // Query active AP stations count
                                let stations = Self::query_ap_stations_count();
                                let (next, _) = next_state(&current_wifi, NetworkEvent::StationsUpdated(stations));
                                current_wifi = next;

                                // Tick cooldown
                                let (next, effect) = next_state(&current_wifi, NetworkEvent::Tick(elapsed));
                                if next != current_wifi {
                                    current_wifi = next;
                                    Self::apply_effect(&effect).await;
                                }
                                Self::update_snapshot(&snapshot, &current_wifi, current_eth, &broadcast_tx);
                            }

                            WifiState::ApSetup => {
                                // Standalone AP mode - ensure snapshot is accurate
                                let stations = Self::query_ap_stations_count();
                                {
                                    let mut s = snapshot.write().unwrap();
                                    s.connected_stations = stations;
                                }
                            }
                        }
                    }

                    Some(cmd) = cmd_rx.recv() => {
                        match cmd {
                            SupervisorCmd::Event(ev) => {
                                let (next, effect) = next_state(&current_wifi, ev);
                                current_wifi = next;
                                Self::apply_effect(&effect).await;
                                Self::update_snapshot(&snapshot, &current_wifi, current_eth, &broadcast_tx);
                            }

                            SupervisorCmd::ApplyMode { input, reply } => {
                                let mode = input.mode.to_lowercase();
                                match mode.as_str() {
                                    "ap" | "hotspot" | "field" => {
                                        let (next, effect) = next_state(&current_wifi, NetworkEvent::UserForget);
                                        current_wifi = next;
                                        let res = Self::execute_script(&["ap"]).await;
                                        Self::update_snapshot(&snapshot, &current_wifi, current_eth, &broadcast_tx);
                                        let _ = reply.send(res);
                                    }
                                    "client" | "wifi-client" | "wifi" => {
                                        let ssid = input.ssid.clone().unwrap_or_default();
                                        let pass = input.password.clone();
                                        if ssid.is_empty() {
                                            let _ = reply.send(NetworkOperationResult {
                                                success: false,
                                                mode: "client".to_string(),
                                                message: "SSID is required".to_string(),
                                                details: None,
                                            });
                                            continue;
                                        }

                                        let (next, _) = next_state(
                                            &current_wifi,
                                            NetworkEvent::UserConnect {
                                                ssid: ssid.clone(),
                                                password: pass.clone(),
                                            },
                                        );
                                        current_wifi = next;
                                        Self::update_snapshot(&snapshot, &current_wifi, current_eth, &broadcast_tx);

                                        // Execute connect script asynchronously
                                        let mut args = vec!["client", ssid.as_str()];
                                        if let Some(ref p) = pass {
                                            if !p.is_empty() {
                                                args.push(p.as_str());
                                            }
                                        }
                                        let res = Self::execute_script(&args).await;
                                        if res.success {
                                            let summary = super::get_system_network_summary();
                                            let ip = summary.wifi_client.as_ref().and_then(|c| c.ip.clone()).unwrap_or_else(|| "Waiting DHCP".to_string());
                                            let (succ_next, _) = next_state(
                                                &current_wifi,
                                                NetworkEvent::ConnectionSucceeded {
                                                    ip,
                                                    gateway: summary.wifi_client.as_ref().and_then(|c| c.gateway.clone()),
                                                    signal: summary.wifi_client.as_ref().and_then(|c| c.signal_dbm),
                                                },
                                            );
                                            current_wifi = succ_next;
                                        } else {
                                            let (fail_next, effect) = next_state(&current_wifi, NetworkEvent::ConnectionAttemptFailed);
                                            current_wifi = fail_next;
                                            Self::apply_effect(&effect).await;
                                        }
                                        Self::update_snapshot(&snapshot, &current_wifi, current_eth, &broadcast_tx);
                                        let _ = reply.send(res);
                                    }
                                    "forget" | "reset-wifi" => {
                                        let (next, _) = next_state(&current_wifi, NetworkEvent::UserForget);
                                        current_wifi = next;
                                        let res = Self::execute_script(&["forget"]).await;
                                        Self::update_snapshot(&snapshot, &current_wifi, current_eth, &broadcast_tx);
                                        let _ = reply.send(res);
                                    }
                                    "camera-lan" | "lan-camera" => {
                                        current_eth = EthernetMode::CameraLan;
                                        let res = Self::execute_script(&["lan-camera"]).await;
                                        Self::update_snapshot(&snapshot, &current_wifi, current_eth, &broadcast_tx);
                                        let _ = reply.send(res);
                                    }
                                    "lan-dhcp" | "ethernet-dhcp" => {
                                        current_eth = EthernetMode::Dhcp;
                                        let res = Self::execute_script(&["lan-dhcp"]).await;
                                        Self::update_snapshot(&snapshot, &current_wifi, current_eth, &broadcast_tx);
                                        let _ = reply.send(res);
                                    }
                                    other => {
                                        let _ = reply.send(NetworkOperationResult {
                                            success: false,
                                            mode: other.to_string(),
                                            message: format!("Unknown mode: {}", other),
                                            details: None,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        supervisor
    }

    pub fn snapshot(&self) -> NetworkStateSnapshot {
        self.snapshot.read().unwrap().clone()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<NetworkStateSnapshot> {
        self.broadcast_tx.subscribe()
    }

    pub async fn apply_mode(&self, input: ApplyNetworkModeInput) -> Result<NetworkOperationResult, String> {
        let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
        self.cmd_tx
            .send(SupervisorCmd::ApplyMode { input, reply: reply_tx })
            .await
            .map_err(|e| format!("Supervisor channel closed: {}", e))?;

        reply_rx.await.map_err(|e| format!("Supervisor dropped reply: {}", e))
    }

    pub async fn send_event(&self, event: NetworkEvent) {
        let _ = self.cmd_tx.send(SupervisorCmd::Event(event)).await;
    }

    fn update_snapshot(
        snapshot: &Arc<RwLock<NetworkStateSnapshot>>,
        wifi: &WifiState,
        eth: EthernetMode,
        broadcast_tx: &broadcast::Sender<NetworkStateSnapshot>,
    ) {
        let mut s = snapshot.write().unwrap();
        s.wifi_state = wifi.clone();
        s.ethernet_mode = eth;
        s.timestamp_ms = chrono::Utc::now().timestamp_millis();

        match wifi {
            WifiState::ApSetup => {
                s.active_ssid = Some("speedcamera".to_string());
                s.client_ip = None;
                s.retry_attempt = 0;
                s.time_to_next_action = 0;
            }
            WifiState::StationConnecting { ssid, attempt, max_attempts } => {
                s.active_ssid = Some(ssid.clone());
                s.client_ip = None;
                s.retry_attempt = *attempt;
                s.max_attempts = *max_attempts;
                s.time_to_next_action = (max_attempts - attempt + 1) as u64 * 10;
            }
            WifiState::StationConnected { ssid, ip, .. } => {
                s.active_ssid = Some(ssid.clone());
                s.client_ip = Some(ip.clone());
                s.retry_attempt = 0;
                s.time_to_next_action = 0;
            }
            WifiState::StationReconnecting { ssid, attempt, max_attempts } => {
                s.active_ssid = Some(ssid.clone());
                s.client_ip = None;
                s.retry_attempt = *attempt;
                s.max_attempts = *max_attempts;
                s.time_to_next_action = (max_attempts - attempt + 1) as u64 * 10;
            }
            WifiState::FallbackAp { target_ssid, stations_connected, probe_countdown_secs } => {
                s.active_ssid = Some("speedcamera".to_string());
                s.client_ip = None;
                s.connected_stations = *stations_connected;
                s.time_to_next_action = *probe_countdown_secs;
            }
        }

        let snap_clone = s.clone();
        drop(s);
        let _ = broadcast_tx.send(snap_clone);
    }

    async fn apply_effect(effect: &TransitionEffect) {
        match effect {
            TransitionEffect::None => {}
            TransitionEffect::ApplyApMode => {
                tracing::info!("[network-supervisor] Applying AP Fallback Mode");
                Self::execute_script(&["ap"]).await;
            }
            TransitionEffect::ApplyClientMode { ssid, password } => {
                tracing::info!("[network-supervisor] Connecting to Wi-Fi client: {}", ssid);
                let mut args = vec!["client", ssid.as_str()];
                if let Some(ref p) = password {
                    if !p.is_empty() {
                        args.push(p.as_str());
                    }
                }
                Self::execute_script(&args).await;
            }
            TransitionEffect::ProbeConnect { ssid } => {
                tracing::info!("[network-supervisor] Background probe connect to: {}", ssid);
                Self::execute_script(&["auto"]).await;
            }
            TransitionEffect::ApplyCameraLan => {
                Self::execute_script(&["lan-camera"]).await;
            }
            TransitionEffect::ApplyEthernetDhcp => {
                Self::execute_script(&["lan-dhcp"]).await;
            }
        }
    }

    fn query_ap_stations_count() -> usize {
        // Query station dump via iw
        if let Ok(output) = Command::new("iw").args(["dev", "wlan0", "station", "dump"]).output() {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                return text.lines().filter(|l| l.starts_with("Station ")).count();
            }
        }
        0
    }

    async fn execute_script(args: &[&str]) -> NetworkOperationResult {
        let script_paths = [
            Path::new("./scripts/setup-network.sh"),
            Path::new("../scripts/setup-network.sh"),
            Path::new("/home/pi/speedcamera/headless-rust/scripts/setup-network.sh"),
        ];

        let script = script_paths
            .iter()
            .find(|p| p.exists())
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("./scripts/setup-network.sh"));

        let args_owned: Vec<String> = args.iter().map(|s| s.to_string()).collect();

        tokio::task::spawn_blocking(move || {
            let mut cmd = Command::new("sudo");
            cmd.arg(&script);
            for a in &args_owned {
                cmd.arg(a);
            }

            tracing::info!("[network-supervisor] Executing: {:?}", cmd);
            match cmd.output() {
                Ok(out) => {
                    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                    let details = if stderr.is_empty() { stdout } else { format!("{}\n{}", stdout, stderr) };

                    NetworkOperationResult {
                        success: out.status.success(),
                        mode: args_owned.first().cloned().unwrap_or_default(),
                        message: if out.status.success() {
                            "Network operation succeeded".to_string()
                        } else {
                            "Network operation failed".to_string()
                        },
                        details: Some(details),
                    }
                }
                Err(err) => NetworkOperationResult {
                    success: false,
                    mode: args_owned.first().cloned().unwrap_or_default(),
                    message: format!("Execution failed: {}", err),
                    details: None,
                },
            }
        })
        .await
        .unwrap_or_else(|e| NetworkOperationResult {
            success: false,
            mode: "error".to_string(),
            message: format!("Join error: {}", e),
            details: None,
        })
    }
}
