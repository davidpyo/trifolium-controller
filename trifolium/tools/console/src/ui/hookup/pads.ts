// The pads of a board's marker sheet (boards/<id>/pins.svg), read as data.
//
// The pin view measures its pads off the rendered DOM because it draws labels in CSS pixels beside
// an <img>-sized render. The hookup view draws everything in one SVG coordinate space, so it can
// read the same facts straight from the markup: where each pad is, what it is, and which plug it
// belongs to. That keeps the whole layout a pure function, testable without a browser.
//
// Sheets are hand-written, so this reads what the README promises and nothing more: circles, rects
// and ellipses carrying data-gpio or data-pin, inside any number of <g data-connector> groups. No
// sheet uses a transform, and check_bundle.py would be the place to hold them to that.

export interface Pad {
  /** Null on a power pad, which has a `power` name instead. */
  gpio: number | null;
  /** The sheet's data-pin name on a power pad: GND, VCC, 5V, 3V3, SOL... */
  power?: string;
  /** The sheet's data-label, the pad's own name. */
  label?: string;
  /** The plug it belongs to, from the nearest enclosing data-connector. */
  connector?: string;
  /** Centre, in the sheet's own coordinates. */
  x: number;
  y: number;
  /** Half the marker's smaller side, in the sheet's coordinates. */
  r: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PadSheet {
  viewBox: Box;
  pads: Pad[];
  /**
   * A sheet made up for a board with no drawing, whose plugs are named for the parts on them - so
   * a "Battery ADC" plug is not a battery's, nor a "Solenoid driver" plug a solenoid's.
   */
  invented?: boolean;
}

const TAG = /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w:-]*)\b[^>]*?(\/?)>/g;

const attr = (tag: string, name: string): string | undefined =>
  new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(tag)?.[1];

const num = (tag: string, name: string): number => Number(attr(tag, name) ?? NaN);

export function viewBoxOf(markup: string): Box | undefined {
  const svg = /<svg\b[^>]*>/.exec(markup)?.[0] ?? "";
  const parts = attr(svg, "viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (parts?.length !== 4 || !parts.every(Number.isFinite) || parts[2] <= 0 || parts[3] <= 0) {
    return undefined;
  }
  return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
}

/** Every positioned pad in a marker sheet. A data-internal pin has no pad and is left out. */
export function readPads(markup: string): PadSheet | undefined {
  const viewBox = viewBoxOf(markup);
  if (!viewBox) return undefined;

  const pads: Pad[] = [];
  // One entry per open <g>, the connector it names or inherits.
  const connectors: (string | undefined)[] = [];
  let inMetadata = 0;

  for (const match of markup.matchAll(TAG)) {
    const [tag, name, selfClosing] = match;
    if (!name) continue; // a comment
    const closing = tag.startsWith("</");
    const element = name.toLowerCase();

    if (element === "metadata") {
      if (closing) inMetadata = Math.max(0, inMetadata - 1);
      else if (!selfClosing) inMetadata++;
      continue;
    }
    if (element === "g") {
      if (closing) connectors.pop();
      else if (!selfClosing) {
        connectors.push(attr(tag, "data-connector") ?? connectors[connectors.length - 1]);
      }
      continue;
    }
    if (closing || inMetadata > 0) continue;

    const gpioAttr = attr(tag, "data-gpio");
    const power = attr(tag, "data-pin");
    if (gpioAttr === undefined && power === undefined) continue;
    if (attr(tag, "data-internal") !== undefined) continue;

    let x: number;
    let y: number;
    let r: number;
    if (element === "circle") {
      x = num(tag, "cx");
      y = num(tag, "cy");
      r = num(tag, "r");
    } else if (element === "ellipse") {
      x = num(tag, "cx");
      y = num(tag, "cy");
      r = Math.min(num(tag, "rx"), num(tag, "ry"));
    } else if (element === "rect") {
      const w = num(tag, "width");
      const h = num(tag, "height");
      x = num(tag, "x") + w / 2;
      y = num(tag, "y") + h / 2;
      r = Math.min(w, h) / 2;
    } else {
      continue;
    }
    if (![x, y].every(Number.isFinite)) continue;

    const gpio = gpioAttr === undefined ? null : Number(gpioAttr);
    if (gpio !== null && !Number.isInteger(gpio)) continue;
    pads.push({
      gpio,
      power: gpio === null ? power : undefined,
      label: attr(tag, "data-label") || undefined,
      connector: attr(tag, "data-connector") ?? connectors[connectors.length - 1],
      x,
      y,
      r: Number.isFinite(r) ? r : 0,
    });
  }
  return { viewBox, pads };
}
