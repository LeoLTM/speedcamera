#!/usr/bin/env bash
set -e

# Usage: ./scripts/cleanup-remote.sh [pi_target] [options]
# Examples:
#   ./scripts/cleanup-remote.sh pi@raspberrypi.local
#   ./scripts/cleanup-remote.sh pi@192.168.4.1 --password --purge
#   bun run cleanup:pi pi@raspberrypi.local

PI_TARGET="pi@raspberrypi.local"
USE_PASSWORD=false
PURGE_FLAG=""
CONFIRM_YES=false

# Parse arguments
for arg in "$@"; do
  case "$arg" in
    --password|-p|--pass)
      USE_PASSWORD=true
      ;;
    --purge)
      PURGE_FLAG="--purge"
      ;;
    --yes|-y)
      CONFIRM_YES=true
      ;;
    --help|-h)
      echo "Speedcamera Headless Rust Remote Pi Complete Teardown & Cleanup"
      echo ""
      echo "Usage: $0 [user@host] [options]"
      echo ""
      echo "Positional Arguments:"
      echo "  [user@host]       SSH target (default: pi@raspberrypi.local or 192.168.4.1)"
      echo ""
      echo "Options:"
      echo "  --password, -p    Force password authentication (disables SSH keys)"
      echo "  --purge           Also remove database and captured images (~/.speedcamera)"
      echo "  --yes, -y         Skip interactive confirmation prompt"
      echo "  --help, -h        Show this help message"
      echo ""
      echo "Notes:"
      echo "  • Safely handles active Wi-Fi Hotspot connections (192.168.4.1):"
      echo "    Deletes files, services, and enables Ethernet DHCP before shutting down Hotspot."
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

SSH_OPTS=(-o "ConnectTimeout=10")

if [ "$USE_PASSWORD" = true ]; then
  echo "[*] Password authentication enabled (-o PubkeyAuthentication=no)"
  SSH_OPTS+=(-o "PubkeyAuthentication=no" -o "PreferredAuthentications=password,keyboard-interactive")
fi

echo "========================================================="
echo " Speedcamera Rust Remote Teardown & Cleanup"
echo " Target: ${PI_TARGET}"
echo "========================================================="

if [[ "$PI_TARGET" == *"192.168.4."* ]]; then
  echo ">>> [!] Note: Connected via Pi Wi-Fi Hotspot (192.168.4.1)."
  echo ">>> All services & files will be cleaned up and Ethernet restored to DHCP"
  echo ">>> before the Wi-Fi Hotspot shuts down."
  echo ""
fi

if [ "$CONFIRM_YES" = false ]; then
  read -p "Are you sure you want to completely uninstall Speedcamera from ${PI_TARGET} and restore DHCP network settings? (y/N) " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
fi

# Encode cleanup-pi.sh to base64 to avoid all nested shell escaping/quoting issues
CLEANUP_B64=$(base64 < "${SCRIPT_DIR}/cleanup-pi.sh" | tr -d '\r\n')

echo "[*] Connecting to ${PI_TARGET} and executing teardown..."

REMOTE_CMD="echo '${CLEANUP_B64}' | base64 -d > /tmp/speedcamera-cleanup-pi.sh && chmod +x /tmp/speedcamera-cleanup-pi.sh && /tmp/speedcamera-cleanup-pi.sh ${PURGE_FLAG} --yes; rm -f /tmp/speedcamera-cleanup-pi.sh"

# Execute with forced TTY so sudo can prompt interactively
ssh -tt "${SSH_OPTS[@]}" "${PI_TARGET}" "${REMOTE_CMD}"

echo ""
echo "========================================================="
echo " Cleanup complete! Speedcamera removed from ${PI_TARGET}."
echo " Ethernet interface restored to standard DHCP."
if [[ "$PI_TARGET" == *"192.168.4."* ]]; then
  echo " Wi-Fi Hotspot is now shutting down."
  echo " Plug Pi into your home router via Ethernet to access via DHCP."
fi
echo "========================================================="
