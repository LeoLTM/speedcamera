#!/usr/bin/env bash
set -e
trap '' HUP

MODE="${1:-status}"

echo "========================================================="
echo " Speedcamera Network Manager"
echo "========================================================="

# Detect Ethernet Interface (eth0, end0, enp*, etc.)
ETH_IFACE=$(ip -o link show | awk -F': ' '{print $2}' | grep -E '^(eth|end|enp)' | head -n 1 || echo "eth0")
# Detect Wi-Fi Interface (wlan0, wifi0, wlp*, etc.)
WIFI_IFACE=$(ip -o link show | awk -F': ' '{print $2}' | grep -E '^(wlan|wifi|wlp)' | head -n 1 || echo "wlan0")

echo "[*] Detected Interfaces:"
echo "    Ethernet (Camera LAN):    ${ETH_IFACE}"
echo "    Wireless (Hotspot/Wi-Fi): ${WIFI_IFACE}"
echo ""

# For modifying operations, request sudo privileges
if [ "$MODE" != "status" ]; then
  sudo -v || { echo "Error: Sudo privileges required to change network configuration." >&2; exit 1; }
fi

apply_field_mode() {
  echo ">>> Applying FIELD MODE (Standalone Offline Dual-Subnet):"
  echo "    1. Camera LAN (${ETH_IFACE}) -> Static IP 192.168.1.100/24"
  echo "    2. Hotspot AP (${WIFI_IFACE}) -> Static IP 192.168.4.1/24 (SSID: speedcamera)"
  echo "    NOTE: In this mode, Pi operates standalone/offline."
  echo ""

  # Apply GigE Vision kernel socket buffer optimizations without causing Wi-Fi bufferbloat
  echo "[*] Applying optimized network socket buffer configuration (128MB max, clean TCP defaults, fq_codel)..."
  sudo bash -c 'cat > /etc/sysctl.d/60-gige-camera.conf <<EOF
# Keep high buffer limits for GigE camera explicit SO_RCVBUF allocation
net.core.rmem_max = 134217728
net.core.wmem_max = 134217728
# Clean defaults for general Wi-Fi / TCP sockets (prevents bufferbloat and queue stalls)
net.core.rmem_default = 262144
net.core.wmem_default = 262144
net.ipv4.tcp_rmem = 4096 131072 67108864
net.ipv4.tcp_wmem = 4096 65536 67108864
net.core.netdev_max_backlog = 30000
# Smart queuing algorithm: small interactive packets jump ahead of massive GigE camera streams
net.core.default_qdisc = fq_codel
# Prevent dirty-page writeback stalls when saving capture images
vm.dirty_background_ratio = 5
vm.dirty_ratio = 10
EOF'
  sudo sysctl -p /etc/sysctl.d/60-gige-camera.conf 2>/dev/null || sudo sysctl --system 2>/dev/null || true

  # Enable jumbo frames on camera NIC — critical for GigE Vision throughput.
  # Larger MTU = fewer packets = fewer interrupts = less CPU/softirq pressure.
  echo "[*] Enabling jumbo frames (MTU 9000) on ${ETH_IFACE}..."
  sudo ip link set dev "${ETH_IFACE}" mtu 9000 2>/dev/null || echo "Note: MTU 9000 not supported by NIC/driver, keeping default."

  # Configure Wi-Fi Hotspot AP (5GHz Band A, Channel 36 to avoid 2.4GHz congestion and Broadcom AP firmware bugs)
  echo "[1/2] Configuring 5GHz Wi-Fi Hotspot AP on ${WIFI_IFACE}..."
  SSID="speedcamera"
  PASS="speedcamerapass"
  
  # Ensure NetworkManager globally disables Wi-Fi power-save on all connections
  sudo mkdir -p /etc/NetworkManager/conf.d
  sudo bash -c 'cat > /etc/NetworkManager/conf.d/default-wifi-powersave-off.conf <<EOF
[connection]
wifi.powersave = 2
EOF'

  sudo nmcli connection delete "Speedcamera-Hotspot" 2>/dev/null || true
  sudo nmcli connection delete "Speedcamera-ClientWiFi" 2>/dev/null || true
  sudo nmcli connection add type wifi \
    ifname "${WIFI_IFACE}" \
    con-name "Speedcamera-Hotspot" \
    autoconnect yes \
    ssid "${SSID}" \
    mode ap \
    802-11-wireless.band a \
    802-11-wireless.channel 36 \
    802-11-wireless.powersave 2 \
    ipv4.method shared \
    ipv4.addresses 192.168.4.1/24 \
    wifi-sec.key-mgmt wpa-psk \
    wifi-sec.psk "${PASS}"

  # Disable MAC randomization which can trigger background radio resets
  sudo nmcli connection modify "Speedcamera-Hotspot" 802-11-wireless.mac-address-randomization 1 2>/dev/null || true

  # Explicitly tell the AP it is not the default route to stop internet-probe stalling
  sudo nmcli connection modify "Speedcamera-Hotspot" ipv4.never-default yes 2>/dev/null || true

  sudo nmcli connection up "Speedcamera-Hotspot" 2>/dev/null || echo "Note: Hotspot initialized."

  # Configure Ethernet Camera LAN
  echo "[2/2] Configuring Camera LAN on ${ETH_IFACE}..."
  sudo nmcli connection delete "Speedcamera-CameraLAN" 2>/dev/null || true
  sudo nmcli connection add type ethernet \
    ifname "${ETH_IFACE}" \
    con-name "Speedcamera-CameraLAN" \
    autoconnect yes \
    ipv4.method manual \
    ipv4.addresses 192.168.1.100/24 \
    ipv4.never-default yes \
    802-3-ethernet.mtu 9000
  sudo nmcli connection up "Speedcamera-CameraLAN" 2>/dev/null || echo "Note: Ethernet link active when camera cable is connected."

  # Permanently disable Wi-Fi power saving via persistent systemd service
  echo "[*] Locking down Wi-Fi power management permanently (wifi-power-off.service)..."
  sudo bash -c "cat > /etc/systemd/system/wifi-power-off.service <<EOF
[Unit]
Description=Disable WiFi Power Management
After=network.target

[Service]
Type=oneshot
ExecStart=/sbin/iwconfig ${WIFI_IFACE} power off
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF"
  sudo systemctl daemon-reload 2>/dev/null || true
  sudo systemctl enable wifi-power-off.service 2>/dev/null || true
  sudo systemctl restart wifi-power-off.service 2>/dev/null || sudo iw dev "${WIFI_IFACE}" set power_save off 2>/dev/null || sudo iwconfig "${WIFI_IFACE}" power off 2>/dev/null || true

  # Configure DNS interception for OS connectivity checks (Windows NCSI, Fedora hotspot, Linux ping)
  echo "[*] Configuring DNS interception for OS internet probes (192.168.4.1)..."
  sudo mkdir -p /etc/NetworkManager/dnsmasq-shared.d /etc/dnsmasq.d
  sudo bash -c 'cat > /etc/NetworkManager/dnsmasq-shared.d/fake-internet.conf <<EOF
address=/msftncsi.com/192.168.4.1
address=/msftconnecttest.com/192.168.4.1
address=/fedoraproject.org/192.168.4.1
address=/ping.archlinux.org/192.168.4.1
address=/connectivitycheck.gstatic.com/192.168.4.1
address=/captive.apple.com/192.168.4.1
address=/network-test.debian.org/192.168.4.1
EOF'
  sudo cp /etc/NetworkManager/dnsmasq-shared.d/fake-internet.conf /etc/dnsmasq.d/fake-internet.conf 2>/dev/null || true

  # Redirect port 80 to port 3000 on hotspot interface so OS HTTP probe requests hit the Rust daemon
  echo "[*] Redirecting HTTP probe port 80 -> 3000 on ${WIFI_IFACE}..."
  sudo iptables -t nat -D PREROUTING -i "${WIFI_IFACE}" -p tcp --dport 80 -j REDIRECT --to-port 3000 2>/dev/null || true
  sudo iptables -t nat -A PREROUTING -i "${WIFI_IFACE}" -p tcp --dport 80 -j REDIRECT --to-port 3000 2>/dev/null || true

  # Block Bluetooth to free 2.4GHz spectrum and internal resources for Wi-Fi
  echo "[*] Blocking Bluetooth to improve Wi-Fi performance..."
  sudo rfkill block bluetooth 2>/dev/null || true

  echo ""
  echo "========================================================="
  echo " Field Mode Active!"
  echo "  • 5GHz Wi-Fi Hotspot: SSID '${SSID}' (Password: '${PASS}')"
  echo "  • Web UI:             http://192.168.4.1:3000"
  echo "  • Camera LAN:         http://192.168.1.100:3000"
  echo "========================================================="
}

