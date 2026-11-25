// Where everything in the hookup view goes: the board in the middle, the parts in a column either
// side of it and a row underneath, and a wire from every lead to its pad.
//
// A part goes on the side of the board its pins are on and as level with them as the parts above it
// allow, so its wires are short and run straight across. A part whose pins are on the bottom edge -
// the solenoid on a Trifolium - goes in the row underneath instead, and the battery always does:
// the ESCs' power leads come down to it.
//
// The board is a schematic block (see schematic.ts), with its pins out along its edges, arranged
// for the parts here rather than as they are on the board. All of it
// is in one coordinate space, the view's own; the origin is the block's top left corner, and
// `offset` is what moves the whole drawing clear of the edges.

import { isHeavy, type Hookup, type Net, type Part, type PartKind } from "./model";
import type { Pad } from "./pads";
import { arrange, STUB, type Schematic, type Side } from "./schematic";

export type Facing = "left" | "right" | "up";

export interface Point {
  x: number;
  y: number;
}

export interface Terminal extends Point {
  /** The way the leg points, out of the part: the wire leaves along it. */
  dx: number;
  dy: number;
}

export interface Placed {
  part: Part;
  /** The part's body; legs, a motor and labels sit around it. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Which way the board is, so the side its legs come out of. */
  facing: Facing;
  terminals: Map<string, Terminal>;
}

export interface PlacedPad extends Pad {
  /** The end of the pad's pin, where a wire lands. */
  sx: number;
  sy: number;
  side: Side;
  used: boolean;
}

export interface Wire {
  key: string;
  part: string;
  lead: string;
  net: Net;
  colour: string;
  d: string;
  gpio?: number;
  /**
   * For a lead with nothing on this board to go to: what it wanted, in full and as the few
   * characters that fit at the end of its stub, and where to say so.
   */
  missing?: { text: string; short: string; x: number; y: number; anchor: "start" | "end" | "middle" };
}

export interface Layout {
  width: number;
  height: number;
  /** Add to every coordinate below to place it in the view. */
  offset: Point;
  board: { x: number; y: number; w: number; h: number };
  /** The block's pins and plugs, for drawing it. */
  schematic: Schematic;
  pads: PlacedPad[];
  parts: Placed[];
  wires: Wire[];
}

/** Body sizes, in view units. */
export const BODY: Record<PartKind, { w: number; h: number }> = {
  microswitch: { w: 58, h: 30 },
  button: { w: 30, h: 30 },
  selector: { w: 44, h: 44 },
  pot: { w: 40, h: 40 },
  oled: { w: 86, h: 54 },
  esc: { w: 66, h: 28 },
  solenoid: { w: 84, h: 28 },
  driver: { w: 52, h: 34 },
  led: { w: 24, h: 34 },
  battery: { w: 124, h: 44 },
  plug: { w: 34, h: 22 },
};

/**
 * What a part draws beyond its body, away from the board: an ESC's motor, a driver's solenoid.
 * Counted in its footprint so the next part along does not land on it.
 */
export const OUTBOARD: Partial<Record<PartKind, number>> = { esc: 64, driver: 124 };

/** How far a leg sticks out of a body, to the point its wire starts from. */
export const LEG = 10;
/** Centre to centre, along the edge legs come out of. */
const LEG_PITCH = 12;
/** Room under a body for its label and note. */
const LABEL_ROOM = 34;
/** Room above a microswitch for its lever. */
const LEVER_ROOM = 12;
/** Between the board's edge and the nearest leg, which is where the wires run. */
const WIRE_RUN = 96;
/** Between the bottom of the board and the row under it. */
const UNDER_RUN = 96;
const STACK_GAP = 14;
const ROW_GAP = 26;
const MARGIN = 16;

const INPUTS: PartKind[] = ["microswitch", "button", "selector", "pot", "oled"];

/** Wire colours. Never red or black, which are the supply and the ground. */
export const SIGNAL_COLOURS = [
  "#f2c12e", // yellow
  "#3b82f6", // blue
  "#22a35a", // green
  "#f08c2e", // orange
  "#a66cf0", // purple
  "#19b5a5", // teal
  "#9bd43a", // lime - not white, which on a dark page reads as a ground's outline
  "#ec4899", // pink
  "#b07a3a", // brown
  "#8fa3b8", // grey
];
export const SUPPLY_COLOUR = "#d7263d";
export const GROUND_COLOUR = "#1c1c1c";

