import { create } from 'zustand';
import { CameraSlice, createCameraSlice } from './cameraSlice';
import { SerialSlice, createSerialSlice } from './serialSlice';
import { MeasurementSlice, createMeasurementSlice } from './measurementSlice';

export const useStore = create<CameraSlice & SerialSlice & MeasurementSlice>()((...a) => ({
    ...createCameraSlice(...a),
    ...createSerialSlice(...a),
    ...createMeasurementSlice(...a),
}));