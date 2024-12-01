import { create } from 'zustand';
import { CameraSlice, createCameraSlice } from './cameraSlice';

export const useStore = create<CameraSlice>()((...a) => ({
    ...createCameraSlice(...a),
}));