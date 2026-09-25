// The wiring diagrams, and how a board id resolves to one.
//
// A diagram is a pair of files in the board's own folder, trifolium/boards/<id>/ - see the README
// there for the data-gpio convention. It's compiled in for the same file:// reason the wiring is
// (see schema/presets.ts): the built page is one self-contained classic script, so a folder of
// assets beside the HTML would not survive it.
//
// A pair rather than one file, and the split is the point: `.board.svg` is the board as the hardware
// side drew it, re-exported or re-traced whenever it changes, and `.pins.svg` is the hand-placed
// markers, which must survive that. One file would put a day of pad-by-pad work at the mercy of the
// next art export.
//
// Both share a coordinate space - the marker sheet's viewBox is the art's - so a marker's
// coordinate is just the coordinate the art uses, whatever size either is displayed at.
//
// Not every board has a pair. A board with none is not an error - it just means the Wiring tab
// falls back to the table, the same way a board with no preset falls back to custom wiring.

// The board id is the folder's name, not part of either filename: `boards/<id>/board.svg`. One
// place spells the id, so a board cannot half-rename itself into a drawing that never loads.
const ART = "/board.svg";
const PINS = "/pins.svg";

const markerSheets = import.meta.glob<string>("../../../../boards/*/pins.svg", {
  eager: true,
  query: "?raw",
  import: "default",
});

// Both as markup rather than as asset URLs. An inlined `<img src="data:image/svg+xml,...">` is a
// document of its own: page CSS cannot reach into it, so the board could never follow the theme -
// and the encoding is fragile besides, a `#` in a fill colour being a fragment delimiter that
// truncates the whole picture. In the DOM it is just elements, which is what both of those want.
const boardArt = import.meta.glob<string>("../../../../boards/*/board.svg", {
  eager: true,
  query: "?raw",
  import: "default",
});

export interface WiringDiagram {
  boardId: string;
  /** The board art. */
  artMarkup: string;
  /** The marker sheet, drawn over the art at the same size. */
  svgMarkup: string;
  /**
   * Every pin the sheet marks, header pin and internally wired alike.
   *
   * Read from the markup rather than from the rendered DOM, so what a board offers can be asked
   * without a diagram on screen - and answered off the board's own drawing rather than off a second
   * list that would start drifting from it the day it was written.
   */
  markers: DiagramMarker[];
  /** Just the numbers, for the common "does this board have that pin at all?" question. */
  available: Set<number>;
}

export interface DiagramMarker {
  gpio: number;
  /**
   * The device field the board wires this pin to, for a pin it wires rather than brings out.
   *
   * Undefined for an ordinary header pin, which is wired to whatever the user plugs into it and so
   * belongs to no setting in particular.
   */
  wiredTo?: string;
}

// Marker sheets are authored by hand, so tolerate whatever whitespace and attribute order they are
// left in. Tags are matched whole and their attributes read out of each, rather than the two
// attributes being matched across the markup independently - which would pair a pin with the
// neighbour's function the first time someone wrote the attributes the other way round.
const TAG = /<[a-zA-Z][^>]*>/g;
const GPIO_ATTRIBUTE = /data-gpio\s*=\s*"(\d+)"/;
const INTERNAL_ATTRIBUTE = /data-internal\s*=\s*"([^"]*)"/;

export function markersIn(svgMarkup: string): DiagramMarker[] {
  const out: DiagramMarker[] = [];
  for (const [tag] of svgMarkup.matchAll(TAG)) {
    const gpio = GPIO_ATTRIBUTE.exec(tag);
    if (!gpio) continue;
    out.push({ gpio: Number(gpio[1]), wiredTo: INTERNAL_ATTRIBUTE.exec(tag)?.[1] || undefined });
  }
  return out;
}

const idFrom = (path: string, suffix: string): string | undefined => {
  if (!path.endsWith(suffix)) return undefined;
  const folder = path.slice(0, -suffix.length);
  return folder.slice(folder.lastIndexOf("/") + 1) || undefined;
};

const artByBoardId = new Map<string, string>();
for (const [path, artMarkup] of Object.entries(boardArt)) {
  const boardId = idFrom(path, ART);
  if (boardId) artByBoardId.set(boardId, artMarkup);
}

const byBoardId = new Map<string, WiringDiagram>();
for (const [path, svgMarkup] of Object.entries(markerSheets)) {
  const boardId = idFrom(path, PINS);
  if (!boardId) continue;
  const artMarkup = artByBoardId.get(boardId);
  // Markers with nothing to sit on would render as rings in empty space, which reads as a bug
  // rather than as the missing half of a pair that it is.
  if (!artMarkup) continue;
  const markers = markersIn(svgMarkup);
  byBoardId.set(boardId, {
    boardId,
    artMarkup,
    svgMarkup,
    markers,
    available: new Set(markers.map((m) => m.gpio)),
  });
}

/**
 * Boards that are the same physical design, and so share one drawing.
 *
 * v1.2, v1.3 and v1.4 are one board, so one sheet answers for all three rather than three copies of
 * it drifting apart.
 *
 * Kept here rather than as an alias on the board itself: a board's `aliases` are ids a device may
 * still report from the firmware that had a board table, which is a different question from which
 * boards look alike. v1.3 is its own board with its own wiring; it just looks like v1.2.
 */
const SHARES_DIAGRAM_WITH: Record<string, string> = {
  trifolium_v1_3: "trifolium_v1_2",
  trifolium_v1_4: "trifolium_v1_2",
};

export function diagramForBoardId(boardId: string | undefined): WiringDiagram | undefined {
  if (!boardId) return undefined;
  const shared = SHARES_DIAGRAM_WITH[boardId];
  return byBoardId.get(boardId) ?? (shared ? byBoardId.get(shared) : undefined);
}
