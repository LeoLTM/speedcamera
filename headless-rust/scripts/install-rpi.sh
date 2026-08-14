#!/usr/bin/env bash
set -e

# Detect non-root target user if executed via sudo
TARGET_USER="${SUDO_USER:-$(whoami)}"
TARGET_HOME=$(getent passwd "$TARGET_USER" | cut -d: -f6)
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "========================================================="
echo " Speedcamera Rust Raspberry Pi Provisioning & Setup"
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
    --force-build|--build)
      FORCE_BUILD=true
      ;;
    --help|-h)
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --app-only, --skip-network, --lan   Provision packages, Rust, Bun, binary, and service (keeps network)"
      echo "  --field                            Provision and immediately switch to Field Mode"
      echo "  --network-only                     Only configure dual-subnet network (Hotspot AP + Camera LAN)"
      echo "  --build, --force-build             Force building release binary and frontend on the Pi"
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
fi

# 1. System packages
if [ "$HAS_INTERNET" = true ]; then
  echo "[1/5] Installing system packages (libaravis, glib, udev, pkg-config, esptool, NetworkManager)..."
  sudo apt-get update
  sudo apt-get install -y \
    libaravis-0.8-0 \
    libaravis-dev \
    libglib2.0-dev \
    libgobject-2.0-0 \
    libudev-dev \
    pkg-config \
    build-essential \
    esptool \
    network-manager \
    curl \
    unzip \
    git \
    rsync \
    sqlite3 \
    libsqlite3-dev
else
  echo "[1/5] Skipping apt package updates (offline mode)."
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

# 2. Check/Install Rust toolchain
echo "[2/5] Checking Rust toolchain..."
export PATH="${TARGET_HOME}/.cargo/bin:$PATH"
if ! command -v cargo &> /dev/null && [ ! -x "${TARGET_HOME}/.cargo/bin/cargo" ]; then
  if [ "$HAS_INTERNET" = true ]; then
    echo ">>> Installing Rust toolchain via rustup..."
    sudo -u "${TARGET_USER}" bash -c "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile default"
    export PATH="${TARGET_HOME}/.cargo/bin:$PATH"
  else
    echo ">>> Note: Rust toolchain not found on offline Pi (relying on pre-built binary if available)."
  fi
else
  echo ">>> Rust toolchain ready: $(cargo --version 2>/dev/null || echo "${TARGET_HOME}/.cargo/bin/cargo")"
fi

# 3. Check/Install Bun runtime
echo "[3/5] Checking Bun runtime..."
export PATH="${TARGET_HOME}/.bun/bin:$PATH"
BUN_BIN=$(command -v bun || echo "${TARGET_HOME}/.bun/bin/bun")
if [ ! -x "${BUN_BIN}" ] && ! command -v bun &> /dev/null; then
  if [ "$HAS_INTERNET" = true ]; then
    echo ">>> Installing Bun runtime for ARM64..."
    sudo -u "${TARGET_USER}" bash -c "curl -fsSL https://bun.sh/install | bash"
    export BUN_INSTALL="${TARGET_HOME}/.bun"
    export PATH="${BUN_INSTALL}/bin:$PATH"
    BUN_BIN="${TARGET_HOME}/.bun/bin/bun"
  else
    echo ">>> Note: Bun not found on offline Pi (relying on pre-built frontend bundle)."
  fi
else
  echo ">>> Bun runtime ready: ${BUN_BIN}"
fi

# 4. Binary and frontend bundle check
echo "[4/5] Checking release binary and frontend bundle..."
cd "${PROJECT_DIR}"

# Build frontend if dist/ missing and Bun is available
if [ ! -f "${PROJECT_DIR}/dist/index.html" ]; then
  if [ -x "${BUN_BIN}" ] || command -v bun &> /dev/null; then
    echo ">>> Building frontend bundle..."
    if [ "$HAS_INTERNET" = true ] && [ ! -d "node_modules" ]; then
      sudo -u "${TARGET_USER}" env PATH="$PATH" "${BUN_BIN}" install
    fi
    sudo -u "${TARGET_USER}" env PATH="$PATH" "${BUN_BIN}" run build
  else
    echo "Error: Missing frontend dist/ and Bun runtime unavailable to build it." >&2
    exit 1
  fi
fi

# Build Rust binary if missing or forced
if [ ! -f "${PROJECT_DIR}/target/release/headless-rust" ] || [ "$FORCE_BUILD" = true ]; then
  echo ">>> Compiling native Rust release binary on Pi..."
  if ! command -v cargo &> /dev/null && [ ! -x "${TARGET_HOME}/.cargo/bin/cargo" ]; then
    echo "Error: Cargo not available to build release binary." >&2
    exit 1
  fi
  sudo -u "${TARGET_USER}" env PATH="$PATH" cargo build --release
else
  echo ">>> Verified release binary at ${PROJECT_DIR}/target/release/headless-rust"
fi

# 5. Systemd daemon installation
echo "[5/5] Configuring systemd autostart service..."
SERVICE_FILE="/etc/systemd/system/speedcamera.service"

sudo bash -c "cat > ${SERVICE_FILE}" <<EOF
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
EOF

sudo systemctl daemon-reload
sudo systemctl enable speedcamera.service
sudo systemctl restart speedcamera.service

echo ""
echo "========================================================="
echo " Speedcamera Rust Daemon is installed & active!"
echo " Daemon status: sudo systemctl status speedcamera"
echo " Daemon logs:   sudo journalctl -u speedcamera -f"
echo "========================================================="

# Step 6: Network Mode Transition
if [ "$AUTO_FIELD" = true ]; then
  echo "[*] Switching directly to Standalone Field Mode..."
  chmod +x "${PROJECT_DIR}/scripts/setup-network.sh"
  "${PROJECT_DIR}/scripts/setup-network.sh" field
  exit 0
fi

if [ "$SKIP_NETWORK" = true ]; then
  echo "Keeping current network configuration (--skip-network / --lan)."
  echo "When ready for field deployment, run:"
  echo "  ~/speedcamera/headless-rust/scripts/setup-network.sh field"
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
    echo "Run anytime later: ~/speedcamera/headless-rust/scripts/setup-network.sh field"
  fi
else
  echo "Non-interactive session: Keeping existing network configuration."
  echo "Switch to field mode when ready: ~/speedcamera/headless-rust/scripts/setup-network.sh field"
fi
