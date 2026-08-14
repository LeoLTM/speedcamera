# Speedcamera Headless & Remote Web Controller

A lightweight, high-performance headless speedcamera daemon and responsive web controller built with **Bun**, **Vite**, **React**, and **TypeScript**.

Engineered to run natively on **Raspberry Pi 4 / 5 with Raspberry Pi OS Lite** (zero desktop or GUI dependencies) inside the camera enclosure, creating a standalone Wi-Fi hotspot for laptops, tablets, and phones to connect and manage the system via web browser.

---

## Architecture & Dual-Subnet Network Setup

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Raspberry Pi 4 / 5 (Raspberry Pi OS Lite ARM64)                         │
│                                                                         │
│  • eth0 (Camera LAN):    192.168.1.100/24  <── GigE Vision (192.168.1.x)│
│  • wlan0 (Hotspot AP):   192.168.4.1/24    <── Web UI (SSID: speedcamera)│
│                                                                         │
│  • systemd Daemon: Pure Headless Bun Service                            │
│     ├── Bun.serve() HTTP Server (Vite SPA + Image API)                  │
│     ├── WebSocket RPC Server (/ws/rpc)                                  │
│     ├── Industrial Camera (Aravis GigE Vision on eth0: 192.168.1.100)   │
│     ├── Serial Port (Arduino / Radar Telemetry)                         │
│     ├── Network Diagnostics (/api/network)                              │
│     └── SQLite Database (bun:sqlite @ ~/.speedcamera)                   │
└───────────────────────┬─────────────────────────────▲───────────────────┘
                        │ Wi-Fi AP                    │ Ethernet Cable
                        ▼                             │
┌──────────────────────────────────────────┐   ┌──────────────────────────┐
│ Client Device (Laptop / Tablet / Phone)  │   │ Industrial GigE Camera   │
│                                          │   │                          │
│ • Connect Wi-Fi SSID: speedcamera        │   │ • Subnet: 192.168.1.0/24 │
│ • Open Browser: http://192.168.4.1:3000  │   │ • GigE Vision / Aravis   │
│ • Live Radar, Live View, Settings, Laps  │   │ • Direct link to eth0    │
└──────────────────────────────────────────┘   └──────────────────────────┘
```

---

## ⚡ Critical Rule: Build on Laptop, Not on Pi

Building the React / Vite frontend (`dist/`) directly on a Raspberry Pi can take **over 20 minutes** and easily exhausts memory on low-resource ARM boards.

The built frontend output is 100% platform-independent static web assets. Therefore:
- **`bun run build` always executes locally on your development laptop** (takes ~2 seconds).
- Pre-built static assets in `dist/` are automatically synced to the Pi over SSH.
- The installer and deploy scripts enforce this workflow by default.

---

## Scenarios & Deployment Procedures

All deployment and maintenance procedures can be executed directly from your laptop via SSH.

```
┌────────────────────────────────────────────────────────────────────────┐
│ Command                      │ Purpose                                 │
├──────────────────────────────┼─────────────────────────────────────────┤
│ bun run install:pi [target]  │ Fresh Pi install on Home LAN / DHCP     │
│ bun run deploy:pi [target]   │ Upgrade existing Pi (Field or Home LAN) │
│ bun run cleanup:pi [target]  │ Complete teardown & restore DHCP network│
└──────────────────────────────┴─────────────────────────────────────────┘
```

---

### Scenario 1: Fresh Pi Setup (Home LAN / Wi-Fi with DHCP)

Use this scenario when you have a freshly flashed Raspberry Pi connected to your home router / Wi-Fi via DHCP and want to provision the complete speedcamera suite.

#### Run from your laptop:
```bash
cd headless

# Standard fresh installation (SSH key auth):
bun run install:pi pi@raspberrypi.local

# With password prompt (if SSH keys are not configured):
bun run install:pi pi@raspberrypi.local --password

# Using direct IP and automatically switching to Field Mode at the end:
bun run install:pi pi@192.168.1.50 --field

# Stay in Home LAN mode (skip field network setup):
bun run install:pi pi@raspberrypi.local --lan
```

#### What this command does:
1. Builds the frontend bundle on your laptop (`bun run build`, ~2s).
2. Establishes an SSH multiplexed connection (password requested once).
3. Rsyncs the codebase and pre-built `dist/` to `~/speedcamera/headless` on the Pi.
4. Updates Pi system packages (`libaravis-0.8-0`, `libaravis-dev`, `esptool`, `network-manager`, `curl`, etc.).
5. Installs the ARM64 Bun runtime on the Pi (if not installed).
6. Installs production node dependencies on the Pi.
7. Registers, enables, and starts the `speedcamera.service` systemd daemon.
8. Configures the network mode (Field Mode or Home LAN Mode).

---

### Scenario 2: Upgrading an Existing Installation

Use this scenario to push code updates to an already configured Pi. The Pi can either be in **Field Mode** (offline Wi-Fi hotspot) or connected to your **Home LAN**.

#### Run from your laptop:
```bash
cd headless

