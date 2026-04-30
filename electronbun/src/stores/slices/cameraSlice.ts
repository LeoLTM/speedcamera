import type { RefObject } from "react";
import type Webcam from "react-webcam";
import type { StateCreator } from "zustand";

export interface CameraSlice {
  /** MediaDeviceInfo entries from navigator.mediaDevices */
  availableCameras: MediaDeviceInfo[];
  /** deviceId of the selected camera */
  selectedCameraDeviceId: string;
  /** Ref to the react-webcam instance (set by GlobalWebcam, always-mounted) */
  webcamRef: RefObject<Webcam | null> | null;
  /** Live MediaStream from the always-mounted GlobalWebcam (null until camera starts) */
  cameraStream: MediaStream | null;
  /** Delay in ms between the flash command and the screenshot */
  pictureDelay: number;
  setAvailableCameras: (cameras: MediaDeviceInfo[]) => void;
  setSelectedCameraDeviceId: (deviceId: string) => void;
  setWebcamRef: (ref: RefObject<Webcam | null> | null) => void;
  setCameraStream: (stream: MediaStream | null) => void;
  setPictureDelay: (delay: number) => void;
}

export const createCameraSlice: StateCreator<CameraSlice, [], [], CameraSlice> = (set) => ({
  availableCameras: [],
  // TODO: replace with real camera selection once multi-camera support is implemented
  selectedCameraDeviceId: "mocked",
  webcamRef: null,
  cameraStream: null,
  pictureDelay: 100,
  setAvailableCameras: () => { /* mocked — no-op */ },
  setSelectedCameraDeviceId: () => { /* mocked — no-op */ },
  setWebcamRef: (ref) => set({ webcamRef: ref }),
  setCameraStream: (stream) => set({ cameraStream: stream }),
  setPictureDelay: (delay) => set({ pictureDelay: delay }),
});
