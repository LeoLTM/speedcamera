declare module "bun-serialport" {
  import { EventEmitter } from "events";

  export interface SerialPortOptions {
    path: string;
    baudRate: number;
    dataBits?: 5 | 6 | 7 | 8;
    stopBits?: 1 | 2;
    parity?: "none" | "even" | "odd";
    rtscts?: boolean;
    xon?: boolean;
    xoff?: boolean;
    autoOpen?: boolean;
    readBufferSize?: number;
  }

  export interface PortInfo {
    path: string;
    manufacturer?: string;
    serialNumber?: string;
    vendorId?: string;
    productId?: string;
    product?: string;
  }

  export interface Parser extends EventEmitter {
    push(chunk: Uint8Array): void;
  }

  export class SerialPort extends EventEmitter {
    readonly path: string;
    readonly baudRate: number;
    readonly isOpen: boolean;

    constructor(options: SerialPortOptions);

    open(): Promise<void>;
    close(): Promise<void>;
    write(data: string | Uint8Array | Buffer): Promise<void>;
    update(options: { baudRate: number }): Promise<void>;
    set(options: { dtr?: boolean; rts?: boolean }): Promise<void>;
    get(): Promise<{ cts: boolean; dsr: boolean; dcd: boolean; ri: boolean }>;
    flush(): Promise<void>;
    drain(): Promise<void>;
    pipe(parser: Parser): Parser;

    on(event: "open", listener: () => void): this;
    on(event: "close", listener: () => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    on(event: "data", listener: (data: Uint8Array) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }

  export function list(): Promise<PortInfo[]>;

  export function delimiterParser(options?: {
    delimiter?: string | number | number[];
    includeDelimiter?: boolean;
  }): Parser;

  export function byteLengthParser(options: { length: number }): Parser;

  export function readlineParser(options?: {
    delimiter?: string;
    encoding?: string;
  }): Parser;
}
