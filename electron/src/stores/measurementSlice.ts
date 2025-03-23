import { playBeepSound } from '@/helpers/sound/audio';
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
> = (set, get) => ({
    lastMeasurement: null,
    maxSpeed: 2,
    setLastMeasurement: (measurement: number) => {
        const { maxSpeed } = get();
        if (measurement > maxSpeed) {
            playBeepSound();
        }
        set({ lastMeasurement: measurement });
    },
    setMaxSpeed: (speed: number) => {
        set({ maxSpeed: speed });
    }
})