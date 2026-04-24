import { SerialPort, list, readlineParser } from "bun-serialport";
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
  return list();
}

export async function openPort(portPath: string): Promise<void> {
  if (activePort?.isOpen) {
    await closePort();
  }

  const port = new SerialPort({
    path: portPath,
    baudRate: 115200,
    autoOpen: false,
  });

  // Attach listeners before opening so no events are missed.
  const parser = port.pipe(readlineParser());

  parser.on("data", (line: string) => {
    handleIncoming(line.trim());
  });

  port.on("error", (err: Error) => {
    console.error(`[serial] Port error on ${portPath}:`, err);
  });

  port.on("close", () => {
    console.log(`[serial] Port ${portPath} closed`);
    activePort = null;
    pushToView?.({ status: "DISCONNECTED" });
  });

  await port.open();

  activePort = port;
  console.log(`[serial] Opened ${portPath}`);
  pushToView?.({ status: "CONNECTED" });
}

export async function closePort(): Promise<void> {
  if (!activePort) return;
  // The 'close' event handler clears activePort and pushes DISCONNECTED.
  await activePort.close();
}

export function sendCommand(json: string): void {
  if (!activePort?.isOpen) {
    console.warn("[serial] sendCommand called but no port is open");
    return;
  }
  activePort.write(json + "\n").catch((err: Error) => {
    console.error("[serial] Write error:", err);
  });
  console.debug("[serial] Sent command:", json);
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
  const timestamp = Date.now(); // capture as early as possible for timing precision
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
        timestamp,
      });
      break;

    case "legal":
      pushToView?.({
        status: "OK",
        value: msg.value ?? 0,
        tolerance: msg.tolerance ?? 0,
        timestamp,
      });
      break;

    // measuring = sensor 1 triggered, waiting for sensor 2 — internal Arduino state,
    // not a complete car pass; config, flash, jsonError, timeout — no view push needed
    default:
      break;
  }
}
