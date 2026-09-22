// Writing a .uf2 to the blaster over PICOBOOT, the RP2040 bootrom's vendor USB interface.
//
// Not a convenience over dragging the file onto the RPI-RP2 drive: a Windows host with a BitLocker
// removable-drive policy cannot write to that drive at all, and the bootrom drive can never satisfy
// the policy. PICOBOOT is an interface rather than a volume, so the policy does not reach it.
//
// The protocol itself is picoflash's, vendored under src/vendor/picoflash - see the README there,
// including why its package entry point is not imported.

import { Picoboot } from "../vendor/picoflash/pkg/picoboot.js";
import type { Connection } from "../vendor/picoflash/pkg/connection.js";
import { PICOBOOT_PID_RP2040, PICOBOOT_VID } from "../vendor/picoflash/pkg/constants.js";
import { firstDifference, formatAddress, type FlashImage } from "./uf2";

export const BOOT_VENDOR_ID = PICOBOOT_VID;

/** Whole sectors, so a chunk boundary is never a bad write address. */
const WRITE_CHUNK = 64 * 1024;
const READ_CHUNK = 16 * 1024;
/** Long enough for the reply to get back before the device goes; picotool uses the same. */
const REBOOT_DELAY_MS = 500;

export type FlashPhase = "erase" | "write" | "verify";

export interface FlashProgress {
  phase: FlashPhase;
  done: number;
  total: number;
}

/** The picker was dismissed, or nothing in it was selected. Not a failure - the device is untouched. */
export class PickerCancelled extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PickerCancelled";
  }
}

/**
 * The click that opened the picker aged out before the picker was asked for.
 *
 * WebUSB needs transient activation, which Chrome expires five seconds after the click. Rebooting
 * to the bootloader and dropping the serial port happen in between, so a slow port teardown can
 * spend the lot. Recoverable: the device is in BOOTSEL by then, so a second click reaches it.
 */
export class ActivationLost extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActivationLost";
  }
}

export class FlashError extends Error {
  constructor(
    message: string,
    /** True once the erase has gone through: the old firmware is no longer on the device. */
    readonly partial: boolean,
  ) {
    super(message);
    this.name = "FlashError";
  }
}

export const webUsbSupported = (): boolean =>
  typeof navigator !== "undefined" && navigator.usb !== undefined;

const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Asks the user to pick the board, now that it is in BOOTSEL.
 *
 * Filtered on the vendor id alone, as picotool matches: Chrome's picker live-updates, so calling
 * this the moment the reboot is requested puts `RP2 Boot` in front of the user a second later
 * without a second click. There is no way to skip the picker - a `file://` origin is opaque, so a
 * grant from last time is unlikely to be remembered.
 */
export async function requestBootDevice(): Promise<USBDevice> {
  const usb = navigator.usb;
  if (!usb) throw new FlashError("This browser has no WebUSB. Use Chrome or Edge on desktop.", false);

  let device: USBDevice;
  try {
    device = await usb.requestDevice({ filters: [{ vendorId: BOOT_VENDOR_ID }] });
  } catch (e) {
    const name = (e as Error).name;
    if (name === "NotFoundError") {
      throw new PickerCancelled("No device was picked.");
    }
    if (name === "SecurityError" || name === "NotAllowedError") {
      throw new ActivationLost("The device picker did not open.");
    }
    throw new FlashError(`Could not ask for a USB device: ${reason(e)}`, false);
  }

  if (device.productId !== PICOBOOT_PID_RP2040) {
    throw new FlashError(
      `Not an RP2040 bootloader (product id 0x${device.productId
        .toString(16)
        .padStart(4, "0")}). Pick RP2 Boot.`,
      false,
    );
  }
  return device;
}

/**
 * Erase, write, then read back and compare. Leaves the device in BOOTSEL either way.
 *
 * Rebooting is deliberately not part of this: a verify mismatch must not hand control back to an
 * image nobody has checked, and leaving the board in BOOTSEL is the recoverable state - it can be
 * flashed again from here with no buttons and no replug.
 */
export async function flashImage(
  device: USBDevice,
  image: FlashImage,
  report: (progress: FlashProgress) => void,
): Promise<void> {
  const { picoboot, connection } = await claim(device);
  let erased = false;
  try {
    await prologue(connection);

    report({ phase: "erase", done: 0, total: image.data.length });
    await connection.flashErase(image.address, image.data.length);
    erased = true;
    report({ phase: "erase", done: image.data.length, total: image.data.length });

    // Chunked for the progress alone. One WRITE of the whole image is legal and is what picoflash
    // does; it just spends half a minute saying nothing.
    for (let at = 0; at < image.data.length; at += WRITE_CHUNK) {
      const chunk = image.data.subarray(at, Math.min(at + WRITE_CHUNK, image.data.length));
      await connection.flashWrite(image.address + at, chunk);
      report({ phase: "write", done: at + chunk.length, total: image.data.length });
    }

    await prologue(connection);
    for (let at = 0; at < image.data.length; at += READ_CHUNK) {
      const want = image.data.subarray(at, Math.min(at + READ_CHUNK, image.data.length));
      const got = await connection.flashRead(image.address + at, want.length);
      const bad = firstDifference(want, got, image.address + at);
      if (bad !== null) {
        throw new FlashError(
          `Verify failed at ${formatAddress(bad)}: the board read back different data. Flash it` +
            " again.",
          true,
        );
      }
      report({ phase: "verify", done: at + want.length, total: image.data.length });
    }
  } catch (e) {
    if (e instanceof FlashError) throw e;
    throw new FlashError(
      erased
        ? `Flashing stopped partway: ${reason(e)}. The old firmware is gone - flash it again.`
        : `Could not erase the flash: ${reason(e)}. The old firmware is untouched.`,
      erased,
    );
  } finally {
    await picoboot.disconnect();
  }
}

/** PICOBOOT REBOOT, which returns the board to its application firmware with no replug. */
export async function rebootDevice(device: USBDevice): Promise<void> {
  const { picoboot, connection } = await claim(device);
  try {
    await connection.reboot(REBOOT_DELAY_MS);
  } catch (e) {
    throw new FlashError(`The board did not take the reboot command: ${reason(e)}`, false);
  } finally {
    // The device is already on its way out, so releasing the interface usually fails. picoflash
    // logs that rather than throwing, which is what makes this safe to run unconditionally.
    await picoboot.disconnect();
  }
}

async function claim(device: USBDevice): Promise<{ picoboot: Picoboot; connection: Connection }> {
  try {
    const picoboot = Picoboot.fromDevice(device);
    return { picoboot, connection: await picoboot.connect() };
  } catch (e) {
    throw new FlashError(
      `Could not claim the bootloader interface: ${reason(e)}. Close any other flashing tool and` +
        " try again.",
      false,
    );
  }
}

/** What every burst of flash commands needs first: no stalled endpoint, and no execute-in-place. */
async function prologue(connection: Connection): Promise<void> {
  await connection.resetInterface();
  await connection.exitXip();
}
