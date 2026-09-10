use std::io::Write;
use std::process::{Command, Stdio};

/// Cleanly powers off the host machine (Raspberry Pi).
/// Supports passwordless sudo, direct systemctl/shutdown, and password-authenticated sudo.
pub fn shutdown_host(password: Option<String>, mock_mode: bool) -> Result<serde_json::Value, String> {
    if mock_mode {
        tracing::info!("[system] Host shutdown simulated (mock mode active)");
        return Ok(serde_json::json!({
            "success": true,
            "simulated": true,
            "message": "Host shutdown simulated successfully (mock mode)"
        }));
    }

    tracing::warn!("[system] Host shutdown command received, powering down...");

    // 1. If password was provided, execute sudo with password through stdin (-S)
    if let Some(ref pass) = password {
        let trimmed = pass.trim();
        if !trimmed.is_empty() {
            let mut child = Command::new("sudo")
                .args(["-S", "-k", "shutdown", "-h", "now"])
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("Failed to spawn sudo shutdown: {}", e))?;

            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(trimmed.as_bytes());
                let _ = stdin.write_all(b"\n");
            }

            let output = child
                .wait_with_output()
                .map_err(|e| format!("Failed to execute sudo shutdown: {}", e))?;

            if output.status.success() {
                return Ok(serde_json::json!({ "success": true }));
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Sudo shutdown failed: {}", stderr.trim()));
            }
        }
    }

    // 2. Try passwordless sudo: sudo -n shutdown -h now (-n prevents interactive hang)
    if let Ok(output) = Command::new("sudo").args(["-n", "shutdown", "-h", "now"]).output() {
        if output.status.success() {
            return Ok(serde_json::json!({ "success": true }));
        }
    }

    // 3. Try systemctl poweroff (often permitted by logind/polkit)
    if let Ok(output) = Command::new("systemctl").arg("poweroff").output() {
        if output.status.success() {
            return Ok(serde_json::json!({ "success": true }));
        }
    }

    // 4. Try direct shutdown -h now (if running as root)
    if let Ok(output) = Command::new("shutdown").args(["-h", "now"]).output() {
        if output.status.success() {
            return Ok(serde_json::json!({ "success": true }));
        }
    }

    Err("Shutdown failed: sudo permission with password is required".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shutdown_mock_mode() {
        let res = shutdown_host(None, true);
        assert!(res.is_ok());
        let val = res.unwrap();
        assert_eq!(val["simulated"], true);
        assert_eq!(val["success"], true);
    }
}
