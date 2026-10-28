#!/usr/bin/env bash
# Manage a speedcamera Raspberry Pi from your laptop over SSH.
# The Pi never compiles anything: `deploy` copies a prebuilt .deb and lets apt
# install or upgrade it, which also works over the Pi's offline hotspot.
set -euo pipefail

REPO="LeoLTM/speedcamera"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<EOF
Usage: scripts/pi.sh <command> [user@host] [options]

Commands:
  deploy      Install or upgrade speedcamera (fresh Pis and git-checkout installs too)
  status      Show installed version, service state and health
  logs        Follow the daemon log
  uninstall   Remove the package; database and images are kept unless --purge

The target defaults to \$SPEEDCAMERA_PI, else pi@raspberrypi.local.
In the field (Pi hotspot) use pi@192.168.4.1.

deploy options:
  (none)             Build the .deb from this working tree (packaging/build-deb.sh)
  --release [TAG]    Download a GitHub release instead (default: latest)
  --deb FILE         Install a .deb you already have

uninstall options:
  --purge            Also delete the database and images (/var/lib/speedcamera)
  --reset-network    Afterwards return Wi-Fi and Ethernet to plain DHCP (drops hotspot and camera LAN)
  --yes, -y          Don't ask for confirmation

Common options:
  --password, -p     Use password authentication instead of SSH keys
EOF
}

COMMAND="${1:-}"
[ $# -gt 0 ] && shift
TARGET="${SPEEDCAMERA_PI:-pi@raspberrypi.local}"
USE_PASSWORD=false
RELEASE=""
DEB=""
PURGE=false
RESET_NETWORK=false
ASSUME_YES=false

while [ $# -gt 0 ]; do
  case "$1" in
    --release)
      if [[ "${2:-}" == v[0-9]* ]]; then RELEASE="$2"; shift; else RELEASE=latest; fi
      ;;
    --deb) DEB="${2:?--deb needs a file}"; shift ;;
    --purge) PURGE=true ;;
    --reset-network) RESET_NETWORK=true ;;
    --yes|-y) ASSUME_YES=true ;;
    --password|-p) USE_PASSWORD=true ;;
    --help|-h) usage; exit 0 ;;
    -*) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
    *) TARGET="$1" ;;
  esac
  shift
done

# One multiplexed SSH connection, so a password is typed at most once.
SOCKET_DIR="$(mktemp -d)"
SSH_OPTS=(-o ControlMaster=auto -o "ControlPath=${SOCKET_DIR}/ssh" -o ControlPersist=60s -o ConnectTimeout=10)
if [ "$USE_PASSWORD" = true ]; then
  SSH_OPTS+=(-o PubkeyAuthentication=no -o "PreferredAuthentications=password,keyboard-interactive")
fi
cleanup() {
  ssh -O exit -o "ControlPath=${SOCKET_DIR}/ssh" "$TARGET" 2>/dev/null || true
  rm -rf "$SOCKET_DIR"
}
trap cleanup EXIT

remote() { ssh "${SSH_OPTS[@]}" "$TARGET" "$@"; }
# -tt so sudo can prompt for a password on Pis without passwordless sudo
remote_tty() { ssh -tt "${SSH_OPTS[@]}" "$TARGET" "$@"; }

fetch_release() {
  local tag="$1" dir="$2" url
  if [ "$tag" = latest ]; then
    url="https://github.com/${REPO}/releases/latest/download"
  else
    url="https://github.com/${REPO}/releases/download/${tag}"
  fi
  echo "[*] Downloading ${tag} release from GitHub..." >&2
  curl -fsSL -o "${dir}/speedcamera_arm64.deb" "${url}/speedcamera_arm64.deb"
  curl -fsSL -o "${dir}/SHA256SUMS" "${url}/SHA256SUMS"
  (cd "$dir" && sha256sum --check --ignore-missing --quiet SHA256SUMS) >&2
  echo "${dir}/speedcamera_arm64.deb"
}

