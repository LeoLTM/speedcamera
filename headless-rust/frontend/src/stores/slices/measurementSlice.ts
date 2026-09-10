import type { StateCreator } from "zustand";
import type { SerialStatusPayload, Violation, EspPongConfig } from "@/shared/types";
import type { CameraSlice } from "./cameraSlice";
import type { SystemSlice } from "./systemSlice";
import { pluginRegistry } from "@/plugins";
import { getRpc } from "@/lib/rpc";

export interface MeasurementSlice {
  /** Last measured speed in km/h (null = no reading yet) */
  lastSpeed: number | null;
  /** Direction of last measurement (null = no reading yet) */
  lastDirection: "forward" | "reverse" | null;
  /** Max allowed speed (km/h) from settings */
  maxSpeed: number;
  /** Most recently captured violation (event-driven, no polling) */
  lastViolation: Violation | null;
  /** Config returned by the last successful ping */
  lastPongConfig: EspPongConfig | null;
  setMaxSpeed: (speed: number) => void;
  setLastViolation: (v: Violation | null) => void;
  handleSerialStatus: (payload: SerialStatusPayload) => void;
}

export const createMeasurementSlice: StateCreator<
  MeasurementSlice & CameraSlice & SystemSlice,
  [],
  [],
  MeasurementSlice
> = (set, get) => ({
  lastSpeed: null,
  lastDirection: null,
  maxSpeed: 30,
  lastViolation: null,
  lastPongConfig: null,

  setMaxSpeed: (speed) => set({ maxSpeed: speed }),

  setLastViolation: (v) => set({ lastViolation: v }),

  handleSerialStatus: (payload) => {
    // PONG is handled regardless of system state or app mode
    if (payload.status === "PONG") {
      set({ lastPongConfig: payload.config });
      if (payload.config?.maxSpeed !== undefined) {
        set({ maxSpeed: payload.config.maxSpeed });
      }
      return;
    }

    if (payload.status === "CONFIG" && payload.key === "maxSpeed") {
      const speedVal = payload.value;
      set({ maxSpeed: speedVal });
      const current = get().lastPongConfig;
      if (current) {
        set({ lastPongConfig: { ...current, maxSpeed: speedVal } });
      }
      return;
    }

    if (payload.status === "CONNECTED") {
      const port = (payload as any).port || (get() as any).selectedPort || "connected";
      (get() as any).setConnectedPort(port);
      // Immediately query ESP config so UI is always synced with hardware
      void getRpc().request.sendCommand({ json: JSON.stringify({ command: "ping" }) });
      return;
    }

    if (payload.status === "DISCONNECTED") {
      (get() as any).setConnectedPort("");
      return;
    }

    // Forward plugin-specific events (e.g. lap timer) to registered plugins
    if (pluginRegistry.dispatchSerialStatus(payload)) {
      return;
    }

    const { systemState, appMode } = get();

    // If in plugin mode (e.g. lap timer), speed events update display without recording violations
    if (appMode !== "speedcamera") {
      if (payload.status === "SPEEDING" || payload.status === "OK") {
        set({ lastSpeed: payload.value, lastDirection: payload.direction });
      }
      return;
    }

    // In PASSIVE mode, ignore all serial measurements
    if (systemState === "PASSIVE") return;

    if (payload.status === "SPEEDING") {
      const { value, direction } = payload;
      set({ lastSpeed: value, lastDirection: direction });
    } else if (payload.status === "OK") {
      set({ lastSpeed: payload.value, lastDirection: payload.direction });
    }
  },
});
