import {
    SERIAL_LIST_PORTS,
    SERIAL_OPEN_PORT,
    SERIAL_CLOSE_PORT,
    SERIAL_SEND_COMMAND,
    SERIAL_ON_STATUS,
} from "./serial-channels";
import { SerialCommands } from "@/types/commands";

// Map zum Speichern der Zuordnung zwischen ursprünglichen Callbacks und den Wrapper-Funktionen
const callbacksMap = new Map<(jsonStatus: string) => void, (event: Electron.IpcRendererEvent, jsonStatus: string) => void>();

export function exposeSerialContext() {
    const { contextBridge, ipcRenderer } = window.require("electron");
    contextBridge.exposeInMainWorld("serial", {
        listPorts: async () => {
           return await ipcRenderer.invoke(SERIAL_LIST_PORTS);
        },
        openPort: (portPath: string) => {
            return ipcRenderer.invoke(SERIAL_OPEN_PORT, portPath);
        },
        closePort: () => {
            return ipcRenderer.invoke(SERIAL_CLOSE_PORT);
        },
        sendCommand: (jsonCommand: SerialCommands) => {
            return ipcRenderer.invoke(SERIAL_SEND_COMMAND, jsonCommand);
        },
        onStatus: (callback: (jsonStatus: string) => void) => {
            // Wir erstellen eine Wrapper-Funktion, damit wir den genauen Listener später identifizieren können
            const wrappedCallback = (event: Electron.IpcRendererEvent, jsonStatus: string) => {
                callback(jsonStatus);
            };
            // Speichere Referenz zwischen callback und wrappedCallback
            if (!callbacksMap.has(callback)) {
                callbacksMap.set(callback, wrappedCallback);
            }
            ipcRenderer.on(SERIAL_ON_STATUS, wrappedCallback);
        },
        offStatus: (callback: (jsonStatus: string) => void) => {
            // Entferne den Listener aus der Map und entferne den Listener
            const wrappedCallback = callbacksMap.get(callback);
            if (wrappedCallback) {
                ipcRenderer.removeListener(SERIAL_ON_STATUS, wrappedCallback);
                callbacksMap.delete(callback);
            }
        },
    });
};
