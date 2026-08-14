#!/usr/bin/env bash
set -e

# Detect non-root target user if executed via sudo
TARGET_USER="${SUDO_USER:-$(whoami)}"
TARGET_HOME=$(getent passwd "$TARGET_USER" | cut -d: -f6)
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "========================================================="
echo " Speedcamera Raspberry Pi Provisioning & Setup"
echo "========================================================="
echo " Target user: ${TARGET_USER} (${TARGET_HOME})"
echo " Project dir: ${PROJECT_DIR}"
echo "========================================================="

# Parse arguments
SKIP_NETWORK=false
ONLY_NETWORK=false
FORCE_BUILD=false
AUTO_FIELD=false

for arg in "$@"; do
  case "$arg" in
    --skip-network|--app-only|--lan|--no-field)
      SKIP_NETWORK=true
      ;;
    --field)
      AUTO_FIELD=true
      ;;
    --network-only)
      ONLY_NETWORK=true
      ;;
    --force-build)
      FORCE_BUILD=true
      ;;
    --help|-h)
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --app-only, --skip-network, --lan   Provision packages, Bun, dependencies, and service (keeps network)"
      echo "  --field                            Provision and immediately switch to Field Mode"
      echo "  --network-only                     Only configure dual-subnet network (Hotspot AP + Camera LAN)"
      echo "  --force-build                      Force Vite frontend build on Pi (NOT recommended: takes >20 mins)"
      echo "  --help, -h                         Show this help message"
      exit 0
      ;;
  esac
done

# Request sudo credentials early so user is prompted interactively if needed
echo "[*] Requesting sudo credentials on Pi..."
sudo -v || { echo "Error: Sudo privileges required to install system packages and services." >&2; exit 1; }

if [ "$ONLY_NETWORK" = true ]; then
  chmod +x "${PROJECT_DIR}/scripts/setup-network.sh"
  "${PROJECT_DIR}/scripts/setup-network.sh" field
  exit 0
fi

# Pre-flight internet check
echo "[*] Checking internet connectivity..."
HAS_INTERNET=true
if ! ping -c 1 -W 2 1.1.1.1 &>/dev/null && ! curl -s --connect-timeout 2 https://bun.sh &>/dev/null; then
  HAS_INTERNET=false
  echo ">>> WARNING: No active internet connection detected on Pi!"
  if [ ! -d "${PROJECT_DIR}/node_modules" ] && [ ! -f "${TARGET_HOME}/.bun/bin/bun" ]; then
    echo "Error: Cannot proceed with initial setup without internet (missing node_modules or Bun)." >&2
    echo "Connect Pi to Wi-Fi/Ethernet with internet first." >&2
    exit 1
  fi
fi

# 1. System packages
if [ "$HAS_INTERNET" = true ]; then
  echo "[1/4] Installing system packages (libaravis, esptool, NetworkManager)..."
  sudo apt-get update
  sudo apt-get install -y \
    libaravis-0.8-0 \
    libaravis-dev \
    esptool \
    network-manager \
    curl \
    unzip \
    git \
    rsync
else
  echo "[1/4] Skipping apt package updates (offline mode)."
fi

# Apply GigE Vision socket buffer tuning (64MB)
echo "[*] Configuring Linux socket buffers for GigE camera..."
sudo bash -c 'cat > /etc/sysctl.d/60-gige-camera.conf <<EOF
net.core.rmem_max = 67108864
net.core.rmem_default = 33554432
net.core.wmem_max = 67108864
net.core.wmem_default = 33554432
net.core.netdev_max_backlog = 10000
EOF'
sudo sysctl -p /etc/sysctl.d/60-gige-camera.conf 2>/dev/null || sudo sysctl --system 2>/dev/null || true

# 2. Check/Install Bun runtime
BUN_BIN=$(command -v bun || echo "${TARGET_HOME}/.bun/bin/bun")
if [ ! -x "${BUN_BIN}" ] && ! command -v bun &> /dev/null; then
  if [ "$HAS_INTERNET" = true ]; then
    echo "[2/4] Installing Bun runtime for ARM64..."
    sudo -u "${TARGET_USER}" bash -c "curl -fsSL https://bun.sh/install | bash"
    export BUN_INSTALL="${TARGET_HOME}/.bun"
    export PATH="${BUN_INSTALL}/bin:$PATH"
    BUN_BIN="${TARGET_HOME}/.bun/bin/bun"
  else
    echo "Error: Bun not found and no internet connection to download it." >&2
    exit 1
  fi
