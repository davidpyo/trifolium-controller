// The board, drawn as a schematic block rather than a picture of itself: a box with its pins along
// the edges, each named on the inside, grouped by the plug they are in.
//
// A picture of the board shows where a pad is; this shows what it is, which is the question a
// wiring diagram answers - the Board pins view beside it is there for the where. So nothing here
// copies the board's shape, and only the plugs something is wired to are drawn - the rest are
// handed back as `free`, for listing. A plug goes on the side of the box its parts are on - inputs
// left, outputs right, the pack's current along the bottom - in the order of those parts. Then, so
// the box is no taller than it has to be, plugs move from the foot of the taller side to the
// shorter for as long as that makes the box shorter.
//
// What a plug never loses is its own pins, in their own order: every pin of it, the free ones
// greyed, as they are along the plug on the board. A builder plugs a ready-made lead in by that
// order, so a drawing that tidied it to save a crossed wire would have them swap a signal for a
// ground. A wire crosses another instead, where it must.
//
// A plug is given as much of its side as the parts wired to it take up in their column, so a
// part's wires run straight across to its pins instead of fanning in from a column much taller
// than the box.

import type { Pad, PadSheet } from "./pads";

export type Side = "left" | "right" | "bottom";

export interface Pin {
  pad: Pad;
  side: Side;
  /** Whether anything is wired to it; a plug's free pins are drawn too, to keep their places. */
  wired: boolean;
  /** The end of the pin, outside the box, where a wire lands. */
  x: number;
  y: number;
  text: string;
  /** The pad's own name beside its GPIO, on a board whose pads have one (D0, A1...). */
  sub?: string;
}

export interface PinGroup {
  /** The plug's name; none for pads that are in no plug, which are drawn loose. */
  name?: string;
  side: Side;
  pins: Pin[];
  /** The plug's outline, inside the box, round its pins' names. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Schematic {
  w: number;
  h: number;
  pins: Pin[];
  groups: PinGroup[];
  /** The board's pads with nothing wired to them, in the board's own order: not drawn. */
  free: Pad[];
}

export const PIN_PITCH = 16;
/** How far a pin sticks out of the box. */
export const STUB = 12;
/** The font size pin names are drawn at, and the width allowed for each character of one. */
export const PIN_FONT = 9.5;
const CHAR = 5.6;
/** Room above a plug's pins for its name. */
const HEAD = 14;
const GROUP_GAP = 10;
/** Between the box's edge and the nearest plug, top and bottom. */
const INSET = 12;
/** Between the box's edge and a pin's name. */
export const TEXT_IN = 7;
const MIN_WIDTH = 150;
/** The narrowest the box is drawn, as a fraction of its height. */
const ASPECT = 0.6;

/** What a pin is called on the drawing. */
export function pinName(pad: Pad): { text: string; sub?: string } {
  if (pad.gpio !== null) return { text: `GP${pad.gpio}`, sub: pad.label };
  return { text: pad.label ?? pad.power ?? "" };
}

/**
 * A plug's pins in the order they are along it on the board: down a plug that runs down the
 * board, across one that runs across it.
 */
export function inPlugOrder(pads: Pad[]): Pad[] {
  const span = (f: (p: Pad) => number) => Math.max(...pads.map(f)) - Math.min(...pads.map(f));
  const across = span((p) => p.x) > span((p) => p.y);
  const along = (p: Pad) => (across ? p.x : p.y);
  const other = (p: Pad) => (across ? p.y : p.x);
  return [...pads].sort((a, b) => along(a) - along(b) || other(a) - other(b));
}

/** A plug's name, without the word every plug's name ends in. */
const plugName = (connector: string) => connector.replace(/\s+connector$/i, "");

const nameWidth = (pad: Pad) => {
  const { text, sub } = pinName(pad);
  return (text.length + (sub ? sub.length + 1 : 0)) * CHAR;
};

export interface ArrangeOptions {
  /** Which plugs go along the bottom edge. */
  low?: (pads: Pad[]) => boolean;
  /** Which side a plug would rather be on, for the parts wired to it. Left to itself, by the board. */
  side?: (pads: Pad[]) => "left" | "right";
  /**
   * Where a pin comes, lowest first: by the parts wired to it. Undefined for a pin with nothing
   * wired to it, which is left out. Left to itself, every pin, in the board's order.
   */
  rank?: (pad: Pad) => number | undefined;
  /** How much of its side a plug on the left or right should take, for the parts wired to it. */
  room?: (pads: Pad[]) => number;
  /**
   * Plugs that stay at the foot of their side: those whose parts have leads running down past the
   * board, to the battery, which would otherwise run over the parts below them.
   */
  sink?: (pads: Pad[]) => boolean;
}

