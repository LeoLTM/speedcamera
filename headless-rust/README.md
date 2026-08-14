# Speedcamera Headless (Rust & Rocket)

A high-performance, single-binary headless speedcamera daemon and web controller written in **Rust** using **Rocket 0.5**, **native Aravis C FFI**, **SQLite**, and embedded **React + Vite** frontend.

Engineered specifically for **Raspberry Pi 5 with Raspberry Pi OS Lite** (zero desktop or GUI dependencies) with ultra-low latency hardware shutter triggering (<10ms) and rock-solid 24/7 stability.

---

## Key Improvements Over Legacy Daemon

| Feature | Legacy Bun / Electron | **Native Rust Daemon (`headless-rust`)** |
| :--- | :--- | :--- |
| **Runtime** | Bun / V8 JavaScript VM | **Pure native compiled binary (ELF ARM64 / x86_64)** |
| **Memory Footprint** | ~250MB+ | **~15MB** |
| **Camera Integration** | Flawed FFI / unstable wrapper | **Direct C FFI to `libaravis-0.8` (zero intermediate overhead)** |
| **Shutter Latency** | ~50–150ms JS event loop lag | **<10ms Instant Hardware Shutter Pipeline** |
| **Poliscan Skinning** | Heavy native canvas node addons | **Pure Rust `image` + `imageproc` + embedded TTF font** |
| **Frontend Serving** | Node / Bun file serving | **Baked into binary via `rust-embed` (Single binary deployment!)** |
| **Database** | Bun SQLite bindings | **Native `rusqlite` with WAL mode & foreign keys** |
| **Stability** | Event loop crashes on buffer overflows | **Ring buffer pool + safe Rust error handling + auto-reconnect** |

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│ Raspberry Pi 5 (Raspberry Pi OS Lite ARM64)                            │
│                                                                        │
│  • eth0 (Camera LAN):    192.168.1.100/24  <── GigE Vision HIKROBOT    │
│  • wlan0 (Hotspot AP):   192.168.4.1/24    <── Web UI Browser Clients  │
│                                                                        │
│  • speedcamera-rust Daemon (Single Binary)                             │
│     ├── Rocket 0.5 HTTP Server (REST API & Embedded Static Frontend)   │
│     ├── Rocket WS (/ws/rpc JSON-RPC Server & Event Broadcaster)        │
│     ├── Native Aravis C FFI (Direct libaravis-0.8 on eth0)             │
│     ├── Serial Port Reader (serialport @ 115200 baud)                  │
│     ├── Instant Trigger Pipeline (Serial Event -> Camera Shutter <10ms)│
│     ├── SQLite Database (rusqlite WAL mode @ ~/.speedcamera)           │
│     └── Pure Rust Poliscan Overlay Renderer                            │
└───────────────────────┬─────────────────────────────▲──────────────────┘
                        │ Wi-Fi AP                    │ Ethernet Cable
                        ▼                             │
┌──────────────────────────────────────────┐   ┌──────────────────────────┐
│ Client Device (Phone / Tablet / Laptop)  │   │ Industrial GigE Camera   │
│                                          │   │                          │
│ • Wi-Fi SSID: speedcamera                │   │ • Subnet: 192.168.1.0/24 │
│ • Open: http://192.168.4.1:3000          │   │ • GenICam / Aravis 0.8   │
│ • Live Radar, Live View, Settings, Laps  │   │ • Direct link to eth0    │
└──────────────────────────────────────────┘   └──────────────────────────┘
```

---

## Quick Start

### 1. Local Development & Testing (Mock Mode)

Run on your laptop without physical camera or Arduino hardware:

```bash
cd headless-rust

# Run in mock mode on port 3000
cargo run -- --mock
```

- **Web UI:** `http://localhost:3000`
- **Health Check:** `http://localhost:3000/api/health`
- **Network Info:** `http://localhost:3000/api/network`
- **WebSocket RPC:** `ws://localhost:3000/ws/rpc`

---

### 2. Building for Release

```bash
# Build optimized release binary with embedded frontend
cargo build --release

# The standalone binary is generated at:
# target/release/headless-rust
```

---

### 3. Deploying to Raspberry Pi 5

Copy the single executable and systemd unit to the Pi:

```bash
# 1. Transfer binary to Pi
scp target/release/headless-rust pi@192.168.4.1:/home/pi/speedcamera/headless-rust/

# 2. Register systemd service
sudo cp scripts/speedcamera.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable speedcamera
sudo systemctl restart speedcamera
```

---

## CLI Options

```
Usage: headless-rust [OPTIONS]

Options:
  -m, --mock         Run in mock hardware mode (no physical camera/serial required)
  -p, --port <PORT>  HTTP server port (default: 3000)
  -H, --host <HOST>  HTTP server bind address (default: 0.0.0.0)
  -h, --help         Print help
```

---

## System Requirements on Pi 5

Install runtime dependencies on Raspberry Pi OS:

```bash
sudo apt-get update
sudo apt-get install -y libaravis-0.8-0 libaravis-dev libudev-dev
```
