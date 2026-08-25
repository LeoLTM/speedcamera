import type { StateCreator } from "zustand";
import type { PortInfo } from "@/shared/types";
import { getRpc } from "@/lib/rpc";

export interface SerialSlice {
  availablePorts: PortInfo[];
  /** Path of the selected port (from settings or UI) */
  selectedPort: string;
  /** Path of the currently open/connected port, or "" */
  connectedPort: string;
  setAvailablePorts: (ports: PortInfo[]) => void;
  setSelectedPort: (path: string) => void;
  setConnectedPort: (path: string) => void;
  refreshSerialStatus: () => Promise<void>;
  connectPort: (path: string) => Promise<void>;
  disconnectPort: () => Promise<void>;
}

export const createSerialSlice: StateCreator<SerialSlice, [], [], SerialSlice> = (set) => ({
  availablePorts: [],
  selectedPort: "",
  connectedPort: "",
  setAvailablePorts: (ports) => set({ availablePorts: ports }),
  setSelectedPort: (path) => set({ selectedPort: path }),
  setConnectedPort: (path) => set({ connectedPort: path }),

  refreshSerialStatus: async () => {
    try {
      const status = await getRpc().request.getSerialStatus({});
      if (status.connected && status.port) {
        set({ connectedPort: status.port, selectedPort: status.port });
      } else if (!status.connected) {
        set({ connectedPort: "" });
      }
    } catch (e) {
      console.warn("[serialSlice] Failed to get serial status:", e);
    }
  },

  connectPort: async (path: string) => {
    await getRpc().request.openPort({ path });
    await getRpc().request.saveSetting({ key: "selectedPort", value: path });
    set({ connectedPort: path, selectedPort: path });
  },

  disconnectPort: async () => {
    await getRpc().request.closePort({});
    set({ connectedPort: "" });
  },
});
