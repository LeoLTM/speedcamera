#!/usr/bin/env bash
set -e

echo "========================================================="
echo " Speedcamera Network Configuration (Dual Subnet Setup)"
echo "========================================================="
echo ""
echo " Architecture:"
echo "  1. Camera LAN (eth0)   -> Static IP 192.168.1.100/24 (Subnet 192.168.1.0/24 for GigE camera)"
echo "  2. Hotspot AP (wlan0)  -> Static IP 192.168.4.1/24   (Subnet 192.168.4.0/24 for Web UI clients)"
echo "========================================================="

# Detect Ethernet Interface (eth0, end0, etc.)
ETH_IFACE=$(ip -o link show | awk -F': ' '{print $2}' | grep -E '^(eth|end|enp)' | head -n 1 || echo "eth0")
# Detect Wi-Fi Interface (wlan0, wifi0, etc.)
WIFI_IFACE=$(ip -o link show | awk -F': ' '{print $2}' | grep -E '^(wlan|wifi|wlp)' | head -n 1 || echo "wlan0")

echo "[*] Detected Interfaces:"
echo "    Ethernet (Camera LAN): ${ETH_IFACE}"
echo "    Wireless (Hotspot AP): ${WIFI_IFACE}"
echo ""

# 1. Configure Ethernet Camera LAN (192.168.1.100/24)
echo "[1/2] Configuring Camera LAN on ${ETH_IFACE}..."
echo "      Setting static IPv4: 192.168.1.100/24 (Camera subnet)..."

sudo nmcli connection delete "Speedcamera-CameraLAN" 2>/dev/null || true

sudo nmcli connection add type ethernet \
  ifname "${ETH_IFACE}" \
  con-name "Speedcamera-CameraLAN" \
  autoconnect yes \
  ipv4.method manual \
  ipv4.addresses 192.168.1.100/24 \
  ipv4.never-default yes

sudo nmcli connection up "Speedcamera-CameraLAN" || echo "Note: Ethernet link will come up when camera cable is connected."

# 2. Configure Wi-Fi Hotspot AP (192.168.4.1/24)
echo ""
echo "[2/2] Configuring Wi-Fi Hotspot AP on ${WIFI_IFACE}..."
SSID="speedcamera"
PASS="speedcamerapass"

sudo nmcli connection delete "Speedcamera-Hotspot" 2>/dev/null || true

sudo nmcli connection add type wifi \
  ifname "${WIFI_IFACE}" \
  con-name "Speedcamera-Hotspot" \
  autoconnect yes \
  ssid "${SSID}" \
  mode ap \
  802-11-wireless.band bg \
  ipv4.method shared \
  ipv4.addresses 192.168.4.1/24 \
  wifi-sec.key-mgmt wpa-psk \
  wifi-sec.psk "${PASS}"

sudo nmcli connection up "Speedcamera-Hotspot" || echo "Note: Run 'sudo nmcli connection up Speedcamera-Hotspot' once wireless interface is ready."

echo ""
echo "========================================================="
echo " Network setup complete!"
echo "  • Industrial Camera LAN: ${ETH_IFACE} @ 192.168.1.100"
echo "  • Wi-Fi Access Point:    ${WIFI_IFACE} @ 192.168.4.1 (SSID: ${SSID})"
echo "  • Web UI Accessible at:  http://192.168.4.1:3000"
echo "========================================================="
