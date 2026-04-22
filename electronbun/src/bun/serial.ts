import { SerialPort, ReadlineParser } from "serialport";
import type { PortInfo, SerialStatusPayload } from "../shared/types";

// ─── State ────────────────────────────────────────────────────────────────────

let activePort: SerialPort | null = null;
let pushToView: ((payload: SerialStatusPayload) => void) | null = null;

// ─── Initialization ───────────────────────────────────────────────────────────

/**
 * Provide the callback that will be used to push serialStatus messages to the view.
 * Call this once from index.ts after the BrowserWindow is created.
 */
export function initSerial(push: (payload: SerialStatusPayload) => void): void {
  pushToView = push;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function listPorts(): Promise<PortInfo[]> {
  return SerialPort.list();
}

export async function openPort(portPath: string): Promise<void> {
  if (activePort?.isOpen) {
    await closePort();
  }

  return new Promise((resolve, reject) => {
    const port = new SerialPort({
      path: portPath,
      baudRate: 115200,
      autoOpen: false,
    });

    const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

    port.open((err) => {
      if (err) {
        reject(new Error(`Failed to open ${portPath}: ${err.message}`));
        return;
      }

      activePort = port;
      console.log(`[serial] Opened ${portPath}`);

      pushToView?.({ status: "CONNECTED" });

      resolve();
    });

    parser.on("data", (raw: string) => {
      handleIncoming(raw.trim());
    });

    port.on("error", (err) => {
      console.error(`[serial] Port error on ${portPath}:`, err);
    });

    port.on("close", () => {
      console.log(`[serial] Port ${portPath} closed`);
      activePort = null;
      pushToView?.({ status: "DISCONNECTED" });
    });
  });
}

export async function closePort(): Promise<void> {
  if (!activePort) return;

  return new Promise((resolve, reject) => {
    activePort!.close((err) => {
      if (err) {
        reject(new Error(`Failed to close port: ${err.message}`));
      } else {
        activePort = null;
        resolve();
      }
    });
  });
}

export function sendCommand(json: string): void {
  if (!activePort?.isOpen) {
    console.warn("[serial] sendCommand called but no port is open");
    return;
  }
  activePort.write(json + "\n", (err) => {
    if (err) console.error("[serial] Write error:", err);
  });
}

export function isConnected(): boolean {
  return activePort?.isOpen === true;
}

// ─── Incoming data parser ─────────────────────────────────────────────────────

/**
 * ESP32 sends JSON status messages, e.g.:
 *   {"status":"speeding","value":45.2,"tolerance":3.0}
 *   {"status":"legal","value":25.0,"tolerance":2.0}
 *   {"status":"config","value":30}
 *   {"status":"flash"}
 *   {"status":"jsonError"}
 */
function handleIncoming(raw: string): void {
  console.log("[serial] Received:", raw);

  let msg: { status?: string; value?: number; tolerance?: number };
  try {
    msg = JSON.parse(raw);
  } catch {
    console.warn("[serial] Non-JSON data received:", raw);
    return;
  }

  if (!msg.status) return;

  switch (msg.status) {
    case "speeding":
      pushToView?.({
        status: "SPEEDING",
        value: msg.value ?? 0,
        tolerance: msg.tolerance ?? 0,
      });
      break;

    case "legal":
    case "measuring":
      pushToView?.({
        status: "OK",
        value: msg.value ?? 0,
        tolerance: msg.tolerance ?? 0,
      });
      break;

    // config, flash, jsonError, timeout — no view push needed
    default:
      break;
  }
}
