// Where everything in the hookup view goes: the board in the middle, the parts in a column either
// side of it and a row underneath, and a wire from every lead to its pad.
//
// A part goes on the side of the board its pads are on and as level with them as the parts above it
// allow, so its wires are short and run across rather than over the board. A part whose pads are
// near the board's bottom edge - the battery and the solenoid on a Trifolium - goes in the row
// underneath instead, and the battery always does: the ESCs' power leads come down to it.
//
// The board is its own drawing, scaled in, with every pad where it really is: a builder matches the
// drawing to the board in their hand. Each wire carries a tag naming its pad (GP21, GND, +) where it
// meets the board - the board's end of it, so it reads as the pad's name and not the part's leg's -
// since the board's own print is too small to read at this size. A board
// with no drawing is a schematic block instead (see schematic.ts), its pins out along its edges.
//
// All of it is in one coordinate space, the view's own; the origin is the board's top left corner,
// and `offset` is what moves the whole drawing clear of the edges.

import { type Hookup, type Net, type Part, type PartKind } from "./model";
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

export type Region = "left" | "right" | "under";

export interface PlacedPad extends Pad {
  /** Where a wire lands: on the pad, or at the end of a block's pin. */
  sx: number;
  sy: number;
  /** Which of the columns or the row under the board a part on it goes in. */
  region: Region;
  /** The way out of the board from it, so the way its wire arrives. */
  normal: Point;
  used: boolean;
  /**
   * A pad nothing lands on that a wire passes over: the wire is broken around it, so it is not
   * taken for the wire's end.
   */
  crossed: boolean;
}

/** How far around a pad a wire passing over it is broken. */
export const CROSS_GAP = 4.5;

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
  /**
   * The name of the pad it lands on, by the leg it leaves from: where it starts, and whether it
   * reads up the page, beside a leg that points up.
   */
  tag?: { text: string; x: number; y: number; w: number; h: number };
  /** Where the wire lands, for a wire to a pad. */
  land?: Point;
}

/**
 * A pad's name, on the board beside the pad: a box centred on (x, y), and the point a short line
 * runs back to the pad from, where the box had to stand off from it to find room.
 */
export interface PadLabel {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  pad: Point;
  leader?: Point;
}

export const PAD_LABEL_FONT = 7.5;
const PAD_LABEL_H = 10;
const padLabelWidth = (text: string) => text.length * 4.6 + 6;

/**
 * Names the pads wires land on, each in a box beside its pad, on the board's side of it - the wire
 * comes in from the other. Where pads are packed tighter than their names, a name stands further
 * in, still level with its own pad, with a straight line back to it: neighbours alternate deep and
 * shallow, so each name stays in line with its pad and never with the next one's. Only a name with
 * no room in line at all moves to one side.
 */
export function placePadLabels(pads: PlacedPad[], board: { w: number; h: number }): PadLabel[] {
  const used = pads.filter((p) => p.used);
  const placed: PadLabel[] = [];
  const DOT = 3.5;
  const clear = (x: number, y: number, w: number, h: number, self: PlacedPad) =>
    x - w / 2 >= 0 &&
    x + w / 2 <= board.w &&
    y - h / 2 >= 0 &&
    y + h / 2 <= board.h &&
    placed.every((l) => Math.abs(l.x - x) * 2 >= l.w + w + 2 || Math.abs(l.y - y) * 2 >= l.h + h + 2) &&
    used.every(
      (p) => p === self || Math.abs(p.sx - x) * 2 >= w + 2 * DOT || Math.abs(p.sy - y) * 2 >= h + 2 * DOT,
    );
  // Names stepping in from a row of pads stand in columns as wide as the widest of them, so a name
  // one column in never touches its neighbour's a column further.
  const widest = Math.max(0, ...used.map((p) => padLabelWidth(tagText(p))));
  for (const pad of [...used].sort((a, b) => a.sy - b.sy || a.sx - b.sx)) {
    const text = tagText(pad);
    const w = padLabelWidth(text);
    const h = PAD_LABEL_H;
    // Into the board, away from where the wire comes in.
    const d = { x: -pad.normal.x, y: -pad.normal.y };
    const side = { x: -d.y, y: d.x };
    const along = Math.abs(d.x) * w + Math.abs(d.y) * h;
    const across = Math.abs(side.x) * w + Math.abs(side.y) * h;
    let spot: PadLabel | undefined;
    search: for (const shift of [0, 1, -1, 2, -2]) {
      for (let row = 0; row < 5; row++) {
        const step = Math.abs(d.x) * widest + Math.abs(d.y) * h;
        const t = DOT + 2 + row * (step + 2) + along / 2;
        const s = shift * (across / 2 + 3);
        const x = pad.sx + d.x * t + side.x * s;
        const y = pad.sy + d.y * t + side.y * s;
        if (!clear(x, y, w, h, pad)) continue;
        const near = row === 0 && shift === 0;
        // The leader meets the box at its edge nearest the pad.
        const leader = near
          ? undefined
          : { x: Math.min(Math.max(pad.sx, x - w / 2), x + w / 2), y: Math.min(Math.max(pad.sy, y - h / 2), y + h / 2) };
        spot = { text, x, y, w, h, pad: { x: pad.sx, y: pad.sy }, leader };
        break search;
      }
    }
    // Nowhere clear within reach: beside the pad anyway, rather than unnamed.
    placed.push(
      spot ?? { text, x: pad.sx + d.x * (DOT + 2 + along / 2), y: pad.sy + d.y * (DOT + 2 + along / 2), w, h, pad: { x: pad.sx, y: pad.sy } },
    );
  }
  return placed;
}

