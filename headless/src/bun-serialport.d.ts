declare module "bun-serialport" {
  export interface PortInfo {
    path: string;
    manufacturer?: string;
    serialNumber?: string;
    pnpId?: string;
    locationId?: string;
    productId?: string;
    vendorId?: string;
  }

  export interface SerialPortOptions {
    path: string;
    baudRate?: number;
    dataBits?: 5 | 6 | 7 | 8;
    stopBits?: 1 | 2;
    parity?: "none" | "even" | "mark" | "odd" | "space";
    autoOpen?: boolean;
  }

  export class SerialPort {
    constructor(options: SerialPortOptions);
    readonly isOpen: boolean;
    readonly path: string;
    readonly baudRate: number;
    open(): Promise<void>;
    close(): Promise<void>;
    write(data: string | Uint8Array | Buffer): Promise<number>;
    flush(): Promise<void>;
    drain(): Promise<void>;
    pipe<T>(destination: T): T;
    on(event: "data", listener: (chunk: Buffer) => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    on(event: "close", listener: () => void): this;
    on(event: "open", listener: () => void): this;
    once(event: string, listener: (...args: any[]) => void): this;
    off(event: string, listener: (...args: any[]) => void): this;
    removeAllListeners(event?: string): this;
  }

  export function list(): Promise<PortInfo[]>;
  export function readlineParser(options?: { delimiter?: string | Buffer | Uint8Array; encoding?: BufferEncoding }): any;
}
