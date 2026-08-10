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

## Quick Start (Development)

### 1. Install Dependencies
```bash
cd headless
bun install
```

### 2. Run in Development Mode (with HMR & Mock Hardware)
```bash
bun run dev:mock
```
* **Frontend (Vite HMR):** `http://localhost:5173`
* **Backend Daemon:** `http://localhost:3000` (WebSocket on `/ws/rpc`)

### 3. Build & Run Production Bundle Locally
```bash
bun run build
bun run start:mock
```
Open `http://localhost:3000` in your browser.

---

## Raspberry Pi 4 / 5 Deployment (Raspberry Pi OS Lite)

### Automated Setup
Run the automated installation script on your Raspberry Pi:
```bash
cd headless
chmod +x scripts/install-rpi.sh
./scripts/install-rpi.sh
```

This script will automatically:
1. Install system libraries (`libaravis-0.8-0`, `python3-esptool`, `network-manager`).
2. Install the **Bun** ARM64 runtime.
3. Build the production React web bundle.
4. Configure the dual-subnet network interfaces (`scripts/setup-network.sh`):
   - **`eth0` Camera LAN:** Static IP `192.168.1.100/24` (Subnet `192.168.1.0/24` for industrial GigE camera).
   - **`wlan0` Hotspot AP:** Static IP `192.168.4.1/24` (SSID: `speedcamera`, password: `speedcamerapass`).
5. Install and enable the `systemd` service for automatic startup on boot.

### Managing the Service
```bash
# Start service
sudo systemctl start speedcamera

# Stop service
sudo systemctl stop speedcamera

# View live real-time logs
sudo journalctl -u speedcamera -f
```

---

## Connecting in the Field
1. Power on the speedcamera Raspberry Pi.
2. On your laptop or phone, connect to the Wi-Fi network **`speedcamera`** (Password: `speedcamerapass`).
3. Open your browser and navigate to:
   **`http://192.168.4.1:3000`**
