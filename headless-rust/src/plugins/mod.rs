pub mod alignment;
pub mod display;
pub mod laptimer;

use crate::camera::CameraService;
use crate::config::AppConfig;
use crate::db::Database;
use crate::models::SerialStatusPayload;
use crate::serial::SerialService;
use crate::storage::FileStore;
use axum::Router;
use serde_json::Value;
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tokio::sync::broadcast;

// ponytail: minimal context passed to plugins without leaking web server internals
#[derive(Clone)]
#[allow(dead_code)]
pub struct PluginContext {
    pub config: AppConfig,
    pub db: Database,
    pub store: FileStore,
    pub camera: Arc<CameraService>,
    pub serial: Arc<SerialService>,
    pub armed: Arc<AtomicBool>,
    pub armed_tx: broadcast::Sender<bool>,
}

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;
pub type RpcHandler = Box<dyn Fn(PluginContext, Value) -> BoxFuture<'static, Result<Value, String>> + Send + Sync>;

// ponytail: simple rpc method map instead of complex dynamic reflection
#[derive(Default)]
pub struct RpcRegistry {
    handlers: HashMap<String, RpcHandler>,
}

impl RpcRegistry {
    pub fn new() -> Self {
        Self {
            handlers: HashMap::new(),
        }
    }

    pub fn register<F, Fut>(&mut self, method: &str, handler: F)
    where
        F: Fn(PluginContext, Value) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<Value, String>> + Send + 'static,
    {
        self.handlers.insert(
            method.to_string(),
            Box::new(move |ctx, params| Box::pin(handler(ctx, params))),
        );
    }

    pub async fn dispatch(&self, method: &str, ctx: &PluginContext, params: Value) -> Option<Result<Value, String>> {
        if let Some(handler) = self.handlers.get(method) {
            Some(handler(ctx.clone(), params).await)
        } else {
            None
        }
    }

    #[allow(dead_code)]
    pub fn has_method(&self, method: &str) -> bool {
        self.handlers.contains_key(method)
    }
}

pub trait Plugin: Send + Sync + 'static {
    fn id(&self) -> &'static str;
    fn name(&self) -> &'static str;
    fn init(&mut self, _ctx: &PluginContext) -> Result<(), Box<dyn std::error::Error>> {
        Ok(())
    }
    fn register_rpc(&self, _registry: &mut RpcRegistry) {}
    fn register_routes(
        &self,
        router: Router<Arc<crate::web::rpc::RpcContext>>,
    ) -> Router<Arc<crate::web::rpc::RpcContext>> {
        router
    }
    fn on_serial_event(&self, _msg: &SerialStatusPayload, _ctx: &PluginContext) {}
}

pub struct PluginRegistry {
    plugins: Vec<Box<dyn Plugin>>,
    rpc_registry: Arc<RpcRegistry>,
    ctx: Option<PluginContext>,
}

impl PluginRegistry {
    pub fn new() -> Self {
        Self {
            plugins: Vec::new(),
            rpc_registry: Arc::new(RpcRegistry::new()),
            ctx: None,
        }
    }

    pub fn register(&mut self, plugin: Box<dyn Plugin>) {
        self.plugins.push(plugin);
    }

    pub fn init(&mut self, ctx: PluginContext) -> Result<(), Box<dyn std::error::Error>> {
        let mut rpc = RpcRegistry::new();
        for plugin in &mut self.plugins {
            plugin.init(&ctx)?;
            plugin.register_rpc(&mut rpc);
        }
        self.rpc_registry = Arc::new(rpc);
        self.ctx = Some(ctx);
        Ok(())
    }

    pub fn register_routes(
        &self,
        mut router: Router<Arc<crate::web::rpc::RpcContext>>,
    ) -> Router<Arc<crate::web::rpc::RpcContext>> {
        for plugin in &self.plugins {
            router = plugin.register_routes(router);
        }
        router
    }

    pub fn list_plugins(&self) -> Vec<serde_json::Value> {
        self.plugins
            .iter()
            .map(|p| {
                serde_json::json!({
                    "id": p.id(),
                    "name": p.name(),
                    "enabled": true
                })
            })
            .collect()
    }

    pub async fn handle_rpc(&self, method: &str, params: Value) -> Option<Result<Value, String>> {
        if let Some(ref ctx) = self.ctx {
            self.rpc_registry.dispatch(method, ctx, params).await
        } else {
            None
        }
    }

    pub fn on_serial_event(&self, msg: &SerialStatusPayload) {
        if let Some(ref ctx) = self.ctx {
            for plugin in &self.plugins {
                plugin.on_serial_event(msg, ctx);
            }
        }
    }
}
