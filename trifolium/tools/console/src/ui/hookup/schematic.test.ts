import { describe, expect, it } from "vitest";
import schemaJson from "../../fixtures/schema.json";
import deviceJson from "../../fixtures/device.json";
import type { Schema } from "../../schema/types";
import { diagramForBoardId } from "../../schema/wiringDiagrams";
import { layout } from "./layout";
import { buildHookup, isHeavy } from "./model";
import { readPads, type Pad } from "./pads";
import { arrange, PIN_PITCH, pinName, type Pin, type Schematic } from "./schematic";

/** The block on its own, with no parts to arrange it for. */
const blockOf = (board: string, room?: (pads: Pad[]) => number): Schematic =>
  arrange(readPads(diagramForBoardId(board)!.svgMarkup)!, { low: (pads) => pads.some(isHeavy), room });

/** The block as the hookup view draws it, arranged for the fixture's parts. */
const drawn = (board: string, overrides: Record<string, unknown> = {}): Schematic => {
  const diagram = diagramForBoardId(board)!;
  return layout(
    buildHookup(schemaJson as unknown as Schema, { ...deviceJson, ...overrides }, readPads(diagram.svgMarkup), diagram.markers),
  ).schematic;
};

const named = (block: Schematic, text: string): Pin => block.pins.find((p) => p.text === text)!;

describe("the schematic block", () => {
  const v12 = drawn("trifolium_v1_2");

  it("draws each pin something is wired to, once, and hands the rest back as free", () => {
    const pads = readPads(diagramForBoardId("trifolium_v1_2")!.svgMarkup)!.pads;
    expect(v12.pins.length + v12.free.length).toBe(pads.length);
    expect(new Set([...v12.pins.map((p) => p.pad), ...v12.free]).size).toBe(pads.length);
    expect(v12.pins.map((p) => p.text)).not.toContain("GP26");
    expect(v12.free.map((p) => p.gpio)).toEqual(expect.arrayContaining([26, 20, 17]));
  });

  it("puts a plug by what is wired to it, not where it is on the board", () => {
    const sideOf = (connector: string) => new Set(v12.pins.filter((p) => p.pad.connector === connector).map((p) => p.side));
    expect(sideOf("GP21 connector")).toEqual(new Set(["left"]));
    expect(sideOf("ESC connector")).toEqual(new Set(["right"]));
    // The pack's plugs along the bottom, the solenoid's before the battery's, in the parts' order.
    expect(sideOf("XT30 IN")).toEqual(new Set(["bottom"]));
    expect(sideOf("XT30 OUT")).toEqual(new Set(["bottom"]));
    expect(named(v12, "+ To Solenoid").x).toBeLessThan(named(v12, "+ From Battery").x);
  });

  it("evens the sides up, keeping the ESCs - whose leads run down to the battery - at the foot", () => {
    // Five inputs and two ESCs: the display and the selector go over to the ESCs' side, above them.
    const names = (side: string) => v12.groups.filter((g) => g.side === side).map((g) => g.name);
    expect(names("left")).toEqual(["GP21", "GP18", "GP19"]);
    expect(names("right")).toEqual(["I2C", "Select", "ESC"]);
  });

  it("is never drawn much taller than it is wide", () => {
    for (const board of ["trifolium_v1_2", "diana_v1_1", "seeed_xiao_rp2040"]) {
      const block = drawn(board);
      expect(block.w, board).toBeGreaterThanOrEqual(block.h * 0.6 - 0.001);
    }
  });

  it("names a plug without the word every plug's name ends in", () => {
    expect(v12.groups.map((g) => g.name)).toEqual(expect.arrayContaining(["ESC", "I2C", "GP21", "XT30 IN"]));
  });

  it("orders a plug's pins by the legs wired to them, a shared ground between its parts", () => {
    const esc = v12.pins.filter((p) => p.pad.connector === "ESC connector").map((p) => p.text);
    // ESC 2's signal, the ground both ESCs share, ESC 4's signal.
    expect(esc).toEqual(["GP1", "GND from ESC", "GP3"]);
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
