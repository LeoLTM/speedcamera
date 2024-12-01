import {
    SERIAL_LIST_PORTS,
    SERIAL_OPEN_PORT
} from "./serial-channels";

export function exposeSerialContext() {
    const { contextBridge, ipcRenderer } = window.require("electron");
    contextBridge.exposeInMainWorld("serial", {
        listPorts: async () => {
           return await ipcRenderer.invoke(SERIAL_LIST_PORTS);
        },
        openPort: (portPath: string) => {
            return ipcRenderer.invoke(SERIAL_OPEN_PORT, portPath);
        }
    });
};
