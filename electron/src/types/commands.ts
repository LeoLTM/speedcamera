// All available serial commands to send to the ESP32

export enum SerialCommands {
    FLASH = "flash",
};

export type SerialCommand = {
    command: SerialCommands;
};