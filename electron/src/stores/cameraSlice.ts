import { RefObject } from 'react';
import Webcam from 'react-webcam';
import { StateCreator } from 'zustand';

export interface CameraSlice {
    availableCameras: MediaDeviceInfo[];
    selectedCamera: MediaDeviceInfo | null;
    selectedCameraRef: RefObject<Webcam> | null;
    setAvailableCameras: (cameras: MediaDeviceInfo[]) => void;
    setSelectedCamera: (camera: MediaDeviceInfo | undefined) => void;
    setSelectedCameraRef: (camera: RefObject<Webcam> | null) => void;
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
    }
})