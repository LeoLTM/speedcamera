import type { StateCreator } from "zustand";

export type SystemState = "PASSIVE" | "DISARMED" | "ARMED";
export type AppMode = "speedcamera" | "laptimer";

export interface SystemSlice {
  /** Current operational state of the speed camera system */
  systemState: SystemState;
  setSystemState: (state: SystemState) => void;
  /** Active mode — routes serial events to violation or lap handler */
  appMode: AppMode;
  setAppMode: (mode: AppMode) => void;
}

export const createSystemSlice: StateCreator<SystemSlice, [], [], SystemSlice> = (set) => ({
  systemState: "PASSIVE",
  setSystemState: (state) => set({ systemState: state }),
  appMode: "speedcamera",
  setAppMode: (mode) => set({ appMode: mode }),
});
