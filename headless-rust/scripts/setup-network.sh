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
if [ "$MODE" != "status" ] && [ "$MODE" != "scan" ]; then
  sudo -v || { echo "Error: Sudo privileges required to change network configuration." >&2; exit 1; }
fi

apply_camera_lan_config() {
  echo "[*] Configuring Camera LAN on ${ETH_IFACE} (Static IP 192.168.1.100/24, MTU 9000)..."
  
  # Apply GigE Vision kernel socket buffer optimizations without causing Wi-Fi bufferbloat
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

  # Enable jumbo frames on camera NIC
  sudo ip link set dev "${ETH_IFACE}" mtu 9000 2>/dev/null || true

  sudo nmcli connection delete "Speedcamera-CameraLAN" 2>/dev/null || true
  sudo nmcli connection delete "Speedcamera-Ethernet-DHCP" 2>/dev/null || true
  sudo nmcli connection add type ethernet \
    ifname "${ETH_IFACE}" \
    con-name "Speedcamera-CameraLAN" \
    autoconnect yes \
    ipv4.method manual \
    ipv4.addresses 192.168.1.100/24 \
    ipv4.never-default yes \
    802-3-ethernet.mtu 9000
  sudo nmcli connection up "Speedcamera-CameraLAN" 2>/dev/null || echo "Note: Ethernet link active when camera cable is connected."
}

enforce_wifi_powersave_off() {
  echo "[*] Locking down Wi-Fi power management permanently (wifi.powersave=2)..."
  sudo mkdir -p /etc/NetworkManager/conf.d
  sudo bash -c 'cat > /etc/NetworkManager/conf.d/default-wifi-powersave-off.conf <<EOF
[connection]
wifi.powersave = 2
EOF'

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
}

