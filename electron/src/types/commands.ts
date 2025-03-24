// All available serial commands to send to the ESP32

export enum SerialCommands {
    FLASH = "flash",
    SET_MAX_SPEED = "setMaxSpeed",
};

export type SerialCommand = {
    command: SerialCommands;
    value?: number;
};