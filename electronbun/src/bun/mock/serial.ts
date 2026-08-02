import type { PortInfo, SerialStatusPayload } from "../../shared/types";

// ─── State ────────────────────────────────────────────────────────────────────

let pushToView: ((payload: SerialStatusPayload) => void) | null = null;
let connected = false;
let autoFireTimer: ReturnType<typeof setInterval> | null = null;

const MOCK_PORT_PATH = "/dev/mock-speedcamera";

// ─── Serial API (mirrors src/bun/serial.ts) ───────────────────────────────────

let onSpeeding: ((msg: unknown) => void) | null = null;

export function initSerial(
  push: (payload: SerialStatusPayload) => void,
  onSpeedingCapture?: (msg: unknown) => void
): void {
  pushToView = push;
  onSpeeding = onSpeedingCapture || null;
  console.log("[mock/serial] Initialized");
}

export async function listPorts(): Promise<PortInfo[]> {
  return [{ path: MOCK_PORT_PATH, manufacturer: "Speedcamera Mock" }];
}

export async function openPort(_portPath: string): Promise<void> {
  if (connected) return;
  // Do something with _portPath so eslint is happy
  console.debug(`[mock/serial] openPort called with path: ${_portPath}`);
  connected = true;
  console.log("[mock/serial] Port opened");
  pushToView?.({ status: "CONNECTED" });
}

export async function closePort(): Promise<void> {
  if (!connected) return;
  stopAutoFire();
  connected = false;
  console.log("[mock/serial] Port closed");
  pushToView?.({ status: "DISCONNECTED" });
}

export function sendCommand(_json: string): void {
  console.log("[mock/serial] sendCommand (no-op):", _json);
}

export function isConnected(): boolean {
  return connected;
}

// ─── Mock-only API (called by mock/server.ts) ─────────────────────────────────

export interface TriggerOptions {
  speed: number;
  tolerance: number;
  isSpeeding: boolean;
}

export function triggerMeasurement({ speed, tolerance, isSpeeding }: TriggerOptions): void {
  if (!connected) {
    console.warn("[mock/serial] triggerMeasurement called but not connected — ignoring");
    return;
  }
  const timestamp = Date.now();
  if (isSpeeding) {
    const msg = { status: "SPEEDING", value: speed, tolerance, direction: "forward", timestamp };
    pushToView?.(msg as SerialStatusPayload);
    onSpeeding?.(msg);
    console.log(`[mock/serial] Triggered SPEEDING @ ${speed} km/h (tol ${tolerance})`);
  } else {
    pushToView?.({ status: "OK", value: speed, tolerance, direction: "forward", timestamp });
    console.log(`[mock/serial] Triggered OK @ ${speed} km/h (tol ${tolerance})`);
  }
}

export interface AutoFireOptions {
  speed: number;
  tolerance: number;
  isSpeeding: boolean;
  interval: number;
}

export function startAutoFire(options: AutoFireOptions): void {
  stopAutoFire();
  console.log(`[mock/serial] Auto-fire started: every ${options.interval}ms`);
  autoFireTimer = setInterval(() => triggerMeasurement(options), options.interval);
}

export function stopAutoFire(): void {
  if (autoFireTimer !== null) {
    clearInterval(autoFireTimer);
    autoFireTimer = null;
    console.log("[mock/serial] Auto-fire stopped");
  }
}