export interface Layout {
  width: number;
  height: number;
  /** Add to every coordinate below to place it in the view. */
  offset: Point;
  board: { x: number; y: number; w: number; h: number };
  /** For a board with no drawing: the block drawn in its place. */
  schematic?: Schematic;
  pads: PlacedPad[];
  parts: Placed[];
  wires: Wire[];
}

/** Body sizes, in view units. */
export const BODY: Record<PartKind, { w: number; h: number }> = {
  microswitch: { w: 58, h: 30 },
  button: { w: 30, h: 30 },
  selector: { w: 48, h: 44 },
  slide: { w: 36, h: 52 },
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
/** Tallest and widest a board's drawing is drawn. */
const BOARD_HEIGHT = 430;
const BOARD_WIDTH = 300;
/** Below this fraction of the board's height, a part goes in the row underneath. */
const UNDER_FROM = 0.8;
export const TAG_FONT = 8.5;
const TAG_H = 11;
const tagWidth = (text: string) => text.length * 5.2 + 8;
const STACK_GAP = 14;
const ROW_GAP = 26;
const MARGIN = 16;

const INPUTS: PartKind[] = ["microswitch", "button", "selector", "slide", "pot", "oled"];

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
 * pair - have them in the order of the pins they go to, so their wires never cross each other.
 * Every other part's legs are drawn the same way every time, in the order they are on the part:
 * an ESC's lead is S then G whether or not that crosses a wire, so no two ESCs look different.
 */
const FREE_ORDER: PartKind[] = ["button", "battery", "solenoid"];

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

/** The nearest edge of a w by h board to a pad, as the way out through it. */
function nearestEdge(x: number, y: number, w: number, h: number): Point {
  const edges = [
    { d: x, n: { x: -1, y: 0 } },
    { d: w - x, n: { x: 1, y: 0 } },
    { d: y, n: { x: 0, y: -1 } },
    { d: h - y, n: { x: 0, y: 1 } },
  ];
  return edges.reduce((a, b) => (b.d < a.d ? b : a)).n;
}

/**
 * What a wire's tag calls its pad: the GPIO, or for a power pad its sign where its name gives one
 * ("+ From Battery" is +), else its power name (GND, VCC). Short, to fit beside a leg.
 */
export function tagText(pad: Pad): string {
  if (pad.gpio !== null) return `GP${pad.gpio}`;
  const label = (pad.label ?? "").trim();
  if (/^\+|\+$/.test(label)) return "+";
  if (/^[-−]|[-−]$/.test(label)) return "−";
  return pad.power ?? label;
}

/** The point a fraction t along a cubic Bezier given as its four points. */
function bezierAt([a, c1, c2, b]: Point[], t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
    y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
  };
}

