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

case "$MODE" in
  field|ap)
    echo ">>> Applying FIELD MODE (Standalone Offline Dual-Subnet):"
    echo "    1. Camera LAN (${ETH_IFACE}) -> Static IP 192.168.1.100/24"
    echo "    2. Hotspot AP (${WIFI_IFACE}) -> Static IP 192.168.4.1/24 (SSID: speedcamera)"
    echo "    NOTE: In this mode, Pi operates standalone/offline."
    echo ""

    # Apply GigE Vision kernel socket buffer optimizations without causing Wi-Fi bufferbloat
    echo "[*] Applying optimized network socket buffer configuration (128MB max, clean TCP defaults)..."
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
# Prevent dirty-page writeback stalls when saving capture images
vm.dirty_background_ratio = 5
vm.dirty_ratio = 10
EOF'
    sudo sysctl -p /etc/sysctl.d/60-gige-camera.conf 2>/dev/null || sudo sysctl --system 2>/dev/null || true

    # Enable jumbo frames on camera NIC — critical for GigE Vision throughput.
    # Larger MTU = fewer packets = fewer interrupts = less CPU/softirq pressure.
    echo "[*] Enabling jumbo frames (MTU 9000) on ${ETH_IFACE}..."
    sudo ip link set dev "${ETH_IFACE}" mtu 9000 2>/dev/null || echo "Note: MTU 9000 not supported by NIC/driver, keeping default."

    # Configure Wi-Fi Hotspot AP
    echo "[1/2] Configuring Wi-Fi Hotspot AP on ${WIFI_IFACE}..."
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
      802-11-wireless.band bg \
      802-11-wireless.channel 6 \
      802-11-wireless.powersave 2 \
      ipv4.method shared \
      ipv4.addresses 192.168.4.1/24 \
      wifi-sec.key-mgmt wpa-psk \
      wifi-sec.psk "${PASS}"
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

    # Disable Wi-Fi power saving on AP interface to eliminate latency spikes and disconnects
    echo "[*] Disabling Wi-Fi power saving on ${WIFI_IFACE}..."
    sudo iw dev "${WIFI_IFACE}" set power_save off 2>/dev/null || sudo iwconfig "${WIFI_IFACE}" power off 2>/dev/null || true

    # Block Bluetooth to free 2.4GHz spectrum and internal resources for Wi-Fi
    echo "[*] Blocking Bluetooth to improve Wi-Fi performance..."
    sudo rfkill block bluetooth 2>/dev/null || true

    echo ""
    echo "========================================================="
    echo " Field Mode Active!"
    echo "  • Wi-Fi Hotspot: SSID '${SSID}' (Password: '${PASS}')"
    echo "  • Web UI:        http://192.168.4.1:3000"
    echo "  • Camera LAN:    http://192.168.1.100:3000"
    echo "========================================================="
    ;;

  internet|client|wifi)
    WIFI_SSID="$2"
    WIFI_PASS="$3"
    if [ -z "$WIFI_SSID" ]; then
      echo "Usage: $0 internet <Wi-Fi-SSID> [Wi-Fi-Password]"
      echo "Example: $0 internet MyHomeWiFi SecretPassword123"
      exit 1
    fi
    echo ">>> Switching to INTERNET / CLIENT MODE (for updates/provisioning)..."
    echo "    Connecting ${WIFI_IFACE} to Wi-Fi SSID: ${WIFI_SSID}"

    sudo nmcli connection delete "Speedcamera-Hotspot" 2>/dev/null || true
    sudo nmcli connection delete "Speedcamera-ClientWiFi" 2>/dev/null || true

    if [ -n "$WIFI_PASS" ]; then
      sudo nmcli dev wifi connect "${WIFI_SSID}" password "${WIFI_PASS}" ifname "${WIFI_IFACE}" name "Speedcamera-ClientWiFi"
    else
      sudo nmcli dev wifi connect "${WIFI_SSID}" ifname "${WIFI_IFACE}" name "Speedcamera-ClientWiFi"
    fi

    echo ""
    echo ">>> Checking internet connectivity..."
    if ping -c 2 -W 3 1.1.1.1 &>/dev/null; then
      echo " Connected to Internet successfully!"
    else
      echo " Wi-Fi connected, but ping to 1.1.1.1 failed. Check gateway/DNS."
    fi
    ;;

  dhcp|reset)
    echo ">>> Reverting Ethernet and Wi-Fi to standard DHCP..."
    
    sudo nmcli connection delete "Speedcamera-Ethernet-DHCP" 2>/dev/null || true
    sudo nmcli connection add type ethernet ifname "${ETH_IFACE}" con-name "Speedcamera-Ethernet-DHCP" autoconnect yes ipv4.method auto 2>/dev/null || true
    sudo nmcli connection up "Speedcamera-Ethernet-DHCP" 2>/dev/null || true
    
    sudo nmcli connection delete "Speedcamera-CameraLAN" 2>/dev/null || true
    sudo nmcli connection delete "Speedcamera-Hotspot" 2>/dev/null || true
    sudo nmcli connection delete "Speedcamera-ClientWiFi" 2>/dev/null || true
    echo "Interfaces set to standard DHCP."
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
