import { describe, expect, it } from "vitest";
import schemaJson from "../../fixtures/schema.json";
import deviceJson from "../../fixtures/device.json";
import type { Schema } from "../../schema/types";
import { diagramForBoardId } from "../../schema/wiringDiagrams";
import { GROUND_COLOUR, layout, placePadLabels, SIGNAL_COLOURS, SUPPLY_COLOUR, tagText, type Layout, type Placed } from "./layout";
import { buildHookup } from "./model";
import { readPads } from "./pads";

const schema = schemaJson as unknown as Schema;

const viewOf = (board: string | null, overrides: Record<string, unknown> = {}): Layout => {
  const diagram = board ? diagramForBoardId(board)! : undefined;
  return layout(
    buildHookup(
      schema,
      { ...deviceJson, ...overrides },
      diagram ? readPads(diagram.svgMarkup) : undefined,
      diagram?.markers,
    ),
  );
};

const placed = (view: Layout, id: string): Placed => view.parts.find((p) => p.part.id === id)!;

/** Every number in a path, so a NaN anywhere in one shows. */
const numbersIn = (d: string) => (d.match(/-?[\d.]+|NaN|Infinity/g) ?? []).map(Number);

describe("layout", () => {
  const view = viewOf("trifolium_v1_2");

  it("puts parts on the side of the board their pads are on, and the battery underneath", () => {
    // The trigger's plug is left of centre on a v1.2, the ESC ribbon right of it.
    expect(placed(view, "trigger").facing).toBe("right");
    expect(placed(view, "trigger").x + placed(view, "trigger").w).toBeLessThan(view.board.x);
    expect(placed(view, "esc1").facing).toBe("left");
    expect(placed(view, "esc1").x).toBeGreaterThan(view.board.x + view.board.w);
    expect(placed(view, "battery").facing).toBe("up");
    expect(placed(view, "battery").y).toBeGreaterThan(view.board.y + view.board.h);
  });

  it("never stacks one part on another", () => {
    for (const a of view.parts) {
      for (const b of view.parts) {
        if (a === b || a.facing !== b.facing) continue;
        const apart =
          a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart, `${a.part.id} and ${b.part.id}`).toBe(true);
      }
    }
  });

  it("runs a wire for every lead that goes somewhere", () => {
    const wired = view.parts.flatMap((p) => p.part.leads.filter((l) => l.target).map((l) => `${p.part.id}:${l.id}`));
    expect(view.wires.map((w) => w.key).sort()).toEqual(wired.sort());
  });

  it("colours supplies red and grounds black, and signals neither", () => {
    for (const wire of view.wires) {
      if (wire.net === "vcc") expect(wire.colour).toBe(SUPPLY_COLOUR);
      else if (wire.net === "gnd") expect(wire.colour).toBe(GROUND_COLOUR);
      else {
        expect(SIGNAL_COLOURS).toContain(wire.colour);
        expect([SUPPLY_COLOUR, GROUND_COLOUR]).not.toContain(wire.colour);
      }
    }
  });

  it("gives neighbouring signal wires different colours", () => {
    const selector = view.wires.filter((w) => w.part === "selector" && w.net === "signal");
    expect(new Set(selector.map((w) => w.colour)).size).toBe(selector.length);
  });

  it("ends each wire on its pad", () => {
    const wire = view.wires.find((w) => w.key === "trigger:NO")!;
    const pad = view.pads.find((p) => p.gpio === 21)!;
    const [x, y] = numbersIn(wire.d).slice(-2);
    expect(x).toBeCloseTo(pad.sx, 0);
    expect(y).toBeCloseTo(pad.sy, 0);
    expect(pad.used).toBe(true);
  });

  it("tags each wire with the pad it goes on where it meets the board, not by the part's leg", () => {
    const tag = (key: string) => view.wires.find((w) => w.key === key)!.tag!;
    expect(tag("trigger:NO").text).toBe("GP21");
    expect(tag("trigger:C").text).toBe("GND");
    expect(tag("battery:+").text).toBe("+");
    expect(tag("battery:-").text).toBe("−");
    // Just off the board, between it and the part: nearer the board than the leg.
    const { board } = view;
    for (const wire of view.wires) {
      const t = wire.tag;
      if (!t) continue;
      const outside = t.x + t.w / 2 <= board.x || t.x - t.w / 2 >= board.x + board.w || t.y + t.h / 2 <= board.y || t.y - t.h / 2 >= board.y + board.h;
      expect(outside, wire.key).toBe(true);
    }
    const leg = placed(view, "trigger").terminals.get("NO")!;
    expect(board.x - tag("trigger:NO").x).toBeLessThan(board.x - leg.x);
    // No two tags on top of each other.
    const tags = view.wires.flatMap((w) => (w.tag ? [w.tag] : []));
    for (const a of tags) {
      for (const b of tags) {
        if (a !== b) expect(Math.abs(a.x - b.x) * 2 >= a.w + b.w || Math.abs(a.y - b.y) * 2 >= a.h + b.h, `${a.text} ${b.text}`).toBe(true);
      }
    }
    // A wire with nowhere to go has its warning instead.
    expect(viewOf("trifolium_v1_2", { revSwitchPin: 5 }).wires.find((w) => w.key === "rev:NO")!.tag).toBeUndefined();
  });

  it.each(["trifolium_v1_2", "diana_v1_1"])("can name every pad in use on %s at once, with no two names on top of each other", (board) => {
    const v = viewOf(board, board === "diana_v1_1" ? { escPins: [255, 1, 255, 2], triggerSwitchPin: 3, revSwitchPin: 4, menuButtonPin: 5, selectFireType: "off", pusherFetPin: 0 } : {});
    const used = v.pads.filter((p) => p.used);
    const labels = placePadLabels(used, v.board);
    expect(labels).toHaveLength(used.length);
    for (const pad of used) expect(labels.some((l) => l.pad.x === pad.sx && l.pad.y === pad.sy), tagText(pad)).toBe(true);
    for (const a of labels) {
      for (const b of labels) {
        if (a === b) continue;
        const apart = Math.abs(a.x - b.x) * 2 >= a.w + b.w || Math.abs(a.y - b.y) * 2 >= a.h + b.h;
        expect(apart, `${a.text} and ${b.text}`).toBe(true);
      }
    }
  });

  it.each(["trifolium_v1_1", "trifolium_v1_2", "diana_v1_1", "rp2040_zero", "seeed_xiao_rp2040"])(
    "routes every wire on %s clear of every pad but its own",
    (board) => {
      const v = viewOf(board, board === "diana_v1_1" ? { escPins: [255, 1, 255, 2], triggerSwitchPin: 3, revSwitchPin: 4, menuButtonPin: 5, selectFireType: "off", pusherFetPin: 0 } : {});
      expect(v.pads.filter((p) => p.crossed).map(tagText)).toEqual([]);
      for (const wire of v.wires.filter((w) => w.land)) {
        // Every point the path's numbers name - its ends and control points - and many along it.
        const n = numbersIn(wire.d);
        const points: { x: number; y: number }[] = [];
        for (let i = 0; i + 1 < n.length; i += 2) points.push({ x: n[i], y: n[i + 1] });
        const segs: { x: number; y: number }[][] = [];
        for (let i = 0; i + 3 < points.length; i += 3) segs.push(points.slice(i, i + 4));
        for (const [a, c1, c2, b] of segs) {
          for (let k = 0; k <= 40; k++) {
            const t = k / 40;
            const u = 1 - t;
            const x = u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x;
            const y = u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y;
            for (const pad of v.pads) {
              if (Math.abs(pad.sx - wire.land!.x) < 0.05 && Math.abs(pad.sy - wire.land!.y) < 0.05) continue;
              expect(Math.hypot(pad.sx - x, pad.sy - y), `${wire.key} by ${tagText(pad)}`).toBeGreaterThan(4);
            }
          }
        }
      }
    },
  );

  it("keeps every tag on a v1.2 off every wire but its own", () => {
    // Points along each wire, from the numbers in its path: ends and control points of each piece.
    const course = (d: string) => {
      const n = numbersIn(d);
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i + 1 < n.length; i += 2) pts.push({ x: n[i], y: n[i + 1] });
      const out: { x: number; y: number }[] = [];
      for (let i = 0; i + 3 < pts.length; i += 3) {
        const [a, c1, c2, b] = pts.slice(i, i + 4);
        for (let k = 0; k <= 80; k++) {
          const t = k / 80;
          const u = 1 - t;
          out.push({
            x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
            y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
          });
        }
      }
      return out;
    };
    const signals = view.wires.filter((w) => w.tag);
    for (const wire of signals) {
      const t = wire.tag!;
      for (const other of view.wires.filter((w) => w !== wire && w.land)) {
        const through = course(other.d).some((q) => Math.abs(q.x - t.x) < t.w / 2 && Math.abs(q.y - t.y) < t.h / 2);
        expect(through, `${other.key} runs through the ${wire.key} tag`).toBe(false);
      }
    }
  });

  it("keeps a pad's name level with its pad, however tightly the pads are packed", () => {
    // The display's four pads on a v1.2 are closer together than a name is tall.
    const lands = view.wires.filter((w) => w.part === "oled").map((w) => w.land!);
    const pads = view.pads.filter((p) => lands.some((l) => l.x === p.sx && l.y === p.sy));
    expect(pads).toHaveLength(4);
    for (const label of placePadLabels(pads, view.board)) expect(label.y).toBeCloseTo(label.pad.y, 5);
  });

  it("calls a power pad by its sign where its name gives one, else by what it is", () => {
    const pad = (power: string, label?: string) => ({ gpio: null, power, label, x: 0, y: 0, r: 1 });
    expect(tagText({ gpio: 26, label: "D0 (A0)", x: 0, y: 0, r: 1 })).toBe("GP26");
    expect(tagText(pad("VCC", "+ From Battery"))).toBe("+");
    expect(tagText(pad("GND", "Battery −"))).toBe("−");
    expect(tagText(pad("GND", "GND from ESC"))).toBe("GND");
    expect(tagText(pad("SOL", "Solenoid 1"))).toBe("SOL");
  });

  it("lines a part up with its pins on a board with no drawing, so its signal runs straight across", () => {
    const plain = viewOf(null);
    const wire = plain.wires.find((w) => w.key === "trigger:NO")!;
    const [x0, y0] = numbersIn(wire.d);
    const [x1, y1] = numbersIn(wire.d).slice(-2);
    expect(Math.abs(y1 - y0)).toBeLessThan(Math.abs(x1 - x0) / 4);
  });

  it("puts a button's, battery's or solenoid's leads in the order of their pins, so they never cross", () => {
    for (const id of ["menu", "battery", "pusher"]) {
      const p = placed(view, id);
      // Where each lead leaves the part, and where its wire lands, along the way they run.
      const ends = p.part.leads
        .filter((l) => l.target?.kind === "pad")
        .map((l) => {
          const t = p.terminals.get(l.id)!;
          const [x, y] = numbersIn(view.wires.find((w) => w.key === `${id}:${l.id}`)!.d).slice(-2);
          return p.facing === "up" ? [t.x, x] : [t.y, y];
        });
      for (const [a0, a1] of ends) for (const [b0, b1] of ends) expect((a0 - b0) * (a1 - b1), id).toBeGreaterThanOrEqual(0);
    }
  });

  it("draws every ESC's lead the same way round, S then G, even where that crosses", () => {
    for (const id of ["esc1", "esc3"]) {
      const t = placed(view, id).terminals;
      expect(t.get("S")!.y, id).toBeLessThan(t.get("G")!.y);
    }
  });

  it("marks a wire with nowhere to go, and says why", () => {
    const view = viewOf("trifolium_v1_2", { revSwitchPin: 5 });
    const wire = view.wires.find((w) => w.key === "rev:NO")!;
    expect(wire.missing?.text).toBe("GP5 — not on board");
    expect(wire.missing?.short).toBe("GP5");
  });

  it.each([null, "trifolium_v1_1", "trifolium_v1_2", "diana_v1_0", "diana_v1_1", "rp2040_zero", "seeed_xiao_rp2040"])(
    "lays out %s with every coordinate finite and inside the drawing",
    (board) => {
      const view = viewOf(board);
      expect(view.width).toBeGreaterThan(0);
      expect(view.height).toBeGreaterThan(0);
      for (const wire of view.wires) {
        for (const n of numbersIn(wire.d)) expect(Number.isFinite(n), wire.key).toBe(true);
      }
      for (const p of view.parts) {
        const left = p.x + view.offset.x;
        const top = p.y + view.offset.y;
        expect(left, p.part.id).toBeGreaterThanOrEqual(0);
        expect(top, p.part.id).toBeGreaterThanOrEqual(0);
        expect(left + p.w, p.part.id).toBeLessThanOrEqual(view.width);
        expect(top + p.h, p.part.id).toBeLessThanOrEqual(view.height);
      }
    },
  );
});