const curve = (a: Point, da: Point, b: Point, db: Point) => {
  const reach = Math.max(28, 0.45 * Math.hypot(b.x - a.x, b.y - a.y));
  const c1 = { x: a.x + da.x * reach, y: a.y + da.y * reach };
  const c2 = { x: b.x + db.x * reach, y: b.y + db.y * reach };
  return {
    d: `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`,
    hull: [a, c1, c2, b],
  };
};

/** A wire's course: cubic Bezier segments, each given as its four points, end to end. */
type Path = Point[][];

function pathAt(path: Path, t: number): Point {
  const x = Math.min(t * path.length, path.length - 1e-9);
  const i = Math.floor(x);
  return bezierAt(path[i], x - i);
}

const pathD = (path: Path) =>
  `M ${path[0][0].x.toFixed(1)} ${path[0][0].y.toFixed(1)} ` +
  path.map(([, c1, c2, b]) => `C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`).join(" ");

const along = (path: Path, per = 40) =>
  path.flatMap((seg) => Array.from({ length: per + 1 }, (_, i) => bezierAt(seg, i / per)));

/** How far a wire keeps from any pad but its own. */
const CLEARANCE = 5.5;

/**
 * A wire's course from a part's leg to its pad, keeping clear of every other pad on the board: a
 * wire drawn over a pad - or under it - reads as ending there. Tries arriving from each side, at
 * a few curvatures, and with a short straight run in at the end for a pad packed between others,
 * and takes the shortest course that touches no other pad - or, if none does, the one that
 * touches fewest.
 */
