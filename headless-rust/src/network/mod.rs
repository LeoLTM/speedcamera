use crate::models::{NetworkInterfaceDetail, SubnetInfo, SystemNetworkSummary};
use std::collections::HashMap;

pub fn get_system_network_summary() -> SystemNetworkSummary {
    let mut interfaces = Vec::new();
    let mut camera_lan_iface: Option<NetworkInterfaceDetail> = None;
    let mut hotspot_ap_iface: Option<NetworkInterfaceDetail> = None;

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
            let is_hotspot_ip = ip == "192.168.4.1" || ip.starts_with("192.168.4.");
            let is_eth_name = name.starts_with("eth") || name.starts_with("end") || name.starts_with("enp");
            let is_wifi_name = name.starts_with("wlan") || name.starts_with("wifi") || name.starts_with("wlp");

            let role = if is_loopback {
                "loopback"
            } else if is_camera_ip || is_eth_name {
                "camera-lan"
            } else if is_hotspot_ip || is_wifi_name {
                "hotspot-ap"
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

            let detail = NetworkInterfaceDetail {
                name: name.clone(),
                role: role.to_string(),
                address: ip.clone(),
                family: "IPv4".to_string(),
                netmask,
                mac: String::new(),
                expected_ip,
                is_configured,
            };

            if role == "camera-lan" && (camera_lan_iface.is_none() || ip == "192.168.1.100") {
                camera_lan_iface = Some(detail.clone());
            }

            if role == "hotspot-ap" && (hotspot_ap_iface.is_none() || ip == "192.168.4.1") {
                hotspot_ap_iface = Some(detail.clone());
            }

            interfaces.push(detail);
        }
    }

    let camera_status = match &camera_lan_iface {
        None => "missing",
        Some(iface) if iface.address == "192.168.1.100" => "ok",
        Some(_) => "ip_mismatch",
    };

    let hotspot_status = match &hotspot_ap_iface {
        None => "missing",
        Some(iface) if iface.address == "192.168.4.1" => "ok",
        Some(_) => "ip_mismatch",
    };

    SystemNetworkSummary {
        camera_lan: SubnetInfo {
            interface_name: camera_lan_iface.as_ref().map(|i| i.name.clone()),
            ip: camera_lan_iface.as_ref().map(|i| i.address.clone()),
            expected_ip: "192.168.1.100".to_string(),
            subnet: "192.168.1.0/24".to_string(),
            status: camera_status.to_string(),
            description: "Dedicated GigE Vision Industrial Camera LAN (eth0/end0)".to_string(),
        },
        hotspot_ap: SubnetInfo {
            interface_name: hotspot_ap_iface.as_ref().map(|i| i.name.clone()),
            ip: hotspot_ap_iface.as_ref().map(|i| i.address.clone()),
            expected_ip: "192.168.4.1".to_string(),
            subnet: "192.168.4.0/24".to_string(),
            status: hotspot_status.to_string(),
            description: "Wi-Fi Access Point & Remote Web UI Control (wlan0/wifi0)".to_string(),
        },
        interfaces,
    }
}
