use crate::models::{
    ApplyNetworkModeInput, NetworkInterfaceDetail, NetworkOperationResult, SubnetInfo,
    SystemNetworkSummary, WifiClientInfo, WifiScanResult,
};
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;

/// Reads hardware MAC address from Linux sysfs (/sys/class/net/<iface>/address)
fn get_interface_mac(iface: &str) -> String {
    let path = format!("/sys/class/net/{}/address", iface);
    std::fs::read_to_string(&path)
        .map(|s| s.trim().to_uppercase())
        .unwrap_or_default()
}

pub fn get_system_network_summary() -> SystemNetworkSummary {
    let mut interfaces = Vec::new();
    let mut camera_lan_iface: Option<NetworkInterfaceDetail> = None;
    let mut hotspot_ap_iface: Option<NetworkInterfaceDetail> = None;
    let mut wifi_client_iface: Option<NetworkInterfaceDetail> = None;
    let mut detected_wifi_name: Option<String> = None;
    let mut detected_eth_name: Option<String> = None;

    // Use nix getifaddrs to inspect active IPv4 network interfaces
    if let Ok(ifaddrs) = nix::ifaddrs::getifaddrs() {
        let mut map: HashMap<String, (String, String)> = HashMap::new(); // name -> (ip, netmask)

        for ifaddr in ifaddrs {
            if let Some(addr) = ifaddr.address {
                if let Some(sock_addr) = addr.as_sockaddr_in() {
                    let ip = std::net::Ipv4Addr::from(sock_addr.ip()).to_string();
                    let netmask = ifaddr
                        .netmask
                        .and_then(|nm| nm.as_sockaddr_in().map(|s| std::net::Ipv4Addr::from(s.ip()).to_string()))
                        .unwrap_or_else(|| "255.255.255.0".to_string());

                    map.insert(ifaddr.interface_name.clone(), (ip, netmask));
                }
            }
        }

        for (name, (ip, netmask)) in map {
            let is_loopback = name == "lo" || ip.starts_with("127.");
            let is_camera_ip = ip == "192.168.1.100" || ip.starts_with("192.168.1.");
            let is_hotspot_ip = ip == "192.168.4.1";
            let is_eth_name = name.starts_with("eth") || name.starts_with("end") || name.starts_with("enp");
            let is_wifi_name = name.starts_with("wlan") || name.starts_with("wifi") || name.starts_with("wlp");

            if is_wifi_name {
                detected_wifi_name = Some(name.clone());
            }
            if is_eth_name && detected_eth_name.is_none() {
                detected_eth_name = Some(name.clone());
            }

            let role = if is_loopback {
                "loopback"
            } else if is_camera_ip || is_eth_name {
                "camera-lan"
            } else if is_hotspot_ip {
                "hotspot-ap"
            } else if is_wifi_name {
                "wifi-client"
            } else {
                "other"
            };

            let expected_ip = if role == "camera-lan" {
                Some("192.168.1.100".to_string())
            } else if role == "hotspot-ap" {
                Some("192.168.4.1".to_string())
            } else {
                None
            };

            let is_configured = match &expected_ip {
                Some(exp) => &ip == exp,
                None => true,
            };

            let mac = get_interface_mac(&name);

            let detail = NetworkInterfaceDetail {
                name: name.clone(),
                role: role.to_string(),
                address: ip.clone(),
                family: "IPv4".to_string(),
                netmask,
                mac,
                expected_ip,
                is_configured,
            };

            if role == "camera-lan" && (camera_lan_iface.is_none() || ip == "192.168.1.100") {
                camera_lan_iface = Some(detail.clone());
            }

            if role == "hotspot-ap" {
                hotspot_ap_iface = Some(detail.clone());
            } else if role == "wifi-client" {
                wifi_client_iface = Some(detail.clone());
            }

            interfaces.push(detail);
        }
    }

    let wifi_iface_name = detected_wifi_name.unwrap_or_else(|| "wlan0".to_string());
    let eth_iface_name = detected_eth_name.unwrap_or_else(|| "eth0".to_string());

    let wifi_mac = {
        let mac = get_interface_mac(&wifi_iface_name);
        if mac.is_empty() { None } else { Some(mac) }
    };

    let ethernet_mac = {
        let mac = get_interface_mac(&eth_iface_name);
        if mac.is_empty() { None } else { Some(mac) }
    };

    let camera_status = match &camera_lan_iface {
        None => "missing",
        Some(iface) if iface.address == "192.168.1.100" => "ok",
        Some(_) => "ip_mismatch",
    };

    // Determine Ethernet mode
    let ethernet_mode = if let Some(ref iface) = camera_lan_iface {
        if iface.address == "192.168.1.100" {
            "camera-lan".to_string()
        } else {
            "dhcp".to_string()
        }
    } else {
        "unmanaged".to_string()
    };

    // Determine Wi-Fi active connection mode & details
    let (active_ssid, signal_dbm, power_save_status, default_gateway) = query_wifi_runtime_info(&wifi_iface_name);

    let (mode, wifi_mode, hotspot_status, wifi_client_info) = if let Some(ref hs) = hotspot_ap_iface {
        let status = if hs.address == "192.168.4.1" { "ok" } else { "ip_mismatch" };
        (
            "ap".to_string(),
            "ap".to_string(),
            status.to_string(),
            None,
        )
    } else if let Some(ref client) = wifi_client_iface {
        let client_info = WifiClientInfo {
            interface_name: Some(client.name.clone()),
            ssid: active_ssid,
            ip: Some(client.address.clone()),
            subnet: Some(format!("{}/24", client.address.rsplit_once('.').map(|(p, _)| p).unwrap_or("192.168.0"))),
            gateway: default_gateway,
            signal_dbm,
            power_save: power_save_status,
            status: "connected".to_string(),
            description: "Wi-Fi Client connected to external router (Station mode)".to_string(),
        };
        (
            "client".to_string(),
            "client".to_string(),
            "inactive".to_string(),
            Some(client_info),
        )
    } else {
        (
            "ap".to_string(),
            "disconnected".to_string(),
            "missing".to_string(),
            None,
        )
    };

    SystemNetworkSummary {
        mode,
        wifi_mode,
        ethernet_mode,
        wifi_mac,
        ethernet_mac,
        camera_lan: SubnetInfo {
            interface_name: camera_lan_iface.as_ref().map(|i| i.name.clone()),
            ip: camera_lan_iface.as_ref().map(|i| i.address.clone()),
            expected_ip: "192.168.1.100".to_string(),
            subnet: "192.168.1.0/24".to_string(),
            status: camera_status.to_string(),
            description: "Dedicated GigE Vision Industrial Camera LAN (eth0/end0)".to_string(),
        },
        hotspot_ap: SubnetInfo {
            interface_name: hotspot_ap_iface.as_ref().map(|i| i.name.clone()).or(Some(wifi_iface_name)),
            ip: hotspot_ap_iface.as_ref().map(|i| i.address.clone()),
            expected_ip: "192.168.4.1".to_string(),
            subnet: "192.168.4.0/24".to_string(),
            status: hotspot_status,
            description: "Open Wi-Fi Hotspot AP & Web Setup (wlan0/wifi0)".to_string(),
        },
        wifi_client: wifi_client_info,
        interfaces,
    }
}

