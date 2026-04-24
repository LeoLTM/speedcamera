import type { StateCreator } from "zustand";
import type { SerialStatusPayload, Violation } from "@/shared/types";
import type { CameraSlice } from "./cameraSlice";
import type { SystemSlice } from "./systemSlice";
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
  MeasurementSlice & CameraSlice & SystemSlice,
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
    const { systemState } = get();
    // In PASSIVE mode, ignore all serial measurements
    if (systemState === "PASSIVE") return;

    if (payload.status === "SPEEDING") {
      const { value } = payload;
      set({ lastSpeed: value });

      // Only save violations and flash when fully ARMED
      if (systemState !== "ARMED") return;

      if (capturing) return;
      const { cameraStream, maxSpeed, pictureDelay } = get();

      if (!cameraStream || cameraStream.getVideoTracks().length === 0) {
        console.warn("[measurement] SPEEDING detected but no camera stream available");
        return;
      }

      capturing = true;
      set({ isCapturing: true });

      // Grab a reference to the track now so it stays stable across the async chain
      const videoTrack = cameraStream.getVideoTracks()[0];

      // 1. Tell the ESP32 to trigger the flash (it applies its own flashDelay + flashDuration).
      // 2. Wait pictureDelay ms so the flash is illuminating the scene when we capture.
      // 3. Use ImageCapture to grab the frame directly from the stream track —
      //    independent of any DOM visibility/throttling.
      getRpc()
        .request.sendCommand({ json: JSON.stringify({ command: "flash" }) })
        .catch((err: unknown) =>
          console.error("[measurement] Failed to send flash command:", err)
        )
        .then(() => new Promise<void>((resolve) => setTimeout(resolve, pictureDelay)))
        .then(async () => {
          const imageCapture = new ImageCapture(videoTrack);
          const bitmap = await imageCapture.grabFrame();
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) return Promise.reject(new Error("no canvas context"));
          ctx.drawImage(bitmap, 0, 0);
          bitmap.close();
          const imageBase64 = canvas.toDataURL("image/png").replace(/^data:image\/\w+;base64,/, "");
          return getRpc().request.saveViolation({ imageBase64, measuredSpeed: value, maxSpeed });
        })
        .then((violation: Violation) => {
          set({ lastViolation: violation, isCapturing: false });
          playBeep();
          toast.success(`Speed violation: ${value} km/h`, {
            description: `Limit: ${maxSpeed} km/h`,
          });
        })
        .catch((err: unknown) => {
          console.error("[measurement] Capture/save failed:", err);
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
