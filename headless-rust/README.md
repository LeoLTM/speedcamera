# Speedcamera Headless (Rust & Rocket)

A lightweight, high-performance, single-binary speedcamera daemon and responsive web controller written in **Rust** using **Rocket 0.5**, **native Aravis C FFI**, **SQLite**, and an embedded **React + Vite** frontend.

Engineered specifically for **Raspberry Pi 5 with Raspberry Pi OS Lite** (zero desktop or GUI dependencies) with ultra-low latency hardware shutter triggering (<10ms) and rock-solid 24/7 reliability. Creates a standalone Wi-Fi hotspot for laptops, tablets, and phones to connect and manage the system via web browser while communicating with industrial GigE cameras on a dedicated Ethernet subnet.

---

## Architecture & Dual-Subnet Network Setup

```
┌────────────────────────────────────────────────────────────────────────┐
│ Raspberry Pi 5 (Raspberry Pi OS Lite ARM64)                            │
│                                                                        │
│  • eth0 (Camera LAN):    192.168.1.100/24  <── GigE Vision HIKROBOT    │
│  • wlan0 (Hotspot AP):   192.168.4.1/24    <── Web UI Browser Clients  │
│                                                                        │
│  • speedcamera-rust Daemon (Single Standalone Binary)                  │
│     ├── Rocket 0.5 HTTP Server (REST API & Embedded Static Frontend)   │
│     ├── Rocket WS (/ws/rpc JSON-RPC Server & Event Broadcaster)        │
│     ├── Native Aravis C FFI (Direct libaravis-0.8 on eth0)             │
│     ├── Serial Port Reader (serialport @ 115200 baud)                  │
│     ├── Instant Trigger Pipeline (Serial Event -> Camera Shutter <10ms)│
│     ├── SQLite Database (rusqlite WAL mode @ ~/.speedcamera)           │
│     └── Pure Rust Poliscan Overlay Renderer (image + imageproc)        │
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

## Fresh Pi OS Requirements & Dependencies

To set up a fresh Raspberry Pi OS image (recommended: **Raspberry Pi OS Lite 64-bit**), the following tools and packages are required.

> [!TIP]
> The automated installer `bun run install:pi` (or `./scripts/install-rpi.sh` directly on the Pi) automatically checks and installs all of these dependencies for you.

### 1. System Packages (APT)

```bash
sudo apt-get update
sudo apt-get install -y \
  libaravis-0.8-0 \
  libaravis-dev \
  libglib2.0-dev \
  libgobject-2.0-0 \
  libudev-dev \
  pkg-config \
  build-essential \
  esptool \
  network-manager \
  curl \
  unzip \
  git \
  rsync \
  sqlite3 \
  libsqlite3-dev
```

### 2. Rust Toolchain (`rustup`)

Required for building and compiling the native daemon on ARM64:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
```

### 3. Bun Runtime (`bun.sh`)

Required on your developer laptop (and optional on the Pi) for building the React/Vite frontend bundle and running automation/test scripts:

```bash
curl -fsSL https://bun.sh/install | bash
source "$HOME/.bashrc"
```

### 4. GigE Vision Network Socket Buffer Tuning

Industrial GigE Vision cameras stream high-throughput packet bursts. Increase Linux UDP socket buffer limits:

```bash
sudo bash -c 'cat > /etc/sysctl.d/60-gige-camera.conf <<EOF
net.core.rmem_max = 67108864
net.core.rmem_default = 33554432
net.core.wmem_max = 67108864
net.core.wmem_default = 33554432
net.core.netdev_max_backlog = 10000
EOF'
sudo sysctl -p /etc/sysctl.d/60-gige-camera.conf
```

---

## Deployment Procedures

All deployment and maintenance procedures can be executed directly from your development laptop over SSH.

> [!IMPORTANT]
> **Internet Requirement for Build/Deploy**: Because the Pi compiles dependencies and pulls from Git, `bun run install:pi` and `bun run deploy:pi` must be executed while the Pi is in **Home LAN / DHCP** or **Client Wi-Fi Mode** (with internet access).
> If your Pi is currently in standalone **Field Mode** (`192.168.4.1` hotspot), connect the Pi to your Wi-Fi router first via SSH:
> ```bash
> ssh pi@192.168.4.1 '~/speedcamera/headless-rust/scripts/setup-network.sh internet "MyHomeWiFi" "MyPassword"'
> ```
> Or plug in an Ethernet cable and run:
> ```bash
> ssh pi@192.168.4.1 '~/speedcamera/headless-rust/scripts/setup-network.sh dhcp'
> ```

```
┌────────────────────────────────────────────────────────────────────────┐
│ Command                      │ Purpose                                 │
├──────────────────────────────┼─────────────────────────────────────────┤
│ bun run install:pi [target]  │ Fresh Pi install on Home LAN / DHCP     │
│ bun run deploy:pi [target]   │ Upgrade existing Pi (in Internet Mode)  │
│ bun run cleanup:pi [target]  │ Complete teardown & restore DHCP network│
└──────────────────────────────┴─────────────────────────────────────────┘
```

