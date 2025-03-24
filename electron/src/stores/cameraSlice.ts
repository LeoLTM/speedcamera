import { RefObject } from 'react';
import Webcam from 'react-webcam';
import { StateCreator } from 'zustand';
import { SerialCommand, SerialCommands } from '@/types/commands';

export interface CameraSlice {
    availableCameras: MediaDeviceInfo[];
    selectedCamera: MediaDeviceInfo | null;
    selectedCameraRef: RefObject<Webcam> | null;
    pictureDelay: number;
    flashDelay: number;
    flashDuration: number;
    setAvailableCameras: (cameras: MediaDeviceInfo[]) => void;
    setSelectedCamera: (camera: MediaDeviceInfo | undefined) => void;
    setSelectedCameraRef: (camera: RefObject<Webcam> | null) => void;
    setPictureDelay: (delay: number) => void;
    setFlashDelay: (delay: number) => void;
    setFlashDuration: (duration: number) => void;
}

export const createCameraSlice: StateCreator<
    CameraSlice,
    [],
    [],
    CameraSlice
> = (set) => ({
    availableCameras: [],
    selectedCamera: null,
    selectedCameraRef: { current: null },
    pictureDelay: 100,
    flashDelay: 100,
    flashDuration: 50,
    setAvailableCameras: (cameras: MediaDeviceInfo[]) => {
        set({ availableCameras: cameras });
    },
    setSelectedCamera: (camera: MediaDeviceInfo | undefined) => {
        if (!camera) {
            set({ selectedCamera: null });
            return;
        }
        set({ selectedCamera: camera });
    },
    setSelectedCameraRef: (camera: RefObject<Webcam> | null) => {
        set({ selectedCameraRef: camera });
    },
    setPictureDelay: (delay: number) => {
        set({ pictureDelay: delay });
    },
    setFlashDelay: (delay: number) => {
        const serialCommand: SerialCommand = {
            command: SerialCommands.SET_FLASH_DELAY,
            value: delay,
        };
        window.serial.sendCommand(JSON.stringify(serialCommand));
        set({ flashDelay: delay });
    },
    setFlashDuration: (duration: number) => {
        const serialCommand: SerialCommand = {
            command: SerialCommands.SET_FLASH_DURATION,
            value: duration,
        };
        window.serial.sendCommand(JSON.stringify(serialCommand));
        set({ flashDuration: duration });
    },
})