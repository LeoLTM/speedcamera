pub mod settings;
pub mod violations;

use rusqlite::{Connection, Result};
use std::path::Path;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn new(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;

        // WAL mode + foreign keys for high concurrency & safety on Pi
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;",
        )?;

        // Core tables
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS speed_violations (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp     TEXT    NOT NULL,
                measuredSpeed REAL    NOT NULL,
                maxSpeed      REAL    NOT NULL,
                direction     TEXT    NOT NULL DEFAULT 'forward',
                imagePath     TEXT    NOT NULL,
                createdAt     TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_timestamp ON speed_violations(timestamp);

            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
        )?;

        // Initialize default settings if not existing
        settings::init_defaults(&conn)?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap()
    }
}
