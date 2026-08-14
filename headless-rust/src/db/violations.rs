use crate::models::{SaveViolationInput, Violation, ViolationPage, ViolationQuery};
use chrono::Utc;
use rusqlite::{params, Connection, Result};

pub fn insert_violation(
    conn: &Connection,
    input: &SaveViolationInput,
    image_path: &str,
) -> Result<Violation> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO speed_violations (timestamp, measuredSpeed, maxSpeed, direction, imagePath, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)",
        params![
            now,
            input.measured_speed,
            input.max_speed,
            input.direction,
            image_path,
            now
        ],
    )?;

    let id = conn.last_insert_rowid();

    Ok(Violation {
        id,
        timestamp: now.clone(),
        measured_speed: input.measured_speed,
        max_speed: input.max_speed,
        direction: input.direction.clone(),
        image_path: image_path.to_string(),
        created_at: now,
    })
}

pub fn query_violations(conn: &Connection, q: &ViolationQuery) -> Result<ViolationPage> {
    let mut conditions = Vec::new();
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(from) = &q.date_from {
        conditions.push("timestamp >= ?");
        params_vec.push(Box::new(from.clone()));
    }
    if let Some(to) = &q.date_to {
        conditions.push("timestamp <= ?");
        params_vec.push(Box::new(to.clone()));
    }
    if let Some(min) = q.min_speed {
        conditions.push("measuredSpeed >= ?");
        params_vec.push(Box::new(min));
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let count_query = format!("SELECT COUNT(*) FROM speed_violations {}", where_clause);
    let mut count_stmt = conn.prepare(&count_query)?;
    let rusqlite_params: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();
    let total: i64 = count_stmt.query_row(rusqlite_params.as_slice(), |r| r.get(0))?;

    let offset = (q.page.max(1) - 1) * q.limit;
    let data_query = format!(
        "SELECT id, timestamp, measuredSpeed, maxSpeed, direction, imagePath, createdAt
         FROM speed_violations {} ORDER BY timestamp DESC LIMIT ? OFFSET ?",
        where_clause
    );

    let mut data_stmt = conn.prepare(&data_query)?;
    let mut query_params = params_vec;
    query_params.push(Box::new(q.limit));
    query_params.push(Box::new(offset));

    let final_params: Vec<&dyn rusqlite::ToSql> = query_params.iter().map(|b| b.as_ref()).collect();

    let rows = data_stmt.query_map(final_params.as_slice(), |row| {
        Ok(Violation {
            id: row.get(0)?,
            timestamp: row.get(1)?,
            measured_speed: row.get(2)?,
            max_speed: row.get(3)?,
            direction: row.get(4)?,
            image_path: row.get(5)?,
            created_at: row.get(6)?,
        })
    })?;

    let mut violations = Vec::new();
    for v in rows {
        violations.push(v?);
    }

    Ok(ViolationPage { violations, total })
}

pub fn get_violation_by_id(conn: &Connection, id: i64) -> Result<Option<Violation>> {
    let mut stmt = conn.prepare(
        "SELECT id, timestamp, measuredSpeed, maxSpeed, direction, imagePath, createdAt
         FROM speed_violations WHERE id = ?",
    )?;

    let mut rows = stmt.query_map(params![id], |row| {
        Ok(Violation {
            id: row.get(0)?,
            timestamp: row.get(1)?,
            measured_speed: row.get(2)?,
            max_speed: row.get(3)?,
            direction: row.get(4)?,
            image_path: row.get(5)?,
            created_at: row.get(6)?,
        })
    })?;

    if let Some(row) = rows.next() {
        Ok(Some(row?))
    } else {
        Ok(None)
    }
}

pub fn remove_violation(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM speed_violations WHERE id = ?", params![id])?;
    Ok(())
}

pub fn export_csv(
    conn: &Connection,
    date_from: Option<&str>,
    date_to: Option<&str>,
    min_speed: Option<f64>,
) -> Result<String> {
    let mut conditions = Vec::new();
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(from) = date_from {
        conditions.push("timestamp >= ?");
        params_vec.push(Box::new(from.to_string()));
    }
    if let Some(to) = date_to {
        conditions.push("timestamp <= ?");
        params_vec.push(Box::new(to.to_string()));
    }
    if let Some(min) = min_speed {
        conditions.push("measuredSpeed >= ?");
        params_vec.push(Box::new(min));
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let query = format!(
        "SELECT id, timestamp, measuredSpeed, maxSpeed, direction, imagePath, createdAt
         FROM speed_violations {} ORDER BY timestamp DESC",
        where_clause
    );

    let mut stmt = conn.prepare(&query)?;
    let slice: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();

    let rows = stmt.query_map(slice.as_slice(), |row| {
        Ok(Violation {
            id: row.get(0)?,
            timestamp: row.get(1)?,
            measured_speed: row.get(2)?,
            max_speed: row.get(3)?,
            direction: row.get(4)?,
            image_path: row.get(5)?,
            created_at: row.get(6)?,
        })
    })?;

    let mut csv = String::from("id,timestamp,measuredSpeed,maxSpeed,direction,imagePath,createdAt\n");
    for item in rows {
        let v = item?;
        csv.push_str(&format!(
            "{},\"{}\",{},{},{},\"{}\",\"{}\"\n",
            v.id, v.timestamp, v.measured_speed, v.max_speed, v.direction, v.image_path, v.created_at
        ));
    }

    Ok(csv)
}
