import { ipcMain } from "electron";
import { SERIAL_LIST_PORTS, SERIAL_OPEN_PORT } from "./serial-channels";
import { SerialPort, SerialPortOpenOptions } from "serialport";

export function addSerialEventListeners() {
    ipcMain.handle(SERIAL_LIST_PORTS, async () => {
        console.log("Listing available serial ports...");
        try {
            const ports = await SerialPort.list();
            console.log("Available serial ports: ", ports);
            return ports;
        } catch (error) {
            console.error("Error listing serial ports: ", error);
            throw error;
        }
    });
    ipcMain.handle(SERIAL_OPEN_PORT, (event, portPath: string) => {
        console.log(`Opening serial port: ${portPath}`);
        const portOptions = {
            baudRate: 115200,
            autoOpen: false,
            path: portPath
        };
        try {
            const serialPort = new SerialPort(portOptions);
            serialPort.open((error) => {
                if (error) {
                    console.error("Error opening serial port: ", error);
                    throw error;
                }
            });
            serialPort.on("data", (data) => {
                console.log(`[${portPath}] Data received: `, data);
            })
            return serialPort;
        } catch (error) {
            console.error("Error opening serial port: ", error);
            throw error;
        }
    });
}