import { create } from "zustand";
import { createCameraSlice, type CameraSlice } from "./slices/cameraSlice";
import { createSerialSlice, type SerialSlice } from "./slices/serialSlice";
import { createMeasurementSlice, type MeasurementSlice } from "./slices/measurementSlice";

export type AppStore = CameraSlice & SerialSlice & MeasurementSlice;

export const useAppStore = create<AppStore>()((...a) => ({
  ...createCameraSlice(...a),
  ...createSerialSlice(...a),
  ...createMeasurementSlice(...a),
}));