export function arrange(sheet: PadSheet, options: ArrangeOptions = {}): Schematic {
  const vb = sheet.viewBox;
  const index = new Map(sheet.pads.map((p, i) => [p, i]));
  const {
    low = () => false,
    side: sideOf = (pads: Pad[]) =>
      pads.reduce((s, p) => s + (p.x - vb.x) / vb.w, 0) / pads.length < 0.5 ? "left" : "right",
    rank = (p: Pad) => index.get(p),
    room = () => 0,
    sink = () => false,
  } = options;
  const isWired = (p: Pad) => rank(p) !== undefined;
  /** Where a group comes among the others: its first wired pin's place in the parts' order. */
  const first = (pads: Pad[]) => Math.min(...pads.filter(isWired).map((p) => rank(p)!));

  // A plug with anything wired to it, whole; a pad in no plug, if it is wired.
  type Draft = { name?: string; pads: Pad[]; side: Side };
  const plugs = new Map<string, Pad[]>();
  const loose: Pad[][] = [];
  for (const pad of sheet.pads) {
    if (pad.connector) plugs.set(pad.connector, [...(plugs.get(pad.connector) ?? []), pad]);
    else if (isWired(pad)) loose.push([pad]);
  }
  const drafts: Draft[] = [
    ...[...plugs]
      .filter(([, pads]) => pads.some(isWired))
      .map(([connector, pads]) => ({ name: plugName(connector), pads: inPlugOrder(pads), side: "left" as Side })),
    ...loose.map((pads) => ({ pads, side: "left" as Side })),
  ];
  for (const d of drafts) d.side = low(d.pads) ? "bottom" : sideOf(d.pads);
  const drawn = new Set(drafts.flatMap((d) => d.pads));
  const free = sheet.pads.filter((p) => !drawn.has(p));
  // In the order of their parts.
  drafts.sort((a, b) => first(a.pads) - first(b.pads) || index.get(a.pads[0])! - index.get(b.pads[0])!);

  const head = (d: Draft) => (d.name ? HEAD : 0);
  const extent = (d: Draft) => Math.max(head(d) + d.pads.length * PIN_PITCH, room(d.pads)) + (d.name ? GROUP_GAP : 0);
  const sinks = new Set(drafts.filter((d) => sink(d.pads)));
  const sorted = (side: "left" | "right") => {
    const here = drafts.filter((d) => d.side === side);
    return [...here.filter((d) => !sinks.has(d)), ...here.filter((d) => sinks.has(d))];
  };
  const columns = { left: sorted("left"), right: sorted("right") };
  const tall = (side: "left" | "right") => columns[side].reduce((sum, d) => sum + extent(d), 0);
  // Even the sides up: the taller side's last plug that is free to move goes to the other, above
  // any there that stay at the foot, while that leaves the taller of the two shorter than it was.
  for (;;) {
    const from = tall("left") >= tall("right") ? "left" : "right";
    const to = from === "left" ? "right" : "left";
    const last = columns[from].filter((d) => !sinks.has(d)).pop();
    if (!last || tall(to) + extent(last) >= tall(from)) break;
    columns[from].splice(columns[from].indexOf(last), 1);
    const foot = columns[to].findIndex((d) => sinks.has(d));
    columns[to].splice(foot < 0 ? columns[to].length : foot, 0, last);
    last.side = to;
  }
  const on = (side: Side) => (side === "bottom" ? drafts.filter((d) => d.side === "bottom") : columns[side]);

  // How wide each side's names run in from its edge.
  const reach = (side: Side) =>
    Math.max(0, ...on(side).flatMap((d) => [...d.pads.map(nameWidth), d.name ? d.name.length * CHAR * 0.9 : 0]));
  const leftReach = reach("left");
  const rightReach = reach("right");
  const bottomPlugs = on("bottom");
  const bottomPins = bottomPlugs.reduce((n, d) => n + d.pads.length, 0);
  let w = Math.max(
    MIN_WIDTH,
    leftReach + rightReach + 2 * TEXT_IN + 30,
    bottomPins * PIN_PITCH * 1.4 + bottomPlugs.length * 40,
  );

  const pins: Pin[] = [];
  const groups: PinGroup[] = [];
  const pinOf = (pad: Pad, side: Side, x: number, y: number) => {
    const pin = { pad, side, x, y, wired: isWired(pad), ...pinName(pad) };
    pins.push(pin);
    return pin;
  };

  // Down each side.
  let sideHeight = 0;
  for (const side of ["left", "right"] as const) {
    let cursor = INSET;
    for (const d of on(side)) {
      const own = head(d) + d.pads.length * PIN_PITCH;
      const top = cursor + (extent(d) - (d.name ? GROUP_GAP : 0) - own) / 2;
      // The right side's x waits for the box's width, below.
      const groupPins = d.pads.map((pad, i) =>
        pinOf(pad, side, side === "left" ? -STUB : NaN, top + head(d) + (i + 0.5) * PIN_PITCH),
      );
      const width = Math.max(...d.pads.map(nameWidth), d.name ? d.name.length * CHAR * 0.9 : 0) + 2 * TEXT_IN - 6;
      groups.push({ name: d.name, side, pins: groupPins, x: side === "left" ? 3 : NaN, y: top + 1, w: width, h: own - 2 });
      cursor += extent(d);
    }
    const last = on(side)[on(side).length - 1];
    sideHeight = Math.max(sideHeight, cursor - (last?.name ? GROUP_GAP : 0) + INSET);
  }

  // Along the bottom, each plug centred in its share of the width, under the box's sides.
  const longest = Math.max(0, ...bottomPlugs.flatMap((d) => d.pads.map(nameWidth)));
  const bottomZone = bottomPlugs.length ? longest + 2 * TEXT_IN + HEAD + 6 : 0;
  const h = Math.max(sideHeight, 120) + bottomZone;
  // No narrower than a board is, against its height: a strip reads as a header, not a board.
  w = Math.max(w, h * ASPECT);
  const pitch = PIN_PITCH * 1.4;
  bottomPlugs.forEach((d, i) => {
    const centre = (w * (i + 0.5)) / bottomPlugs.length;
    const first = centre - ((d.pads.length - 1) / 2) * pitch;
    const groupPins = d.pads.map((pad, j) => pinOf(pad, "bottom", first + j * pitch, h + STUB));
    groups.push({
      name: d.name,
      side: "bottom",
      pins: groupPins,
      x: first - pitch / 2,
      y: h - bottomZone + HEAD,
      w: d.pads.length * pitch,
      h: bottomZone - HEAD - 3,
    });
  });

  // The right side's x, now the width is known.
  for (const pin of pins) if (pin.side === "right") pin.x = w + STUB;
  for (const g of groups) if (g.side === "right") g.x = w - 3 - g.w;

  return { w, h, pins, groups, free };
}
