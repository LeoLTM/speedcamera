# Backend Plugin System Guide (`src/plugins`)

This guide explains how AI software development agents and human developers must structure and implement backend plugins for the Speed Camera headless daemon.

For frontend UI plugins, see the [Frontend Plugin System Guide](../../frontend/src/plugins/README.md).

---

## 1. Architectural Principles

1. **Zero Core Pollution:** Core crates and modules (`src/main.rs`, `src/db/mod.rs`, `src/web/rpc.rs`, `src/web/routes.rs`) must NEVER directly import or reference internal plugin files, database tables, or models.
2. **Self-Contained Modules:** Each plugin lives in its own subdirectory under `src/plugins/<plugin_id>/`. It owns its data models, SQLite schemas, RPC handlers, and background tasks.
3. **In-Process Trait Extensibility:** Plugins implement the `Plugin` trait defined in [`src/plugins/mod.rs`](./mod.rs). Avoid dynamic `.so` / dlopen / C FFI (Rust lacks a stable ABI across compiler builds and cannot safely share Tokio runtimes or Axum router state across C ABI boundaries on embedded targets like Raspberry Pi).
4. **Lifecycle Hooks:** Plugins extend the application through declarative hooks:
   - Database migrations / table creation (`init`)
   - RPC request dispatching over Socket.io (`register_rpc`)
   - Axum HTTP route extension (`register_routes`)
   - Hardware serial events from ESP32 radar (`on_serial_event`)

---

## 2. Directory Layout

A backend plugin should follow this modular directory structure:

```
src/plugins/<plugin_id>/
├── mod.rs        # Plugin struct implementing `Plugin` trait
├── db.rs         # SQLite table initialization & query functions
├── models.rs     # Data structures, serde serialization/deserialization
└── rpc.rs        # JSON-RPC method handlers registered to RpcRegistry
```

---

## 3. The `Plugin` Trait Contract

Defined in [`src/plugins/mod.rs`](./mod.rs):

```rust
pub trait Plugin: Send + Sync + 'static {
    /// Unique identifier for the plugin (e.g. "laptimer", "weather", "telemetry")
    fn id(&self) -> &'static str;

    /// Human-readable plugin name
    fn name(&self) -> &'static str;

    /// Called once on daemon startup. Initialize tables, state, or background workers.
    fn init(&mut self, ctx: &PluginContext) -> Result<(), Box<dyn std::error::Error>> {
        Ok(())
    }

    /// Register custom RPC handlers accessible via web Socket.io client
    fn register_rpc(&self, registry: &mut RpcRegistry) {}

    /// Extend Axum HTTP router with custom REST/streaming endpoints
    fn register_routes(
        &self,
        router: Router<Arc<crate::web::rpc::RpcContext>>,
    ) -> Router<Arc<crate::web::rpc::RpcContext>> {
        router
    }

    /// Process serial messages received from ESP32 radar/sensors
    fn on_serial_event(&self, msg: &SerialStatusPayload, ctx: &PluginContext) {}
}
```

### The `PluginContext` Object

The daemon passes a cloned `PluginContext` providing access to core services:

```rust
pub struct PluginContext {
    pub config: AppConfig,                   // Server port, data directories, mock flags
    pub db: Database,                        // SQLite thread-safe connection pool
    pub store: FileStore,                    // File storage & image compression engine
    pub camera: Arc<CameraService>,          // Industrial GigE Aravis / Mock camera
    pub serial: Arc<SerialService>,          // ESP32 Serial port connection & sender
    pub armed: Arc<AtomicBool>,              // Global system armed flag
    pub armed_tx: broadcast::Sender<bool>,   // Broadcast channel for armed state changes
}
```

---

## 4. Step-by-Step Implementation Guide

### Step 1: Define Data Models (`models.rs`)

Define your plugin-specific structs with Serde camelCase attributes for JavaScript web client interoperability:

```rust
// src/plugins/example/models.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExampleRecord {
    pub id: i64,
    pub title: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateExampleInput {
    pub title: String,
}
```

### Step 2: Implement Database Operations (`db.rs`)

Create tables inside `init_tables` using `CREATE TABLE IF NOT EXISTS`. Never modify `src/db/mod.rs`!

