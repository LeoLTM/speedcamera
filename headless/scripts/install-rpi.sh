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

# Ensure bun is in PATH for current script
export PATH="$HOME/.bun/bin:$PATH"

# 3. Install project dependencies and build production frontend
echo "[3/5] Installing project dependencies & building production bundle..."
cd "$(dirname "$0")/.."
bun install
bun run build

# 4. Install and enable systemd service
echo "[4/5] Installing systemd autostart service..."
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
echo " Daemon & Frontend installation complete!"
echo " Start daemon:      sudo systemctl start speedcamera"
echo " Check daemon logs: sudo journalctl -u speedcamera -f"
echo "========================================================="

# 5. Network Configuration (Final Step with SSH Disconnection Warning)
echo ""
echo "[5/5] Network Configuration (Camera LAN & Wi-Fi Hotspot)"
echo ""
echo "************************************************************************"
echo "  CAUTION: NETWORK INTERFACE CONFIGURATION"
echo "  Applying these network settings may immediately DISCONNECT your"
echo "  current SSH session if you are connected via Wi-Fi or Ethernet!"
echo ""
echo "  • Ethernet (eth0/end0) -> Reconfigured to Static IP 192.168.1.100/24"
echo "  • Wireless (wlan0)     -> Reconfigured as Standalone Hotspot 192.168.4.1"
echo "************************************************************************"
echo ""
read -p "Do you want to configure the dual-subnet network interfaces now? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  # Run dedicated network setup script
  chmod +x scripts/setup-network.sh
  ./scripts/setup-network.sh
else
  echo "Skipping network interface reconfiguration."
  echo "You can run network setup anytime later via: ./scripts/setup-network.sh"
fi

echo ""
echo "========================================================="
echo " Speedcamera setup finished!"
echo " Web UI access:"
echo "  • Hotspot AP:  http://192.168.4.1:3000 (SSID: speedcamera)"
echo "  • Camera LAN:  http://192.168.1.100:3000"
echo "  • Local:       http://localhost:3000"
echo "========================================================="
