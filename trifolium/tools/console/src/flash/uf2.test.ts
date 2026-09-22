// The half of flashing that can be checked without a device.
//
// What it is guarding: every refusal here happens *before* the blaster is rebooted into BOOTSEL, so
// a file that gets past them costs the user a board that is out of its firmware with nothing valid
// to put back. The RP2350 case is the one with no other symptom - that image writes perfectly and
// then does not boot, which looks exactly like a failed flash.

import { describe, expect, it } from "vitest";
import {
  UF2_BLOCK_SIZE,
  firstDifference,
  formatAddress,
  parseUf2,
} from "./uf2";

const FLASH_BASE = 0x10000000;
const RP2040_FAMILY = 0xe48bff56;
const RP2350_ARM_S_FAMILY = 0xe48bff59;
const FAMILY_PRESENT = 0x2000;

/** One well-formed UF2 block carrying `payload` at `address`. */
function block(
  address: number,
  payload: Uint8Array,
  { index = 0, total = 1, family = RP2040_FAMILY } = {},
): Uint8Array {
  const out = new Uint8Array(UF2_BLOCK_SIZE);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x0a324655, true);
  view.setUint32(4, 0x9e5d5157, true);
  view.setUint32(8, FAMILY_PRESENT, true);
  view.setUint32(12, address, true);
  view.setUint32(16, payload.length, true);
  view.setUint32(20, index, true);
  view.setUint32(24, total, true);
  view.setUint32(28, family, true);
  out.set(payload, 32);
  view.setUint32(508, 0x0ab16f30, true);
  return out;
}

const join = (...blocks: Uint8Array[]) => {
  const out = new Uint8Array(blocks.length * UF2_BLOCK_SIZE);
  blocks.forEach((b, i) => out.set(b, i * UF2_BLOCK_SIZE));
  return out;
};

const payload = (fill: number) => new Uint8Array(256).fill(fill);

describe("parseUf2", () => {
  it("unpacks blocks into one flat image at the address they name", () => {
    const image = parseUf2(
      join(
        block(FLASH_BASE, payload(0xaa), { index: 0, total: 2 }),
        block(FLASH_BASE + 256, payload(0xbb), { index: 1, total: 2 }),
      ),
    );
    expect(image.address).toBe(FLASH_BASE);
    expect(image.blocks).toBe(2);
    expect(image.data[0]).toBe(0xaa);
    expect(image.data[256]).toBe(0xbb);
  });

  it("pads the image up to the sector the erase clears anyway", () => {
    const image = parseUf2(join(block(FLASH_BASE, payload(0x11))));
    // 256 bytes of payload, rounded up to one 4096-byte sector.
    expect(image.data.length).toBe(0x1000);
    expect(image.data[0]).toBe(0x11);
    // Padding is what an erase leaves behind, so writing it back changes nothing on the chip.
    expect(image.data[0x0fff]).toBe(0xff);
  });

  it("refuses an RP2350 image, which would write and then not boot", () => {
    expect(() =>
      parseUf2(join(block(FLASH_BASE, payload(0x22), { family: RP2350_ARM_S_FAMILY }))),
    ).toThrow(/RP2350/);
  });

  it("accepts a family it does not recognise - flash_nuke is one", () => {
    const absolute = 0xe48bff57;
    expect(parseUf2(join(block(FLASH_BASE, payload(0x33), { family: absolute }))).family).toBe(
      absolute,
    );
  });

  it("refuses an image that does not start in flash", () => {
    expect(() => parseUf2(join(block(0x20000000, payload(0x44))))).toThrow(/not flash/);
  });

  it("refuses a file that is not a whole number of blocks", () => {
    expect(() => parseUf2(join(block(FLASH_BASE, payload(0x55))).slice(0, 500))).toThrow(
      /whole number/,
    );
  });

  it("refuses an empty file rather than flashing nothing", () => {
    expect(() => parseUf2(new Uint8Array(0))).toThrow(/empty/);
  });

  it("refuses a block whose magic is wrong", () => {
    const bad = join(block(FLASH_BASE, payload(0x66)));
    bad[0] = 0x00;
    expect(() => parseUf2(bad)).toThrow();
  });
});

describe("firstDifference", () => {
  const want = new Uint8Array([1, 2, 3, 4]);

  it("says nothing when the read back matches", () => {
    expect(firstDifference(want, new Uint8Array([1, 2, 3, 4]), FLASH_BASE)).toBeNull();
  });

  it("reports the address of the first wrong byte, not the last", () => {
    expect(firstDifference(want, new Uint8Array([1, 2, 9, 9]), FLASH_BASE)).toBe(FLASH_BASE + 2);
  });

  // A device that answered short has not agreed with the rest of the buffer, it just stopped
  // talking. Treating the tail as verified would be the one way this check reports a pass it
  // never made.
  it("treats a short read as a mismatch where it ran out", () => {
    expect(firstDifference(want, new Uint8Array([1, 2]), FLASH_BASE)).toBe(FLASH_BASE + 2);
  });

  it("does not mind a read that came back long", () => {
    expect(firstDifference(want, new Uint8Array([1, 2, 3, 4, 5]), FLASH_BASE)).toBeNull();
  });
});

describe("formatAddress", () => {
  it("pads to eight digits so two addresses line up", () => {
    expect(formatAddress(FLASH_BASE)).toBe("0x10000000");
    expect(formatAddress(0x2a)).toBe("0x0000002a");
  });
});
