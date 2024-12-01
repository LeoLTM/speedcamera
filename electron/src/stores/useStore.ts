import { create } from 'zustand';
import { CameraSlice, createCameraSlice } from './cameraSlice';
import { SerialSlice, createSerialSlice } from './serialSlice';

export const useStore = create<CameraSlice & SerialSlice>()((...a) => ({
    ...createCameraSlice(...a),
    ...createSerialSlice(...a)
}));