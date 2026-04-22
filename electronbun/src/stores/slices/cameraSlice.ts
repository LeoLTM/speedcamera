import type { RefObject } from "react";
import type Webcam from "react-webcam";
import type { StateCreator } from "zustand";

export interface CameraSlice {
  /** MediaDeviceInfo entries from navigator.mediaDevices */
  availableCameras: MediaDeviceInfo[];
  /** deviceId of the selected camera */
  selectedCameraDeviceId: string;
  /** Ref to the react-webcam instance (set by LiveCamera component) */
  webcamRef: RefObject<Webcam | null> | null;
  setAvailableCameras: (cameras: MediaDeviceInfo[]) => void;
  setSelectedCameraDeviceId: (deviceId: string) => void;
  setWebcamRef: (ref: RefObject<Webcam | null> | null) => void;
}

export const createCameraSlice: StateCreator<CameraSlice, [], [], CameraSlice> = (set) => ({
  availableCameras: [],
  selectedCameraDeviceId: "",
  webcamRef: null,
  setAvailableCameras: (cameras) => set({ availableCameras: cameras }),
  setSelectedCameraDeviceId: (deviceId) => set({ selectedCameraDeviceId: deviceId }),
  setWebcamRef: (ref) => set({ webcamRef: ref }),
});