function route(a: Point, da: Point, pad: PlacedPad, others: Point[]): Path {
  const b = { x: pad.sx, y: pad.sy };
  const span = (p: Point, q: Point) => Math.hypot(q.x - p.x, q.y - p.y);
  const at = (p: Point, d: Point, k: number) => ({ x: p.x + d.x * k, y: p.y + d.y * k });
  const ways = [pad.normal, { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }].filter(
    (d, i, all) => all.findIndex((e) => e.x === d.x && e.y === d.y) === i,
  );
  let best: { path: Path; score: number } | undefined;
  const consider = (path: Path, penalty: number) => {
    const points = along(path);
    const hits = others.filter((o) => points.some((q) => Math.hypot(q.x - o.x, q.y - o.y) < CLEARANCE)).length;
    let length = 0;
    for (let i = 1; i < points.length; i++) length += span(points[i - 1], points[i]);
    const score = hits * 1000 + length + penalty;
    if (!best || score < best.score) best = { path, score };
  };
  for (const [i, db] of ways.entries()) {
    const turn = i === 0 ? 0 : 4;
    for (const k of [0.45, 0.25, 0.7]) {
      const reach = Math.max(k === 0.45 ? 28 : 14, k * span(a, b));
      consider([[a, at(a, da, reach), at(b, db, reach), b]], turn);
    }
    // A straight run in, for a pad with neighbours close either side.
    for (const run of [12, 22]) {
      const w = at(b, db, run);
      const reach = Math.max(16, 0.45 * span(a, w));
      const lerp = (t: number) => ({ x: w.x + (b.x - w.x) * t, y: w.y + (b.y - w.y) * t });
      consider([[a, at(a, da, reach), at(w, db, reach * 0.6), w], [w, lerp(1 / 3), lerp(2 / 3), b]], turn + 6);
    }
  }
  return best!.path;
}

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
  let bw: number;
  let bh: number;
  let block: Schematic | undefined;
  const placedOf = new Map<Pad, PlacedPad>();
  if (hookup.sheet.invented) {
    block = arrange(hookup.sheet, {
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
    bw = block.w;
    bh = block.h;
    for (const pin of block.pins) {
      placedOf.set(pin.pad, {
        ...pin.pad,
        sx: pin.x,
        sy: pin.y,
        region: pin.side === "bottom" ? "under" : pin.side,
        normal: OUTWARD[pin.side],
        used: false,
        crossed: false,
      });
    }
  } else {
    const vb = hookup.sheet.viewBox;
    const scale = Math.min(BOARD_HEIGHT / vb.h, BOARD_WIDTH / vb.w);
    bw = vb.w * scale;
    bh = vb.h * scale;
    for (const pad of hookup.sheet.pads) {
      const sx = (pad.x - vb.x) * scale;
      const sy = (pad.y - vb.y) * scale;
      const region: Region = sy > bh * UNDER_FROM ? "under" : sx < bw / 2 ? "left" : "right";
      placedOf.set(pad, { ...pad, sx, sy, region, normal: nearestEdge(sx, sy, bw, bh), used: false, crossed: false });
    }
  }
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
    const region: Region =
      part.kind === "battery" ? "under" : (primary?.region ?? (INPUTS.includes(part.kind) ? "left" : "right"));
    // Level with its pins in its main plug - or its main pin alone, on a board without plugs, where
    // a ground it shares with every other part may be anywhere down the side.
    const pads = padsOf(part).filter(
      (p) =>
        p.region === region &&
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
      const y = bh + (block ? STUB : 0) + UNDER_RUN;
      placed.push({ part, x, y, w, h, facing: "up", terminals: terminalsFor(part, x, y, w, h, "up", alongOf("up")) });
    }
  }

  // The wires, signals coloured in the order their parts are read: down the left, down the right,
  // then along the bottom - so neighbours never share a colour until the palette runs out.
  const order = (p: Placed) => (p.facing === "right" ? 0 : p.facing === "left" ? 1 : 2) * 1e6 + (p.facing === "up" ? p.x : p.y);
  const byId = new Map(placed.map((p) => [p.part.id, p]));
  let nextSignal = 0;
  const tagged: { wire: Wire; text: string; path: Path }[] = [];
  /** Points along every wire, to keep each tag off the wires that are not its own. */
  const courses: { key: string; points: Point[] }[] = [];
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
        // A block's pins stand out from it with nothing between; a board's pads are among others.
        const path: Path = block
          ? [curve(from, dir, { x: pad.sx, y: pad.sy }, pad.normal).hull]
          : route(
              from,
              dir,
              pad,
              placedPads.filter((o) => o !== pad).map((o) => ({ x: o.sx, y: o.sy })),
            );
        const d = pathD(path);
        hull.push(...path.flat());
        const wire: Wire = { ...base, d, land: { x: pad.sx, y: pad.sy } };
        wires.push(wire);
        if (!block) tagged.push({ wire, text: tagText(lead.target.pad), path });
        courses.push({ key: wire.key, points: along(path, 80) });
      } else if (lead.target.kind === "part") {
        const other = byId.get(lead.target.part)?.terminals.get(lead.target.lead);
        if (!other) continue;
        // A power lead heading down to the battery drops straight down its own column first, so it
        // runs beside the board rather than across it, and only then bends over to the battery.
        const drop = from.dy > 0 ? Math.max(from.y, other.y - 46) : from.y;
        const bend = { x: from.x, y: drop };
        const { d, hull: h } = curve(bend, dir, other, { x: other.dx, y: other.dy });
        hull.push(from, ...h);
        const drops = Array.from({ length: 21 }, (_, i) => ({ x: from.x, y: from.y + ((drop - from.y) * i) / 20 }));
        courses.push({ key: base.key, points: [...drops, ...along([h], 80)] });
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

  // Each tag where its wire meets the board, just outside it - or, where that spot is taken, a step
  // back along the wire toward its part, until it is clear of the other tags, of every part, and of
  // every other wire: a tag another wire runs through reads as that wire's. Where converging wires
  // leave no such spot, the one fewest other wires touch.
  const bodies = placed.map((p) => ({ x: p.x - LEG, y: p.y - LEG, w: p.w + 2 * LEG, h: p.h + 2 * LEG }));
  const tags: { x: number; y: number; w: number; h: number; part: string }[] = [];
  const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const onBoard = { x: 0, y: 0, w: bw, h: bh };
  type Box = { x: number; y: number; w: number; h: number };
  type Tagged = Box & { part: string };
  // Where one wire's tag would go, given the tags already placed, and how many wires and other
  // parts it would sit on there: the first clear spot, else the least bad one.
  const spotFor = ({ wire, text, path }: (typeof tagged)[number], taken: Tagged[]) => {
    const at = (t: number) => pathAt(path, t);
    const w = tagWidth(text);
    const h = TAG_H;
    const STEPS = 240;
    let enter = STEPS;
    for (let i = 0; i <= STEPS; i++) {
      const p = at(i / STEPS);
      if (p.x >= 0 && p.x <= bw && p.y >= 0 && p.y <= bh) {
        enter = i;
        break;
      }
    }
    const others = courses.filter((c) => c.key !== wire.key);
    // A wire through the tag itself, not one running alongside it.
    const WIRE = 0.5;
    const CROWD = 6;
    // Near another part's legs, a tag reads as one of that part's.
    const NEAR = 22;
    const strangers = placed
      .filter((p) => p.part.id !== wire.part)
      .map((p) => ({ x: p.x - LEG - NEAR, y: p.y - LEG - NEAR, w: p.w + 2 * (LEG + NEAR), h: p.h + 2 * (LEG + NEAR) }));
    let best: { r: Box; hits: number } | undefined;
    for (let i = enter; i >= 0; i--) {
      const p = at(i / STEPS);
      const r = { x: p.x - w / 2, y: p.y - h / 2, w, h };
      if (overlaps(r, onBoard) || taken.some((o) => overlaps(r, o)) || bodies.some((o) => overlaps(r, o))) continue;
      const hits =
        others.filter((c) =>
          c.points.some((q) => q.x > r.x - WIRE && q.x < r.x + r.w + WIRE && q.y > r.y - WIRE && q.y < r.y + r.h + WIRE),
        ).length *
          10 +
        // How far into another part's space, not just whether: the edge of it is better than the middle.
        // Right up against another part's tag, a tag reads as one of that part's set.
        taken.filter(
          (o) => o.part !== wire.part && overlaps(r, { x: o.x - CROWD, y: o.y - CROWD, w: o.w + 2 * CROWD, h: o.h + 2 * CROWD }),
        ).length *
          0.5 +
        strangers.reduce((sum, o) => {
          const ix = Math.max(0, Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x));
          const iy = Math.max(0, Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y));
          return sum + (ix * iy) / (r.w * r.h);
        }, 0);
      if (!best || hits < best.hits) best = { r, hits };
      if (hits === 0) break;
    }
    return best;
  };
  const orders = <T,>(items: T[]): T[][] =>
    items.length <= 1 ? [items] : items.flatMap((x, i) => orders([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [x, ...rest]));
  // A part's tags as a set: whichever goes first takes the best spot, so every order is tried (a
  // part has a few wires at most) and the one whose tags sit on fewest wires kept.
  for (const id of [...new Set(tagged.map((t) => t.wire.part))]) {
    const mine = tagged.filter((t) => t.wire.part === id);
    let best: { total: number; spots: { t: (typeof tagged)[number]; r: Box }[] } | undefined;
    for (const order of mine.length <= 5 ? orders(mine) : [mine]) {
      const taken = [...tags];
      const spots: { t: (typeof tagged)[number]; r: Box }[] = [];
      let total = 0;
      for (const t of order) {
        const spot = spotFor(t, taken);
        if (!spot) {
          total += 100;
          continue;
        }
        total += spot.hits;
        taken.push({ x: spot.r.x - 1, y: spot.r.y - 1, w: spot.r.w + 2, h: spot.r.h + 2, part: id });
        spots.push({ t, r: spot.r });
      }
      if (!best || total < best.total) best = { total, spots };
      if (total === 0) break;
    }
    for (const { t, r } of best!.spots) {
      tags.push({ x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2, part: id });
      t.wire.tag = { text: t.text, x: r.x + r.w / 2, y: r.y + r.h / 2, w: r.w, h: r.h };
    }
  }

  // The free pads a wire passes over.
  if (!block) {
    const paths = tagged.map(({ path }) => along(path, 120));
    for (const pad of placedPads) {
      if (pad.used) continue;
      pad.crossed = paths.some((path) => path.some((q) => Math.hypot(q.x - pad.sx, q.y - pad.sy) < CROSS_GAP));
    }
  }

  // Everything's extent, so the drawing can be moved clear of its edges.
  const out = block ? STUB + 6 : 0;
  const xs = [-out, bw + out, ...hull.map((p) => p.x)];
  const ys = [0, bh + (block?.pins.some((p) => p.side === "bottom") ? out : 0), ...hull.map((p) => p.y)];
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