wait_for_health() {
  remote 'port=3000; [ -r /etc/default/speedcamera ] && . /etc/default/speedcamera && port="${PORT:-3000}"
    for i in $(seq 1 30); do
      if health=$(curl -fsS "http://127.0.0.1:${port}/api/health" 2>/dev/null); then
        echo "running: $(echo "$health" | grep -oE "\"(version|gitSha)\":\"[^\"]*\"" | tr "\n" " ")"; exit 0
      fi
      sleep 1
    done
    echo "speedcamera did not answer on port ${port}; check: sudo journalctl -u speedcamera -e" >&2; exit 1'
}

cmd_deploy() {
  local work deb
  work="$(mktemp -d)"
  if [ -n "$DEB" ]; then
    deb="$DEB"
  elif [ -n "$RELEASE" ]; then
    deb="$(fetch_release "$RELEASE" "$work")"
  else
    deb="$("${PROJECT_DIR}/packaging/build-deb.sh")"
  fi
  [ -f "$deb" ] || { echo "Error: package not found: $deb" >&2; exit 1; }

  echo "[*] Copying $(basename "$deb") to ${TARGET}..."
  scp -q "${SSH_OPTS[@]}" "$deb" "${TARGET}:/tmp/speedcamera_arm64.deb"
  rm -rf "$work"

  echo "[*] Installing on ${TARGET}..."
  # Works offline once dependencies are present. A first install needs internet once
  # to fetch libaravis & co., so refresh the package lists only if the install fails.
  if ! remote_tty 'set -e
      install_deb() { sudo apt-get install -y --reinstall --allow-downgrades /tmp/speedcamera_arm64.deb; }
      install_deb || { echo "[*] Refreshing package lists and retrying..."; sudo apt-get update && install_deb; }
      rm -f /tmp/speedcamera_arm64.deb'; then
    echo "Error: install failed. A first install needs internet on the Pi once (home Wi-Fi or Ethernet) for dependencies." >&2
    exit 1
  fi

  echo "[*] Waiting for the daemon..."
  wait_for_health
  echo "[+] Deployed to ${TARGET}. Logs: scripts/pi.sh logs ${TARGET}"
}

cmd_status() {
  remote 'dpkg-query -W speedcamera 2>/dev/null || echo "speedcamera is not installed"
    systemctl status speedcamera --no-pager --lines=0 || true'
  wait_for_health || true
}

cmd_logs() {
  remote_tty 'sudo journalctl -u speedcamera -f -n 100'
}

cmd_uninstall() {
  local action=remove
  [ "$PURGE" = true ] && action=purge
  if [ "$ASSUME_YES" = false ]; then
    local what="Remove speedcamera from ${TARGET}"
    [ "$PURGE" = true ] && what="${what} and DELETE its database and images"
    [ "$RESET_NETWORK" = true ] && what="${what}, then reset its network to DHCP"
    read -r -p "${what}? (y/N) " reply
    [[ "$reply" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }
  fi

  local script="set -e"
  if [ "$RESET_NETWORK" = true ]; then
    # Keep a copy of the network script (the package removes it) to run after removal.
    script+=$'\nsudo cp /usr/lib/speedcamera/setup-network.sh /tmp/speedcamera-network-reset.sh'
  fi
  script+=$'\nsudo apt-get '"${action}"' -y speedcamera'
  if [ "$RESET_NETWORK" = true ]; then
    # Detached, because over the hotspot the reset ends this SSH session.
    script+=$'\necho "[*] Resetting network to DHCP (this SSH session may drop)..."'
    script+=$'\nsudo systemd-run --collect --unit=speedcamera-network-reset /tmp/speedcamera-network-reset.sh dhcp'
  fi
  remote_tty "$script"
  echo "[+] speedcamera removed from ${TARGET}."
}

case "$COMMAND" in
  deploy) cmd_deploy ;;
  status) cmd_status ;;
  logs) cmd_logs ;;
  uninstall) cmd_uninstall ;;
  ""|help|-h|--help) usage ;;
  *) echo "Unknown command: $COMMAND" >&2; usage >&2; exit 1 ;;
esac
