import { ipcMain, BrowserWindow } from "electron";
import { SERIAL_CLOSE_PORT, SERIAL_LIST_PORTS, SERIAL_ON_STATUS, SERIAL_OPEN_PORT, SERIAL_SEND_COMMAND } from "./serial-channels";
import { SerialPort, ReadlineParser } from "serialport";

let ESP32: SerialPort | null = null;

export function addSerialEventListeners(mainWindow: BrowserWindow) {
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
    ipcMain.handle(SERIAL_OPEN_PORT, (event, portPath: string): boolean => {
        console.log(`Opening serial port: ${portPath}`);
        const portOptions = {
            baudRate: 115200,
            autoOpen: false,
            path: portPath
        };
        try {
            const serialPort = new SerialPort(portOptions);
            const parser = serialPort.pipe(new ReadlineParser({ delimiter: "\n" }));
            serialPort.open((error) => {
                if (error) {
                    console.error("Error opening serial port: ", error);
                    return false;
                }
            });
            parser.on("data", (data) => {
                console.log(`[${portPath}] Data received: `, data.toString());
                mainWindow.webContents.send(SERIAL_ON_STATUS, data.toString());
            });
            serialPort.on("error", (error) => {
                console.error(`[${portPath}] Error: `, error);
            });
            ESP32 = serialPort;
            console.log(`Serial port ${portPath} opened`);
            return true;
        } catch (error) {
            console.error("Error opening serial port: ", error);
            return false;
        }
    });
    ipcMain.handle(SERIAL_SEND_COMMAND, (event, jsonCommand: string): void => {
        console.log(`Sending command: ${JSON.parse(jsonCommand).command}`);

        // Check if serial port is open
        if (!ESP32) {
            console.error("Serial port not open");
            return;
        } else {
            // Send command to ESP32
            ESP32.write(jsonCommand, (error) => {
                if (error) {
                    console.error("Error sending command: ", error);
                }
            });
        }
    });
    ipcMain.handle(SERIAL_CLOSE_PORT, (): boolean => {
        console.log("Closing serial port...");
        if (ESP32) {
            ESP32.close((error) => {
                if (error) {
                    console.error("Error closing serial port: ", error);
                    return false;
                }
            });
            ESP32 = null;
            console.log("Serial port closed");
            return true;
        }
        return false
    })
}