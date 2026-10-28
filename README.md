# speedcamera

An end-to-end vehicle speed measurement, GigE Vision camera capture, and remote management suite.

---

## Submodules & Modules

| Directory | Description |
| --------- | ----------- |
| [**`headless-rust`**](./headless-rust) | **(Recommended)** High-performance single-binary headless daemon and responsive Web UI controller for Raspberry Pi 5 built with Rust (Axum 0.8, Socket.io, native Aravis C FFI, SQLite) and embedded React + Vite frontend. Features IoT-style open AP setup hotspot (`192.168.4.1`) with captive portal redirect, Client Wi-Fi operation mode with scannable connect QR codes, and a dedicated GigE Vision Camera LAN (`192.168.1.100`). |
| [**`arduino`**](./arduino) | Microcontroller firmware (ESP8266 / ESP32) reading dual optical light barriers to calculate vehicle speeds and transmit telemetry over Serial. |

The earlier desktop apps (`electron/`, `electronbun/`) were retired in favour of `headless-rust`; they remain in the git history.

---

## Quick Deployment Commands (Raspberry Pi 5)

Run from your laptop. The Pi installs a prebuilt `.deb` and never compiles anything, so updates also work over its offline hotspot.

```bash
cd headless-rust

# Install or update (fresh Pi, old git-checkout install, or already packaged)
bun run deploy pi@raspberrypi.local             # build the package from this checkout
bun run deploy pi@192.168.4.1 --release         # latest GitHub release, via the Pi hotspot

# Inspect, follow logs, remove
bun run pi status pi@raspberrypi.local
bun run pi logs pi@raspberrypi.local
bun run pi uninstall pi@raspberrypi.local       # --purge also deletes data
```

For full documentation on architecture, network onboarding flow, offline/client operation, dependencies, migration guide, and local mock testing, see the [**Headless Rust Documentation**](./headless-rust/README.md).
