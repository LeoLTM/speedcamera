#!/usr/bin/env bash
set -e

echo "========================================================="
echo " Speedcamera Raspberry Pi OS Lite Setup & Install Script"
echo "========================================================="

# 1. Update and install required system packages
echo "[1/5] Installing system packages (Aravis, esptool, NetworkManager)..."
sudo apt-get update
sudo apt-get install -y \
  libaravis-0.8-0 \
  libaravis-dev \
  esptool \
  network-manager \
  curl \
  unzip \
  git

# 2. Check/Install Bun runtime
if ! command -v bun &> /dev/null; then
  echo "[2/5] Installing Bun runtime for ARM64..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
else
  echo "[2/5] Bun already installed: $(bun --version)"
fi

# 3. Install project dependencies and build frontend
echo "[3/5] Installing project dependencies & building frontend..."
bun install
bun run build

# 4. Configure Networking (Camera LAN 192.168.1.100 + Wi-Fi Hotspot 192.168.4.1)
echo "[4/5] Network Configuration (Camera LAN & Wi-Fi Hotspot)"
read -p "Do you want to configure the dual-subnet network interfaces? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  # Detect interfaces
  ETH_IFACE=$(ip -o link show | awk -F': ' '{print $2}' | grep -E '^(eth|end|enp)' | head -n 1 || echo "eth0")
  WIFI_IFACE=$(ip -o link show | awk -F': ' '{print $2}' | grep -E '^(wlan|wifi|wlp)' | head -n 1 || echo "wlan0")

  # 4a. Camera Ethernet LAN
  echo "Configuring Camera LAN on ${ETH_IFACE} (Static IP: 192.168.1.100/24)..."
  sudo nmcli connection delete "Speedcamera-CameraLAN" 2>/dev/null || true
  sudo nmcli connection add type ethernet ifname "${ETH_IFACE}" con-name "Speedcamera-CameraLAN" autoconnect yes \
    ipv4.method manual ipv4.addresses 192.168.1.100/24 ipv4.never-default yes
  sudo nmcli connection up "Speedcamera-CameraLAN" || echo "Note: Ethernet link active when camera connected."

  # 4b. Wi-Fi Hotspot
  SSID="speedcamera"
  PASS="speedcamerapass"
  echo "Configuring Wi-Fi Hotspot on ${WIFI_IFACE} (SSID: '${SSID}', IP: 192.168.4.1/24)..."
  sudo nmcli connection delete "Speedcamera-Hotspot" 2>/dev/null || true
  sudo nmcli connection add type wifi ifname "${WIFI_IFACE}" con-name "Speedcamera-Hotspot" autoconnect yes \
    ssid "${SSID}" mode ap 802-11-wireless.band bg \
    ipv4.method shared ipv4.addresses 192.168.4.1/24 \
    wifi-sec.key-mgmt wpa-psk wifi-sec.psk "${PASS}"
  sudo nmcli connection up "Speedcamera-Hotspot" || echo "Note: Run 'sudo nmcli connection up Speedcamera-Hotspot' once wireless interface is ready."
fi

# 5. Install and enable systemd service
echo "[5/5] Installing systemd autostart service..."
CURRENT_USER=$(whoami)
PROJECT_DIR=$(pwd)
BUN_BIN=$(command -v bun || echo "$HOME/.bun/bin/bun")

SERVICE_FILE="/etc/systemd/system/speedcamera.service"

sudo bash -c "cat > ${SERVICE_FILE}" <<EOF
[Unit]
Description=Speedcamera Headless Daemon & Web Server
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${CURRENT_USER}
WorkingDirectory=${PROJECT_DIR}
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOST=0.0.0.0
Environment=DATA_DIR=${HOME}/.speedcamera
ExecStart=${BUN_BIN} src/server/index.ts
Restart=always
RestartSec=3
KillSignal=SIGINT
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable speedcamera.service

echo ""
echo "========================================================="
echo " Setup complete!"
echo " Start daemon:      sudo systemctl start speedcamera"
echo " Check daemon logs: sudo journalctl -u speedcamera -f"
echo " Camera LAN (eth0): Static IP 192.168.1.100/24"
echo " Wi-Fi Hotspot:     http://192.168.4.1:3000"
echo "========================================================="
