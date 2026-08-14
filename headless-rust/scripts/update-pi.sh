#!/usr/bin/env bash
set -e

# Usage: ./scripts/update-pi.sh [options]
# Options:
#   --build, -b, --force-build    Force rebuilding frontend bundle and Rust release binary
#   --pull                        Run git pull in ~/speedcamera before building
#   --help, -h                    Show help message

FORCE_BUILD=false
DO_PULL=false

for arg in "$@"; do
  case "$arg" in
    --build|-b|--force-build)
      FORCE_BUILD=true
      ;;
    --pull)
      DO_PULL=true
      ;;
    --help|-h)
      echo "Speedcamera Headless Rust Pi Update & Build Script"
      echo ""
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --build, -b, --force-build   Force compiling frontend and Rust binary on Pi"
      echo "  --pull                       Run git pull in ~/speedcamera before building"
      echo "  --help, -h                   Show this help message"
      exit 0
      ;;
  esac
done

TARGET_USER="${SUDO_USER:-$(whoami)}"
TARGET_HOME=$(getent passwd "$TARGET_USER" | cut -d: -f6)
export PATH="${TARGET_HOME}/.cargo/bin:${TARGET_HOME}/.bun/bin:/usr/local/bin:/usr/bin:$PATH"

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "${PROJECT_DIR}/.." && pwd)"
cd "${PROJECT_DIR}"

run_as_user() {
  if [ "$(whoami)" = "${TARGET_USER}" ]; then
    env PATH="$PATH" "$@"
  else
    sudo -u "${TARGET_USER}" env PATH="$PATH" "$@"
  fi
}

# Pre-flight internet check: update scripts require active DHCP or Internet Mode
echo "[*] Checking internet connectivity on Pi..."
if ! ping -c 1 -W 2 1.1.1.1 &>/dev/null && ! curl -s --connect-timeout 2 https://bun.sh &>/dev/null; then
  echo "Error: No active internet connection detected on Pi." >&2
  echo "Updates and builds must be performed in DHCP or Internet Mode (not offline Field Mode)." >&2
  echo "If currently in Field Mode, switch to internet mode first: ~/speedcamera/headless-rust/scripts/setup-network.sh internet <SSID> <PASS>" >&2
  echo "or connect an Ethernet cable and run: ~/speedcamera/headless-rust/scripts/setup-network.sh dhcp" >&2
  exit 1
fi

# Optional git pull if requested
if [ "$DO_PULL" = true ] && [ -d "${REPO_DIR}/.git" ]; then
  echo "[*] Pulling latest git commits in ${REPO_DIR}..."
  cd "${REPO_DIR}"
  run_as_user git pull
  cd "${PROJECT_DIR}"
fi

# Request sudo credentials upfront so service operations don't block later
echo "[*] Requesting sudo credentials on Pi..."
sudo -v || { echo "Error: Sudo privileges required to configure services." >&2; exit 1; }

# Locate tool binaries
BUN_BIN=$(command -v bun || echo "${TARGET_HOME}/.bun/bin/bun")
CARGO_BIN=$(command -v cargo || echo "${TARGET_HOME}/.cargo/bin/cargo")

# 1. Check if frontend rebuild is needed
NEEDS_FRONTEND_BUILD=false
if [ "$FORCE_BUILD" = true ] || [ ! -f "dist/index.html" ]; then
  NEEDS_FRONTEND_BUILD=true
elif [ -d "frontend" ] && [ $(find frontend index.html vite.config.ts package.json tailwind.config.js tsconfig.json components.json -newer "dist/index.html" 2>/dev/null | wc -l) -gt 0 ]; then
  NEEDS_FRONTEND_BUILD=true
fi

if [ "$NEEDS_FRONTEND_BUILD" = true ]; then
  echo "[*] Frontend changes detected. Building frontend with Bun on Pi..."
  if [ ! -x "${BUN_BIN}" ] && ! command -v bun &>/dev/null; then
    echo ">>> Installing Bun runtime for ARM64..."
    run_as_user bash -c "curl -fsSL https://bun.sh/install | bash"
    BUN_BIN="${TARGET_HOME}/.bun/bin/bun"
  fi

  if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules" ]; then
    echo ">>> Installing/updating frontend dependencies with Bun..."
    run_as_user "${BUN_BIN}" install
  fi

  echo ">>> Compiling frontend bundle..."
  run_as_user "${BUN_BIN}" run build
else
  echo "[*] Frontend bundle is up to date."
fi

# 2. Check if Rust binary rebuild is needed
NEEDS_RUST_BUILD=false
if [ "$FORCE_BUILD" = true ] || [ ! -f "target/release/headless-rust" ] || [ "$NEEDS_FRONTEND_BUILD" = true ]; then
  NEEDS_RUST_BUILD=true
elif [ -d "src" ] && [ $(find src Cargo.toml Cargo.lock build.rs dist -newer "target/release/headless-rust" 2>/dev/null | wc -l) -gt 0 ]; then
  NEEDS_RUST_BUILD=true
fi

if [ "$NEEDS_RUST_BUILD" = true ]; then
  echo "[*] Building native release binary with Cargo on Pi..."
  if [ ! -x "${CARGO_BIN}" ] && ! command -v cargo &>/dev/null; then
    echo ">>> Installing Rust toolchain via rustup..."
    run_as_user bash -c "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile default"
    CARGO_BIN="${TARGET_HOME}/.cargo/bin/cargo"
  fi

  run_as_user "${CARGO_BIN}" build --release
else
  echo "[*] Release binary is up to date."
fi

# 3. Ensure systemd service exists and is up to date
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
AmbientCapabilities=CAP_NET_RAW CAP_NET_ADMIN
CapabilityBoundingSet=CAP_NET_RAW CAP_NET_ADMIN

[Install]
WantedBy=multi-user.target
SERVICE_EOF
  sudo systemctl daemon-reload
  sudo systemctl enable speedcamera.service
fi

echo "[*] Restarting speedcamera service on Pi..."
sudo systemctl daemon-reload
sudo systemctl restart speedcamera.service
sleep 1
sudo systemctl status speedcamera --no-pager
