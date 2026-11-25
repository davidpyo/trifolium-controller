import { describe, expect, it } from "vitest";
import schemaJson from "../../fixtures/schema.json";
import deviceJson from "../../fixtures/device.json";
import type { Schema } from "../../schema/types";
import { diagramForBoardId } from "../../schema/wiringDiagrams";
import { layout } from "./layout";
import { buildHookup, isHeavy } from "./model";
import { readPads, type Pad } from "./pads";
import { arrange, inPlugOrder, PIN_PITCH, pinName, type Pin, type Schematic } from "./schematic";

/** The block on its own, with no parts to arrange it for. */
const blockOf = (board: string, room?: (pads: Pad[]) => number): Schematic =>
  arrange(readPads(diagramForBoardId(board)!.svgMarkup)!, { low: (pads) => pads.some(isHeavy), room });

/** The block for a real board's sheet, as though only the pads `wired` passes had wires on them. */
const wiredOnly = (board: string, wired: (pad: Pad) => boolean): Schematic => {
  const sheet = readPads(diagramForBoardId(board)!.svgMarkup)!;
  return arrange(sheet, { low: (pads) => pads.some(isHeavy), rank: (p) => (wired(p) ? sheet.pads.indexOf(p) : undefined) });
};

/** The block the hookup view draws for a board with no drawing, arranged for the fixture's parts. */
const plain = (): Schematic =>
  layout(buildHookup(schemaJson as unknown as Schema, deviceJson, undefined)).schematic!;

const named = (block: Schematic, text: string): Pin => block.pins.find((p) => p.text === text)!;

describe("the schematic block", () => {
  const v12 = blockOf("trifolium_v1_2");

  it("draws every pin of a plug something is wired to, once, and hands the other plugs back as free", () => {
    const block = wiredOnly("trifolium_v1_2", (p) => p.connector !== "GP20 connector" && p.gpio !== 26);
    const pads = readPads(diagramForBoardId("trifolium_v1_2")!.svgMarkup)!.pads;
    expect(block.pins.length + block.free.length).toBe(pads.length);
    expect(new Set([...block.pins.map((p) => p.pad), ...block.free]).size).toBe(pads.length);
    // GP26 is free, but on the ESC plug, which is drawn whole - greyed, so the pins keep their places.
    expect(named(block, "GP26").wired).toBe(false);
    expect(named(block, "GP3").wired).toBe(true);
    // Nothing is wired to the GP20 plug at all.
    expect(block.free.map((p) => p.gpio)).toEqual(expect.arrayContaining([20]));
    expect(block.free.map((p) => p.gpio)).not.toContain(26);
  });

  it("puts the pack's plugs along the bottom", () => {
    const sideOf = (connector: string) => new Set(v12.pins.filter((p) => p.pad.connector === connector).map((p) => p.side));
    expect(sideOf("XT30 IN")).toEqual(new Set(["bottom"]));
    expect(sideOf("XT30 OUT")).toEqual(new Set(["bottom"]));
  });

  it("puts a board with no drawing's plugs by what is wired to them, the ESCs at the foot of theirs", () => {
    const block = plain();
    const names = (side: string) => block.groups.filter((g) => g.side === side).map((g) => g.name);
    expect(names("left")).toContain("Trigger");
    // Everything from the first ESC down runs leads to the battery: nothing sits under them.
    const right = names("right");
    expect(right.slice(right.indexOf("ESC 2"))).toEqual(["ESC 2", "ESC 4", "Solenoid driver"]);
  });

  it("is never drawn much taller than it is wide", () => {
    for (const board of ["trifolium_v1_2", "diana_v1_1", "seeed_xiao_rp2040"]) {
      const block = blockOf(board);
      expect(block.w, board).toBeGreaterThanOrEqual(block.h * 0.6 - 0.001);
    }
  });

  it("names a plug without the word every plug's name ends in", () => {
    expect(v12.groups.map((g) => g.name)).toEqual(expect.arrayContaining(["ESC", "I2C", "GP21", "XT30 IN"]));
  });

  it("keeps a plug's pins in the order they are along it on the board, whatever that crosses", () => {
    const pinsOf = (connector: string) => v12.pins.filter((p) => p.pad.connector === connector).map((p) => p.text);
    // The ESC plug runs across the board, the I2C plug down it.
    expect(pinsOf("ESC connector")).toEqual(["GP26", "GP4", "GP3", "GP2", "GP1", "GP0", "VCC from ESC", "GND from ESC"]);
    expect(pinsOf("I2C connector")).toEqual(["GND to I2C", "VCC to I2C", "GP14", "GP15"]);
  });

  it("reads a plug's order along whichever way it runs", () => {
    const pad = (gpio: number, x: number, y: number) => ({ gpio, x, y, r: 1 });
    expect(inPlugOrder([pad(1, 30, 5), pad(2, 10, 5), pad(3, 20, 6)]).map((p) => p.gpio)).toEqual([2, 3, 1]);
    expect(inPlugOrder([pad(1, 5, 30), pad(2, 5, 10), pad(3, 6, 20)]).map((p) => p.gpio)).toEqual([2, 3, 1]);
  });

  it("never puts two pins on one spot", () => {
    for (const a of v12.pins) {
      for (const b of v12.pins) {
        if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y), `${a.text} and ${b.text}`).toBeGreaterThanOrEqual(PIN_PITCH);
      }
    }
  });

  it("ends every pin outside the box, where a wire can reach it", () => {
    for (const pin of v12.pins) {
      const outside = pin.x < 0 || pin.x > v12.w || pin.y > v12.h;
      expect(outside, pin.text).toBe(true);
    }
  });

  it("gives a plug the room its parts take, its pins centred in it, so their wires run straight across", () => {
    const sheet = {
      viewBox: { x: 0, y: 0, w: 100, h: 100 },
      pads: [
        { gpio: 21, connector: "Trigger", x: 0, y: 10, r: 1 },
        { gpio: null, power: "GND", connector: "Trigger", x: 0, y: 20, r: 1 },
      ],
    };
    const tight = arrange(sheet);
    const roomy = arrange(sheet, { room: () => 200 });
    const own = 14 + 2 * PIN_PITCH;
    expect(roomy.pins[0].y - tight.pins[0].y).toBeCloseTo((200 - own) / 2, 5);
  });

  it("calls a pin by its GPIO, with the board's own name for it beside", () => {
    expect(pinName({ gpio: 26, label: "D0 (A0)", x: 0, y: 0, r: 1 })).toEqual({ text: "GP26", sub: "D0 (A0)" });
    expect(pinName({ gpio: null, power: "GND", x: 0, y: 0, r: 1 })).toEqual({ text: "GND" });
    expect(pinName({ gpio: null, power: "VCC", label: "VCC to I2C", x: 0, y: 0, r: 1 })).toEqual({ text: "VCC to I2C" });
  });

  it.each(["trifolium_v1_1", "diana_v1_0", "diana_v1_1", "rp2040_zero", "seeed_xiao_rp2040"])(
    "lays out %s with every pin finite and outside the box",
    (board) => {
      const block = blockOf(board);
      expect(block.w).toBeGreaterThan(0);
      for (const pin of block.pins) {
        expect(Number.isFinite(pin.x) && Number.isFinite(pin.y), pin.text).toBe(true);
        expect(pin.x < 0 || pin.x > block.w || pin.y > block.h, pin.text).toBe(true);
      }
    },
  );
});
