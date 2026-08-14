#!/usr/bin/env bash
set -e

# Usage: ./scripts/deploy-to-pi.sh [pi_target] [options]
# Examples:
#   ./scripts/deploy-to-pi.sh pi@raspberrypi.local
#   ./scripts/deploy-to-pi.sh pi@192.168.4.1 --password
#   bun run deploy:pi pi@raspberrypi.local

PI_TARGET="pi@raspberrypi.local"
USE_PASSWORD=false
FORCE_BUILD=false
BUILD_FLAG=""

# Parse arguments
for arg in "$@"; do
  case "$arg" in
    --password|-p|--pass)
      USE_PASSWORD=true
      ;;
    --build|-b|--force-build)
      FORCE_BUILD=true
      BUILD_FLAG="--build"
      ;;
    --help|-h)
      echo "Speedcamera Headless Rust Fast Deploy / Upgrade Script"
      echo ""
      echo "Usage: $0 [user@host] [options]"
      echo ""
      echo "Positional Arguments:"
      echo "  [user@host]       SSH target (default: pi@raspberrypi.local or 192.168.4.1)"
      echo ""
      echo "Options:"
      echo "  --password, -p    Force password authentication (disables SSH keys)"
      echo "  --build, -b       Force compiling release binary on Pi"
      echo "  --help, -h        Show this help message"
      echo ""
      echo "Notes:"
      echo "  • Automatically builds frontend locally on host (fast: ~2s)."
      echo "  • Works seamlessly in Field Mode (offline) or Home LAN Mode (online)."
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
SOCKET_DIR="/tmp/speedcamera-deploy-ssh-$$"
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
echo " Deploying / Upgrading Speedcamera Rust: ${PI_TARGET}"
echo "========================================================="

# 1. Build frontend bundle on host (fast!)
echo "[1/3] Building frontend bundle locally on host machine..."
cd "${HEADLESS_DIR}"
bun run build

# 2. Sync files to Pi (skipping heavy debug targets, node_modules & git)
echo "[2/3] Syncing files to Pi..."
ssh "${SSH_OPTS[@]}" "${PI_TARGET}" "mkdir -p ~/speedcamera/headless-rust"

RSYNC_SSH="ssh"
for opt in "${SSH_OPTS[@]}"; do
  RSYNC_SSH+=" $(printf "%q" "$opt")"
done

rsync -avz --delete \
  -e "${RSYNC_SSH}" \
  --exclude 'target/debug' \
  --exclude 'target/release/incremental' \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '*.log' \
  "${HEADLESS_DIR}/" "${PI_TARGET}:~/speedcamera/headless-rust/"

# 3. Update binary & restart service on Pi
echo "[3/3] Updating service on Pi..."
# Use -tt to force pseudo-terminal allocation so sudo can prompt for password interactively
ssh -tt "${SSH_OPTS[@]}" "${PI_TARGET}" "chmod +x ~/speedcamera/headless-rust/scripts/*.sh && ~/speedcamera/headless-rust/scripts/update-pi.sh ${BUILD_FLAG}"

echo ""
echo "========================================================="
echo " Deployment / Upgrade successful on ${PI_TARGET}!"
if [ "$USE_PASSWORD" = true ]; then
  echo " Check live logs: ssh -o PubkeyAuthentication=no ${PI_TARGET} 'sudo journalctl -u speedcamera -f'"
else
  echo " Check live logs: ssh ${PI_TARGET} 'sudo journalctl -u speedcamera -f'"
fi
echo "========================================================="