apply_dhcp_mode() {
  echo ">>> Reverting Ethernet and Wi-Fi to standard DHCP..."
  
  sudo nmcli connection delete "Speedcamera-Ethernet-DHCP" 2>/dev/null || true
  sudo nmcli connection add type ethernet ifname "${ETH_IFACE}" con-name "Speedcamera-Ethernet-DHCP" autoconnect yes ipv4.method auto 2>/dev/null || true
  sudo nmcli connection up "Speedcamera-Ethernet-DHCP" 2>/dev/null || true
  
  sudo nmcli connection delete "Speedcamera-CameraLAN" 2>/dev/null || true
  sudo nmcli connection delete "Speedcamera-Hotspot" 2>/dev/null || true
  sudo nmcli connection delete "Speedcamera-ClientWiFi" 2>/dev/null || true
  echo "Interfaces set to standard DHCP."
}

apply_internet_mode() {
  local WIFI_SSID="$1"
  local WIFI_PASS="$2"
  if [ -z "$WIFI_SSID" ]; then
    echo "Usage: $0 internet <Wi-Fi-SSID> [Wi-Fi-Password]"
    echo "Example: $0 internet MyHomeWiFi SecretPassword123"
    exit 1
  fi

  # Record previous mode before changing configuration so we can revert if needed
  local PREV_MODE="field"
  if nmcli -t -f NAME connection show --active 2>/dev/null | grep -qx "Speedcamera-Ethernet-DHCP"; then
    PREV_MODE="dhcp"
  elif nmcli -t -f NAME connection show 2>/dev/null | grep -qx "Speedcamera-Ethernet-DHCP"; then
    PREV_MODE="dhcp"
  else
    PREV_MODE="field"
  fi

  revert_mode() {
    local reason="$1"
    echo "" >&2
    echo "[-] Error: ${reason}" >&2
    echo "[!] Reverting to ${PREV_MODE} mode to preserve connectivity..." >&2
    echo "" >&2
    sudo nmcli connection delete "Speedcamera-ClientWiFi" 2>/dev/null || true
    if [ "$PREV_MODE" = "dhcp" ]; then
      apply_dhcp_mode
    else
      apply_field_mode
    fi
  }

  echo ">>> Switching to INTERNET / CLIENT MODE (for updates/provisioning)..."
  echo "    Connecting ${WIFI_IFACE} to Wi-Fi SSID: ${WIFI_SSID}"

  sudo nmcli connection delete "Speedcamera-Hotspot" 2>/dev/null || true
  sudo nmcli connection delete "Speedcamera-ClientWiFi" 2>/dev/null || true

  local CONNECT_SUCCESS=0
  if [ -n "$WIFI_PASS" ]; then
    # Scan before trying to connect, to ensure the SSID is visible and avoid stale connection issues
    sudo nmcli dev wifi rescan 2>/dev/null || true
    if sudo nmcli dev wifi connect "${WIFI_SSID}" password "${WIFI_PASS}" ifname "${WIFI_IFACE}" name "Speedcamera-ClientWiFi"; then
      CONNECT_SUCCESS=1
    fi
  else
    if sudo nmcli dev wifi connect "${WIFI_SSID}" ifname "${WIFI_IFACE}" name "Speedcamera-ClientWiFi"; then
      CONNECT_SUCCESS=1
    fi
  fi

  if [ "$CONNECT_SUCCESS" -ne 1 ]; then
    revert_mode "Failed to connect to Wi-Fi network '${WIFI_SSID}'."
    exit 1
  fi

  echo ""
  echo "[*] Connected to Wi-Fi '${WIFI_SSID}'. Waiting 5 seconds for DHCP lease / route assignment before connectivity check..."
  sleep 5

  echo ">>> Checking internet connectivity (pinging 1.1.1.1)..."
  if ping -c 2 -W 3 1.1.1.1 &>/dev/null; then
    echo " Connected to Internet successfully!"
  else
    revert_mode "Wi-Fi connected to '${WIFI_SSID}', but ping to 1.1.1.1 failed (no internet reachability)."
    exit 1
  fi
}

case "$MODE" in
  field|ap)
    apply_field_mode
    ;;

  internet|client|wifi)
    apply_internet_mode "$2" "$3"
    ;;

  dhcp|reset)
    apply_dhcp_mode
    ;;

  status)
    echo "--- Active Network Connections ---"
    nmcli connection show --active || true
    echo ""
    echo "--- IP Addresses ---"
    ip -br addr show || true
    echo ""
    echo "--- Internet Reachability ---"
    if ping -c 1 -W 2 1.1.1.1 &>/dev/null; then
      echo "Status: ONLINE (Internet reachable)"
    else
      echo "Status: OFFLINE (Isolated field mode or no route)"
    fi
    ;;

  *)
    echo "Usage: $0 {field|internet|dhcp|status}"
    echo ""
    echo "Commands:"
    echo "  field                       Set Camera LAN (192.168.1.100) + Hotspot AP (192.168.4.1) [Offline]"
    echo "  internet <SSID> [PASS]      Connect Wi-Fi to home/lab router for updates [Online]"
    echo "  dhcp                        Reset ethernet & Wi-Fi to standard DHCP"
    echo "  status                      Check current IP addresses and connectivity"
    exit 1
    ;;
esac
