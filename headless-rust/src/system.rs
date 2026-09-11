use std::io::Write;
use std::process::{Command, Stdio};

/// Verifies whether the shutdown request is authorized without triggering system poweroff.
/// Returns Ok(()) if authorized, or Err with an explanation if authorization fails.
pub fn verify_shutdown_authorization(password: Option<&str>, mock_mode: bool) -> Result<(), String> {
    if mock_mode {
        tracing::info!("[system] Shutdown authorization verified (mock mode active)");
        return Ok(());
    }

    // 1. If password was provided, validate via `sudo -S -k -v`
    if let Some(pass) = password {
        let trimmed = pass.trim();
        if !trimmed.is_empty() {
            let mut child = Command::new("sudo")
                .args(["-S", "-k", "-v"])
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("Failed to spawn sudo authorization check: {}", e))?;

            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(trimmed.as_bytes());
                let _ = stdin.write_all(b"\n");
            }

            let output = child
                .wait_with_output()
                .map_err(|e| format!("Failed to execute sudo authorization check: {}", e))?;

            if output.status.success() {
                tracing::info!("[system] Sudo password authorization succeeded");
                return Ok(());
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Sudo authorization failed: {}", stderr.trim()));
            }
        }
    }

    // 2. Check if passwordless sudo is permitted
    if let Ok(output) = Command::new("sudo").args(["-n", "-v"]).output() {
        if output.status.success() {
            tracing::info!("[system] Passwordless sudo authorization confirmed");
            return Ok(());
        }
    }

    // 3. Check if running as root (UID 0)
    if let Ok(output) = Command::new("id").arg("-u").output() {
        if output.status.success() {
            let uid_str = String::from_utf8_lossy(&output.stdout);
            if uid_str.trim() == "0" {
                tracing::info!("[system] Root user authorization confirmed");
                return Ok(());
            }
        }
    }

    Err("Shutdown failed: sudo permission with password is required".to_string())
}

/// Executes the physical OS poweroff / shutdown command.
pub fn perform_os_shutdown(password: Option<&str>, mock_mode: bool) -> Result<(), String> {
    if mock_mode {
        tracing::info!("[system] Host shutdown simulated (mock mode active)");
        return Ok(());
    }

    tracing::warn!("[system] Host shutdown command received, powering down...");

    // 1. If password was provided, execute sudo shutdown with password
    if let Some(pass) = password {
        let trimmed = pass.trim();
        if !trimmed.is_empty() {
            let mut child = Command::new("sudo")
                .args(["-S", "shutdown", "-h", "now"])
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
                return Ok(());
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Sudo shutdown failed: {}", stderr.trim()));
            }
        }
    }

    // 2. Try passwordless sudo: sudo -n shutdown -h now
    if let Ok(output) = Command::new("sudo").args(["-n", "shutdown", "-h", "now"]).output() {
        if output.status.success() {
            return Ok(());
        }
    }

    // 3. Try systemctl poweroff
    if let Ok(output) = Command::new("systemctl").arg("poweroff").output() {
        if output.status.success() {
            return Ok(());
        }
    }

    // 4. Try direct shutdown -h now (if running as root)
    if let Ok(output) = Command::new("shutdown").args(["-h", "now"]).output() {
        if output.status.success() {
            return Ok(());
        }
    }

    Err("Shutdown failed: sudo permission with password is required".to_string())
}

/// Cleanly powers off the host machine (Raspberry Pi).
/// Supports passwordless sudo, direct systemctl/shutdown, and password-authenticated sudo.
#[allow(dead_code)]
pub fn shutdown_host(password: Option<String>, mock_mode: bool) -> Result<serde_json::Value, String> {
    if mock_mode {
        tracing::info!("[system] Host shutdown simulated (mock mode active)");
        return Ok(serde_json::json!({
            "success": true,
            "simulated": true,
            "message": "Host shutdown simulated successfully (mock mode)"
        }));
    }

    verify_shutdown_authorization(password.as_deref(), mock_mode)?;
    perform_os_shutdown(password.as_deref(), mock_mode)?;

    Ok(serde_json::json!({ "success": true }))
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

    #[test]
    fn test_verify_authorization_mock_mode() {
        let res = verify_shutdown_authorization(None, true);
        assert!(res.is_ok());

        let res_with_pass = verify_shutdown_authorization(Some("mock_password"), true);
        assert!(res_with_pass.is_ok());
    }
}
