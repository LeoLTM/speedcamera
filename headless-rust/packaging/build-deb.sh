#!/usr/bin/env bash
# Builds the arm64 speedcamera .deb for the Raspberry Pi inside a Debian Bookworm
# container (podman or docker). Prints the path of the built package on stdout.
#
# Environment:
#   SPEEDCAMERA_DEB_VERSION   Package version (default: <Cargo version>+git.<sha>, used for dev builds)
#   SKIP_FRONTEND=1           Reuse the existing dist/ instead of rebuilding the web UI
#   SKIP_IMAGE_BUILD=1        Use an already built speedcamera-cross image (CI builds it with layer caching)
#   CONTAINER_ENGINE          podman or docker (default: whichever is installed, podman first)
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="speedcamera-cross:bookworm"
TARGET="aarch64-unknown-linux-gnu"
# The toolchain is an x86_64 -> arm64 cross compiler. Pin the platform so a locally
# cached arm64 debian:bookworm (e.g. from testing) is never used as the base.
PLATFORM="linux/amd64"
cd "$PROJECT_DIR"

ENGINE="${CONTAINER_ENGINE:-$(command -v podman || command -v docker || true)}"
if [ -z "$ENGINE" ]; then
  echo "Error: podman or docker is required to build the Pi package." >&2
  exit 1
fi

if [ "${SKIP_FRONTEND:-0}" != 1 ]; then
  echo "[*] Building web UI..." >&2
  bun install --frozen-lockfile >&2
  bun run build >&2
fi
if [ ! -f dist/index.html ]; then
  echo "Error: dist/index.html missing; the web UI must be built before packaging." >&2
  exit 1
fi

GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
if ! git diff --quiet HEAD -- . 2>/dev/null; then
  GIT_SHA="${GIT_SHA}.dirty"
fi
CARGO_VERSION="$(sed -n 's/^version = "\(.*\)"/\1/p' Cargo.toml | head -n1)"
DEB_VERSION="${SPEEDCAMERA_DEB_VERSION:-${CARGO_VERSION}+git.${GIT_SHA}}"

if [ "${SKIP_IMAGE_BUILD:-0}" != 1 ]; then
  echo "[*] Preparing cross-compilation image (cached after the first run)..." >&2
  "$ENGINE" build -q --platform "$PLATFORM" -t "$IMAGE" -f packaging/Containerfile packaging >&2
fi

# A broken sudoers.d file disables sudo on the Pi, so refuse to package one. Runs as the image's
# root user: visudo rejects users missing from the container's passwd (e.g. CI's runner uid).
"$ENGINE" run --rm --platform "$PLATFORM" -v "$PROJECT_DIR/packaging/files:/files:ro,z" \
  "$IMAGE" visudo -cqf /files/sudoers >&2

# Rootful docker would leave root-owned files in target/; run as the calling user instead.
RUN_AS=()
if [ "$(basename "$ENGINE")" = docker ]; then
  RUN_AS=(--user "$(id -u):$(id -g)")
fi

mkdir -p target/cross-cache/registry
echo "[*] Compiling and packaging speedcamera ${DEB_VERSION} for arm64..." >&2
"$ENGINE" run --rm --platform "$PLATFORM" "${RUN_AS[@]}" \
  -v "$PROJECT_DIR:/src:z" \
  -v "$PROJECT_DIR/target/cross-cache/registry:/opt/cargo/registry:z" \
  -e SPEEDCAMERA_GIT_SHA="$GIT_SHA" \
  "$IMAGE" cargo deb --locked --target "$TARGET" --deb-version "$DEB_VERSION" --output target/debian/ >&2

DEB="target/debian/speedcamera_${DEB_VERSION}_arm64.deb"
if [ ! -f "$DEB" ]; then
  echo "Error: expected package $DEB was not produced." >&2
  exit 1
fi
echo "$PROJECT_DIR/$DEB"
