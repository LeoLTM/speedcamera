import {
    SERIAL_LIST_PORTS,
    SERIAL_OPEN_PORT,
    SERIAL_CLOSE_PORT,
    SERIAL_SEND_COMMAND,
    SERIAL_ON_STATUS,
} from "./serial-channels";
import { SerialCommands } from "@/types/commands";

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
            ipcRenderer.on(SERIAL_ON_STATUS, (event, jsonStatus: string) => {
                callback(jsonStatus);
            });
        }
    });
};
