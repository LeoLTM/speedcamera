#!/usr/bin/env bash
set -e

# Usage: ./scripts/deploy-to-pi.sh [pi_target] [options]
# Examples:
#   ./scripts/deploy-to-pi.sh pi@raspberrypi.local
#   ./scripts/deploy-to-pi.sh pi@192.168.1.50 --password
#   ./scripts/deploy-to-pi.sh pi@raspberrypi.local --branch feature/headless
#   bun run deploy:pi pi@raspberrypi.local

PI_TARGET="pi@raspberrypi.local"
USE_PASSWORD=false
FORCE_BUILD=false
BUILD_FLAG=""
BRANCH=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --password|-p|--pass)
      USE_PASSWORD=true
      shift
      ;;
    --build|-b|--force-build)
      FORCE_BUILD=true
      BUILD_FLAG="--build"
      shift
      ;;
    --branch)
      BRANCH="$2"
      shift 2
      ;;
    --help|-h)
      echo "Speedcamera Headless Rust Fast Deploy / Upgrade Script"
      echo ""
      echo "Usage: $0 [user@host] [options]"
      echo ""
      echo "Positional Arguments:"
      echo "  [user@host]       SSH target (default: pi@raspberrypi.local or 192.168.1.x)"
      echo ""
      echo "Options:"
      echo "  --password, -p    Force password authentication (disables SSH keys)"
      echo "  --build, -b       Force compiling release binary & frontend on Pi"
      echo "  --branch <name>   Checkout and pull a specific git branch on Pi"
      echo "  --help, -h        Show this help message"
      echo ""
      echo "Notes:"
      echo "  • Requires Pi to be in Internet or DHCP Mode (not Field Mode) to pull from git."
      echo "  • Pulls latest git commits in ~/speedcamera directly on the Pi."
      echo "  • Compiles and updates frontend & Rust release binary entirely on Pi."
      echo "  • No local laptop build or file transfer required."
      exit 0
      ;;
    *)
      if [[ "$1" != -* ]]; then
        PI_TARGET="$1"
      fi
      shift
      ;;
  esac
done

if [[ "$PI_TARGET" == *"192.168.4."* ]]; then
  echo "Error: Target is in Field Mode Hotspot (${PI_TARGET})." >&2
  echo "Deployment requires the Pi to be connected to the internet (Home LAN / DHCP or Client Wi-Fi Mode) to perform git pull and build." >&2
  echo "To connect the Pi to Wi-Fi for updates, run:" >&2
  echo "  ssh ${PI_TARGET} '~/speedcamera/headless-rust/scripts/setup-network.sh internet <SSID> <PASS>'" >&2
  echo "  or plug in Ethernet and run: ssh ${PI_TARGET} '~/speedcamera/headless-rust/scripts/setup-network.sh dhcp'" >&2
  exit 1
fi

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

# 1. Check internet connectivity and pull latest repository changes on the Pi
echo "[1/2] Checking Pi internet connectivity and pulling git updates (~/speedcamera)..."
GIT_CMD="if ! ping -c 1 -W 2 1.1.1.1 &>/dev/null && ! curl -s --connect-timeout 2 https://github.com &>/dev/null; then
  echo 'Error: Pi has no active internet connection. Deployment requires DHCP or Internet mode.' >&2
  echo 'Switch to internet mode: ~/speedcamera/headless-rust/scripts/setup-network.sh internet <SSID> <PASS>' >&2
  exit 1
fi
if [ ! -d ~/speedcamera/.git ]; then
  echo 'Error: ~/speedcamera git repository not found on Pi. Run install:pi first.' >&2
  exit 1
fi
cd ~/speedcamera"

if [ -n "$BRANCH" ]; then
  GIT_CMD+=" && git fetch origin && git checkout ${BRANCH} && git pull origin ${BRANCH}"
else
  GIT_CMD+=" && git pull"
fi

ssh -tt "${SSH_OPTS[@]}" "${PI_TARGET}" "${GIT_CMD}"

# 2. Update frontend/binary & restart service on Pi
echo "[2/2] Running build and updating service directly on Pi..."
# Use -tt to force pseudo-terminal allocation so sudo can prompt for password interactively
ssh -tt "${SSH_OPTS[@]}" "${PI_TARGET}" "cd ~/speedcamera/headless-rust && chmod +x scripts/*.sh && ./scripts/update-pi.sh ${BUILD_FLAG}"

echo ""
echo "========================================================="
echo " Deployment / Upgrade successful on ${PI_TARGET}!"
if [ "$USE_PASSWORD" = true ]; then
  echo " Check live logs: ssh -o PubkeyAuthentication=no ${PI_TARGET} 'sudo journalctl -u speedcamera -f'"
else
  echo " Check live logs: ssh ${PI_TARGET} 'sudo journalctl -u speedcamera -f'"
fi
echo "========================================================="