const colourOf = (net: Net, signal: () => string) =>
  net === "vcc" ? SUPPLY_COLOUR : net === "gnd" ? GROUND_COLOUR : signal();

/** Legs evenly along a span, centred on its middle. */
const spread = (count: number, centre: number, span: number) => {
  const pitch = Math.min(LEG_PITCH * 1.6, Math.max(LEG_PITCH, span / Math.max(count, 1)));
  return Array.from({ length: count }, (_, i) => centre + (i - (count - 1) / 2) * pitch);
};

/**
 * Parts whose leads can go on in either order - a button's two legs, a battery's or a solenoid's
 * pair, the signal and ground of an ESC's or a driver's lead - have them in the order of the pins
 * they go to, so their wires never cross each other. A switch's or a display's legs are where they
 * are on the part, and stay so.
 */
const FREE_ORDER: PartKind[] = ["button", "battery", "solenoid", "esc", "driver", "plug"];

function terminalsFor(
  part: Part,
  x: number,
  y: number,
  w: number,
  h: number,
  facing: Facing,
  along?: (lead: Part["leads"][number]) => number,
) {
  const out = new Map<string, Terminal>();
  const board = part.leads.filter((l) => l.edge === "board");
  if (along && FREE_ORDER.includes(part.kind)) board.sort((a, b) => along(a) - along(b));
  const under = part.leads.filter((l) => l.edge === "under");
  if (facing === "up") {
    // Wider apart than on a side: legs side by side carry their names side by side.
    spread(board.length, x + w / 2, Math.max(w * 0.8, board.length * 18)).forEach((tx, i) =>
      out.set(board[i].id, { x: tx, y: y - LEG, dx: 0, dy: -1 }),
    );
  } else {
    const tx = facing === "right" ? x + w + LEG : x - LEG;
    spread(board.length, y + h / 2, h).forEach((ty, i) =>
      out.set(board[i].id, { x: tx, y: ty, dx: facing === "right" ? 1 : -1, dy: 0 }),
    );
  }
  // Under the body, at the end nearest the board: the power leads, on their way down.
  const near = facing === "right" ? x + w - 10 : x + 10;
  under.forEach((lead, i) => {
    const ux = near + (facing === "right" ? -1 : 1) * i * 10;
    out.set(lead.id, { x: ux, y: y + h + LEG, dx: 0, dy: 1 });
  });
  return out;
}

/**
 * A part with power leads underneath has its label on top instead, where nothing runs.
 */
export const labelAbove = (part: Part) => part.leads.some((l) => l.edge === "under");

/** The part's footprint above and below its body, for stacking. */
const above = (part: Part) =>
  (part.kind === "microswitch" ? LEVER_ROOM : 0) + (labelAbove(part) ? 18 : 0);
const below = (part: Part) => (labelAbove(part) ? LEG + 8 : LABEL_ROOM);

/** How much height a part takes in a column, gap included. */
export const footprint = (part: Part) => {
  const a = above(part);
  return { above: a, total: a + BODY[part.kind].h + below(part) + STACK_GAP };
};

/** The way a pin points out of the block, so the way a wire arrives along it. */
const OUTWARD: Record<Side, Point> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 } };

const curve = (a: Point, da: Point, b: Point, db: Point) => {
  const reach = Math.max(28, 0.45 * Math.hypot(b.x - a.x, b.y - a.y));
  const c1 = { x: a.x + da.x * reach, y: a.y + da.y * reach };
  const c2 = { x: b.x + db.x * reach, y: b.y + db.y * reach };
  return {
    d: `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`,
    hull: [a, c1, c2, b],
  };
};

