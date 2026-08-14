#!/usr/bin/env bash
set -e

FORCE_INSTALL=false

for arg in "$@"; do
  case "$arg" in
    --install|-i)
      FORCE_INSTALL=true
      ;;
  esac
done

TARGET_USER="${SUDO_USER:-$(whoami)}"
TARGET_HOME=$(getent passwd "$TARGET_USER" | cut -d: -f6)
export PATH="${TARGET_HOME}/.bun/bin:/usr/local/bin:/usr/bin:$PATH"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${PROJECT_DIR}"

# Request sudo credentials early so user is prompted interactively if needed
echo "[*] Requesting sudo credentials on Pi..."
sudo -v || { echo "Error: Sudo privileges required to configure services." >&2; exit 1; }

# Check internet availability
HAS_NET=false
if ping -c 1 -W 2 1.1.1.1 &>/dev/null; then
  HAS_NET=true
fi

BUN_BIN=$(command -v bun || echo "${TARGET_HOME}/.bun/bin/bun")

if [ "${FORCE_INSTALL}" = true ]; then
  echo "[*] Force install requested: running bun install..."
  sudo -u "${TARGET_USER}" env PATH="$PATH" "${BUN_BIN}" install --production
elif [ ! -d "node_modules" ]; then
  if [ "$HAS_NET" = true ]; then
    echo "[*] Initial dependencies missing: running bun install..."
    sudo -u "${TARGET_USER}" env PATH="$PATH" "${BUN_BIN}" install --production
  else
    echo ">>> WARNING: node_modules missing and Pi has no internet access."
    echo ">>> Connect Pi to home Wi-Fi to install dependencies: ./scripts/setup-network.sh internet <SSID> <PASS>"
  fi
elif [ "$HAS_NET" = true ]; then
  if [ "package.json" -nt "node_modules" ]; then
    echo "[*] package.json updated: updating production dependencies..."
    sudo -u "${TARGET_USER}" env PATH="$PATH" "${BUN_BIN}" install --production
  fi
else
  echo "[*] Pi in offline mode: skipping package updates (existing dependencies reused)."
fi

# Ensure systemd service exists and is up to date
SERVICE_FILE="/etc/systemd/system/speedcamera.service"

if [ ! -f "$SERVICE_FILE" ]; then
  echo "[*] Creating systemd service file..."
  sudo bash -c "cat > ${SERVICE_FILE}" << SERVICE_EOF
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

[Install]
WantedBy=multi-user.target
SERVICE_EOF
  sudo systemctl daemon-reload
  sudo systemctl enable speedcamera.service
fi

echo "[*] Restarting speedcamera service..."
sudo systemctl daemon-reload
sudo systemctl restart speedcamera.service
sleep 1
sudo systemctl status speedcamera --no-pager
