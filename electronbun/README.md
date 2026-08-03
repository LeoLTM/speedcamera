# speedcamera-electronbun

A remake of the speedcamera app using electronbun.

## Getting Started

```bash
# Install dependencies
bun install

# Start development server
bun run start

# Start development server with a mock speedcamera device (for testing)
bun run start:mock

# Development without HMR (uses bundled assets)
bun run dev

# Development with HMR (recommended)
bun run dev:hmr

# Build for production
bun run build

# Build for production release
bun run build:stable
```

## How HMR Works

When you run `bun run dev:hmr`:

1. **Vite dev server** starts on `http://localhost:5173` with HMR enabled
2. **Electrobun** starts and detects the running Vite server
3. The app loads from the Vite dev server instead of bundled assets
4. Changes to React components update instantly without full page reload

When you run `bun run dev` (without HMR):

1. Electrobun starts and loads from `views://mainview/index.html`
2. You need to rebuild (`bun run build`) to see changes

## Project Structure

```
├── src/
│   ├── bun/
│   │   └── index.ts        # Main process (Electrobun/Bun)
│   └── mainview/
│       ├── App.tsx         # React app component
│       ├── main.tsx        # React entry point
│       ├── index.html      # HTML template
│       └── index.css       # Tailwind CSS
├── electrobun.config.ts    # Electrobun configuration
├── vite.config.ts          # Vite configuration
├── tailwind.config.js      # Tailwind configuration
└── package.json
```

## Installation, Upgrading & Uninstallation (Linux)

### System Dependencies
- **Debian / Ubuntu**: `sudo apt update && sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0 zstd`
- **Fedora**: `sudo dnf install webkit2gtk4.1 gtk3 zstd`

### Installing
1. Unpack `stable-linux-x64-Speedcamera-Setup.tar.gz` and run the self-extractor (`installer` or `Speedcamera-Setup`):

```bash
tar -xzf stable-linux-x64-Speedcamera-Setup.tar.gz
cd stable-linux-x64-Speedcamera-Setup/
chmod +x installer  # or Speedcamera-Setup
./installer
```

*The installer automatically unpacks the app into `~/.local/share/com.speedcamera.app/stable/app/`.*

2. Create a desktop shortcut in `~/.local/share/applications/speedcamera.desktop`:

```ini
[Desktop Entry]
Name=Speedcamera
Exec=/home/YOUR_USERNAME/.local/share/com.speedcamera.app/stable/app/bin/launcher
Type=Application
Categories=Utility;
Terminal=false
```
*(Replace `YOUR_USERNAME` with your Linux username or `$USER`)*

3. (Optional) Refresh application launcher cache:
```bash
update-desktop-database ~/.local/share/applications
```

### Upgrading
- **Automatic**: Background updates occur automatically via Electrobun's `Updater` API (fetching `.tar.zst` / `.patch` releases).
- **Manual**: Run `./installer` from a newly downloaded release archive. It will update the application in `~/.local/share/com.speedcamera.app/stable/app/` while keeping user data (`~/.config/com.speedcamera.app/`) intact.

### Uninstallation
```bash
# Remove desktop shortcut
rm -f ~/.local/share/applications/speedcamera.desktop

# Remove installed app, user data, config, cache, and logs
rm -rf ~/.local/share/com.speedcamera.app/ ~/.config/com.speedcamera.app/ ~/.cache/com.speedcamera.app/
```

## File Locations

- DB path: `/home/<your_username>/.local/share/com.speedcamera.app/dev/speedcamera.db`
- Images dir: `/home/<your_username>/.local/share/com.speedcamera.app/dev/images/`

## Firmware Flashing

The firmware update UI (Settings → Device → Firmware Update) requires the `esptool` binary to be present at `resources/esptool`. This file is excluded from git and downloaded automatically in CI.

For local development, use one of the following:

**Option A — download the pre-built binary (Linux amd64, matches CI):**
```bash
bun run setup:esptool
```

**Option B — install esptool system-wide via pip (cross-platform):**
```bash
pip install esptool
```

The app will automatically detect a system-installed `esptool` on `$PATH` if the bundled binary is not found.

> **Note:** Flash testing requires a physical ESP8266 device connected over USB. You will also need a GitHub personal access token (fine-grained PAT with *Contents: Read* access) configured in the app to fetch firmware releases from the private repository.

## Customizing

- **React components**: Edit files in `src/mainview/`
- **Tailwind theme**: Edit `tailwind.config.js`
- **Vite settings**: Edit `vite.config.ts`
- **Window settings**: Edit `src/bun/index.ts`
- **App metadata**: Edit `electrobun.config.ts`
