use crate::models::{FlashProgressPayload, GithubRelease};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, USER_AGENT};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::broadcast;

const GITHUB_API_URL: &str = "https://api.github.com/repos/LeoLTM/speedcamera/releases";
const GITHUB_USER_URL: &str = "https://api.github.com/user";

fn github_headers(token: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static("speedcamera-rust"));
    if !token.is_empty() {
        if let Ok(val) = HeaderValue::from_str(&format!("Bearer {}", token)) {
            headers.insert(AUTHORIZATION, val);
        }
    }
    headers
}

pub async fn test_github_token(
    token: &str,
) -> Result<(bool, Option<String>), String> {
    if token.trim().is_empty() {
        return Ok((false, None));
    }

    let client = reqwest::Client::new();
    let res = client
        .get(GITHUB_USER_URL)
        .headers(github_headers(token))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        let login = json["login"].as_str().map(|s| s.to_string());
        Ok((true, login))
    } else {
        Ok((false, None))
    }
}

pub async fn list_firmware_releases(token: &str) -> Result<Vec<GithubRelease>, String> {
    let client = reqwest::Client::new();
    let res = client
        .get(GITHUB_API_URL)
        .headers(github_headers(token))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("GitHub API error: HTTP {}", res.status()));
    }

    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let mut list = Vec::new();

    if let Some(releases) = json.as_array() {
        for r in releases {
            let tag = r["tag_name"].as_str().unwrap_or("").to_string();
            let name = r["name"].as_str().unwrap_or(&tag).to_string();
            let published_at = r["published_at"].as_str().unwrap_or("").to_string();
            let prerelease = r["prerelease"].as_bool().unwrap_or(false);

            let mut firmware_asset_api_url = String::new();
            if let Some(assets) = r["assets"].as_array() {
                for a in assets {
                    let asset_name = a["name"].as_str().unwrap_or("");
                    if asset_name.ends_with(".bin") || asset_name.contains("firmware") {
                        firmware_asset_api_url = a["url"].as_str().unwrap_or("").to_string();
                        break;
                    }
                }
            }

            list.push(GithubRelease {
                tag,
                name,
                published_at,
                prerelease,
                firmware_asset_api_url,
            });
        }
    }

    Ok(list)
}

pub async fn flash_firmware(
    _release_tag: &str,
    port: &str,
    firmware_asset_api_url: &str,
    token: &str,
    tx: broadcast::Sender<FlashProgressPayload>,
) {
    let _ = tx.send(FlashProgressPayload::Downloading);

    let client = reqwest::Client::new();
    let mut req = client.get(firmware_asset_api_url).headers(github_headers(token));
    req = req.header("Accept", "application/octet-stream");

    let bytes = match req.send().await {
        Ok(res) if res.status().is_success() => match res.bytes().await {
            Ok(b) => b,
            Err(e) => {
                let _ = tx.send(FlashProgressPayload::Error {
                    message: format!("Failed to read binary: {}", e),
                });
                return;
            }
        },
        Ok(res) => {
            let _ = tx.send(FlashProgressPayload::Error {
                message: format!("Failed to download firmware asset: HTTP {}", res.status()),
            });
            return;
        }
        Err(e) => {
            let _ = tx.send(FlashProgressPayload::Error {
                message: format!("Download network error: {}", e),
            });
            return;
        }
    };

    let temp_file = std::env::temp_dir().join("speedcamera_firmware.bin");
    if let Err(e) = std::fs::write(&temp_file, &bytes) {
        let _ = tx.send(FlashProgressPayload::Error {
            message: format!("Failed to write temp firmware file: {}", e),
        });
        return;
    }

    let esptool_cmd = "esptool.py";
    let mut child = match Command::new(esptool_cmd)
        .arg("--chip")
        .arg("esp8266")
        .arg("--port")
        .arg(port)
        .arg("--baud")
        .arg("460800")
        .arg("write_flash")
        .arg("0x0")
        .arg(temp_file.to_str().unwrap_or(""))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(_) => {
            // Try standard esptool
            match Command::new("esptool")
                .arg("--chip")
                .arg("esp8266")
                .arg("--port")
                .arg(port)
                .arg("--baud")
                .arg("460800")
                .arg("write_flash")
                .arg("0x0")
                .arg(temp_file.to_str().unwrap_or(""))
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
            {
                Ok(c) => c,
                Err(e) => {
                    let _ = tx.send(FlashProgressPayload::Error {
                        message: format!("esptool not found or failed to spawn: {}", e),
                    });
                    return;
                }
            }
        }
    };

    if let Some(stdout) = child.stdout.take() {
        let mut reader = BufReader::new(stdout).lines();
        let tx_clone = tx.clone();
        tokio::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                let _ = tx_clone.send(FlashProgressPayload::Output { line });
            }
        });
    }

    match child.wait().await {
        Ok(status) if status.success() => {
            let _ = tx.send(FlashProgressPayload::Done);
        }
        Ok(status) => {
            let _ = tx.send(FlashProgressPayload::Error {
                message: format!("esptool exited with status {}", status),
            });
        }
        Err(e) => {
            let _ = tx.send(FlashProgressPayload::Error {
                message: format!("esptool execution error: {}", e),
            });
        }
    }
}
