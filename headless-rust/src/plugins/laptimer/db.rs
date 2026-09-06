use super::models::{Lap, LapSession, LapSessionWithLaps, SaveLapInput};
use chrono::Utc;
use rusqlite::{params, Connection, Result};

pub fn init_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS lap_sessions (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            startedAt TEXT    NOT NULL,
            endedAt   TEXT,
            lapMode   TEXT    NOT NULL,
            createdAt TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_lap_sessions_started ON lap_sessions(startedAt);

        CREATE TABLE IF NOT EXISTS laps (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            sessionId        INTEGER NOT NULL REFERENCES lap_sessions(id) ON DELETE CASCADE,
            lapNumber        INTEGER NOT NULL,
            startTimestamp   INTEGER NOT NULL,
            endTimestamp     INTEGER NOT NULL,
            durationMs       REAL    NOT NULL,
            durationUs       INTEGER,
            speedAtStart     REAL    NOT NULL,
            speedAtEnd       REAL    NOT NULL,
            startImagePath   TEXT,
            endImagePath     TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_laps_session ON laps(sessionId);",
    )?;
    // Safe auto-migration for existing databases
    let _ = conn.execute("ALTER TABLE laps ADD COLUMN durationUs INTEGER", []);
    Ok(())
}

pub fn create_lap_session(conn: &Connection, lap_mode: &str) -> Result<LapSession> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO lap_sessions (startedAt, lapMode, createdAt) VALUES (?, ?, ?)",
        params![now, lap_mode, now],
    )?;

    let id = conn.last_insert_rowid();

    Ok(LapSession {
        id,
        started_at: now.clone(),
        ended_at: None,
        lap_mode: lap_mode.to_string(),
        created_at: now,
    })
}

pub fn close_lap_session(conn: &Connection, id: i64) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE lap_sessions SET endedAt = ? WHERE id = ?",
        params![now, id],
    )?;
    Ok(())
}

pub fn insert_lap(
    conn: &Connection,
    input: &SaveLapInput,
    start_image_path: Option<&str>,
    end_image_path: Option<&str>,
) -> Result<Lap> {
    conn.execute(
        "INSERT INTO laps (
            sessionId, lapNumber, startTimestamp, endTimestamp, durationMs, durationUs,
            speedAtStart, speedAtEnd, startImagePath, endImagePath
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            input.session_id,
            input.lap_number,
            input.start_timestamp,
            input.end_timestamp,
            input.duration_ms,
            input.duration_us,
            input.speed_at_start,
            input.speed_at_end,
            start_image_path,
            end_image_path,
        ],
    )?;

    let id = conn.last_insert_rowid();

    Ok(Lap {
        id,
        session_id: input.session_id,
        lap_number: input.lap_number,
        start_timestamp: input.start_timestamp,
        end_timestamp: input.end_timestamp,
        duration_ms: input.duration_ms,
        duration_us: input.duration_us,
        speed_at_start: input.speed_at_start,
        speed_at_end: input.speed_at_end,
        start_image_path: start_image_path.map(|s| s.to_string()),
        end_image_path: end_image_path.map(|s| s.to_string()),
    })
}

