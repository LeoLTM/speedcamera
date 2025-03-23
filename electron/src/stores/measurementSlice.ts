import { StateCreator } from 'zustand';

export interface MeasurementSlice {
    lastMeasurement: number | null;
    maxSpeed: number;
    setLastMeasurement: (measurement: number) => void;
    setMaxSpeed: (speed: number) => void;
}

export const createMeasurementSlice: StateCreator<
    MeasurementSlice,
    [],
    [],
    MeasurementSlice
> = (set) => ({
    lastMeasurement: null,
    maxSpeed: 2,
    setLastMeasurement: (measurement: number) => {
        set({ lastMeasurement: measurement });
    },
    setMaxSpeed: (speed: number) => {
        set({ maxSpeed: speed });
    }
})