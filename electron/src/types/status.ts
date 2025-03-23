// All available status types the ESP32 can send to the Electron app

export enum Status {
    MEASURING = "measuring",
    LEGAL = "legal",
    SPEEDING = "speeding",
    TIMEOUT = "timeout",
    JSON_ERROR = "jsonError",
    CONFIG = "config",
};

export type StatusMessage = {
    status: Status;
    value?: number;
};