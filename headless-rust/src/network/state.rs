use serde::{Deserialize, Serialize};

// ponytail: pure state machine without external IO for deterministic transitions and zero-mock testing
pub const MAX_RETRY_ATTEMPTS: u32 = 6;
#[allow(dead_code)]
pub const RETRY_INTERVAL_SECS: u64 = 10;
pub const IDLE_PROBE_COOLDOWN_SECS: u64 = 60;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WifiState {
    ApSetup,
    StationConnecting {
        ssid: String,
        attempt: u32,
        max_attempts: u32,
    },
    StationConnected {
        ssid: String,
        ip: String,
        gateway: Option<String>,
        signal: Option<i32>,
    },
    StationReconnecting {
        ssid: String,
        attempt: u32,
        max_attempts: u32,
    },
    FallbackAp {
        target_ssid: Option<String>,
        stations_connected: usize,
        probe_countdown_secs: u64,
    },
}

impl WifiState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ApSetup => "ap_setup",
            Self::StationConnecting { .. } => "connecting",
            Self::StationConnected { .. } => "connected",
            Self::StationReconnecting { .. } => "reconnecting",
            Self::FallbackAp { .. } => "fallback_ap",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EthernetMode {
    CameraLan,
    Dhcp,
    Unmanaged,
}

impl EthernetMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::CameraLan => "camera-lan",
            Self::Dhcp => "lan-dhcp",
            Self::Unmanaged => "unmanaged",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkStateSnapshot {
    pub wifi_state: WifiState,
    pub ethernet_mode: EthernetMode,
    pub active_ssid: Option<String>,
    pub client_ip: Option<String>,
    pub ap_ip: String,
    pub retry_attempt: u32,
    pub max_attempts: u32,
    pub connected_stations: usize,
    pub time_to_next_action: u64,
    pub timestamp_ms: i64,
}

