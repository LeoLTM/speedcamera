import type { StateCreator } from "zustand";
import type { SerialStatusPayload, Violation } from "@/shared/types";
import type { CameraSlice } from "./cameraSlice";
import { getRpc } from "@/lib/rpc";
import { playBeep } from "@/lib/sound";
import { toast } from "sonner";

export interface MeasurementSlice {
  /** Last measured speed in km/h (null = no reading yet) */
  lastSpeed: number | null;
  /** Max allowed speed (km/h) from settings */
  maxSpeed: number;
  /** Most recently captured violation (event-driven, no polling) */
  lastViolation: Violation | null;
  /** Prevent re-entrant captures */
  isCapturing: boolean;
  setMaxSpeed: (speed: number) => void;
  setLastViolation: (v: Violation | null) => void;
  handleSerialStatus: (payload: SerialStatusPayload) => void;
}

// Module-level guard to survive Zustand re-renders
let capturing = false;

export const createMeasurementSlice: StateCreator<
  MeasurementSlice & CameraSlice,
  [],
  [],
  MeasurementSlice
> = (set, get) => ({
  lastSpeed: null,
  maxSpeed: 30,
  lastViolation: null,
  isCapturing: false,

  setMaxSpeed: (speed) => set({ maxSpeed: speed }),

  setLastViolation: (v) => set({ lastViolation: v }),

  handleSerialStatus: (payload) => {
    if (payload.status === "SPEEDING") {
      const { value } = payload;
      set({ lastSpeed: value });

      if (capturing) return;
      const { webcamRef, maxSpeed } = get();

      if (!webcamRef?.current) {
        console.warn("[measurement] SPEEDING detected but no webcam ref available");
        return;
      }

      capturing = true;
      set({ isCapturing: true });

      const screenshot = webcamRef.current.getScreenshot();
      if (!screenshot) {
        console.error("[measurement] Failed to capture webcam screenshot");
        capturing = false;
        set({ isCapturing: false });
        return;
      }

      // Strip data-URL prefix — bun side adds it back when reading
      const imageBase64 = screenshot.replace(/^data:image\/\w+;base64,/, "");

      getRpc()
        .request.saveViolation({ imageBase64, measuredSpeed: value, maxSpeed })
        .then((violation: Violation) => {
          set({ lastViolation: violation, isCapturing: false });
          playBeep();
          toast.success(`Speed violation: ${value} km/h`, {
            description: `Limit: ${maxSpeed} km/h`,
          });
        })
        .catch((err: unknown) => {
          console.error("[measurement] saveViolation failed:", err);
          toast.error("Failed to save violation");
          set({ isCapturing: false });
        })
        .finally(() => {
          capturing = false;
        });
    } else if (payload.status === "OK") {
      set({ lastSpeed: payload.value });
    }
    // CONNECTED / DISCONNECTED handled by serialSlice indirectly via store
  },
});
