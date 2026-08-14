import type { StateCreator } from "zustand";
import type { PortInfo } from "@/shared/types";

export interface SerialSlice {
  availablePorts: PortInfo[];
  /** Path of the selected port (from settings or UI) */
  selectedPort: string;
  /** Path of the currently open/connected port, or "" */
  connectedPort: string;
  setAvailablePorts: (ports: PortInfo[]) => void;
  setSelectedPort: (path: string) => void;
  setConnectedPort: (path: string) => void;
}

export const createSerialSlice: StateCreator<SerialSlice, [], [], SerialSlice> = (set) => ({
  availablePorts: [],
  selectedPort: "",
  connectedPort: "",
  setAvailablePorts: (ports) => set({ availablePorts: ports }),
  setSelectedPort: (path) => set({ selectedPort: path }),
  setConnectedPort: (path) => set({ connectedPort: path }),
});