impl Default for NetworkStateSnapshot {
    fn default() -> Self {
        Self {
            wifi_state: WifiState::ApSetup,
            ethernet_mode: EthernetMode::CameraLan,
            active_ssid: None,
            client_ip: None,
            ap_ip: "192.168.4.1".to_string(),
            retry_attempt: 0,
            max_attempts: MAX_RETRY_ATTEMPTS,
            connected_stations: 0,
            time_to_next_action: 0,
            timestamp_ms: chrono::Utc::now().timestamp_millis(),
        }
    }
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum NetworkEvent {
    UserConnect { ssid: String, password: Option<String> },
    UserForget,
    UserSetEthernet(EthernetMode),
    ConnectionSucceeded { ip: String, gateway: Option<String>, signal: Option<i32> },
    ConnectionAttemptFailed,
    LinkLost,
    StationsUpdated(usize),
    Tick(u64), // elapsed seconds since last tick
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(dead_code)]
pub enum TransitionEffect {
    None,
    ApplyApMode,
    ApplyClientMode { ssid: String, password: Option<String> },
    ProbeConnect { ssid: String },
    ApplyCameraLan,
    ApplyEthernetDhcp,
}

/// Pure state transition function
pub fn next_state(
    current: &WifiState,
    event: NetworkEvent,
) -> (WifiState, TransitionEffect) {
    match (current, event) {
        // User triggers connection from Web UI
        (_, NetworkEvent::UserConnect { ssid, password }) => {
            (
                WifiState::StationConnecting {
                    ssid: ssid.clone(),
                    attempt: 1,
                    max_attempts: MAX_RETRY_ATTEMPTS,
                },
                TransitionEffect::ApplyClientMode { ssid, password },
            )
        }

        // User clicks "Forget Wi-Fi"
        (_, NetworkEvent::UserForget) => (
            WifiState::ApSetup,
            TransitionEffect::ApplyApMode,
        ),

        // ─── StationConnecting ───────────────────────────────────────────────
        (WifiState::StationConnecting { ssid, .. }, NetworkEvent::ConnectionSucceeded { ip, gateway, signal }) => {
            (
                WifiState::StationConnected {
                    ssid: ssid.clone(),
                    ip,
                    gateway,
                    signal,
                },
                TransitionEffect::None,
            )
        }

        (WifiState::StationConnecting { ssid, attempt, max_attempts }, NetworkEvent::ConnectionAttemptFailed) => {
            if *attempt >= *max_attempts {
                // Exhausted retries -> enter Fallback AP
                (
                    WifiState::FallbackAp {
                        target_ssid: Some(ssid.clone()),
                        stations_connected: 0,
                        probe_countdown_secs: IDLE_PROBE_COOLDOWN_SECS,
                    },
                    TransitionEffect::ApplyApMode,
                )
            } else {
                // Retry again
                (
                    WifiState::StationConnecting {
                        ssid: ssid.clone(),
                        attempt: attempt + 1,
                        max_attempts: *max_attempts,
                    },
                    TransitionEffect::ProbeConnect { ssid: ssid.clone() },
                )
            }
        }

        // ─── StationConnected ────────────────────────────────────────────────
        (WifiState::StationConnected { ssid, .. }, NetworkEvent::LinkLost) => {
            (
                WifiState::StationReconnecting {
                    ssid: ssid.clone(),
                    attempt: 1,
                    max_attempts: MAX_RETRY_ATTEMPTS,
                },
                TransitionEffect::ProbeConnect { ssid: ssid.clone() },
            )
        }

        // ─── StationReconnecting ─────────────────────────────────────────────
        (WifiState::StationReconnecting { ssid, .. }, NetworkEvent::ConnectionSucceeded { ip, gateway, signal }) => {
            (
                WifiState::StationConnected {
                    ssid: ssid.clone(),
                    ip,
                    gateway,
                    signal,
                },
                TransitionEffect::None,
            )
        }

        (WifiState::StationReconnecting { ssid, attempt, max_attempts }, NetworkEvent::ConnectionAttemptFailed) => {
            if *attempt >= *max_attempts {
                (
                    WifiState::FallbackAp {
                        target_ssid: Some(ssid.clone()),
                        stations_connected: 0,
                        probe_countdown_secs: IDLE_PROBE_COOLDOWN_SECS,
                    },
                    TransitionEffect::ApplyApMode,
                )
            } else {
                (
                    WifiState::StationReconnecting {
                        ssid: ssid.clone(),
                        attempt: attempt + 1,
                        max_attempts: *max_attempts,
                    },
                    TransitionEffect::ProbeConnect { ssid: ssid.clone() },
                )
            }
        }

        // ─── FallbackAp ──────────────────────────────────────────────────────
        (
            WifiState::FallbackAp {
                target_ssid,
                probe_countdown_secs,
                ..
            },
            NetworkEvent::StationsUpdated(count),
        ) => {
            // If user phone/laptop connects to AP, freeze countdown
            let new_countdown = if count > 0 {
                IDLE_PROBE_COOLDOWN_SECS
            } else {
                *probe_countdown_secs
            };
            (
                WifiState::FallbackAp {
                    target_ssid: target_ssid.clone(),
                    stations_connected: count,
                    probe_countdown_secs: new_countdown,
                },
                TransitionEffect::None,
            )
        }

        (
            WifiState::FallbackAp {
                target_ssid,
                stations_connected,
                probe_countdown_secs,
            },
            NetworkEvent::Tick(elapsed),
        ) => {
            // Only count down if 0 stations connected and target SSID is known
            if *stations_connected == 0 && target_ssid.is_some() {
                if *probe_countdown_secs <= elapsed {
                    let ssid = target_ssid.clone().unwrap();
                    (
                        WifiState::StationReconnecting {
                            ssid: ssid.clone(),
                            attempt: 1,
                            max_attempts: MAX_RETRY_ATTEMPTS,
                        },
                        TransitionEffect::ProbeConnect { ssid },
                    )
                } else {
                    (
                        WifiState::FallbackAp {
                            target_ssid: target_ssid.clone(),
                            stations_connected: 0,
                            probe_countdown_secs: probe_countdown_secs.saturating_sub(elapsed),
                        },
                        TransitionEffect::None,
                    )
                }
            } else {
                (current.clone(), TransitionEffect::None)
            }
        }

        // Default no-op
        _ => (current.clone(), TransitionEffect::None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_retry_exhaustion_transitions_to_fallback_ap() {
        let mut state = WifiState::StationConnecting {
            ssid: "TestWiFi".to_string(),
            attempt: 1,
            max_attempts: 6,
        };

        // Attempts 1 to 5 should remain in StationConnecting
        for attempt in 1..6 {
            let (next, effect) = next_state(&state, NetworkEvent::ConnectionAttemptFailed);
            match next {
                WifiState::StationConnecting { attempt: next_att, .. } => {
                    assert_eq!(next_att, attempt + 1);
                }
                _ => panic!("Expected StationConnecting on attempt {}", attempt),
            }
            assert_eq!(effect, TransitionEffect::ProbeConnect { ssid: "TestWiFi".to_string() });
            state = next;
        }

        // 6th failed attempt MUST transition to FallbackAp
        let (next, effect) = next_state(&state, NetworkEvent::ConnectionAttemptFailed);
        match next {
            WifiState::FallbackAp { target_ssid, stations_connected, .. } => {
                assert_eq!(target_ssid, Some("TestWiFi".to_string()));
                assert_eq!(stations_connected, 0);
            }
            _ => panic!("Expected FallbackAp after 6 failed attempts"),
        }
        assert_eq!(effect, TransitionEffect::ApplyApMode);
    }

    #[test]
    fn test_connected_stations_blocks_idle_probing() {
        let state = WifiState::FallbackAp {
            target_ssid: Some("TestWiFi".to_string()),
            stations_connected: 1, // User is connected
            probe_countdown_secs: 5,
        };

        // Tick event when user is connected should NOT trigger probe
        let (next, effect) = next_state(&state, NetworkEvent::Tick(10));
        match next {
            WifiState::FallbackAp { stations_connected, .. } => {
                assert_eq!(stations_connected, 1);
            }
            _ => panic!("Expected to stay in FallbackAp while user is connected"),
        }
        assert_eq!(effect, TransitionEffect::None);
    }

    #[test]
    fn test_zero_stations_triggers_probe_after_cooldown() {
        let state = WifiState::FallbackAp {
            target_ssid: Some("TestWiFi".to_string()),
            stations_connected: 0,
            probe_countdown_secs: 5,
        };

        // Tick 6 seconds (exceeding 5s cooldown) -> trigger probe
        let (next, effect) = next_state(&state, NetworkEvent::Tick(6));
        match next {
            WifiState::StationReconnecting { ssid, attempt, .. } => {
                assert_eq!(ssid, "TestWiFi");
                assert_eq!(attempt, 1);
            }
            _ => panic!("Expected StationReconnecting after cooldown"),
        }
        assert_eq!(effect, TransitionEffect::ProbeConnect { ssid: "TestWiFi".to_string() });
    }

    #[test]
    fn test_link_lost_triggers_reconnect() {
        let state = WifiState::StationConnected {
            ssid: "MyRouter".to_string(),
            ip: "192.168.0.50".to_string(),
            gateway: Some("192.168.0.1".to_string()),
            signal: Some(-55),
        };

        let (next, effect) = next_state(&state, NetworkEvent::LinkLost);
        match next {
            WifiState::StationReconnecting { ssid, attempt, max_attempts } => {
                assert_eq!(ssid, "MyRouter");
                assert_eq!(attempt, 1);
                assert_eq!(max_attempts, 6);
            }
            _ => panic!("Expected StationReconnecting"),
        }
        assert_eq!(effect, TransitionEffect::ProbeConnect { ssid: "MyRouter".to_string() });
    }
}
