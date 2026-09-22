// Ours, not upstream's. Only the surface src/flash/ drives; see the README beside this file.

import type { Connection } from "./connection.js";

export declare class Picoboot {
  /**
   * Finds the PICOBOOT interface on a device the user already picked. Throws when there is none.
   *
   * The search skips interface 0 when the device exposes more than one, which is what an RP2040 in
   * BOOTSEL does (mass storage, then PICOBOOT), and mirrors picotool's own logic.
   */
  static fromDevice(device: USBDevice): Picoboot;
  /** Opens the device, claims the interface, and resets it. */
  connect(): Promise<Connection>;
  /** Releases the interface and closes the device. Never throws; logs instead. */
  disconnect(): Promise<void>;
}