/// Queries Wi-Fi link information (SSID, signal, power_save, default gateway) via Linux utilities
fn query_wifi_runtime_info(wifi_iface: &str) -> (Option<String>, Option<i32>, Option<String>, Option<String>) {
    let mut ssid = None;
    let mut signal_dbm = None;
    let mut power_save = None;
    let mut gateway = None;

    // 1. Query active SSID via nmcli or iw
    if let Ok(output) = Command::new("nmcli")
        .args(["-t", "-f", "ACTIVE,SSID", "dev", "wifi"])
        .output()
    {
        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                if line.starts_with("yes:") {
                    let s = line.trim_start_matches("yes:").trim();
                    if !s.is_empty() {
                        ssid = Some(s.to_string());
                        break;
                    }
                }
            }
        }
    }

    if ssid.is_none() {
        if let Ok(output) = Command::new("iw").args(["dev", wifi_iface, "link"]).output() {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                for line in text.lines() {
                    let trimmed = line.trim();
                    if trimmed.starts_with("SSID: ") {
                        ssid = Some(trimmed.trim_start_matches("SSID: ").to_string());
                    } else if trimmed.starts_with("signal: ") {
                        if let Some(dbm_str) = trimmed.split_whitespace().nth(1) {
                            signal_dbm = dbm_str.parse::<i32>().ok();
                        }
                    }
                }
            }
        }
    }

    // 2. Query power save status
    if let Ok(output) = Command::new("iw").args(["dev", wifi_iface, "get", "power_save"]).output() {
        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout);
            power_save = text.split_whitespace().last().map(|s| s.to_string());
        }
    }

    // 3. Query default gateway via `ip route`
    if let Ok(output) = Command::new("ip").args(["route", "show", "default"]).output() {
        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout);
            let parts: Vec<&str> = text.split_whitespace().collect();
            if parts.len() >= 3 && parts[0] == "default" && parts[1] == "via" {
                gateway = Some(parts[2].to_string());
            }
        }
    }

    (ssid, signal_dbm, power_save, gateway)
}

