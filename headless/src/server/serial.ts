import { SerialPort, list, readlineParser } from "bun-serialport";
import type { PortInfo, SerialStatusPayload } from "../shared/types";
import { EspMessageSchema, EspCommandSchema, type EspMessage } from "../shared/schemas";

// ─── State ────────────────────────────────────────────────────────────────────

let activePort: SerialPort | null = null;
let pushToView: ((payload: SerialStatusPayload) => void) | null = null;
let onSpeeding: ((msg: EspMessage) => void) | null = null;

// ─── Initialization ───────────────────────────────────────────────────────────

export function initSerial(
  push: (payload: SerialStatusPayload) => void,
  onSpeedingCapture?: (msg: EspMessage) => void
): void {
  pushToView = push;
  onSpeeding = onSpeedingCapture || null;
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
  await activePort.close();
}

export function sendCommand(json: string): void {
  if (!activePort?.isOpen) {
    console.warn("[serial] sendCommand called but no port is open");
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    console.error("[serial] sendCommand: invalid JSON:", json);
    return;
  }

  const validation = EspCommandSchema.safeParse(parsed);
  if (!validation.success) {
    console.error("[serial] sendCommand: invalid command schema:", validation.error.issues);
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

function handleIncoming(raw: string): void {
  const timestamp = Date.now();
  console.log("[serial] Received:", raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn("[serial] Non-JSON data received:", raw);
    return;
  }

  if (typeof parsed === "object" && parsed !== null && "debug" in parsed) {
    console.debug("[serial] ESP debug:", (parsed as Record<string, unknown>).debug);
    return;
  }

  const result = EspMessageSchema.safeParse(parsed);
  if (!result.success) {
    console.warn("[serial] Schema validation failed:", result.error.issues, "raw:", raw);
    return;
  }

  const msg = result.data;

  switch (msg.status) {
    case "speeding":
      pushToView?.({
        status: "SPEEDING",
        value: msg.value,
        tolerance: msg.tolerance,
        direction: msg.direction,
        timestamp,
      });
      onSpeeding?.(msg);
      break;

    case "legal":
      pushToView?.({
        status: "OK",
        value: msg.value,
        tolerance: msg.tolerance,
        direction: msg.direction,
        timestamp,
      });
      break;

    case "pong":
      pushToView?.({ status: "PONG", config: msg.config });
      break;

    case "lapStart":
      pushToView?.({
        status: "LAPSTART",
        lapNumber: msg.lapNumber,
        speedAtStart: msg.speedAtStart,
        timestamp,
      });
      break;

    case "lapEnd":
      pushToView?.({
        status: "LAPEND",
        lapNumber: msg.lapNumber,
        durationMs: msg.durationMs,
        speedAtStart: msg.speedAtStart,
        speedAtEnd: msg.speedAtEnd,
        timestamp,
      });
      break;

    case "lapWaiting":
      pushToView?.({ status: "LAPWAITING" });
      break;

    case "lapStopped":
      pushToView?.({ status: "LAPSTOPPED" });
      break;

    case "configError":
      console.warn("[serial] ESP config error:", msg.message);
      break;

    default:
      break;
  }
}
