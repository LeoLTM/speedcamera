pub mod db;
pub mod models;
pub mod rpc;

use crate::plugins::{Plugin, PluginContext, RpcRegistry};

pub struct LapTimerPlugin;

impl LapTimerPlugin {
    pub fn new() -> Self {
        Self
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
        tracing::info!("[plugin:laptimer] Initialized database tables");
        Ok(())
    }

    fn register_rpc(&self, registry: &mut RpcRegistry) {
        rpc::register_rpc_methods(registry);
        tracing::info!("[plugin:laptimer] Registered RPC methods");
    }
}