```rust
// src/plugins/example/db.rs
use super::models::{CreateExampleInput, ExampleRecord};
use chrono::Utc;
use rusqlite::{params, Connection, Result};

pub fn init_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS example_records (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            title      TEXT    NOT NULL,
            createdAt  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_example_created ON example_records(createdAt);"
    )?;
    Ok(())
}

pub fn create_record(conn: &Connection, input: &CreateExampleInput) -> Result<ExampleRecord> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO example_records (title, createdAt) VALUES (?, ?)",
        params![input.title, now],
    )?;
    let id = conn.last_insert_rowid();
    Ok(ExampleRecord {
        id,
        title: input.title.clone(),
        created_at: now,
    })
}
```

### Step 3: Register RPC Methods (`rpc.rs`)

Register methods into `RpcRegistry`. Methods receive `(ctx: PluginContext, params: serde_json::Value)` and return an async `Result<serde_json::Value, String>`.

```rust
// src/plugins/example/rpc.rs
use super::db;
use super::models::CreateExampleInput;
use crate::plugins::RpcRegistry;
use serde_json::json;

pub fn register_rpc_methods(registry: &mut RpcRegistry) {
    registry.register("createExampleRecord", |ctx, params| async move {
        let input: CreateExampleInput = serde_json::from_value(params).map_err(|e| e.to_string())?;
        let db = ctx.db.clone();

        let record = tokio::task::spawn_blocking(move || {
            let conn = db.lock();
            db::create_record(&conn, &input)
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;

        Ok(serde_json::to_value(record).unwrap())
    });
}
```

### Step 4: Implement the `Plugin` Trait (`mod.rs`)

Glue the components together in `src/plugins/<plugin_id>/mod.rs`:

```rust
// src/plugins/example/mod.rs
pub mod db;
pub mod models;
pub mod rpc;

use crate::plugins::{Plugin, PluginContext, RpcRegistry};

pub struct ExamplePlugin;

impl ExamplePlugin {
    pub fn new() -> Self {
        Self
    }
}

impl Plugin for ExamplePlugin {
    fn id(&self) -> &'static str {
        "example"
    }

    fn name(&self) -> &'static str {
        "Example Plugin"
    }

    fn init(&mut self, ctx: &PluginContext) -> Result<(), Box<dyn std::error::Error>> {
        let conn = ctx.db.lock();
        db::init_tables(&conn)?;
        tracing::info!("[plugin:example] Database tables initialized");
        Ok(())
    }

    fn register_rpc(&self, registry: &mut RpcRegistry) {
        rpc::register_rpc_methods(registry);
        tracing::info!("[plugin:example] RPC methods registered");
    }
}
```

### Step 5: Register the Plugin in `src/plugins/mod.rs` & `src/main.rs`

1. Add your module export in [`src/plugins/mod.rs`](./mod.rs):
   ```rust
   pub mod example;
   pub mod laptimer;
   ```

2. Register the plugin instance in `src/main.rs`:
   ```rust
   plugin_reg.register(Box::new(plugins::example::ExamplePlugin::new()));
   ```

---

## 5. Adding HTTP REST Endpoints

If your plugin needs custom REST endpoints (e.g. `GET /api/example/export`):

```rust
impl Plugin for ExamplePlugin {
    fn register_routes(
        &self,
        router: axum::Router<std::sync::Arc<crate::web::rpc::RpcContext>>,
    ) -> axum::Router<std::sync::Arc<crate::web::rpc::RpcContext>> {
        router.route(
            "/api/example/ping",
            axum::routing::get(|| async { "pong from example plugin" }),
        )
    }
}
```

---

## 6. Verification Checklist for AI Agents

Before concluding any plugin implementation task:

- [ ] `cargo check` passes with 0 errors and 0 warnings.
- [ ] `cargo test` passes.
- [ ] Registered RPC methods are reachable via Socket.io `rpc` request.
- [ ] Plugin is listed in `getPlugins` RPC response.
- [ ] Database tables are auto-created in WAL mode on startup.
- [ ] No core files (`src/db/mod.rs`, `src/web/rpc.rs`) contain direct imports of plugin types.
