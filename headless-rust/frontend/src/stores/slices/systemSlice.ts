import type { StateCreator } from "zustand";
import { getRpc } from "@/lib/rpc";
import type { SerialSlice } from "./serialSlice";
import type { CameraSlice } from "./cameraSlice";
import type { MeasurementSlice } from "./measurementSlice";
import type { ModeAvailability, OperatingModeStatus, SetOperatingModeResult } from "@/shared/types";
import { pluginRegistry } from "@/plugins";

export type SystemState = "PASSIVE" | "DISARMED" | "ARMED";
export type AppMode = "speedcamera" | "laptimer" | "alignment" | "setup" | string;

export interface SystemSlice {
  /** Underlying daemon armed state */
  isArmed: boolean;
  /** Current operational state of the speed camera system */
  systemState: SystemState;
  setSystemState: (state: SystemState) => void;
  setArmed: (armed: boolean) => Promise<void>;
  handleArmedStatus: (armed: boolean) => void;
  refreshArmedStatus: () => Promise<void>;

  /** Centralized synchronized operating mode */
  operatingMode: AppMode;
  previousMode: string | null;
  availableModes: Record<string, ModeAvailability>;
  handleOperatingModeStatus: (status: OperatingModeStatus) => void;
  refreshOperatingMode: () => Promise<void>;
  requestModeChange: (targetMode: string, force?: boolean) => Promise<SetOperatingModeResult>;

  /** Backwards-compatible alias for UI components */
  appMode: AppMode;
  setAppMode: (mode: AppMode) => Promise<SetOperatingModeResult>;
}

export const createSystemSlice: StateCreator<
  SystemSlice & SerialSlice & CameraSlice & MeasurementSlice,
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

  operatingMode: "speedcamera",
  previousMode: null,
  availableModes: {},
  appMode: "speedcamera",

  handleOperatingModeStatus: (status: OperatingModeStatus) => {
    pluginRegistry.dispatchModeChange(status.currentMode);
    const isSetup = status.currentMode === "setup";
    set({
      operatingMode: status.currentMode,
      previousMode: status.previousMode,
      availableModes: status.availableModes || {},
      appMode: status.currentMode,
      isArmed: status.armed,
      setupStreamActive: isSetup,
      liveFrame: isSetup ? get().liveFrame : null,
    });
    get().handleArmedStatus(status.armed);
  },


  refreshOperatingMode: async () => {
    try {
      const res = await getRpc().request.getOperatingMode({});
      if (res) {
        get().handleOperatingModeStatus(res);
      }
    } catch (e) {
      console.warn("[systemSlice] Failed to get operating mode:", e);
    }
  },

  requestModeChange: async (targetMode: string, force?: boolean) => {
    try {
      const res = await getRpc().request.setOperatingMode({ targetMode, force });
      if (res.success && res.status) {
        get().handleOperatingModeStatus(res.status);
      }
      return res;
    } catch (e: any) {
      console.error("[systemSlice] Error setting operating mode:", e);
      return {
        success: false,
        message: e?.message || "Failed to switch operating mode",
      };
    }
  },

  setAppMode: async (mode: AppMode) => {
    return get().requestModeChange(mode);
  },
});


