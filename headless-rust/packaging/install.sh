#!/usr/bin/env bash
# Installs (or upgrades to) a speedcamera release directly on a Raspberry Pi with internet:
#   curl -fsSL https://raw.githubusercontent.com/LeoLTM/speedcamera/main/headless-rust/packaging/install.sh | sudo bash
# Pin a version with:  ... | sudo bash -s -- v0.5.0
set -euo pipefail

TAG="${1:-latest}"
REPO="LeoLTM/speedcamera"

if [ "$(id -u)" -ne 0 ]; then
  echo "Error: run as root (pipe into 'sudo bash')." >&2
  exit 1
fi
if [ "$(dpkg --print-architecture)" != arm64 ]; then
  echo "Error: speedcamera packages are built for 64-bit Raspberry Pi OS (arm64)." >&2
  exit 1
fi

if [ "$TAG" = latest ]; then
  URL="https://github.com/${REPO}/releases/latest/download"
else
  URL="https://github.com/${REPO}/releases/download/${TAG}"
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
chmod 755 "$WORK"  # apt reads local .debs as the unprivileged _apt user
cd "$WORK"

echo "[*] Downloading speedcamera (${TAG})..."
curl -fsSLO "${URL}/speedcamera_arm64.deb"
curl -fsSLO "${URL}/SHA256SUMS"
sha256sum --check --ignore-missing --quiet SHA256SUMS

echo "[*] Installing..."
apt-get update
apt-get install -y --reinstall --allow-downgrades ./speedcamera_arm64.deb

echo ""
echo "[+] speedcamera $(dpkg-query -W -f='${Version}' speedcamera) is running."
echo "    Web UI: http://$(hostname -I | awk '{print $1}'):3000"
echo "    Logs:   sudo journalctl -u speedcamera -f"
