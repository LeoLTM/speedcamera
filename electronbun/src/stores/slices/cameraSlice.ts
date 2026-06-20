import type { StateCreator } from "zustand";
import type { CameraStatusPayload } from "@/shared/types";
import { getRpc } from "@/lib/rpc";

export interface CameraSlice {
  cameraConnected: boolean;
  cameraVendor: string | null;
  cameraModel: string | null;
  cameraSerial: string | null;
  cameraExposure: number;
  cameraGain: number;
  setCameraStatus: (status: CameraStatusPayload) => void;
  connectCamera: () => Promise<void>;
  disconnectCamera: () => Promise<void>;
  setCameraExposure: (value: number) => Promise<void>;
  setCameraGain: (value: number) => Promise<void>;
}

export const createCameraSlice: StateCreator<CameraSlice, [], [], CameraSlice> = (set, get) => ({
  cameraConnected: false,
  cameraVendor: null,
  cameraModel: null,
  cameraSerial: null,
  cameraExposure: 5000,
  cameraGain: 0,
  
  setCameraStatus: (status) => set({
    cameraConnected: status.connected,
    cameraVendor: status.vendor,
    cameraModel: status.model,
    cameraSerial: status.serial,
  }),
  
  connectCamera: async () => {
    await getRpc().request.connectCamera({});
  },
  
  disconnectCamera: async () => {
    await getRpc().request.disconnectCamera({});
  },
  
  setCameraExposure: async (value) => {
    await getRpc().request.setCameraExposure({ value });
    await getRpc().request.saveSetting({ key: "cameraExposure", value: value.toString() });
    set({ cameraExposure: value });
  },
  
  setCameraGain: async (value) => {
    await getRpc().request.setCameraGain({ value });
    await getRpc().request.saveSetting({ key: "cameraGain", value: value.toString() });
    set({ cameraGain: value });
  },
});
