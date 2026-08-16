import type { StateCreator } from "zustand";
import { getRpc } from "@/lib/rpc";
import type { SerialSlice } from "./serialSlice";
import type { CameraSlice } from "./cameraSlice";
import type { MeasurementSlice } from "./measurementSlice";
import type { LapSlice } from "./lapSlice";

export type SystemState = "PASSIVE" | "DISARMED" | "ARMED";
export type AppMode = "speedcamera" | "laptimer";

export interface SystemSlice {
  /** Underlying daemon armed state */
  isArmed: boolean;
  /** Current operational state of the speed camera system */
  systemState: SystemState;
  setSystemState: (state: SystemState) => void;
  setArmed: (armed: boolean) => Promise<void>;
  handleArmedStatus: (armed: boolean) => void;
  refreshArmedStatus: () => Promise<void>;
  /** Active mode — routes serial events to violation or lap handler */
  appMode: AppMode;
  setAppMode: (mode: AppMode) => void;
}

export const createSystemSlice: StateCreator<
  SystemSlice & SerialSlice & CameraSlice & MeasurementSlice & LapSlice,
  [],
  [],
  SystemSlice
> = (set, get) => ({
  isArmed: false,
  systemState: "PASSIVE",
  setSystemState: (state) => set({ systemState: state }),
  handleArmedStatus: (armed) => {
    const { connectedPort, cameraConnected } = get();
    const conditionsMet = !!connectedPort && cameraConnected;
    set({
      isArmed: armed,
      systemState: !conditionsMet ? "PASSIVE" : armed ? "ARMED" : "DISARMED",
    });
  },
  setArmed: async (armed) => {
    try {
      await getRpc().request.setArmed({ armed });
      get().handleArmedStatus(armed);
    } catch (e) {
      console.error("[systemSlice] Failed to update armed state:", e);
    }
  },
  refreshArmedStatus: async () => {
    try {
      const res = await getRpc().request.getArmedState({});
      get().handleArmedStatus(res.armed);
    } catch (e) {
      console.warn("[systemSlice] Failed to get armed status:", e);
    }
  },
  appMode: "speedcamera",
  setAppMode: (mode) => set({ appMode: mode }),
});