/// Scans for visible 2.4GHz & 5GHz Wi-Fi networks
pub fn scan_wifi_networks() -> Vec<WifiScanResult> {
    let mut seen_ssids: HashMap<String, WifiScanResult> = HashMap::new();

    if let Ok(output) = Command::new("nmcli")
        .args(["-t", "-f", "SSID,BSSID,CHAN,SIGNAL,SECURITY,IN-USE", "dev", "wifi", "list", "--rescan", "auto"])
        .output()
    {
        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                // Split with care: BSSID has colons, so nmcli escapes or separates with colon.
                // When using -t (terse), nmcli escapes colons inside fields with \:
                let parts: Vec<&str> = line.split(':').collect();
                if parts.len() >= 4 {
                    // With BSSID having 5 colons (e.g. AA:BB:CC:DD:EE:FF), parts length is typically >= 10
                    let (ssid, bssid, channel, signal, security, in_use) = if parts.len() >= 10 {
                        let ssid = parts[0].trim().to_string();
                        let bssid = format!("{}:{}:{}:{}:{}:{}", parts[1], parts[2], parts[3], parts[4], parts[5], parts[6]);
                        let chan = parts[7].trim().parse::<u32>().unwrap_or(0);
                        let sig = parts[8].trim().parse::<i32>().unwrap_or(0);
                        let sec = parts[9].trim().to_string();
                        let in_u = parts.get(10).map(|s| s.trim().eq_ignore_ascii_case("yes") || *s == "*").unwrap_or(false);
                        (ssid, bssid, chan, sig, sec, in_u)
                    } else {
                        // Fallback parsing
                        let ssid = parts[0].trim().to_string();
                        let sig = parts.iter().find_map(|p| p.trim().parse::<i32>().ok()).unwrap_or(0);
                        let sec = parts.last().map(|s| s.trim().to_string()).unwrap_or_default();
                        let in_u = parts.iter().any(|p| p.trim().eq_ignore_ascii_case("yes") || *p == "*");
                        (ssid, String::new(), 0, sig, sec, in_u)
                    };

                    if ssid.is_empty() || ssid == "--" {
                        continue;
                    }

                    let item = WifiScanResult {
                        ssid: ssid.clone(),
                        bssid,
                        channel,
                        signal,
                        security: if security.is_empty() { "Open".to_string() } else { security },
                        in_use,
                    };

                    if let Some(existing) = seen_ssids.get_mut(&ssid) {
                        if item.in_use {
                            existing.in_use = true;
                        }
                        if item.signal > existing.signal {
                            existing.signal = item.signal;
                            existing.bssid = item.bssid;
                            existing.channel = item.channel;
                        }
                    } else {
                        seen_ssids.insert(ssid, item);
                    }
                }
            }
        }
    }

    let mut results: Vec<WifiScanResult> = seen_ssids.into_values().collect();
    results.sort_by(|a, b| {
        if a.in_use != b.in_use {
            b.in_use.cmp(&a.in_use)
        } else {
            b.signal.cmp(&a.signal)
        }
    });

    results
}