apply_field_mode() {
  echo ">>> Applying FIELD MODE (Standalone Offline Dual-Subnet):"
  echo "    1. Camera LAN (${ETH_IFACE}) -> Static IP 192.168.1.100/24"
  echo "    2. Hotspot AP (${WIFI_IFACE}) -> Static IP 192.168.4.1/24 (SSID: speedcamera)"
  echo "    NOTE: In this mode, Pi operates standalone/offline."
  echo ""

  # 1. Configure Camera LAN
  apply_camera_lan_config

  # 2. Configure Wi-Fi Hotspot AP (5GHz Band A, Channel 36 to avoid 2.4GHz congestion)
  echo "[*] Configuring 5GHz Wi-Fi Hotspot AP on ${WIFI_IFACE}..."
  SSID="speedcamera"
  PASS="speedcamerapass"

  enforce_wifi_powersave_off

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
  sudo nmcli connection modify "Speedcamera-Hotspot" ipv4.never-default yes 2>/dev/null || true

  sudo nmcli connection up "Speedcamera-Hotspot" 2>/dev/null || echo "Note: Hotspot initialized."

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

apply_client_mode() {
  local WIFI_SSID="$1"
  local WIFI_PASS="$2"

  if [ -z "$WIFI_SSID" ]; then
    echo "Usage: $0 client <Wi-Fi-SSID> [Wi-Fi-Password]"
    echo "Example: $0 client MyHomeWiFi SecretPassword123"
    exit 1
  fi

  echo ">>> Applying WI-FI CLIENT + CAMERA LAN MODE:"
  echo "    1. Camera LAN (${ETH_IFACE}) -> Static IP 192.168.1.100/24 (Direct GigE Camera link)"
  echo "    2. Wi-Fi Client (${WIFI_IFACE}) -> Connecting to SSID: '${WIFI_SSID}' (DHCP)"
  echo "    NOTE: Allows testing if AP mode was root cause of connectivity issues."
  echo ""

  # 1. Configure Camera LAN (isolated static 192.168.1.100)
  apply_camera_lan_config

  # 2. Enforce Wi-Fi Power-Save OFF
  enforce_wifi_powersave_off

  # 3. Clean up fake-internet DNS interception and port 80 redirect so real internet/DNS works
  echo "[*] Cleaning up captive portal DNS rules & port redirects..."
  sudo rm -f /etc/NetworkManager/dnsmasq-shared.d/fake-internet.conf /etc/dnsmasq.d/fake-internet.conf 2>/dev/null || true
  sudo iptables -t nat -D PREROUTING -i "${WIFI_IFACE}" -p tcp --dport 80 -j REDIRECT --to-port 3000 2>/dev/null || true

  # 4. Tear down Hotspot AP profile
  echo "[*] Stopping Wi-Fi Hotspot AP and connecting as Client Station..."
  sudo nmcli connection delete "Speedcamera-Hotspot" 2>/dev/null || true
  sudo nmcli connection delete "Speedcamera-ClientWiFi" 2>/dev/null || true

  # 5. Scan and connect to external Wi-Fi network
  sudo nmcli dev wifi rescan 2>/dev/null || true
  sleep 1

  local CONNECT_SUCCESS=0
  if [ -n "$WIFI_PASS" ]; then
    if sudo nmcli dev wifi connect "${WIFI_SSID}" password "${WIFI_PASS}" ifname "${WIFI_IFACE}" name "Speedcamera-ClientWiFi"; then
      CONNECT_SUCCESS=1
    fi
  else
    if sudo nmcli dev wifi connect "${WIFI_SSID}" ifname "${WIFI_IFACE}" name "Speedcamera-ClientWiFi"; then
      CONNECT_SUCCESS=1
    fi
  fi

  if [ "$CONNECT_SUCCESS" -ne 1 ]; then
    echo "" >&2
    echo "[-] Error: Failed to connect to Wi-Fi network '${WIFI_SSID}'." >&2
    exit 1
  fi

  # Optimize client connection: powersave off, no MAC randomization
  sudo nmcli connection modify "Speedcamera-ClientWiFi" 802-11-wireless.powersave 2 2>/dev/null || true
  sudo nmcli connection modify "Speedcamera-ClientWiFi" 802-11-wireless.mac-address-randomization 1 2>/dev/null || true
  sudo nmcli connection modify "Speedcamera-ClientWiFi" connection.autoconnect yes 2>/dev/null || true

  echo ""
  echo "[*] Connected to '${WIFI_SSID}'. Waiting for DHCP lease..."
  sleep 3

  local WIFI_IP
  WIFI_IP=$(ip -4 -o addr show dev "${WIFI_IFACE}" 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -n 1 || echo "")

  echo ""
  echo "========================================================="
  echo " Wi-Fi Client + Camera LAN Mode Active!"
  echo "  • Connected Wi-Fi:    SSID '${WIFI_SSID}'"
  if [ -n "$WIFI_IP" ]; then
    echo "  • Wi-Fi Client IP:    ${WIFI_IP}"
    echo "  • Web UI:             http://${WIFI_IP}:3000"
  else
    echo "  • Wi-Fi Client IP:    Waiting for DHCP..."
    echo "  • Web UI:             http://raspberrypi.local:3000"
  fi
  echo "  • Camera LAN:         http://192.168.1.100:3000"
  echo "========================================================="
}

apply_dhcp_mode() {
  echo ">>> Reverting Ethernet and Wi-Fi to standard DHCP..."
  
  sudo rm -f /etc/NetworkManager/dnsmasq-shared.d/fake-internet.conf /etc/dnsmasq.d/fake-internet.conf 2>/dev/null || true
  sudo iptables -t nat -D PREROUTING -i "${WIFI_IFACE}" -p tcp --dport 80 -j REDIRECT --to-port 3000 2>/dev/null || true

  sudo nmcli connection delete "Speedcamera-Ethernet-DHCP" 2>/dev/null || true
  sudo nmcli connection add type ethernet ifname "${ETH_IFACE}" con-name "Speedcamera-Ethernet-DHCP" autoconnect yes ipv4.method auto 2>/dev/null || true
  sudo nmcli connection up "Speedcamera-Ethernet-DHCP" 2>/dev/null || true
  
  sudo nmcli connection delete "Speedcamera-CameraLAN" 2>/dev/null || true
  sudo nmcli connection delete "Speedcamera-Hotspot" 2>/dev/null || true
  sudo nmcli connection delete "Speedcamera-ClientWiFi" 2>/dev/null || true
  echo "Interfaces set to standard DHCP."
}

scan_wifi_networks() {
  echo "--- Scanning Visible Wi-Fi Networks ---"
  sudo nmcli dev wifi rescan 2>/dev/null || true
  nmcli -f IN-USE,SSID,MODE,CHAN,RATE,SIGNAL,BARS,SECURITY dev wifi list || true
}

show_status() {
  echo "--- Network Configuration Mode ---"
  local HAS_HOTSPOT=0
  local HAS_CLIENT=0
  local HAS_CAM_LAN=0

  if nmcli -t -f NAME connection show --active 2>/dev/null | grep -qx "Speedcamera-Hotspot"; then
    HAS_HOTSPOT=1
  fi
  if nmcli -t -f NAME connection show --active 2>/dev/null | grep -qx "Speedcamera-ClientWiFi"; then
    HAS_CLIENT=1
  fi
  if nmcli -t -f NAME connection show --active 2>/dev/null | grep -qx "Speedcamera-CameraLAN"; then
    HAS_CAM_LAN=1
  fi

  if [ "$HAS_HOTSPOT" -eq 1 ] && [ "$HAS_CAM_LAN" -eq 1 ]; then
    echo "Mode: FIELD MODE (Hotspot AP 192.168.4.1 + Camera LAN 192.168.1.100)"
  elif [ "$HAS_CLIENT" -eq 1 ] && [ "$HAS_CAM_LAN" -eq 1 ]; then
    echo "Mode: WI-FI CLIENT MODE (External Wi-Fi + Camera LAN 192.168.1.100)"
  elif [ "$HAS_HOTSPOT" -eq 1 ]; then
    echo "Mode: HOTSPOT AP ONLY"
  elif [ "$HAS_CLIENT" -eq 1 ]; then
    echo "Mode: WI-FI CLIENT ONLY"
  elif nmcli -t -f NAME connection show --active 2>/dev/null | grep -qx "Speedcamera-Ethernet-DHCP"; then
    echo "Mode: STANDARD DHCP"
  else
    echo "Mode: CUSTOM / DYNAMIC"
  fi
  echo ""

  echo "--- Active Network Connections ---"
  nmcli connection show --active || true
  echo ""

  echo "--- IP Addresses ---"
  ip -br addr show || true
  echo ""

  echo "--- Wi-Fi Power Management ---"
  if command -v iw &>/dev/null; then
    iw dev "${WIFI_IFACE}" get power_save 2>/dev/null || echo "Power Save: N/A"
  elif command -v iwconfig &>/dev/null; then
    iwconfig "${WIFI_IFACE}" 2>/dev/null | grep -i "Power Management" || echo "Power Save: N/A"
  fi
  echo ""

  echo "--- Internet Reachability ---"
  if ping -c 1 -W 2 1.1.1.1 &>/dev/null; then
    echo "Status: ONLINE (Internet reachable)"
  else
    echo "Status: OFFLINE (Isolated field mode or no default route)"
  fi
}

case "$MODE" in
  field|ap)
    apply_field_mode
    ;;

  client|wifi-client|internet|wifi)
    apply_client_mode "$2" "$3"
    ;;

  dhcp|reset)
    apply_dhcp_mode
    ;;

  scan)
    scan_wifi_networks
    ;;

  status)
    show_status
    ;;

  *)
    echo "Usage: $0 {field|client <SSID> [PASS]|scan|dhcp|status}"
    echo ""
    echo "Commands:"
    echo "  field                       Set Camera LAN (192.168.1.100) + Hotspot AP (192.168.4.1) [Standalone/Field]"
    echo "  client <SSID> [PASS]        Set Camera LAN (192.168.1.100) + Connect Wi-Fi Client to router [Client Mode]"
    echo "  scan                        Scan visible 2.4GHz & 5GHz Wi-Fi networks"
    echo "  dhcp                        Reset ethernet & Wi-Fi to standard DHCP"
    echo "  status                      Check current network mode, IP addresses, and connectivity"
    exit 1
    ;;
esac
