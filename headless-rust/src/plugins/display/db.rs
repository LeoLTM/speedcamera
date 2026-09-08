use super::models::DisplayConfig;
use rusqlite::{params, Connection, Result};

// ponytail: simple single-row json config persistence avoids complex migration schemas
pub fn init_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS display_settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );"
    )?;
    Ok(())
}

pub fn get_config(conn: &Connection) -> Result<DisplayConfig> {
    let mut stmt = conn.prepare("SELECT value FROM display_settings WHERE key = 'config' LIMIT 1")?;
    let mut rows = stmt.query([])?;

    if let Some(row) = rows.next()? {
        let json_str: String = row.get(0)?;
        if let Ok(cfg) = serde_json::from_str::<DisplayConfig>(&json_str) {
            return Ok(cfg);
        }
    }

    // Return default if not found or corrupted
    Ok(DisplayConfig::default())
}

pub fn save_config(conn: &Connection, config: &DisplayConfig) -> Result<()> {
    let json_str = serde_json::to_string(config).map_err(|e| {
        rusqlite::Error::ToSqlConversionFailure(Box::new(e))
    })?;

    conn.execute(
        "INSERT OR REPLACE INTO display_settings (key, value) VALUES ('config', ?)",
        params![json_str],
    )?;
    Ok(())
}
