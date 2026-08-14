#!/usr/bin/env bash
set -e

# Target user and directories
TARGET_USER="${SUDO_USER:-$(whoami)}"
TARGET_HOME=$(getent passwd "$TARGET_USER" | cut -d: -f6)

PURGE_DATA=false
CONFIRM_YES=false

for arg in "$@"; do
  case "$arg" in
    --purge)
      PURGE_DATA=true
      ;;
    --yes|-y)
      CONFIRM_YES=true
      ;;
    --help|-h)
      echo "Speedcamera Raspberry Pi Complete Uninstaller & Network Reset"
      echo ""
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --purge        Also delete data directory (${TARGET_HOME}/.speedcamera - database & images)"
      echo "  --yes, -y      Non-interactive mode (skip confirmation prompts)"
      echo "  --help, -h     Show this help message"
      exit 0
      ;;
  esac
done

echo "========================================================="
echo " Speedcamera Complete Teardown & Reset"
echo " Target user: ${TARGET_USER} (${TARGET_HOME})"
echo "========================================================="

if [ "$CONFIRM_YES" = false ] && [ -t 0 ]; then
  read -p "Are you sure you want to completely uninstall Speedcamera and reset network? (y/N) " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
fi

# Refresh sudo credentials upfront
echo "[*] Requesting sudo credentials..."
sudo -v || { echo "Error: Sudo privileges required to reset network and services." >&2; exit 1; }

# 1. Stop & remove systemd service
echo "[1/4] Stopping and removing systemd service..."
sudo systemctl stop speedcamera.service 2>/dev/null || true
sudo systemctl disable speedcamera.service 2>/dev/null || true
sudo rm -f /etc/systemd/system/speedcamera.service
sudo systemctl daemon-reload 2>/dev/null || true
sudo systemctl reset-failed 2>/dev/null || true

# 2. Remove application files & optional data purge
echo "[2/4] Removing speedcamera application files..."
rm -rf "${TARGET_HOME}/speedcamera"

if [ "$PURGE_DATA" = true ]; then
  echo "      Purging data directory (${TARGET_HOME}/.speedcamera)..."
  rm -rf "${TARGET_HOME}/.speedcamera"
else
  echo "      Preserving data directory (${TARGET_HOME}/.speedcamera). Use --purge to delete."
fi

# 3. Reset Ethernet interface to standard DHCP first
echo "[3/4] Resetting Ethernet to standard auto-DHCP..."
if command -v nmcli &>/dev/null; then
  sudo nmcli connection delete "Speedcamera-CameraLAN" 2>/dev/null || true
  sudo nmcli connection delete "Speedcamera-Ethernet-DHCP" 2>/dev/null || true

  ETH_IFACE=$(ip -o link show | awk -F': ' '{print $2}' | grep -E '^(eth|end|enp)' | head -n 1 || echo "")
  if [ -n "$ETH_IFACE" ]; then
    echo "      Re-enabling standard DHCP on Ethernet (${ETH_IFACE})..."
    sudo nmcli device set "${ETH_IFACE}" managed yes 2>/dev/null || true
    sudo nmcli connection add type ethernet ifname "${ETH_IFACE}" con-name "Wired connection 1" autoconnect yes ipv4.method auto 2>/dev/null || true
    sudo nmcli connection up "Wired connection 1" 2>/dev/null || true
  fi
fi

# 4. Reset Wi-Fi interface (handle active hotspot SSH session safely)
echo "[4/4] Resetting Wi-Fi & Hotspot profiles..."
IS_HOTSPOT_SSH=false
if echo "${SSH_CONNECTION:-}" | grep -q "192.168.4."; then
  IS_HOTSPOT_SSH=true
fi

if [ "$IS_HOTSPOT_SSH" = true ]; then
  echo "      [!] Active SSH session over Wi-Fi Hotspot (192.168.4.1) detected."
  echo "      Scheduling Hotspot teardown in background (2s delay) to close SSH cleanly..."
  sudo nohup bash -c '
    sleep 2
    nmcli connection delete "Speedcamera-Hotspot" 2>/dev/null || true
    nmcli connection delete "Speedcamera-ClientWiFi" 2>/dev/null || true
    WIFI_IFACE=$(ip -o link show | awk -F": " "{print \$2}" | grep -E "^(wlan|wifi|wlp)" | head -n 1 || echo "")
    if [ -n "$WIFI_IFACE" ]; then
      nmcli device set "$WIFI_IFACE" managed yes 2>/dev/null || true
    fi
  ' >/dev/null 2>&1 &
else
  if command -v nmcli &>/dev/null; then
    sudo nmcli connection delete "Speedcamera-Hotspot" 2>/dev/null || true
    sudo nmcli connection delete "Speedcamera-ClientWiFi" 2>/dev/null || true
    WIFI_IFACE=$(ip -o link show | awk -F': ' '{print $2}' | grep -E '^(wlan|wifi|wlp)' | head -n 1 || echo "")
    if [ -n "$WIFI_IFACE" ]; then
      sudo nmcli device set "${WIFI_IFACE}" managed yes 2>/dev/null || true
    fi
  fi
fi

echo ""
echo "========================================================="
echo " Speedcamera uninstallation complete!"
echo " • Services stopped & removed"
echo " • Application files deleted"
echo " • Ethernet reverted to standard DHCP (connect cable to router)"
if [ "$IS_HOTSPOT_SSH" = true ]; then
  echo " • Wi-Fi Hotspot is shutting down now."
else
  echo " • Wi-Fi reset to client DHCP mode."
fi
echo "========================================================="
