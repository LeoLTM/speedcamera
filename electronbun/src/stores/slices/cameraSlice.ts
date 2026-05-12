import type { StateCreator } from "zustand";

export interface CameraSlice {
  /** MediaDeviceInfo entries from navigator.mediaDevices */
  availableCameras: MediaDeviceInfo[];
  /** deviceId of the selected camera */
  selectedCameraDeviceId: string;
  /** Live MediaStream from GlobalWebcam (null until camera access is granted) */
  cameraStream: MediaStream | null;
  /** Delay in ms between the flash command and the screenshot */
  pictureDelay: number;
  setAvailableCameras: (cameras: MediaDeviceInfo[]) => void;
  setSelectedCameraDeviceId: (deviceId: string) => void;
  setCameraStream: (stream: MediaStream | null) => void;
  setPictureDelay: (delay: number) => void;
}

export const createCameraSlice: StateCreator<CameraSlice, [], [], CameraSlice> = (set) => ({
  availableCameras: [],
  // TODO: replace with real camera selection once multi-camera support is implemented
  selectedCameraDeviceId: "mocked",
  cameraStream: null,
  pictureDelay: 100,
  setAvailableCameras: () => { /* mocked — no-op */ },
  setSelectedCameraDeviceId: () => { /* mocked — no-op */ },
  setCameraStream: (stream) => set({ cameraStream: stream }),
  setPictureDelay: (delay) => set({ pictureDelay: delay }),
});
