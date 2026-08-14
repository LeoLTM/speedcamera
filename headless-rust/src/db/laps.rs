use crate::models::{Lap, LapSession, LapSessionWithLaps, SaveLapInput};
use chrono::Utc;
use rusqlite::{params, Connection, Result};

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
            sessionId, lapNumber, startTimestamp, endTimestamp, durationMs,
            speedAtStart, speedAtEnd, startImagePath, endImagePath
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            input.session_id,
            input.lap_number,
            input.start_timestamp,
            input.end_timestamp,
            input.duration_ms,
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
        speed_at_start: input.speed_at_start,
        speed_at_end: input.speed_at_end,
        start_image_path: start_image_path.map(|s| s.to_string()),
        end_image_path: end_image_path.map(|s| s.to_string()),
    })
}

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
    for s in session_rows {
        let session = s?;
        let laps = get_laps_for_session(conn, session.id)?;
        sessions.push(LapSessionWithLaps {
            id: session.id,
            started_at: session.started_at,
            ended_at: session.ended_at,
            lap_mode: session.lap_mode,
            created_at: session.created_at,
            laps,
        });
    }

    Ok((sessions, total))
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

fn get_laps_for_session(conn: &Connection, session_id: i64) -> Result<Vec<Lap>> {
    let mut stmt = conn.prepare(
        "SELECT id, sessionId, lapNumber, startTimestamp, endTimestamp, durationMs,
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
            speed_at_start: row.get(6)?,
            speed_at_end: row.get(7)?,
            start_image_path: row.get(8)?,
            end_image_path: row.get(9)?,
        })
    })?;

    let mut laps = Vec::new();
    for l in rows {
        laps.push(l?);
    }
    Ok(laps)
}

pub fn delete_lap_session(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM lap_sessions WHERE id = ?", params![id])?;
    Ok(())
}

pub fn delete_lap(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM laps WHERE id = ?", params![id])?;
    Ok(())
}
