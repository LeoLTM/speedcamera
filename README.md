# speedcamera

An end-to-end vehicle speed measurement, GigE Vision camera capture, and remote management suite.

---

## Submodules & Modules

| Directory | Description |
| --------- | ----------- |
| [**`headless-rust`**](./headless-rust) | **(Recommended)** High-performance single-binary headless daemon and responsive Web UI controller for Raspberry Pi 5 built with Rust (Rocket 0.5, native Aravis C FFI, SQLite) and embedded React + Vite frontend. Creates standalone Wi-Fi hotspot (`192.168.4.1`) & GigE Vision Camera LAN (`192.168.1.100`). |
| [**`arduino`**](./arduino) | Microcontroller firmware (ESP8266 / ESP32) reading dual optical light barriers to calculate vehicle speeds and transmit telemetry over Serial. |
| [**`electronbun`**](./electronbun) | Desktop companion application rewrite built with Electron and Bun. |
| [**`electron`**](./electron) | *(Legacy)* Desktop companion app made with classic Electron. |

---

## Quick Deployment Commands (Raspberry Pi 5)

All deployment and maintenance commands are executed from your development laptop over SSH. The scripts pull the repository and perform all frontend asset builds and native Rust compilation directly on the Raspberry Pi.

```bash
cd headless-rust

# 1. Fresh Pi Setup (Pi connected to Home LAN/Wi-Fi with DHCP)
bun run install:pi pi@raspberrypi.local

# 2. Upgrade Existing Pi (in Field Hotspot Mode or Home LAN)
bun run deploy:pi pi@raspberrypi.local
# or when connected to Pi Wi-Fi hotspot in the field:
bun run deploy:pi pi@192.168.4.1

# 3. Complete Cleanup & Reset Network to DHCP
bun run cleanup:pi pi@raspberrypi.local
```

For full documentation on architecture, network modes, offline field use, dependencies, and local mock testing, see the [**Headless Rust Documentation**](./headless-rust/README.md).
