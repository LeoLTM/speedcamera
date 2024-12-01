import {
    CAMERA_SAVE_PICTURE_CHANNEL,
} from "./camera-channels";

export function exposeCameraContext() {
    const { contextBridge, ipcRenderer } = window.require("electron");
    contextBridge.exposeInMainWorld("camera", {
        savePicture: (imgEncoded: string) => ipcRenderer.invoke(CAMERA_SAVE_PICTURE_CHANNEL, imgEncoded),
    });
}
