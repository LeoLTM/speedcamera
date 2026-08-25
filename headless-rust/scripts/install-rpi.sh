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
      echo "  --field                            Provision and switch to Field Mode at the very end"
      echo "  --network-only                     Only configure dual-subnet network (Hotspot AP + Camera LAN)"
      echo "  --build, --force-build             Force building release binary and frontend on the Pi"
      echo "  --help, -h                         Show this help message"
      exit 0
      ;;
  esac
done

run_as_user() {
  if [ "$(whoami)" = "${TARGET_USER}" ]; then
    env PATH="$PATH" "$@"
  else
    sudo -u "${TARGET_USER}" env PATH="$PATH" "$@"
  fi
}

# Request sudo credentials early so user is prompted interactively if needed
echo "[*] Requesting sudo credentials on Pi..."
sudo -v || { echo "Error: Sudo privileges required to install system packages and services." >&2; exit 1; }

if [ "$ONLY_NETWORK" = true ]; then
  chmod +x "${PROJECT_DIR}/scripts/setup-network.sh"
  "${PROJECT_DIR}/scripts/setup-network.sh" field
  exit 0
fi

# Pre-flight internet check: installation MUST be done in DHCP/Internet mode
echo "[*] Checking internet connectivity..."
if ! ping -c 1 -W 2 1.1.1.1 &>/dev/null && ! curl -s --connect-timeout 2 https://bun.sh &>/dev/null; then
  echo "Error: No active internet connection detected on Pi." >&2
  echo "Installation must be performed in DHCP or Internet Mode (not offline Field Mode) to download system packages and build tools." >&2
  echo "If currently in Field Mode, switch to internet mode first: ~/speedcamera/headless-rust/scripts/setup-network.sh internet <SSID> <PASS>" >&2
  echo "or connect an Ethernet cable and run: ~/speedcamera/headless-rust/scripts/setup-network.sh dhcp" >&2
  exit 1
fi

# 1. System packages (APT)
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

# Apply GigE Vision socket buffer tuning with fq_codel to prevent bufferbloat
echo "[*] Configuring Linux socket buffers for GigE camera (with fq_codel)..."
sudo bash -c 'cat > /etc/sysctl.d/60-gige-camera.conf <<EOF
net.core.rmem_max = 134217728
net.core.wmem_max = 134217728
net.core.rmem_default = 262144
net.core.wmem_default = 262144
net.ipv4.tcp_rmem = 4096 131072 67108864
net.ipv4.tcp_wmem = 4096 65536 67108864
net.core.netdev_max_backlog = 30000
net.core.default_qdisc = fq_codel
vm.dirty_background_ratio = 5
vm.dirty_ratio = 10
EOF'
sudo sysctl -p /etc/sysctl.d/60-gige-camera.conf 2>/dev/null || sudo sysctl --system 2>/dev/null || true

# 2. Check/Install Rust toolchain
echo "[2/5] Checking Rust toolchain..."
export PATH="${TARGET_HOME}/.cargo/bin:${TARGET_HOME}/.bun/bin:/usr/local/bin:/usr/bin:$PATH"
if ! command -v cargo &> /dev/null && [ ! -x "${TARGET_HOME}/.cargo/bin/cargo" ]; then
  echo ">>> Installing Rust toolchain via rustup..."
  run_as_user bash -c "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile default"
  export PATH="${TARGET_HOME}/.cargo/bin:$PATH"
else
  echo ">>> Rust toolchain ready: $(cargo --version 2>/dev/null || echo "${TARGET_HOME}/.cargo/bin/cargo")"
fi

# 3. Check/Install Bun runtime
echo "[3/5] Checking Bun runtime..."
BUN_BIN=$(command -v bun || echo "${TARGET_HOME}/.bun/bin/bun")
if [ ! -x "${BUN_BIN}" ] && ! command -v bun &> /dev/null; then
  echo ">>> Installing Bun runtime for ARM64..."
  run_as_user bash -c "curl -fsSL https://bun.sh/install | bash"
  export BUN_INSTALL="${TARGET_HOME}/.bun"
  export PATH="${BUN_INSTALL}/bin:$PATH"
  BUN_BIN="${TARGET_HOME}/.bun/bin/bun"
else
  echo ">>> Bun runtime ready: ${BUN_BIN}"
fi

# 4. Binary and frontend bundle compilation on Pi
echo "[4/5] Building frontend and compiling native Rust daemon on Pi..."
cd "${PROJECT_DIR}"

# Build frontend bundle
if [ -x "${BUN_BIN}" ] || command -v bun &> /dev/null; then
  if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules" ]; then
    echo ">>> Installing frontend dependencies with Bun..."
    run_as_user "${BUN_BIN}" install
  fi
  echo ">>> Building frontend assets with Bun..."
  run_as_user "${BUN_BIN}" run build
else
  if [ ! -f "${PROJECT_DIR}/dist/index.html" ]; then
    echo "Error: Missing frontend dist/ and Bun runtime unavailable to build it." >&2
    exit 1
  fi
fi

# Build Rust binary on Pi
CARGO_BIN=$(command -v cargo || echo "${TARGET_HOME}/.cargo/bin/cargo")
if [ ! -x "${CARGO_BIN}" ] && ! command -v cargo &> /dev/null; then
  echo "Error: Cargo not available to build release binary." >&2
  exit 1
fi
echo ">>> Compiling native Rust release binary on Pi..."
run_as_user "${CARGO_BIN}" build --release

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

# Install WiFi power management disable service
sudo cp "${PROJECT_DIR}/scripts/wifi-power-off.service" /etc/systemd/system/wifi-power-off.service 2>/dev/null || sudo bash -c "cat > /etc/systemd/system/wifi-power-off.service <<'EOF'
[Unit]
Description=Disable WiFi Power Management
After=network.target

[Service]
Type=oneshot
ExecStart=/sbin/iwconfig wlan0 power off
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF"

sudo systemctl daemon-reload
sudo systemctl enable speedcamera.service
sudo systemctl enable wifi-power-off.service
sudo systemctl restart wifi-power-off.service 2>/dev/null || true
sudo systemctl restart speedcamera.service

echo ""
echo "========================================================="
echo " Speedcamera Rust Daemon is installed & active!"
echo " Daemon status: sudo systemctl status speedcamera"
echo " Daemon logs:   sudo journalctl -u speedcamera -f"
echo "========================================================="

# Step 6: Network Mode Transition (executed ONLY after all builds & services are fully running)
if [ "$AUTO_FIELD" = true ]; then
  echo "[*] Switching network to Standalone Field Mode (Camera LAN + Hotspot AP)..."
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
  echo " All software and services have been installed and built successfully."
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
