#!/usr/bin/env bash
set -e

FORCE_BUILD=false

for arg in "$@"; do
  case "$arg" in
    --build|-b|--force-build)
      FORCE_BUILD=true
      ;;
  esac
done

TARGET_USER="${SUDO_USER:-$(whoami)}"
TARGET_HOME=$(getent passwd "$TARGET_USER" | cut -d: -f6)
export PATH="${TARGET_HOME}/.cargo/bin:${TARGET_HOME}/.bun/bin:/usr/local/bin:/usr/bin:$PATH"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${PROJECT_DIR}"

# Request sudo credentials early so user is prompted interactively if needed
echo "[*] Requesting sudo credentials on Pi..."
sudo -v || { echo "Error: Sudo privileges required to configure services." >&2; exit 1; }

# Check if binary rebuild is needed
NEEDS_BUILD=false
if [ "$FORCE_BUILD" = true ] || [ ! -f "target/release/headless-rust" ]; then
  NEEDS_BUILD=true
elif [ -d "src" ] && [ $(find src Cargo.toml build.rs -newer "target/release/headless-rust" 2>/dev/null | wc -l) -gt 0 ]; then
  NEEDS_BUILD=true
fi

if [ "$NEEDS_BUILD" = true ]; then
  echo "[*] Building release binary with cargo..."
  if ! command -v cargo &> /dev/null && [ ! -x "${TARGET_HOME}/.cargo/bin/cargo" ]; then
    echo "Error: Cargo not found. Please install Rust or run install-rpi.sh first." >&2
    exit 1
  fi
  sudo -u "${TARGET_USER}" env PATH="$PATH" cargo build --release
else
  echo "[*] Release binary is up to date."
fi

# Ensure systemd service exists and is up to date
SERVICE_FILE="/etc/systemd/system/speedcamera.service"

if [ ! -f "$SERVICE_FILE" ]; then
  echo "[*] Creating systemd service file..."
  sudo bash -c "cat > ${SERVICE_FILE}" << SERVICE_EOF
[Unit]
Description=Speedcamera Native Rust Daemon & Web Server
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${TARGET_USER}
WorkingDirectory=${PROJECT_DIR}
Environment=PORT=3000
Environment=HOST=0.0.0.0
Environment=DATA_DIR=${TARGET_HOME}/.speedcamera
Environment=PATH=${TARGET_HOME}/.cargo/bin:${TARGET_HOME}/.bun/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=${PROJECT_DIR}/target/release/headless-rust
Restart=always
RestartSec=2
KillSignal=SIGINT
LimitNOFILE=65536
LimitMEMLOCK=infinity

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