# Deploy to Pi on Home LAN:
bun run deploy:pi pi@raspberrypi.local

# Deploy to Pi in Field Mode (connected to 'speedcamera' Wi-Fi):
bun run deploy:pi pi@192.168.4.1

# With password authentication:
bun run deploy:pi pi@192.168.4.1 --password
```

#### What this command does:
1. Re-builds the frontend bundle locally (`bun run build`).
2. Syncs changed files (`dist/`, `src/`, `scripts/`, `package.json`, etc.) to the Pi.
3. Automatically detects internet connectivity on the Pi:
   - **Online (Home LAN):** Updates production dependencies if `package.json` changed.
   - **Offline (Field Mode):** Safely skips dependency downloads and reuses existing `node_modules`.
4. Updates the systemd service file if needed and runs `sudo systemctl daemon-reload`.
5. Restarts `speedcamera.service` and verifies that the daemon is active and running.
6. **Preserves existing network configuration** without causing unexpected disconnections.

---

### Scenario 3: Complete Cleanup & Network Reset

Use this scenario to completely uninstall Speedcamera, remove systemd services, delete application files, and restore standard DHCP networking on Ethernet and Wi-Fi.

#### Option A: Remote cleanup from your laptop
```bash
cd headless

# Clean up speedcamera and restore DHCP network:
bun run cleanup:pi pi@raspberrypi.local

# Clean up in Field Mode and purge all SQLite databases/images:
bun run cleanup:pi pi@192.168.4.1 --password --purge

# Non-interactive cleanup:
bun run cleanup:pi pi@raspberrypi.local --yes --purge
```

#### Option B: Direct cleanup on the Raspberry Pi
```bash
# SSH into Pi
ssh pi@raspberrypi.local

# Run cleanup script
~/speedcamera/headless/scripts/cleanup-pi.sh

# Or with complete data purge (database & images):
~/speedcamera/headless/scripts/cleanup-pi.sh --purge --yes
```

#### What cleanup does:
1. Stops and disables `speedcamera.service`.
2. Deletes `/etc/systemd/system/speedcamera.service` and reloads systemd.
3. Deletes repository files `~/speedcamera` (and purges `~/.speedcamera` if `--purge`).
4. Restores Ethernet `eth0` to standard automatic DHCP (ready for router connection).
5. **Safe Hotspot Teardown:** If triggered while connected to the Pi's Wi-Fi hotspot (`192.168.4.1`), the script completes all service/file/Ethernet cleanup first, then schedules Wi-Fi AP shutdown with a 2-second background delay (`nohup`), allowing the SSH session to return cleanly before the hotspot turns off.

---

## Network Mode Management (`setup-network.sh`)

You can switch the Pi's networking mode at any time using the network management script:

```bash
# Switch to Standalone Field Mode (Camera LAN 192.168.1.100 + Hotspot AP 192.168.4.1)
~/speedcamera/headless/scripts/setup-network.sh field

# Connect Pi Wi-Fi to a router for internet updates (Client Mode)
~/speedcamera/headless/scripts/setup-network.sh internet "MyHomeWiFi" "SecretPassword123"

# Revert Ethernet and Wi-Fi to standard DHCP
~/speedcamera/headless/scripts/setup-network.sh dhcp

# Check active connections, IP addresses, and internet reachability
~/speedcamera/headless/scripts/setup-network.sh status
```

---

## Managing the Service on Raspberry Pi

The Speedcamera backend daemon runs as a `systemd` background service:

```bash
# Check service status
sudo systemctl status speedcamera

# View live streaming logs
sudo journalctl -u speedcamera -f

# Restart service
sudo systemctl restart speedcamera

# Stop service
sudo systemctl stop speedcamera

# Start service
sudo systemctl start speedcamera
```

---

## Field Operation Quick Reference

1. Power on the Raspberry Pi.
2. On your laptop, phone, or tablet, connect to the Wi-Fi network:
   - **SSID:** `speedcamera`
   - **Password:** `speedcamerapass`
3. Open your web browser and go to:
   - **`http://192.168.4.1:3000`**
4. Connect the industrial GigE Vision camera to the Pi's Ethernet port (assigned to `192.168.1.100`).

---

## Local Development & Testing

You can develop and test the entire headless system on your local laptop without physical hardware using mock mode:

```bash
cd headless

# Install local dependencies
bun install

# Run frontend (Vite HMR on :5173) + backend (Bun on :3000) with mock camera & radar
bun run dev:mock

# Build production bundle
bun run build

# Run production server locally with mock hardware
bun run start:mock
```

- **Web UI:** `http://localhost:5173` (dev) or `http://localhost:3000` (production)
- **WebSocket RPC:** `ws://localhost:3000/ws/rpc`
