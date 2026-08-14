import type { StateCreator } from "zustand";
import type { CameraStatusPayload, MfsConfigResult, AppSettings } from "@/shared/types";
import { getRpc } from "@/lib/rpc";

export interface CameraSlice {
  cameraConnected: boolean;
  cameraVendor: string | null;
  cameraModel: string | null;
  cameraSerial: string | null;
  cameraExposure: number;
  cameraGain: number;
  pixelFormat: string;
  exposureAuto: string;
  gainAuto: string;
  frameRate: number;
  cameraWidth: number;
  cameraHeight: number;
  blackLevel: number;
  strobeLineDuration: number;
  setupStreamActive: boolean;
  liveFrame: string | null;
  mfsResult: MfsConfigResult | null;
  setCameraStatus: (status: CameraStatusPayload) => void;
  refreshCameraStatus: () => Promise<void>;
  connectCamera: () => Promise<void>;
  disconnectCamera: () => Promise<void>;
  setCameraExposure: (value: number) => Promise<void>;
  setCameraGain: (value: number) => Promise<void>;
  setCameraFeature: (key: string, value: string | number) => Promise<void>;
  startSetupStream: () => Promise<void>;
  stopSetupStream: () => Promise<void>;
  setLiveFrame: (frame: string) => void;
  applyMfsConfig: (mfsContent: string, saveAsDefault: boolean) => Promise<void>;
  clearMfsResult: () => void;
  loadCameraSettings: (settings: AppSettings) => void;
}

export const createCameraSlice: StateCreator<CameraSlice, [], [], CameraSlice> = (set) => ({
  cameraConnected: false,
  cameraVendor: null,
  cameraModel: null,
  cameraSerial: null,
  cameraExposure: 5000,
  cameraGain: 0,
  pixelFormat: "Mono",
  exposureAuto: "Off",
  gainAuto: "Off",
  frameRate: 30,
  cameraWidth: 1280,
  cameraHeight: 1024,
  blackLevel: 0,
  strobeLineDuration: 5000,
  setupStreamActive: false,
  liveFrame: null,
  mfsResult: null,
  loadCameraSettings: (settings) => set({
    cameraExposure: settings.cameraExposure ?? 5000,
    cameraGain: settings.cameraGain ?? 0,
    pixelFormat: settings.pixelFormat ?? "Mono",
    exposureAuto: settings.exposureAuto ?? "Off",
    gainAuto: settings.gainAuto ?? "Off",
    frameRate: settings.frameRate ?? 30,
    cameraWidth: settings.cameraWidth ?? 1280,
    cameraHeight: settings.cameraHeight ?? 1024,
    blackLevel: settings.blackLevel ?? 0,
    strobeLineDuration: settings.strobeLineDuration ?? 5000,
  }),
  setCameraStatus: (status) => set({
    cameraConnected: status.connected,
    cameraVendor: status.vendor,
    cameraModel: status.model,
    cameraSerial: status.serial,
    setupStreamActive: status.isStreaming,
  }),
  
  connectCamera: async () => {
    await getRpc().request.connectCamera({});
  },
  
  refreshCameraStatus: async () => {
    const status = await getRpc().request.getCameraStatus({});
    set({
      cameraConnected: status.connected,
      cameraVendor: status.vendor,
      cameraModel: status.model,
      cameraSerial: status.serial,
      setupStreamActive: status.isStreaming,
    });
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

  setCameraFeature: async (key, value) => {
    if (typeof value === "string") {
        if (key === "pixelFormat") {
            await getRpc().request.setCameraPixelFormat({ format: value });
        } else {
            await getRpc().request.setCameraFeatureStr({ feature: key.charAt(0).toUpperCase() + key.slice(1), value });
        }
    } else {
        if (key === "strobeLineDuration") {
            await getRpc().request.setCameraStrobeDuration({ value });
        } else {
            await getRpc().request.setCameraFeatureInt({ feature: key.charAt(0).toUpperCase() + key.slice(1), value });
        }
    }
    await getRpc().request.saveSetting({ key: key as keyof AppSettings, value: value.toString() });
    set({ [key]: value } as Partial<CameraSlice>);
  },

  startSetupStream: async () => {
    set({ setupStreamActive: true, liveFrame: null });
    await getRpc().request.startSetupStream({});
  },

  stopSetupStream: async () => {
    set({ setupStreamActive: false, liveFrame: null });
    await getRpc().request.stopSetupStream({});
  },

  setLiveFrame: (frame) => set({ liveFrame: frame }),

  applyMfsConfig: async (mfsContent, saveAsDefault) => {
    const result = await getRpc().request.applyMfsConfig({ mfsContent, saveAsDefault });
    set({ mfsResult: result });
  },

  clearMfsResult: () => set({ mfsResult: null }),
});
