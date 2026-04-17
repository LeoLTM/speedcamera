import { get } from "http";
import {
    CAMERA_SAVE_PICTURE_CHANNEL,
    CAMERA_GET_IMAGE_DATA_CHANNEL,
    CAMERA_GET_AVAILABLE_HW_CONTROLS_CHANNEL,
    CAMERA_GET_HW_CONTROL_CHANNEL,
    CAMERA_SET_HW_CONTROL_CHANNEL,
    CAMERA_GET_AVAILABLE_CAMERAS_CHANNEL,
} from "./camera-channels";

export function exposeCameraContext() {
    const { contextBridge, ipcRenderer } = window.require("electron");
    contextBridge.exposeInMainWorld("camera", {
        savePicture: (imgEncoded: string) => ipcRenderer.invoke(CAMERA_SAVE_PICTURE_CHANNEL, imgEncoded),
        getImageData: (imagePath: string) => ipcRenderer.invoke(CAMERA_GET_IMAGE_DATA_CHANNEL, imagePath),
        getAvailableCameras: () => ipcRenderer.invoke(CAMERA_GET_AVAILABLE_CAMERAS_CHANNEL),
        getAvailableHwControls: (cameraId: number) => ipcRenderer.invoke(CAMERA_GET_AVAILABLE_HW_CONTROLS_CHANNEL, cameraId),
        setHwControl: (cameraId: number, controlName: string, value: number) => ipcRenderer.invoke(CAMERA_SET_HW_CONTROL_CHANNEL, cameraId, controlName, value),
        getHwControl: (cameraId: number, controlName: string) => ipcRenderer.invoke(CAMERA_GET_HW_CONTROL_CHANNEL, cameraId, controlName),
    });
}
