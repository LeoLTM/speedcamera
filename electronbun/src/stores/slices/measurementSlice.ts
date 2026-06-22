import type { StateCreator } from "zustand";
import type { SerialStatusPayload, Violation, EspPongConfig } from "@/shared/types";
import type { CameraSlice } from "./cameraSlice";
import type { SystemSlice } from "./systemSlice";
import type { LapSlice } from "./lapSlice";
import { getRpc } from "@/lib/rpc";
import { playBeep } from "@/lib/sound";
import { toast } from "sonner";

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
  MeasurementSlice & CameraSlice & SystemSlice & LapSlice,
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
      return;
    }

    const { systemState, appMode } = get();
    // In PASSIVE mode, ignore all serial measurements
    if (systemState === "PASSIVE") return;

    // In lap timer mode, delegate lap-specific events to the lap state machine
    if (appMode === "laptimer") {
      if (payload.status === "LAPSTART" || payload.status === "LAPEND" ||
          payload.status === "LAPWAITING" || payload.status === "LAPSTOPPED") {
        get().handleSerialStatusForLap(payload);
        return;
      }
      // Speed events still update the display but do not create violations in lap mode
      if (payload.status === "SPEEDING" || payload.status === "OK") {
        set({ lastSpeed: payload.value, lastDirection: payload.direction });
      }
      return;
    }

    if (payload.status === "SPEEDING") {
      const { value, direction } = payload;
      set({ lastSpeed: value, lastDirection: direction });

      // Only save violations and flash when fully ARMED
      if (systemState !== "ARMED") return;

      const { maxSpeed } = get();

      // Trigger bun-side capture and save
      getRpc()
        .request.saveViolation({ measuredSpeed: value, maxSpeed, direction })
        .then((v) => {
          get().setLastViolation(v);
        })
        .catch((err: unknown) => {
          console.error("[measurement] Capture/save failed:", err);
          toast.error("Failed to save violation");
        });
    } else if (payload.status === "OK") {
      set({ lastSpeed: payload.value, lastDirection: payload.direction });
    }
    // CONNECTED / DISCONNECTED handled by serialSlice indirectly via store
  },
});
