#!/usr/bin/env bash
set -e

# Usage: ./scripts/install-remote.sh [pi_target] [options]
# Examples:
#   ./scripts/install-remote.sh pi@raspberrypi.local
#   ./scripts/install-remote.sh pi@192.168.1.50 --password
#   ./scripts/install-remote.sh pi@raspberrypi.local --field
#   ./scripts/install-remote.sh pi@raspberrypi.local --branch feature/headless
#   bun run install:pi pi@raspberrypi.local

PI_TARGET="pi@raspberrypi.local"
USE_PASSWORD=false
NETWORK_FLAG=""
PURGE_FIRST=false
REPO_URL="https://github.com/LeoLTM/speedcamera.git"
BRANCH=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --password|-p|--pass)
      USE_PASSWORD=true
      shift
      ;;
    --field)
      NETWORK_FLAG="--field"
      shift
      ;;
    --lan|--no-field|--skip-network)
      NETWORK_FLAG="--skip-network"
      shift
      ;;
    --purge)
      PURGE_FIRST=true
      shift
      ;;
    --repo)
      REPO_URL="$2"
      shift 2
      ;;
    --branch)
      BRANCH="$2"
      shift 2
      ;;
    --help|-h)
      echo "Speedcamera Headless Rust Remote Installer"
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
      echo "  --repo <url>                 Git repository URL (default: https://github.com/LeoLTM/speedcamera.git)"
      echo "  --branch <name>              Git branch to checkout on Pi"
      echo "  --help, -h                   Show this help message"
      echo ""
      echo "Notes:"
      echo "  • Requires Pi to be in Internet or DHCP Mode (not Field Mode) for package installation."
      echo "  • Clones/pulls the speedcamera repo directly to ~/speedcamera on the Pi."
      echo "  • Provisions system dependencies, Rust toolchain, and Bun runtime on the Pi."
      echo "  • Builds the frontend and compiles the native Rust release binary directly on the Pi."
      echo "  • All internet-dependent steps complete before optionally transitioning to Field Mode."
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
  echo "Fresh installation requires the Pi to be in DHCP or Internet Mode to install packages and dependencies." >&2
  echo "Please connect the Pi to your home router / Wi-Fi via DHCP before installing." >&2
  exit 1
fi

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
echo " Speedcamera Rust Remote Pi Fresh Installer"
echo " Target: ${PI_TARGET}"
echo "========================================================="

# 1. Test SSH connectivity & internet reachability on Pi
echo "[1/3] Connecting to ${PI_TARGET} and verifying internet reachability..."
if ! ssh "${SSH_OPTS[@]}" "${PI_TARGET}" "echo 'Connected successfully to '\$(hostname)" ; then
  echo "Error: Cannot connect to ${PI_TARGET} via SSH." >&2
  exit 1
fi

CHECK_NET_CMD="if ! ping -c 1 -W 2 1.1.1.1 &>/dev/null && ! curl -s --connect-timeout 2 https://github.com &>/dev/null; then
  echo 'Error: Pi has no active internet connection. Installation requires DHCP or Internet mode.' >&2
  exit 1
fi"
ssh "${SSH_OPTS[@]}" "${PI_TARGET}" "${CHECK_NET_CMD}"

# Optional cleanup before fresh install
if [ "$PURGE_FIRST" = true ]; then
  echo "[*] Purging existing speedcamera installation on Pi..."
  ssh -tt "${SSH_OPTS[@]}" "${PI_TARGET}" "sudo -v || true; sudo systemctl stop speedcamera 2>/dev/null || true; sudo systemctl disable speedcamera 2>/dev/null || true; sudo rm -f /etc/systemd/system/speedcamera.service; sudo systemctl daemon-reload 2>/dev/null || true; rm -rf ~/speedcamera"
fi

# 2. Clone or update repository on the Pi
echo "[2/3] Setting up speedcamera repository in ~/speedcamera on Pi..."
if [ -n "$BRANCH" ]; then
  GIT_SETUP="if [ ! -d ~/speedcamera/.git ]; then sudo apt-get update -qq && sudo apt-get install -y git && git clone -b ${BRANCH} ${REPO_URL} ~/speedcamera; else cd ~/speedcamera && git fetch origin && git checkout ${BRANCH} && git pull origin ${BRANCH}; fi"
else
  GIT_SETUP="if [ ! -d ~/speedcamera/.git ]; then sudo apt-get update -qq && sudo apt-get install -y git && git clone ${REPO_URL} ~/speedcamera; else cd ~/speedcamera && git pull; fi"
fi

ssh -tt "${SSH_OPTS[@]}" "${PI_TARGET}" "${GIT_SETUP}"

# 3. Execute installer on Pi (all internet tasks complete before any Field Mode switch)
echo "[3/3] Running system provisioning, dependencies setup, frontend & native Rust compilation on Pi..."
REMOTE_CMD="cd ~/speedcamera/headless-rust && chmod +x scripts/*.sh && ./scripts/install-rpi.sh ${NETWORK_FLAG}"

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
  echo " Network: Home LAN / DHCP Mode Active"
  echo "   • Web UI:        http://${PI_TARGET#*@}:3000 (or http://raspberrypi.local:3000)"
  echo "   • Switch to field mode when ready: ssh ${PI_TARGET} '~/speedcamera/headless-rust/scripts/setup-network.sh field'"
fi
echo ""
echo " View logs: ssh ${PI_TARGET} 'sudo journalctl -u speedcamera -f'"
echo "========================================================="
