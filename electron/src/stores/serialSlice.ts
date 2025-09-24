import { PortInfo } from '@serialport/bindings-cpp';
import { StateCreator } from 'zustand';

export interface SerialSlice {
    availablePorts: PortInfo[];
    selectedPort: string | null;
    initializedPort: string | null;
    setAvailablePorts: (ports: PortInfo[]) => void;
    setSelectedPort: (port: string | undefined) => void;
    setInitializedPort: (port: string | undefined) => void;
}

export const createSerialSlice: StateCreator<
    SerialSlice,
    [],
    [],
    SerialSlice
> = (set) => ({
    availablePorts: [],
    selectedPort: null,
    initializedPort: null,
    setAvailablePorts: (ports: PortInfo[]) => {
        set({ availablePorts: ports });
    },
    setSelectedPort: (port: string | undefined) => {
        if (!port) {
            set({ selectedPort: null });
            return;
        }
        set({ selectedPort: port });
    },
    setInitializedPort: (port: string | undefined) => {
        if (!port) {
            set({ initializedPort: null });
            return;
        }
        set({ initializedPort: port });
    },
})