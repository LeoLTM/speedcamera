#!/usr/bin/env bash
set -e

# Usage: ./scripts/install-remote.sh [pi_target] [options]
# Examples:
#   ./scripts/install-remote.sh pi@raspberrypi.local
#   ./scripts/install-remote.sh pi@192.168.1.50 --password
#   ./scripts/install-remote.sh pi@raspberrypi.local --field
#   bun run install:pi pi@raspberrypi.local

PI_TARGET="pi@raspberrypi.local"
USE_PASSWORD=false
NETWORK_FLAG=""
PURGE_FIRST=false

# Parse arguments
for arg in "$@"; do
  case "$arg" in
    --password|-p|--pass)
      USE_PASSWORD=true
      ;;
    --field)
      NETWORK_FLAG="--field"
      ;;
    --lan|--no-field|--skip-network)
      NETWORK_FLAG="--skip-network"
      ;;
    --purge)
      PURGE_FIRST=true
      ;;
    --help|-h)
      echo "Speedcamera Headless Remote Installer"
      echo ""
      echo "Usage: $0 [user@host] [options]"
      echo ""
      echo "Positional Arguments:"
      echo "  [user@host]                  SSH target (default: pi@raspberrypi.local)"
      echo ""
      echo "Options:"
      echo "  --password, -p               Force password authentication (disables SSH keys)"
      echo "  --field                      Automatically switch Pi to Field Mode (Camera LAN + Hotspot AP)"
      echo "  --lan, --skip-network        Keep Pi connected to Home LAN/Wi-Fi (skip field network setup)"
      echo "  --purge                      Clean up any existing speedcamera files/services before install"
      echo "  --help, -h                   Show this help message"
      echo ""
      echo "Notes:"
      echo "  • The React frontend is built on this machine (fast: <2s) and synced to the Pi."
      echo "  • The Pi is never required to run slow Vite/React builds."
      exit 0
      ;;
    *)
      if [[ "$arg" != -* ]]; then
        PI_TARGET="$arg"
      fi
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HEADLESS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Setup SSH Connection Multiplexing so password is typed at most once
SOCKET_DIR="/tmp/speedcamera-install-ssh-$$"
mkdir -p "$SOCKET_DIR"
SOCKET_PATH="${SOCKET_DIR}/socket"

SSH_OPTS=(-o "ControlMaster=auto" -o "ControlPath=${SOCKET_PATH}" -o "ControlPersist=60s" -o "ConnectTimeout=10")

if [ "$USE_PASSWORD" = true ]; then
  echo "[*] Password authentication enabled (-o PubkeyAuthentication=no)"
  SSH_OPTS+=(-o "PubkeyAuthentication=no" -o "PreferredAuthentications=password,keyboard-interactive")
fi

cleanup() {
  ssh -O exit -o "ControlPath=${SOCKET_PATH}" "${PI_TARGET}" 2>/dev/null || true
  rm -rf "$SOCKET_DIR"
}
trap cleanup EXIT INT TERM

echo "========================================================="
echo " Speedcamera Remote Pi Fresh Installer"
echo " Target: ${PI_TARGET}"
echo "========================================================="

# 1. Build frontend bundle on local laptop
echo "[1/4] Building frontend bundle locally on host machine..."
cd "${HEADLESS_DIR}"
bun run build

# 2. Test SSH connectivity
echo "[2/4] Connecting to ${PI_TARGET}..."
if ! ssh "${SSH_OPTS[@]}" "${PI_TARGET}" "echo 'Connected successfully to '\$(hostname)" ; then
  echo "Error: Cannot connect to ${PI_TARGET} via SSH." >&2
  exit 1
fi

# Optional cleanup before fresh install
if [ "$PURGE_FIRST" = true ]; then
  echo "[*] Purging existing speedcamera installation on Pi..."
  ssh -tt "${SSH_OPTS[@]}" "${PI_TARGET}" "sudo -v || true; sudo systemctl stop speedcamera 2>/dev/null || true; sudo systemctl disable speedcamera 2>/dev/null || true; sudo rm -f /etc/systemd/system/speedcamera.service; sudo systemctl daemon-reload 2>/dev/null || true; rm -rf ~/speedcamera"
fi

# 3. Sync repository & pre-built dist to Pi
echo "[3/4] Syncing application and pre-built frontend to Pi..."
ssh "${SSH_OPTS[@]}" "${PI_TARGET}" "mkdir -p ~/speedcamera/headless"

RSYNC_SSH="ssh"
for opt in "${SSH_OPTS[@]}"; do
  RSYNC_SSH+=" $(printf "%q" "$opt")"
done

rsync -avz --delete \
  -e "${RSYNC_SSH}" \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '*.log' \
  "${HEADLESS_DIR}/" "${PI_TARGET}:~/speedcamera/headless/"

# 4. Execute installer on Pi
echo "[4/4] Running system provisioning and service installation on Pi..."
REMOTE_CMD="chmod +x ~/speedcamera/headless/scripts/*.sh && ~/speedcamera/headless/scripts/install-rpi.sh ${NETWORK_FLAG}"

# Use -tt to force pseudo-terminal allocation so sudo can prompt for password interactively
ssh -tt "${SSH_OPTS[@]}" "${PI_TARGET}" "${REMOTE_CMD}"

echo ""
echo "========================================================="
echo " Installation Complete on ${PI_TARGET}!"
echo "========================================================="
if [ "$NETWORK_FLAG" = "--field" ]; then
  echo " Network: Standalone Field Mode Active"
  echo "   • Connect Wi-Fi: SSID 'speedcamera' (Pass: 'speedcamerapass')"
  echo "   • Web UI:        http://192.168.4.1:3000"
  echo "   • Camera LAN:    http://192.168.1.100:3000"
else
  echo " Network: Home LAN Mode Active"
  echo "   • Web UI:        http://${PI_TARGET#*@}:3000 (or http://raspberrypi.local:3000)"
  echo "   • Switch to field mode later: ssh ${PI_TARGET} '~/speedcamera/headless/scripts/setup-network.sh field'"
fi
echo ""
echo " View logs: ssh ${PI_TARGET} 'sudo journalctl -u speedcamera -f'"
echo "========================================================="
