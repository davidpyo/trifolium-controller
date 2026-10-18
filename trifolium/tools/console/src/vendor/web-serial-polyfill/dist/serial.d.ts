// Ours, not upstream's: the package's own declarations need @types/w3c-web-usb. Only what
// src/serial/ uses is declared.

export interface SerialPort {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
  getInfo(): SerialPortInfo;
}

export const SerialPort: new (device: unknown) => SerialPort;

export const serial: {
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
  getPorts(): Promise<SerialPort[]>;
};