else
  export PATH="${TARGET_HOME}/.bun/bin:$PATH"
  echo "[2/4] Bun runtime ready: ${BUN_BIN}"
fi

# 3. Dependencies and frontend bundle check
echo "[3/4] Checking project dependencies & frontend bundle..."
cd "${PROJECT_DIR}"
if [ "$HAS_INTERNET" = true ]; then
  sudo -u "${TARGET_USER}" env PATH="$PATH" "${BUN_BIN}" install --production
fi

if [ -f "${PROJECT_DIR}/dist/index.html" ]; then
  echo ">>> Verified pre-built frontend in dist/! (Built locally on dev host)"
elif [ "$FORCE_BUILD" = true ]; then
  echo ">>> [!] WARNING: Building production frontend bundle on Pi..."
  sudo -u "${TARGET_USER}" env PATH="$PATH" "${BUN_BIN}" run build
else
  echo "========================================================================="
  echo " ERROR: Pre-built frontend bundle missing (${PROJECT_DIR}/dist/index.html)"
  echo "========================================================================="
  echo " Building the React/Vite frontend directly on Raspberry Pi can take"
  echo " over 20 minutes and exhausts Pi memory."
  echo ""
  echo " Recommended: Build frontend on your laptop and deploy using:"
  echo "   bun run install:pi ${TARGET_USER}@$(hostname).local"
  echo "   (or: bun run deploy:pi ${TARGET_USER}@$(hostname).local)"
  echo ""
  echo " If you truly want to build directly on the Pi, rerun with:"
  echo "   $0 --force-build"
  echo "========================================================================="
  exit 1
fi

# 4. Systemd daemon installation
echo "[4/4] Configuring systemd autostart service..."
SERVICE_FILE="/etc/systemd/system/speedcamera.service"

sudo bash -c "cat > ${SERVICE_FILE}" <<EOF
[Unit]
Description=Speedcamera Headless Daemon & Web Server
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${TARGET_USER}
WorkingDirectory=${PROJECT_DIR}
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOST=0.0.0.0
Environment=DATA_DIR=${TARGET_HOME}/.speedcamera
Environment=PATH=${TARGET_HOME}/.bun/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=${BUN_BIN} ${PROJECT_DIR}/src/server/index.ts
Restart=always
RestartSec=3
KillSignal=SIGINT
LimitNOFILE=65536
LimitMEMLOCK=infinity

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable speedcamera.service
sudo systemctl restart speedcamera.service

echo ""
echo "========================================================="
echo " Speedcamera Daemon is installed & active!"
echo " Daemon status: sudo systemctl status speedcamera"
echo " Daemon logs:   sudo journalctl -u speedcamera -f"
echo "========================================================="

# Step 5: Network Mode Transition
if [ "$AUTO_FIELD" = true ]; then
  echo "[*] Switching directly to Standalone Field Mode..."
  chmod +x "${PROJECT_DIR}/scripts/setup-network.sh"
  "${PROJECT_DIR}/scripts/setup-network.sh" field
  exit 0
fi

if [ "$SKIP_NETWORK" = true ]; then
  echo "Keeping current network configuration (--skip-network / --lan)."
  echo "When ready for field deployment, run:"
  echo "  ~/speedcamera/headless/scripts/setup-network.sh field"
  exit 0
fi

# If running in interactive terminal, prompt user
if [ -t 0 ]; then
  echo ""
  echo "========================================================================="
  echo " FIELD NETWORK CONFIGURATION (Camera LAN + Hotspot AP)"
  echo "========================================================================="
  echo " Ready to switch Pi into Standalone Field Mode:"
  echo "  • Ethernet (eth0) -> Static IP 192.168.1.100 (GigE Camera LAN)"
  echo "  • Wi-Fi (wlan0)   -> Standalone Hotspot AP 192.168.4.1 (SSID: speedcamera)"
  echo ""
  echo " WARNING: This will disconnect current Wi-Fi/SSH internet connection!"
  echo "========================================================================="
  read -p "Switch to Standalone Field Mode now? (y/N) " -n 1 -r
  echo ""

  if [[ $REPLY =~ ^[Yy]$ ]]; then
    chmod +x "${PROJECT_DIR}/scripts/setup-network.sh"
    "${PROJECT_DIR}/scripts/setup-network.sh" field
  else
    echo "Skipping Field Mode network switch for now."
    echo "Run anytime later: ~/speedcamera/headless/scripts/setup-network.sh field"
  fi
else
  echo "Non-interactive session: Keeping existing network configuration."
  echo "Switch to field mode when ready: ~/speedcamera/headless/scripts/setup-network.sh field"
fi
