// Ours, not upstream's. Only the surface src/flash/ drives; see the README beside this file.

export declare class Connection {
  /** Clears a protocol stall left by an earlier operation. Sent before every burst of commands. */
  resetInterface(): Promise<void>;
  /** Flash commands need the chip out of execute-in-place first. */
  exitXip(): Promise<void>;
  /** `addr` and `size` both sector-aligned (0x1000), or the device refuses. */
  flashErase(addr: number, size: number): Promise<void>;
  /** `addr` page-aligned (0x100). */
  flashWrite(addr: number, buf: Uint8Array): Promise<void>;
  flashRead(addr: number, size: number): Promise<Uint8Array>;
  /** Back to the application image. RP2040 sends REBOOT (0x2), RP2350 REBOOT2 (0xA). */
  reboot(delayMs: number): Promise<void>;
}
