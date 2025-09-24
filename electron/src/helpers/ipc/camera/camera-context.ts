import {
    CAMERA_SAVE_PICTURE_CHANNEL,
    CAMERA_GET_IMAGE_DATA_CHANNEL,
} from "./camera-channels";

export function exposeCameraContext() {
    const { contextBridge, ipcRenderer } = window.require("electron");
    contextBridge.exposeInMainWorld("camera", {
        savePicture: (imgEncoded: string) => ipcRenderer.invoke(CAMERA_SAVE_PICTURE_CHANNEL, imgEncoded),
        getImageData: (imagePath: string) => ipcRenderer.invoke(CAMERA_GET_IMAGE_DATA_CHANNEL, imagePath),
    });
}