---

### Scenario 1: Fresh Pi Setup (Home LAN / Wi-Fi with DHCP)

Use this scenario when you have a freshly flashed Raspberry Pi connected to your home router / Wi-Fi via DHCP and want to provision the complete speedcamera suite.

#### Run from your laptop:
```bash
cd headless-rust

# Standard fresh installation (SSH key auth):
bun run install:pi pi@raspberrypi.local

# With password prompt (if SSH keys are not configured):
bun run install:pi pi@raspberrypi.local --password

# Using direct IP and automatically switching to Field Mode at the very end:
bun run install:pi pi@192.168.1.50 --field

# Stay in Home LAN mode (skip field network setup):
bun run install:pi pi@raspberrypi.local --lan

# Deploy a specific branch:
bun run install:pi pi@raspberrypi.local --branch feature/headless
```

#### What this command does:
1. Connects to the Raspberry Pi over SSH and verifies internet reachability.
2. Clones or pulls the `speedcamera` git repository directly to `~/speedcamera` on the Pi.
3. Updates Pi system packages (`libaravis-0.8-0`, `libaravis-dev`, `libglib2.0-dev`, `libudev-dev`, `build-essential`, `esptool`, `network-manager`, etc.).
4. Installs the Rust toolchain (`rustup`) and Bun runtime on the Pi.
5. Builds the frontend assets (`bun run build`) and compiles the release binary (`cargo build --release`) natively on Pi 5.
6. Registers, enables, and starts the `speedcamera.service` systemd daemon.
7. **Only after all software and builds succeed**: Transitions network mode to Field Mode if requested (`--field`).

---

### Scenario 2: Upgrading an Existing Installation

Use this scenario to push code updates to an already configured Pi while connected to your **Home LAN** or **Client Wi-Fi**.

#### Run from your laptop:
```bash
cd headless-rust

# Deploy to Pi on Home LAN:
bun run deploy:pi pi@raspberrypi.local

# With password authentication:
bun run deploy:pi pi@raspberrypi.local --password

# Force rebuild frontend & Rust binary:
bun run deploy:pi pi@raspberrypi.local --build
```

#### What this command does:
1. Connects to the Pi via SSH and verifies active internet connectivity.
2. Runs `git pull` in `~/speedcamera` to fetch and apply the latest commits.
3. Automatically rebuilds the frontend bundle on the Pi if frontend files changed.
4. Automatically recompiles the native Rust release binary on the Pi if Rust code or frontend bundle changed.
5. Restarts `speedcamera.service` and verifies that the daemon is active and running.
6. Preserves existing network configuration without causing unexpected disconnections.

---

### Scenario 3: Complete Cleanup & Network Reset

Use this scenario to completely uninstall Speedcamera, remove systemd services, delete application files, and restore standard DHCP networking on Ethernet and Wi-Fi.

#### Option A: Remote cleanup from your laptop
```bash
cd headless-rust

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
~/speedcamera/headless-rust/scripts/cleanup-pi.sh

# Or with complete data purge (database & images):
~/speedcamera/headless-rust/scripts/cleanup-pi.sh --purge --yes
```

---

## Network Mode Management (`setup-network.sh`)

You can switch the Pi's networking mode at any time using the network management script:

```bash
# Switch to Standalone Field Mode (Camera LAN 192.168.1.100 + Hotspot AP 192.168.4.1)
~/speedcamera/headless-rust/scripts/setup-network.sh field

# Connect Pi Wi-Fi to a router for internet updates (Client Mode)
~/speedcamera/headless-rust/scripts/setup-network.sh internet "MyHomeWiFi" "SecretPassword123"

# Revert Ethernet and Wi-Fi to standard DHCP
~/speedcamera/headless-rust/scripts/setup-network.sh dhcp

# Check active connections, IP addresses, and internet reachability
~/speedcamera/headless-rust/scripts/setup-network.sh status
```

---

## Managing the Service on Raspberry Pi

The Speedcamera daemon runs as a `systemd` background service:

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

## Local Development & Testing

You can develop and test the entire system on your local laptop without physical hardware using mock mode:

```bash
cd headless-rust

# 1. Install frontend dependencies
bun install

# 2. Build frontend assets
bun run build

# 3. Run mock backend (on :3000)
cargo run -- --mock

# 4. Run automated server & WebSocket RPC integration tests
bun run test:server
```

- **Web UI:** `http://localhost:3000`
- **Health Endpoint:** `http://localhost:3000/api/health`
- **Network Endpoint:** `http://localhost:3000/api/network`
- **WebSocket RPC:** `ws://localhost:3000/ws/rpc`

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
