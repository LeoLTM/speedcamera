use crate::models::AppSettings;
use rusqlite::{params, Connection, Result};
use std::collections::HashMap;

pub fn init_defaults(conn: &Connection) -> Result<()> {
    // Purge legacy maxSpeed from database so ESP is the single source of truth
    let _ = conn.execute("DELETE FROM settings WHERE key = 'maxSpeed'", []);

    let defaults = [
        ("selectedPort", ""),
        ("cameraExposure", "5000"),
        ("cameraGain", "0"),
        ("strobeLineDuration", "5000"),
        ("pixelFormat", "Mono"),
        ("exposureAuto", "Off"),
        ("gainAuto", "Off"),
        ("frameRate", "30"),
        ("cameraWidth", "1280"),
        ("cameraHeight", "1024"),
        ("blackLevel", "0"),
        ("lapMode", "single"),
        ("lapSaveImages", "true"),
        ("lapDirFilter", "both"),
        ("teableUrl", ""),
        ("teableToken", ""),
        ("teableUserName", ""),
        ("teableUserEmail", ""),
        ("teableUserAvatar", ""),
        ("teableSpaceId", ""),
        ("teableBaseId", ""),
        ("teableTableId", ""),
        ("teableSyncEnabled", "false"),
        ("githubToken", ""),
        ("skinMeasuringLocation", ""),
    ];

    let mut stmt = conn.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)")?;
    for (k, v) in defaults {
        stmt.execute(params![k, v])?;
    }
    Ok(())
}

pub fn get_settings(conn: &Connection) -> Result<AppSettings> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    let mut map = HashMap::new();
    for item in rows {
        if let Ok((k, v)) = item {
            map.insert(k, v);
        }
    }

    let get_str = |k: &str, default: &str| map.get(k).cloned().unwrap_or_else(|| default.to_string());
    let get_f64 = |k: &str, default: f64| {
        map.get(k)
            .and_then(|v| v.parse::<f64>().ok())
            .unwrap_or(default)
    };
    let get_i64 = |k: &str, default: i64| {
        map.get(k)
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(default)
    };

    Ok(AppSettings {
        max_speed: 30.0, // Default fallback; ESP is single source of truth and not stored in DB
        selected_port: get_str("selectedPort", ""),
        camera_exposure: get_f64("cameraExposure", 5000.0),
        camera_gain: get_f64("cameraGain", 0.0),
        strobe_line_duration: get_f64("strobeLineDuration", 5000.0),
        pixel_format: get_str("pixelFormat", "Mono"),
        exposure_auto: get_str("exposureAuto", "Off"),
        gain_auto: get_str("gainAuto", "Off"),
        frame_rate: get_f64("frameRate", 30.0),
        camera_width: get_i64("cameraWidth", 1280),
        camera_height: get_i64("cameraHeight", 1024),
        black_level: get_f64("blackLevel", 0.0),
        lap_mode: get_str("lapMode", "single"),
        lap_save_images: get_str("lapSaveImages", "true"),
        lap_dir_filter: get_str("lapDirFilter", "both"),
        teable_url: get_str("teableUrl", ""),
        teable_token: get_str("teableToken", ""),
        teable_user_name: get_str("teableUserName", ""),
        teable_user_email: get_str("teableUserEmail", ""),
        teable_user_avatar: get_str("teableUserAvatar", ""),
        teable_space_id: get_str("teableSpaceId", ""),
        teable_base_id: get_str("teableBaseId", ""),
        teable_table_id: get_str("teableTableId", ""),
        teable_sync_enabled: get_str("teableSyncEnabled", "false"),
        github_token: get_str("githubToken", ""),
        skin_measuring_location: get_str("skinMeasuringLocation", ""),
    })
}

pub fn save_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    if key == "maxSpeed" {
        // Speed limit is not stored in DB; ESP is single source of truth
        return Ok(());
    }
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_max_speed_not_stored_in_db() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);"
        ).unwrap();

        // Simulate legacy maxSpeed existing
        conn.execute("INSERT INTO settings (key, value) VALUES ('maxSpeed', '120')", []).unwrap();

        init_defaults(&conn).unwrap();

        // Legacy maxSpeed must be purged by init_defaults
        let count: i64 = conn.query_row("SELECT count(*) FROM settings WHERE key = 'maxSpeed'", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);

        // Attempting to save maxSpeed must be a no-op
        save_setting(&conn, "maxSpeed", "80").unwrap();
        let count_after: i64 = conn.query_row("SELECT count(*) FROM settings WHERE key = 'maxSpeed'", [], |r| r.get(0)).unwrap();
        assert_eq!(count_after, 0);
    }
}
