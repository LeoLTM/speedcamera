# speedcamera

An end-to-end vehicle speed measurement, GigE Vision camera capture, and remote management suite.

---

## Submodules & Modules

| Directory | Description |
| --------- | ----------- |
| [**`headless`**](./headless) | **(Recommended)** Lightweight, high-performance headless Raspberry Pi 4/5 daemon and responsive Web UI controller built with Bun, Vite, and React. Creates standalone Wi-Fi hotspot (`192.168.4.1`) & GigE Vision Camera LAN (`192.168.1.100`). |
| [**`arduino`**](./arduino) | Microcontroller firmware (ESP8266 / ESP32) reading dual optical light barriers to calculate vehicle speeds and transmit telemetry over Serial. |
| [**`electronbun`**](./electronbun) | Desktop companion application rewrite built with Electron and Bun. |
| [**`electron`**](./electron) | *(Legacy)* Desktop companion app made with classic Electron. |

---

## Quick Deployment Commands (Raspberry Pi)

All commands are executed from your development laptop. The React frontend is built on the laptop in ~2s (`bun run build`) and synced over SSH, avoiding slow builds on the Pi.

```bash
cd headless

# 1. Fresh Pi Setup (Pi connected to Home LAN/Wi-Fi with DHCP)
bun run install:pi pi@raspberrypi.local

# 2. Upgrade Existing Pi (in Field Hotspot Mode or Home LAN)
bun run deploy:pi pi@raspberrypi.local
# or when connected to Pi Wi-Fi hotspot in the field:
bun run deploy:pi pi@192.168.4.1

# 3. Complete Cleanup & Reset Network to DHCP
bun run cleanup:pi pi@raspberrypi.local
```

For full documentation on architecture, network modes, offline field use, and local mock testing, see the [**Headless Documentation**](./headless/README.md).
