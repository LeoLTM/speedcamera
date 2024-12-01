import { StateCreator } from 'zustand';

export interface CameraSlice {
    availableCameras: MediaDeviceInfo[];
    selectedCamera: MediaDeviceInfo | null;
    setAvailableCameras: (cameras: MediaDeviceInfo[]) => void;
    setSelectedCamera: (camera: MediaDeviceInfo | undefined) => void;
}

export const createCameraSlice: StateCreator<
    CameraSlice,
    [],
    [],
    CameraSlice
> = (set) => ({
    availableCameras: [],
    selectedCamera: null,
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
})