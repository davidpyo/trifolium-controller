import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readPads } from "./pads";

const BOARDS = fileURLToPath(new URL("../../../../../boards/", import.meta.url));

describe("readPads", () => {
  it("reads circles and rects, with the plug they are in", () => {
    const sheet = readPads(
      '<svg viewBox="0 0 100 50"><g fill="#000"><g data-connector="Plug A">' +
        '<circle cx="10" cy="20" r="3" data-gpio="4" />' +
        '<rect x="20" y="10" width="8" height="4" data-pin="GND" data-label="GND to A" />' +
        "</g>" +
        '<circle cx="50" cy="5" r="2" data-gpio="7" />' +
        "</g></svg>",
    )!;
    expect(sheet.viewBox).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    expect(sheet.pads).toEqual([
      { gpio: 4, power: undefined, label: undefined, connector: "Plug A", x: 10, y: 20, r: 3 },
      { gpio: null, power: "GND", label: "GND to A", connector: "Plug A", x: 24, y: 12, r: 2 },
      { gpio: 7, power: undefined, label: undefined, connector: undefined, x: 50, y: 5, r: 2 },
    ]);
  });

  it("leaves out pins the board wires itself, and anything in a comment", () => {
    const sheet = readPads(
      '<svg viewBox="0 0 10 10"><metadata><pin data-gpio="24" data-internal="pusherFetPin" />' +
        "</metadata><!-- <circle cx=\"1\" cy=\"1\" r=\"1\" data-gpio=\"3\" /> -->" +
        '<circle cx="2" cy="2" r="1" data-gpio="5" /></svg>',
    )!;
    expect(sheet.pads.map((p) => p.gpio)).toEqual([5]);
  });

  it("has no sheet without a viewBox to place it in", () => {
    expect(readPads('<svg><circle cx="1" cy="1" r="1" data-gpio="1" /></svg>')).toBeUndefined();
  });

  // Every marker the README describes, on every board that has a drawing, comes back as a pad.
  const boards = readdirSync(BOARDS).filter((id) => existsSync(join(BOARDS, id, "pins.svg")));
  it.each(boards)("reads every pad of %s", (id) => {
    const markup = readFileSync(join(BOARDS, id, "pins.svg"), "utf8");
    const withoutComments = markup.replace(/<!--[\s\S]*?-->/g, "");
    const expected = [...withoutComments.matchAll(/<(circle|rect|ellipse)\b[^>]*data-(gpio|pin)=/g)].length;
    const sheet = readPads(markup)!;
    expect(sheet.pads).toHaveLength(expected);
    for (const pad of sheet.pads) {
      expect(Number.isFinite(pad.x) && Number.isFinite(pad.y)).toBe(true);
      expect(pad.x).toBeGreaterThanOrEqual(sheet.viewBox.x);
      expect(pad.x).toBeLessThanOrEqual(sheet.viewBox.x + sheet.viewBox.w);
      expect(pad.y).toBeGreaterThanOrEqual(sheet.viewBox.y);
      expect(pad.y).toBeLessThanOrEqual(sheet.viewBox.y + sheet.viewBox.h);
    }
  });
});
