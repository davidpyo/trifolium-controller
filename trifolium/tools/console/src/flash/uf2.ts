// Reading a .uf2 into the flat image PICOBOOT writes, and the comparison the verify pass makes.
//
// Everything here is pure, so it is the half of flashing that can be tested without a device.
// src/flash/flash.ts holds the half that cannot.

import { uf2ToFlashBuffer } from "../vendor/picoflash/js/uf2/uf2.js";
import {
  FLASH_START,
  SECTOR_SIZE,
  UF2_RP2350_ARM_NS_FAMILY_ID,
  UF2_RP2350_ARM_S_FAMILY_ID,
  UF2_RP2350_RISCV_FAMILY_ID,
} from "../vendor/picoflash/pkg/constants.js";

export const UF2_BLOCK_SIZE = 512;
/** UF2 flag bit saying word 7 of a block is a family id rather than the reserved field. */
const UF2_FLAG_FAMILY_ID = 0x0000_2000;
/**
 * End of the RP2040's XIP window. Defined here rather than imported: `FLASH_END_RP2040` is exactly
 * the constant picoflash's package entry point re-exports and `pkg/constants.js` never defines.
 */
const FLASH_END = FLASH_START + 0x100_0000;

/** What a .uf2 turns into: one flat buffer and the flash address it starts at. */
export interface FlashImage {
  address: number;
  /** Padded up to a whole number of sectors, so erase and write cover the same bytes. */
  data: Uint8Array;
  blocks: number;
  /** 0 when the file carries no family id. */
  family: number;
}

const RP2350_FAMILIES = new Map<number, string>([
  [UF2_RP2350_ARM_S_FAMILY_ID, "RP2350 (Arm secure)"],
  [UF2_RP2350_RISCV_FAMILY_ID, "RP2350 (RISC-V)"],
  [UF2_RP2350_ARM_NS_FAMILY_ID, "RP2350 (Arm non-secure)"],
]);

/**
 * Reads a .uf2 and refuses the ones that would flash but not run.
 *
 * The family check is the one worth having: an RP2350 image writes to an RP2040 perfectly happily
 * and then does not boot, which looks exactly like a failed flash. Anything else - an unset family
 * bit, a family this list does not know - is left alone, because `flash_nuke.uf2` and friends are
 * ABSOLUTE-family and legitimately useful here.
 */
export function parseUf2(bytes: Uint8Array): FlashImage {
  if (bytes.length === 0) throw new Error("That file is empty.");
  if (bytes.length % UF2_BLOCK_SIZE !== 0) {
    throw new Error(
      `Not a .uf2 - ${bytes.length} bytes is not a whole number of ${UF2_BLOCK_SIZE}-byte blocks.`,
    );
  }

  const head = new DataView(bytes.buffer, bytes.byteOffset, UF2_BLOCK_SIZE);
  const flags = head.getUint32(8, true);
  const family = flags & UF2_FLAG_FAMILY_ID ? head.getUint32(28, true) : 0;
  const rp2350 = RP2350_FAMILIES.get(family);
  if (rp2350) {
    throw new Error(`Built for ${rp2350}, not the RP2040 this blaster uses.`);
  }

  // Throws on a bad magic or a short block, with its own message.
  const { address, data } = uf2ToFlashBuffer(bytes);

  if (address < FLASH_START || address >= FLASH_END) {
    throw new Error(`Starts at 0x${address.toString(16)}, which is not flash.`);
  }
  if (address % SECTOR_SIZE !== 0) {
    throw new Error(`Starts at 0x${address.toString(16)}, which is not sector-aligned.`);
  }

  return {
    address,
    data: padToSector(data),
    blocks: bytes.length / UF2_BLOCK_SIZE,
    family,
  };
}

/**
 * Rounds the image up to the sector the erase will clear anyway.
 *
 * Erase granularity is a sector and write granularity is a page, so an image that is neither leaves
 * the last write shorter than the erase and the device refusing a bad transfer length. 0xFF is what
 * the erase left there, so the padding writes back exactly what is already on the chip.
 */
function padToSector(data: Uint8Array): Uint8Array {
  const size = Math.ceil(data.length / SECTOR_SIZE) * SECTOR_SIZE;
  if (size === data.length) return data;
  const padded = new Uint8Array(size);
  padded.fill(0xff);
  padded.set(data);
  return padded;
}

/**
 * The address of the first byte that came back wrong, or null when the read matched.
 *
 * A short read counts as a mismatch at the point it ran out: the device answering with fewer bytes
 * than asked for is not evidence the rest is right.
 */
export function firstDifference(
  expected: Uint8Array,
  actual: Uint8Array,
  baseAddress: number,
): number | null {
  const shared = Math.min(expected.length, actual.length);
  for (let i = 0; i < shared; i++) {
    if (expected[i] !== actual[i]) return baseAddress + i;
  }
  if (actual.length < expected.length) return baseAddress + actual.length;
  return null;
}

export const formatAddress = (address: number): string =>
  `0x${address.toString(16).padStart(8, "0")}`;

export const formatSize = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;
