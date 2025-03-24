import { playBeepSound } from '@/helpers/sound/audio';
import { SerialCommand, SerialCommands } from '@/types/commands';
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
            const serialCommand: SerialCommand = {
                command: SerialCommands.FLASH,
            };
            window.serial.sendCommand(JSON.stringify(serialCommand));
        }
        set({ lastMeasurement: measurement });
    },
    setMaxSpeed: (speed: number) => {
        const serialCommand: SerialCommand = {
            command: SerialCommands.SET_MAX_SPEED,
            value: speed,
        };
        window.serial.sendCommand(JSON.stringify(serialCommand));
        set({ maxSpeed: speed });
    }
})