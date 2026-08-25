use crate::models::{
    SyncLapInput, TeableBase, TeableSchemaCheck, TeableSpace, TeableTable, TeableUser,
};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde_json::json;

pub struct TeableClient {
    client: reqwest::Client,
}

impl TeableClient {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .danger_accept_invalid_certs(true)
                .build()
                .unwrap_or_default(),
        }
    }

    fn headers(token: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        if let Ok(val) = HeaderValue::from_str(&format!("Bearer {}", token)) {
            headers.insert(AUTHORIZATION, val);
        }
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        headers
    }

    pub async fn test_connection(&self, url: &str, token: &str) -> Result<TeableUser, String> {
        let base = url.trim_end_matches('/');
        let endpoint = format!("{}/api/user/me", base);

        let res = self
            .client
            .get(&endpoint)
            .headers(Self::headers(token))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !res.status().is_success() {
            return Err(format!("HTTP {}", res.status()));
        }

        let user: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        Ok(TeableUser {
            id: user["id"].as_str().unwrap_or("").to_string(),
            name: user["name"].as_str().unwrap_or("").to_string(),
            email: user["email"].as_str().unwrap_or("").to_string(),
            avatar: user["avatar"].as_str().map(|s| s.to_string()),
        })
    }

    pub async fn list_spaces(&self, url: &str, token: &str) -> Result<Vec<TeableSpace>, String> {
        let base = url.trim_end_matches('/');
        let endpoint = format!("{}/api/space", base);

        let res = self
            .client
            .get(&endpoint)
            .headers(Self::headers(token))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        let list = json
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|s| {
                        Some(TeableSpace {
                            id: s["id"].as_str()?.to_string(),
                            name: s["name"].as_str()?.to_string(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(list)
    }

    pub async fn list_bases(&self, url: &str, token: &str, space_id: &str) -> Result<Vec<TeableBase>, String> {
        let base = url.trim_end_matches('/');
        let endpoint = format!("{}/api/space/{}/base", base, space_id);

        let res = self
            .client
            .get(&endpoint)
            .headers(Self::headers(token))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        let list = json
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|b| {
                        Some(TeableBase {
                            id: b["id"].as_str()?.to_string(),
                            name: b["name"].as_str()?.to_string(),
                            space_id: space_id.to_string(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(list)
    }

    pub async fn list_tables(&self, url: &str, token: &str, base_id: &str) -> Result<Vec<TeableTable>, String> {
        let base = url.trim_end_matches('/');
        let endpoint = format!("{}/api/base/{}/table", base, base_id);

        let res = self
            .client
            .get(&endpoint)
            .headers(Self::headers(token))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        let list = json
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|t| {
                        Some(TeableTable {
                            id: t["id"].as_str()?.to_string(),
                            name: t["name"].as_str()?.to_string(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(list)
    }

    async fn list_fields(&self, url: &str, token: &str, table_id: &str) -> Result<Vec<String>, String> {
        let base = url.trim_end_matches('/');
        let endpoint = format!("{}/api/table/{}/field", base, table_id);

        let res = self
            .client
            .get(&endpoint)
            .headers(Self::headers(token))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        let names = json
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|f| f["name"].as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        Ok(names)
    }

    pub async fn verify_table(&self, url: &str, token: &str, table_id: &str) -> Result<TeableSchemaCheck, String> {
        let required_fields = [
            "Session Started At",
            "Lap Mode",
            "Lap Number",
            "Start Time",
            "End Time",
            "Duration",
            "Speed At Start",
            "Speed At End",
        ];

        let existing = self.list_fields(url, token, table_id).await?;
        let existing_set: std::collections::HashSet<_> = existing.into_iter().collect();

        let missing_fields = required_fields
            .iter()
            .filter(|f| !existing_set.contains(**f))
            .map(|f| f.to_string())
            .collect();

        Ok(TeableSchemaCheck { missing_fields })
    }

    pub async fn ensure_fields(&self, url: &str, token: &str, table_id: &str) -> Result<Vec<String>, String> {
        let required_fields: &[(&str, &str)] = &[
            ("Session Started At", "singleLineText"),
            ("Lap Mode", "singleLineText"),
            ("Lap Number", "number"),
            ("Start Time", "singleLineText"),
            ("End Time", "singleLineText"),
            ("Duration", "singleLineText"),
            ("Speed At Start", "number"),
            ("Speed At End", "number"),
        ];

        let existing = self.list_fields(url, token, table_id).await?;
        let existing_set: std::collections::HashSet<_> = existing.into_iter().collect();

        let base = url.trim_end_matches('/');
        let endpoint = format!("{}/api/table/{}/field", base, table_id);

        let mut created = Vec::new();
        for (name, field_type) in required_fields {
            if existing_set.contains(*name) {
                continue;
            }

            let body = json!({
                "name": name,
                "type": field_type
            });

            let res = self
                .client
                .post(&endpoint)
                .headers(Self::headers(token))
                .json(&body)
                .send()
                .await
                .map_err(|e| e.to_string())?;

            if res.status().is_success() {
                created.push(name.to_string());
            }
        }

        Ok(created)
    }

    pub async fn create_table(
        &self,
        url: &str,
        token: &str,
        base_id: &str,
        table_name: &str,
    ) -> Result<TeableTable, String> {
        let base = url.trim_end_matches('/');
        let endpoint = format!("{}/api/base/{}/table", base, base_id);

        let fields = json!([
            { "name": "Session Started At", "type": "singleLineText" },
            { "name": "Lap Mode", "type": "singleLineText" },
            { "name": "Lap Number", "type": "number" },
            { "name": "Start Time", "type": "singleLineText" },
            { "name": "End Time", "type": "singleLineText" },
            { "name": "Duration", "type": "singleLineText" },
            { "name": "Speed At Start", "type": "number" },
            { "name": "Speed At End", "type": "number" }
        ]);

        let body = json!({
            "name": table_name,
            "fields": fields
        });

        let res = self
            .client
            .post(&endpoint)
            .headers(Self::headers(token))
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !res.status().is_success() {
            let body_text = res.text().await.unwrap_or_default();
            return Err(format!("Failed to create table: {}", body_text));
        }

        let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        Ok(TeableTable {
            id: data["id"].as_str().unwrap_or("").to_string(),
            name: data["name"].as_str().unwrap_or(table_name).to_string(),
        })
    }

    pub async fn sync_lap(&self, url: &str, token: &str, table_id: &str, input: &SyncLapInput) -> Result<(), String> {
        let base = url.trim_end_matches('/');
        let endpoint = format!("{}/api/table/{}/record", base, table_id);

        let start_dt = chrono::DateTime::from_timestamp_millis(input.lap.start_timestamp)
            .map(|dt| dt.to_rfc3339())
            .unwrap_or_default();

        let end_dt = chrono::DateTime::from_timestamp_millis(input.lap.end_timestamp)
            .map(|dt| dt.to_rfc3339())
            .unwrap_or_default();

        let total_sec = input.lap.duration_ms as f64 / 1000.0;
        let min = (total_sec / 60.0).floor() as i64;
        let sec = (total_sec % 60.0).floor() as i64;
        let ms = input.lap.duration_ms % 1000;
        let dur_str = format!("{:02}:{:02}.{:03}", min, sec, ms);

        let body = json!({
            "records": [{
                "fields": {
                    "Session Started At": input.session.started_at,
                    "Lap Mode": input.session.lap_mode,
                    "Lap Number": input.lap.lap_number,
                    "Start Time": start_dt,
                    "End Time": end_dt,
                    "Duration": dur_str,
                    "Speed At Start": input.lap.speed_at_start,
                    "Speed At End": input.lap.speed_at_end
                }
            }]
        });

        let res = self
            .client
            .post(&endpoint)
            .headers(Self::headers(token))
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !res.status().is_success() {
            return Err(format!("Teable sync error: HTTP {}", res.status()));
        }

        Ok(())
    }
}