export function layout(hookup: Hookup): Layout {
  // Each part's main pad - its first signal's, else its first - decides which side it goes on.
  const primaryOf = new Map<Part, Pad | undefined>();
  for (const part of hookup.parts) {
    const signal = part.leads.find((l) => l.net === "signal" && l.target?.kind === "pad");
    const first = part.leads.find((l) => l.target?.kind === "pad");
    const lead = signal ?? first;
    primaryOf.set(part, lead?.target?.kind === "pad" ? lead.target.pad : undefined);
  }
  // Each pin's place in the order the parts are read in, leg by leg; a pin two parts share - a
  // ground - comes between them.
  const ranks = new Map<Pad, number[]>();
  hookup.parts.forEach((part, i) =>
    part.leads.forEach((lead, j) => {
      if (lead.target?.kind === "pad") ranks.set(lead.target.pad, [...(ranks.get(lead.target.pad) ?? []), i * 100 + j]);
    }),
  );
  const users = (pads: Pad[]) =>
    hookup.parts.filter(
      (p) => p.kind !== "battery" && p.leads.some((l) => l.target?.kind === "pad" && pads.includes(l.target.pad)),
    );
  const block = arrange(hookup.sheet, {
    low: (pads) => !hookup.sheet.invented && pads.some(isHeavy),
    // Inputs on the left, everything else on the right, by what most of a plug's parts are.
    side: (pads) => {
      const parts = users(pads);
      const inputs = parts.filter((p) => INPUTS.includes(p.kind)).length;
      return inputs * 2 >= parts.length ? "left" : "right";
    },
    sink: (pads) => users(pads).some((p) => p.leads.some((l) => l.edge === "under")),
    rank: (pad) => {
      const r = ranks.get(pad);
      return r ? r.reduce((a, b) => a + b, 0) / r.length : undefined;
    },
    // A plug takes as much of its side as the parts wired to it take of their column.
    room: (pads) =>
      hookup.parts
        .filter((p) => p.kind !== "battery" && pads.includes(primaryOf.get(p)!))
        .reduce((sum, p) => sum + footprint(p).total, 0),
  });
  const bw = block.w;
  const bh = block.h;

  const placedOf = new Map<Pad, PlacedPad>(
    block.pins.map((pin) => [pin.pad, { ...pin.pad, sx: pin.x, sy: pin.y, side: pin.side, used: false }]),
  );
  const placedPads = [...placedOf.values()];
  /** How far along its side of the board a lead's pin is, to order a part's legs by. */
  const alongOf = (facing: Facing) => (lead: Part["leads"][number]) => {
    const pad = lead.target?.kind === "pad" ? placedOf.get(lead.target.pad) : undefined;
    return pad ? (facing === "up" ? pad.sx : pad.sy) : 0;
  };
  const padsOf = (part: Part) =>
    part.leads.flatMap((l) => (l.target?.kind === "pad" ? [placedOf.get(l.target.pad)!] : []));

  // Which side each part goes on, and how far along it wants to be.
  type Slot = { part: Part; region: "left" | "right" | "under"; want: number };
  const slots: Slot[] = hookup.parts.map((part) => {
    const primary = primaryOf.get(part) && placedOf.get(primaryOf.get(part)!);
    const region =
      part.kind === "battery" || primary?.side === "bottom"
        ? "under"
        : primary
          ? primary.side === "left"
            ? "left"
            : "right"
          : INPUTS.includes(part.kind)
            ? "left"
            : "right";
    // Level with its pins in its main plug - or its main pin alone, on a board without plugs, where
    // a ground it shares with every other part may be anywhere down the side.
    const pads = padsOf(part).filter(
      (p) =>
        (region === "under" ? p.side === "bottom" : p.side === region) &&
        (primary?.connector ? p.connector === primary.connector : p === primary),
    );
    const mean = (f: (p: PlacedPad) => number) => pads.reduce((s, p) => s + f(p), 0) / pads.length;
    const want = region === "under" ? (pads.length ? mean((p) => p.sx) : bw / 2) : pads.length ? mean((p) => p.sy) : bh / 2;
    return { part, region, want };
  });

  const placed: Placed[] = [];
  for (const region of ["left", "right"] as const) {
    let bottom = -Infinity;
    for (const { part } of slots.filter((s) => s.region === region).sort((a, b) => a.want - b.want)) {
      const { w, h } = BODY[part.kind];
      const want = slots.find((s) => s.part === part)!.want;
      const top = Math.max(want - h / 2, bottom + STACK_GAP + above(part));
      bottom = top + h + below(part);
      const x = region === "left" ? -WIRE_RUN - LEG - w : bw + WIRE_RUN + LEG;
      const facing = region === "left" ? "right" : "left";
      placed.push({ part, x, y: top, w, h, facing, terminals: terminalsFor(part, x, top, w, h, facing, alongOf(facing)) });
    }
  }
  {
    let right = -Infinity;
    for (const { part, want } of slots.filter((s) => s.region === "under").sort((a, b) => a.want - b.want)) {
      const { w, h } = BODY[part.kind];
      const x = Math.max(want - w / 2, right + ROW_GAP);
      right = x + w + (OUTBOARD[part.kind] ?? 0);
      const y = bh + STUB + UNDER_RUN;
      placed.push({ part, x, y, w, h, facing: "up", terminals: terminalsFor(part, x, y, w, h, "up", alongOf("up")) });
    }
  }

  // The wires, signals coloured in the order their parts are read: down the left, down the right,
  // then along the bottom - so neighbours never share a colour until the palette runs out.
  const order = (p: Placed) => (p.facing === "right" ? 0 : p.facing === "left" ? 1 : 2) * 1e6 + (p.facing === "up" ? p.x : p.y);
  const byId = new Map(placed.map((p) => [p.part.id, p]));
  let nextSignal = 0;
  const wires: Wire[] = [];
  const hull: Point[] = [];
  for (const p of [...placed].sort((a, b) => order(a) - order(b))) {
    // One colour per lead rather than per part: a selector's three positions must be tellable apart.
    const signalColour = () => SIGNAL_COLOURS[nextSignal++ % SIGNAL_COLOURS.length];
    for (const lead of p.part.leads) {
      const from = p.terminals.get(lead.id);
      if (!from || !lead.target) continue;
      const base = {
        key: `${p.part.id}:${lead.id}`,
        part: p.part.id,
        lead: lead.id,
        net: lead.net,
        colour: colourOf(lead.net, signalColour),
        gpio: lead.gpio,
      };
      const dir = { x: from.dx, y: from.dy };
      if (lead.target.kind === "pad") {
        const pad = placedOf.get(lead.target.pad)!;
        pad.used = true;
        const { d, hull: h } = curve(from, dir, { x: pad.sx, y: pad.sy }, OUTWARD[pad.side]);
        hull.push(...h);
        wires.push({ ...base, d });
      } else if (lead.target.kind === "part") {
        const other = byId.get(lead.target.part)?.terminals.get(lead.target.lead);
        if (!other) continue;
        // A power lead heading down to the battery drops straight down its own column first, so it
        // runs beside the board rather than across it, and only then bends over to the battery.
        const drop = from.dy > 0 ? Math.max(from.y, other.y - 46) : from.y;
        const bend = { x: from.x, y: drop };
        const { d, hull: h } = curve(bend, dir, other, { x: other.dx, y: other.dy });
        hull.push(from, ...h);
        wires.push({ ...base, d: drop > from.y ? `M ${from.x} ${from.y} L ${d.slice(2)}` : d });
      } else {
        const end = { x: from.x + from.dx * 26, y: from.y + from.dy * 26 };
        hull.push(from, end);
        wires.push({
          ...base,
          d: `M ${from.x} ${from.y} L ${end.x} ${end.y}`,
          missing: {
            text: lead.target.text,
            short: lead.target.text.split(" — ")[0],
            x: end.x + from.dx * 4,
            y: end.y + (from.dy ? from.dy * 10 : 4),
            anchor: from.dx > 0 ? "start" : from.dx < 0 ? "end" : "middle",
          },
        });
      }
    }
  }

  // Everything's extent, so the drawing can be moved clear of its edges.
  const xs = [-STUB - 6, bw + STUB + 6, ...hull.map((p) => p.x)];
  const ys = [0, bh + (block.pins.some((p) => p.side === "bottom") ? STUB + 6 : 0), ...hull.map((p) => p.y)];
  for (const p of placed) {
    const out = OUTBOARD[p.part.kind] ?? 0;
    xs.push(p.x - LEG - (p.facing === "left" ? 0 : out), p.x + p.w + LEG + (p.facing === "left" ? out : 0));
    // Labels are centred under the body and can be wider than it.
    xs.push(p.x + p.w / 2 - 60, p.x + p.w / 2 + 60);
    ys.push(p.y - LEG - above(p.part), p.y + p.h + below(p.part) + (p.facing === "up" ? LEVER_ROOM : 0));
  }
  for (const w of wires) {
    if (!w.missing) continue;
    const span = w.missing.short.length * 6.5;
    xs.push(w.missing.anchor === "end" ? w.missing.x - span : w.missing.x + span);
  }
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    width: Math.max(...xs) - minX + 2 * MARGIN,
    height: Math.max(...ys) - minY + 2 * MARGIN,
    offset: { x: MARGIN - minX, y: MARGIN - minY },
    board: { x: 0, y: 0, w: bw, h: bh },
    schematic: block,
    pads: placedPads,
    parts: placed,
    wires,
  };
}
