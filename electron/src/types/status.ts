// All available status types the ESP32 can send to the Electron app

export enum Status {
    MEASURING = "measuring",
    LEGAL = "legal",
    SPEEDING = "speeding",
    TIMEOUT = "timeout",
    JSON_ERROR = "jsonError",
};

export type StatusMessage = {
    status: Status;
};