/// Applies a network mode switch (AP, Wi-Fi Client, Forget Wi-Fi, Ethernet LAN, Ethernet DHCP, or standard DHCP)
pub fn apply_network_mode(input: &ApplyNetworkModeInput) -> NetworkOperationResult {
    let script_paths = [
        Path::new("./scripts/setup-network.sh"),
        Path::new("../scripts/setup-network.sh"),
        Path::new("/home/pi/speedcamera/headless-rust/scripts/setup-network.sh"),
        Path::new("/root/speedcamera/headless-rust/scripts/setup-network.sh"),
    ];

    let script = script_paths
        .iter()
        .find(|p| p.exists())
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| Path::new("./scripts/setup-network.sh").to_path_buf());

    let normalized_mode = input.mode.to_lowercase();
    let mut cmd = Command::new("sudo");
    cmd.arg(&script);

    match normalized_mode.as_str() {
        "ap" | "field" | "hotspot" => {
            cmd.arg("ap");
        }
        "client" | "wifi-client" | "internet" | "wifi" => {
            let ssid = match &input.ssid {
                Some(s) if !s.trim().is_empty() => s.trim(),
                _ => {
                    return NetworkOperationResult {
                        success: false,
                        mode: input.mode.clone(),
                        message: "SSID is required to connect to a Wi-Fi network in Client mode.".to_string(),
                        details: None,
                    };
                }
            };
            cmd.arg("client").arg(ssid);
            if let Some(pass) = &input.password {
                if !pass.is_empty() {
                    cmd.arg(pass);
                }
            }
        }
        "forget" | "reset-wifi" => {
            cmd.arg("forget");
        }
        "lan-camera" | "camera-lan" => {
            cmd.arg("lan-camera");
        }
        "lan-dhcp" | "ethernet-dhcp" => {
            cmd.arg("lan-dhcp");
        }
        "auto" => {
            cmd.arg("auto");
        }
        "dhcp" | "reset" => {
            cmd.arg("dhcp");
        }
        other => {
            return NetworkOperationResult {
                success: false,
                mode: input.mode.clone(),
                message: format!("Unknown network mode '{}'.", other),
                details: None,
            };
        }
    }

    tracing::info!("[network] Executing mode transition: {:?}", cmd);

    match cmd.output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            let details = if !stderr.is_empty() {
                format!("{}\n{}", stdout, stderr)
            } else {
                stdout.clone()
            };

            if output.status.success() {
                tracing::info!("[network] Mode transition to '{}' succeeded", normalized_mode);
                NetworkOperationResult {
                    success: true,
                    mode: normalized_mode,
                    message: format!("Network mode '{}' applied successfully.", input.mode),
                    details: Some(details),
                }
            } else {
                tracing::warn!("[network] Mode transition failed with exit code {:?}: {}", output.status.code(), details);
                NetworkOperationResult {
                    success: false,
                    mode: normalized_mode,
                    message: format!("Failed to apply network mode '{}'.", input.mode),
                    details: Some(details),
                }
            }
        }
        Err(err) => {
            tracing::error!("[network] Failed to spawn network script: {}", err);
            NetworkOperationResult {
                success: false,
                mode: normalized_mode,
                message: format!("Failed to execute network script: {}", err),
                details: None,
            }
        }
    }
}
