import { describe, expect, it } from "vitest";
import schemaJson from "../../fixtures/schema.json";
import deviceJson from "../../fixtures/device.json";
import type { Schema } from "../../schema/types";
import { diagramForBoardId } from "../../schema/wiringDiagrams";
import { GROUND_COLOUR, layout, SIGNAL_COLOURS, SUPPLY_COLOUR, type Layout, type Placed } from "./layout";
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

  it("lines a part up with its pins, so its signal runs straight across", () => {
    const wire = view.wires.find((w) => w.key === "trigger:NO")!;
    const [x0, y0] = numbersIn(wire.d);
    const [x1, y1] = numbersIn(wire.d).slice(-2);
    expect(Math.abs(y1 - y0)).toBeLessThan(Math.abs(x1 - x0) / 4);
  });

  it("never crosses a part's wires on the way to its pins", () => {
    for (const p of view.parts) {
      const wires = view.wires.filter((w) => w.part === p.part.id && !w.missing && w.key.split(":")[1] in Object.fromEntries(p.terminals));
      const along = (w: (typeof wires)[number]) => {
        const n = numbersIn(w.d);
        const [sx, sy] = n;
        const [ex, ey] = n.slice(-2);
        return p.facing === "up" ? [sx, ex] : [sy, ey];
      };
      const toPads = wires.filter((w) => view.pads.some((pad) => w.d.endsWith(`${pad.sx.toFixed(1)} ${pad.sy.toFixed(1)}`)));
      for (const a of toPads) {
        for (const b of toPads) {
          if (a === b) continue;
          const [a0, a1] = along(a);
          const [b0, b1] = along(b);
          // Legs and pins in the same order, or a pin the two share.
          expect((a0 - b0) * (a1 - b1) >= 0 || Math.abs(a1 - b1) < 0.5, `${a.key} and ${b.key}`).toBe(true);
        }
      }
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
