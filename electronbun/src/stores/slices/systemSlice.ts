import type { StateCreator } from "zustand";

export type SystemState = "PASSIVE" | "DISARMED" | "ARMED";

export interface SystemSlice {
  /** Current operational state of the speed camera system */
  systemState: SystemState;
  setSystemState: (state: SystemState) => void;
}

export const createSystemSlice: StateCreator<SystemSlice, [], [], SystemSlice> = (set) => ({
  systemState: "PASSIVE",
  setSystemState: (state) => set({ systemState: state }),
});
