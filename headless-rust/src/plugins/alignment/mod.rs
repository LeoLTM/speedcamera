pub mod models;
pub mod rpc;

use crate::models::SerialStatusPayload;
use crate::plugins::{Plugin, PluginContext, RpcRegistry};
use std::sync::{Arc, Mutex};

// ponytail: in-memory state tracking live light barrier states
#[derive(Debug, Clone)]
pub struct AlignmentState {
    pub active: bool,
    pub sensor1_interrupted: bool,
    pub sensor2_interrupted: bool,
    pub last_update_ms: Option<i64>,
}

impl Default for AlignmentState {
    fn default() -> Self {
        Self {
            active: false,
            sensor1_interrupted: false,
            sensor2_interrupted: false,
            last_update_ms: None,
        }
    }
}

pub struct AlignmentPlugin {
    state: Arc<Mutex<AlignmentState>>,
}

impl AlignmentPlugin {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(AlignmentState::default())),
        }
    }
}

impl Plugin for AlignmentPlugin {
    fn id(&self) -> &'static str {
        "alignment"
    }

    fn name(&self) -> &'static str {
        "Sensor Alignment"
    }

    fn init(&mut self, _ctx: &PluginContext) -> Result<(), Box<dyn std::error::Error>> {
        tracing::info!("[plugin:alignment] Initialized alignment plugin");
        Ok(())
    }

    fn register_rpc(&self, registry: &mut RpcRegistry) {
        rpc::register_rpc_methods(registry, self.state.clone());
        tracing::info!("[plugin:alignment] Registered RPC methods");
    }

    fn on_serial_event(&self, msg: &SerialStatusPayload, _ctx: &PluginContext) {
        if let SerialStatusPayload::BarrierStatus {
            sensor1_interrupted,
            sensor2_interrupted,
            timestamp,
        } = msg
        {
            let mut s = self.state.lock().unwrap();
            s.sensor1_interrupted = *sensor1_interrupted;
            s.sensor2_interrupted = *sensor2_interrupted;
            s.last_update_ms = Some(*timestamp);
        }
    }
}