// ponytail: single batched query for laps to avoid N+1 query overhead
pub fn get_lap_sessions(
    conn: &Connection,
    page: i64,
    limit: i64,
) -> Result<(Vec<LapSessionWithLaps>, i64)> {
    let mut count_stmt = conn.prepare("SELECT COUNT(*) FROM lap_sessions")?;
    let total: i64 = count_stmt.query_row([], |r| r.get(0))?;

    let offset = (page.max(1) - 1) * limit;
    let mut session_stmt = conn.prepare(
        "SELECT id, startedAt, endedAt, lapMode, createdAt
         FROM lap_sessions ORDER BY startedAt DESC LIMIT ? OFFSET ?",
    )?;

    let session_rows = session_stmt.query_map(params![limit, offset], |row| {
        Ok(LapSession {
            id: row.get(0)?,
            started_at: row.get(1)?,
            ended_at: row.get(2)?,
            lap_mode: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?;

    let mut sessions = Vec::new();
    let mut session_map: std::collections::HashMap<i64, Vec<Lap>> = std::collections::HashMap::new();
    for s in session_rows {
        let session = s?;
        session_map.insert(session.id, Vec::new());
        sessions.push(session);
    }

    if !sessions.is_empty() {
        let placeholders: Vec<String> = sessions.iter().map(|_| "?".to_string()).collect();
        let sql = format!(
            "SELECT id, sessionId, lapNumber, startTimestamp, endTimestamp, durationMs, durationUs,
                    speedAtStart, speedAtEnd, startImagePath, endImagePath
             FROM laps WHERE sessionId IN ({}) ORDER BY lapNumber ASC",
            placeholders.join(",")
        );
        let mut stmt = conn.prepare(&sql)?;
        let id_params: Vec<&dyn rusqlite::ToSql> =
            sessions.iter().map(|s| &s.id as &dyn rusqlite::ToSql).collect();
        let lap_rows = stmt.query_map(id_params.as_slice(), |row| {
            Ok(Lap {
                id: row.get(0)?,
                session_id: row.get(1)?,
                lap_number: row.get(2)?,
                start_timestamp: row.get(3)?,
                end_timestamp: row.get(4)?,
                duration_ms: row.get(5)?,
                duration_us: row.get(6)?,
                speed_at_start: row.get(7)?,
                speed_at_end: row.get(8)?,
                start_image_path: row.get(9)?,
                end_image_path: row.get(10)?,
            })
        })?;

        for lap in lap_rows {
            let l = lap?;
            if let Some(vec) = session_map.get_mut(&l.session_id) {
                vec.push(l);
            }
        }
    }

    let result = sessions
        .into_iter()
        .map(|s| {
            let laps = session_map.remove(&s.id).unwrap_or_default();
            LapSessionWithLaps {
                id: s.id,
                started_at: s.started_at,
                ended_at: s.ended_at,
                lap_mode: s.lap_mode,
                created_at: s.created_at,
                laps,
            }
        })
        .collect();

    Ok((result, total))
}

pub fn get_active_session(conn: &Connection) -> Result<Option<LapSession>> {
    let mut stmt = conn.prepare(
        "SELECT id, startedAt, endedAt, lapMode, createdAt FROM lap_sessions WHERE endedAt IS NULL ORDER BY id DESC LIMIT 1",
    )?;
    let mut rows = stmt.query_map([], |row| {
        Ok(LapSession {
            id: row.get(0)?,
            started_at: row.get(1)?,
            ended_at: row.get(2)?,
            lap_mode: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?;

    if let Some(row) = rows.next() {
        Ok(Some(row?))
    } else {
        Ok(None)
    }
}

pub fn get_lap_session_by_id(conn: &Connection, id: i64) -> Result<Option<LapSessionWithLaps>> {
    let mut stmt = conn.prepare(
        "SELECT id, startedAt, endedAt, lapMode, createdAt FROM lap_sessions WHERE id = ?",
    )?;

    let mut rows = stmt.query_map(params![id], |row| {
        Ok(LapSession {
            id: row.get(0)?,
            started_at: row.get(1)?,
            ended_at: row.get(2)?,
            lap_mode: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?;

    if let Some(row) = rows.next() {
        let s = row?;
        let laps = get_laps_for_session(conn, s.id)?;
        Ok(Some(LapSessionWithLaps {
            id: s.id,
            started_at: s.started_at,
            ended_at: s.ended_at,
            lap_mode: s.lap_mode,
            created_at: s.created_at,
            laps,
        }))
    } else {
        Ok(None)
    }
}

pub fn get_laps_for_session(conn: &Connection, session_id: i64) -> Result<Vec<Lap>> {
    let mut stmt = conn.prepare(
        "SELECT id, sessionId, lapNumber, startTimestamp, endTimestamp, durationMs, durationUs,
                speedAtStart, speedAtEnd, startImagePath, endImagePath
         FROM laps WHERE sessionId = ? ORDER BY lapNumber ASC",
    )?;

    let rows = stmt.query_map(params![session_id], |row| {
        Ok(Lap {
            id: row.get(0)?,
            session_id: row.get(1)?,
            lap_number: row.get(2)?,
            start_timestamp: row.get(3)?,
            end_timestamp: row.get(4)?,
            duration_ms: row.get(5)?,
            duration_us: row.get(6)?,
            speed_at_start: row.get(7)?,
            speed_at_end: row.get(8)?,
            start_image_path: row.get(9)?,
            end_image_path: row.get(10)?,
        })
    })?;

    let mut laps = Vec::new();
    for l in rows {
        laps.push(l?);
    }
    Ok(laps)
}

pub fn get_lap_image_paths_for_session(conn: &Connection, session_id: i64) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT startImagePath, endImagePath FROM laps WHERE sessionId = ?")?;
    let rows = stmt.query_map(params![session_id], |row| {
        let start: Option<String> = row.get(0)?;
        let end: Option<String> = row.get(1)?;
        Ok((start, end))
    })?;

    let mut paths = Vec::new();
    for r in rows {
        let (start, end) = r?;
        if let Some(s) = start {
            paths.push(s);
        }
        if let Some(e) = end {
            paths.push(e);
        }
    }
    Ok(paths)
}

pub fn get_lap_image_paths_for_lap(conn: &Connection, lap_id: i64) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT startImagePath, endImagePath FROM laps WHERE id = ?")?;
    let mut rows = stmt.query_map(params![lap_id], |row| {
        let start: Option<String> = row.get(0)?;
        let end: Option<String> = row.get(1)?;
        Ok((start, end))
    })?;

    let mut paths = Vec::new();
    if let Some(r) = rows.next() {
        let (start, end) = r?;
        if let Some(s) = start {
            paths.push(s);
        }
        if let Some(e) = end {
            paths.push(e);
        }
    }
    Ok(paths)
}

pub fn delete_lap_session(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM lap_sessions WHERE id = ?", params![id])?;
    Ok(())
}

pub fn delete_lap(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM laps WHERE id = ?", params![id])?;
    Ok(())
}
