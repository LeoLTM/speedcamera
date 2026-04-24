import { create } from "zustand";
import { createCameraSlice, type CameraSlice } from "./slices/cameraSlice";
import { createSerialSlice, type SerialSlice } from "./slices/serialSlice";
import { createMeasurementSlice, type MeasurementSlice } from "./slices/measurementSlice";
import { createSystemSlice, type SystemSlice } from "./slices/systemSlice";
import { createLapSlice, type LapSlice } from "./slices/lapSlice";

export type AppStore = CameraSlice & SerialSlice & MeasurementSlice & SystemSlice & LapSlice;

export const useAppStore = create<AppStore>()((...a) => ({
  ...createCameraSlice(...a),
  ...createSerialSlice(...a),
  ...createMeasurementSlice(...a),
  ...createSystemSlice(...a),
  ...createLapSlice(...a),
}));
