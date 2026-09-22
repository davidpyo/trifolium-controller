import React from "react";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { alpha, useTheme, type Theme } from "@mui/material/styles";
import { getByKey } from "../schema/keyPath";
import type { Schema } from "../schema/types";
import type { WiringDiagram as Diagram } from "../schema/wiringDiagrams";
import { labelsByField } from "./PinConflicts";
import { collectWiring, type Row } from "./WiringTable";

// The read-only visual counterpart to WiringTable: the same board, drawn instead of tabulated.
//
// Pin location comes entirely from the marker sheet -
// every element with a data-gpio attribute is a physical pin the console can label. Which control,
// if any, sits on that pin is a live fact read the same way WiringTable reads it: off the device
// payload, via the same collectWiring() rows, not duplicated here.
//
// Labels sit in columns either side of the board rather than on the pins, because pins are as close
// together as a connector's pitch - the ESC header puts six of them inside 120px of render - and a
// label naming a control is never that narrow. A leader line back to the pad is what buys the room.
//
// A pad can also carry a `data-label` the sheet's author wrote, and that is the only thing there is
// to say about a power pad - nothing is ever assigned to one, so without a label a supply pad can
// only ever answer "GND". Authored labels are drawn the same way but quieter, because the two answer
// different questions: what is wired here on this device, against what the pad is for on any of them.
//
// Pads that share a plug can say so with `data-connector`, usually on a <g> around them. Hovering
// any pad then lights the whole plug, and the connector's labels stack together. Until a sheet says
// otherwise this is guessed from the geometry, which is a good guess and only a guess - see runs().

/** 255 is the firmware's "unused" sentinel - see wiringRules.tsx. Never a real assignment. */
const UNUSED = 255;

/** Label column width each side of the board. Wide enough for a label, its pin and its plug. */
const GUTTER = 148;
/** Widest the board render itself is drawn. */
const ART_WIDTH = 340;
/**
 * Least vertical room a stacked label needs before it collides with the one above.
 *
 * Tight, because these are the labels of one plug and they are meant to read as a block - a
 * connector's four wires at the spacing of four lines of text, rather than as four separate
 * facts evenly spread down the gutter.
 */
const LABEL_GAP = 16;
/** And the room between one plug's labels and the next, which is what makes the block a block. */
const PLUG_GAP = 26;
/**
 * What kind of plug a name describes, which is all the colour means.
 *
 * Read off the name rather than declared, because the names already say it - a sheet that calls
 * something "I2C connector" has said which bus it is, and asking it to say so twice is how the two
 * start disagreeing. Anything unrecognised is a plain GPIO plug, which is the common case and wants
 * no ceremony.
 */
export type ConnectorKind = "i2c" | "esc" | "power" | "gpio";

/**
 * The plug's name, shortened for the chip that sits on every one of its rows.
 *
 * "GP18 connector" on four rows is three quarters wasted width in a gutter this narrow, and the
 * word is the same on every plug so it carries nothing. The full name stays in the pad's tooltip.
 */
export const shortPlugName = (name: string): string =>
  name.replace(/\s*connectors?\s*$/i, "").trim() || name;

export function connectorKind(name: string): ConnectorKind {
  if (/i2c|oled|display/i.test(name)) return "i2c";
  if (/esc|ribbon|motor/i.test(name)) return "esc";
  if (/xt30|power|batt|solenoid|supply/i.test(name)) return "power";
  return "gpio";
}
/**
 * Height within which two pads count as the same row.
 *
 * A connector header is a run of pads at one height, and pads that share a height have no natural
 * order to label them in - so they get ordered across instead. See stack().
 */
const CLUSTER_BAND = 12;

/** Smallest a pad's hover target is allowed to be, whatever size the sheet draws its marker. */
const HOVER_FLOOR = 14;
/**
 * The markers that are actually on the board: signal pads, and the power pads beside them.
 *
 * A data-internal pin is wired inside the board and has no pad to point at, so the sheet declares it
 * without a position. Measuring one would put a hover target on a zero-sized element at the origin.
 */
const PIN_SELECTOR = "[data-gpio]:not([data-internal]), [data-pin]";

/**
 * A plug's colour, by what kind of plug it is.
 *
 * Four hues that are already in the palette, so both themes get them for free. They overlap with
 * the pad colours - green is a ground pad, red a supply - but a filled chip of text on the board
 * reads as a different thing from a ring around a pad, and four kinds of plug is worth more than
 * keeping the two vocabularies apart.
 */
const CHIP_COLOURS: Record<ConnectorKind, (theme: Theme) => string> = {
  i2c: (theme) => theme.palette.info.main,
  esc: (theme) => theme.palette.warning.main,
  power: (theme) => theme.palette.error.main,
  gpio: (theme) => theme.palette.success.main,
};

/** A power pad's colour, by the name the sheet gave it. Anything unrecognised stays neutral. */
const powerColourFor = (name: string, vcc: string, gnd: string, other: string): string => {
  const upper = name.toUpperCase();
  if (upper === "VCC") return vcc;
  if (upper === "GND") return gnd;
  return other;
};

export interface DiagramMatch {
  gpio: number;
  rows: Row[];
}

/**
 * Which control(s), if any, currently occupy each GPIO.
 *
 * An array of rows per gpio, not one optional row, because two controls can legitimately share a
 * pin today (select0Pin doubling as the menu button - see wiringRules.tsx) and a genuine
 * misconfiguration can just as easily put two unrelated controls on one pin. Either way the diagram
 * should show both rather than silently picking one.
 */
export function matchDiagramPins(rows: Row[], device: unknown): DiagramMatch[] {
  const byGpio = new Map<number, Row[]>();
  for (const row of rows) {
    if (!row.pin?.key) continue;
    const value = getByKey(device, row.pin.key);
    if (typeof value !== "number" || value === UNUSED) continue;
    const existing = byGpio.get(value);
    if (existing) existing.push(row);
    else byGpio.set(value, [row]);
  }
  return [...byGpio.entries()].map(([gpio, rows]) => ({ gpio, rows }));
}

interface Measured {
  /**
   * `gpio` is null on a power pad, which carries a `power` name instead and no control, ever;
   * `label` is the sheet author's own name for the pad, on either kind, where they wrote one.
   */
  pins: {
    gpio: number | null;
    power?: string;
    label?: string;
    /** The plug this pad belongs to, where the sheet declares one. */
    connector?: string;
    x: number;
    y: number;
    size: number;
  }[];
  imageLeft: number;
  imageRight: number;
  height: number;
}

export interface Placement {
  /** Null on a power pad, which has no number to name and never carries a control. */
  gpio: number | null;
  /** Tells apart two pads that share a name - which every unlabelled GND on the board does. */
  key: string;
  label: string;
  /**
   * True when the label is the sheet's `data-label` rather than a control assigned to the pad.
   *
   * Drawn quieter than an assignment, so that what is wired here today still reads first.
   */
  authored: boolean;
  /** The plug this pad belongs to, where the sheet declares one. */
  connector?: string;
  pinX: number;
  pinY: number;
  side: "left" | "right";
  labelY: number;
}

/**
 * What a pad says on hover.
 *
 * Every pad answers, including the ones no leader line points at: a free pin says it is free, and a
 * power pad says it is not the sort of thing anything can be assigned to. Where the sheet named the
 * pad, that name leads - it is what the board would call it, whatever this device has done with it.
 */
export function padTitle(
  pad: { gpio: number | null; power?: string; label?: string; connector?: string },
  controls?: string,
): string {
  const said =
    pad.gpio === null
      ? pad.label
        ? `${pad.label} — ${pad.power}, nothing to assign`
        : `${pad.power} — power, nothing to assign`
      : controls
        ? `${controls} — GP${pad.gpio}`
        : pad.label
          ? `${pad.label} — GP${pad.gpio}, no control assigned`
          : `GP${pad.gpio} — no control assigned`;
  // Which plug, last: it is the thing you want once you already know what the pad is, and on a
  // power pad it is most of what there is to know.
  return pad.connector ? `${said} · ${pad.connector}` : said;
}

/** How near in x two pads must be to count as the same column. They share a cx, so this is slack. */
const COLUMN_TOLERANCE = 5;
/** How far apart down a column two pads can be and still be one connector. */
const COLUMN_REACH = 60;

/**
 * Pads grouped into the connectors they belong to, so a connector is labelled as one run.
 *
 * Without this, ordering by height alone splits a connector whose pads happen to straddle another
 * one: the I2C pair sits either side of the select row, so SDA got labelled, then all three select
 * pins, then SCL - the two halves of one plug three rows apart. A column of pads close together is
 * one connector and its labels belong together, whatever else shares their height.
 *
 * A sheet that names its plugs with `data-connector` is believed outright, and the geometry below
 * is only what answers for the pads it has not named. The guess is a good one, but a plug is a fact
 * about the board and the distance between two pads is evidence for it - so where a sheet states
 * the fact there is nothing left to infer. Within a group the order is left to stack(), which is
 * the only caller that knows which side of the board its labels are going to.
 */
export function runs(items: Placement[]): Placement[][] {
  const out: Placement[][] = [];
  const declared = new Map<string, Placement[]>();
  const rest: Placement[] = [];
  for (const item of items) {
    if (!item.connector) {
      rest.push(item);
      continue;
    }
    const list = declared.get(item.connector);
    if (list) list.push(item);
    else declared.set(item.connector, [item]);
  }
  out.push(...declared.values());

  const byColumn = new Map<number, Placement[]>();
  for (const item of rest) {
    const key = Math.round(item.pinX / COLUMN_TOLERANCE);
    const list = byColumn.get(key);
    if (list) list.push(item);
    else byColumn.set(key, [item]);
  }

  for (const list of byColumn.values()) {
    list.sort((a, b) => a.pinY - b.pinY);
    // Sharing an x does not make two pads one connector if they are at opposite ends of the board.
    let run = [list[0]];
    for (let i = 1; i < list.length; i++) {
      if (list[i].pinY - list[i - 1].pinY <= COLUMN_REACH) run.push(list[i]);
      else {
        out.push(run);
        run = [list[i]];
      }
    }
    out.push(run);
  }
  return out;
}

/**
 * Stacks one side's labels so none overlaps its neighbour.
 *
 * Each label wants to sit level with its own pad and is pushed down until it clears the one above,
 * then the whole column slides back up if that ran it off the bottom of the board.
 *
 * Order is by height, and *across* the board for pads of equal height: within a header the pad
 * nearest the label column takes the nearest label. Any other order crosses their leader lines over
 * each other, which is what turns six labelled pads at connector pitch back into an unreadable fan.
 */
export function stack(column: Placement[], side: "left" | "right", height: number): Placement[][] {
  const groups = runs(column);
  const order = (a: Placement, b: Placement) =>
    Math.round(a.pinY / CLUSTER_BAND) - Math.round(b.pinY / CLUSTER_BAND) ||
    (side === "left" ? a.pinX - b.pinX : b.pinX - a.pinX);
  // Within a group first. A declared connector arrives as one group of several pads, and a header's
  // pads all share a height - so without this the ribbon would be labelled in sheet order, which is
  // left to right whichever side of the board it is being labelled from.
  for (const group of groups) group.sort(order);
  // Then the groups themselves: a run stays together, and its first pad decides where it sits.
  groups.sort((a, b) => order(a[0], b[0]));

  let last = -Infinity;
  for (const group of groups) {
    group.forEach((item, i) => {
      item.labelY = Math.max(item.pinY, last + (i === 0 ? PLUG_GAP : LABEL_GAP));
      last = item.labelY;
    });
  }

  const overflow = last - height;
  if (overflow > 0) {
    for (const group of groups) {
      for (const item of group) item.labelY = Math.max(0, item.labelY - overflow);
    }
  }
  return groups;
}

export interface WiringDiagramProps {
  schema: Schema;
  device: unknown;
  diagram: Diagram;
}

export function WiringDiagram({ schema, device, diagram }: WiringDiagramProps) {
  const theme = useTheme();
  // A pad in use takes the colour its leader line and label already use; a free one is filled red,
  // which is the pair that showed up against this board's render. Both come from the palette, so
  // standardising the board art's own colours is the one move that retunes them.
  const pinUsed = theme.palette.primary.main;
  const pinFree = theme.palette.secondary.main;
  // Power pads are neither in use nor free - nothing can be assigned to them - so they answer a
  // different question, in their own pair of colours.
  const pinVcc = theme.palette.error.main;
  const pinGnd = theme.palette.success.main;
  const pinPower = theme.palette.grey[500];
  const hostRef = React.useRef<HTMLDivElement>(null);
  const artRef = React.useRef<HTMLDivElement>(null);
  const artSheetRef = React.useRef<HTMLDivElement>(null);
  const sheetRef = React.useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = React.useState<Measured | null>(null);
  /**
   * The plug the pointer is on, if the sheet names it.
   *
   * Held here rather than done in CSS because a plug's pads are siblings, not an element that can
   * be hovered - and they are in injected markup that no rule of ours can reach into anyway.
   */
  const [hoveredConnector, setHoveredConnector] = React.useState<string | null>(null);

  // Both drawings are injected rather than passed through dangerouslySetInnerHTML, because React
  // rebuilds the subtree it owns whenever it re-renders this component - and measuring schedules a
  // render, so the pads were replaced moments after being coloured and came back in the sheet's own
  // colours. Nothing here is a React child, so nothing re-creates it behind the effects below.
  React.useLayoutEffect(() => {
    const art = artSheetRef.current;
    if (art) art.innerHTML = diagram.artMarkup;
  }, [diagram.artMarkup]);

  React.useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (sheet) sheet.innerHTML = diagram.svgMarkup;
  }, [diagram.svgMarkup]);

  const measure = React.useCallback(() => {
    const host = hostRef.current;
    const art = artRef.current;
    if (!host || !art) return;
    const hostRect = host.getBoundingClientRect();
    const artRect = art.getBoundingClientRect();
    const pins: Measured["pins"] = [];
    host.querySelectorAll(PIN_SELECTOR).forEach((el) => {
      const attr = el.getAttribute("data-gpio");
      const gpio = attr === null ? null : Number(attr);
      if (gpio !== null && !Number.isInteger(gpio)) return;
      const rect = el.getBoundingClientRect();
      pins.push({
        gpio,
        power: el.getAttribute("data-pin") ?? undefined,
        label: el.getAttribute("data-label") ?? undefined,
        // closest(), so a sheet can wrap a plug's pads in one <g data-connector> rather than
        // repeating the name on every pad in it.
        connector: el.closest("[data-connector]")?.getAttribute("data-connector") ?? undefined,
        x: rect.left - hostRect.left + rect.width / 2,
        y: rect.top - hostRect.top + rect.height / 2,
        // A marker drawn at connector scale is a few pixels across, which is a hard thing to put a
        // pointer on; the floor is what makes every pad hoverable without moving any of them.
        size: Math.max(rect.width, rect.height, HOVER_FLOOR),
      });
    });
    setMeasured({
      pins,
      imageLeft: artRect.left - hostRect.left,
      imageRight: artRect.right - hostRect.left,
      height: hostRect.height,
    });
  }, []);

  React.useLayoutEffect(() => {
    measure();
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
    // diagram.svgMarkup: re-measure whenever the markup (and so the DOM it produces) changes.
  }, [measure, diagram.svgMarkup]);

  const matches = matchDiagramPins(collectWiring(schema), device);
  const matchByGpio = new Map(matches.map((m) => [m.gpio, m.rows]));
  const internal = diagram.markers.filter((m) => m.wiredTo);
  const labels = labelsByField(schema);

  // Colours each pad by whether a control is on it. Set on the element rather than left to a rule in
  // the sx below, because a sheet carries its own fill and stroke - on the marker or on a group
  // around it - and those are the author's business. This is the one thing the console overrides,
  // so it overrides it outright rather than by out-specifying whatever the sheet happens to say.
  const assignedKey = [...matchByGpio.keys()].sort((a, b) => a - b).join(",");
  React.useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const assigned = new Set(assignedKey ? assignedKey.split(",").map(Number) : []);
    host.querySelectorAll<SVGElement>(PIN_SELECTOR).forEach((el) => {
      // Every pad on the hovered plug, not just the one under the pointer: which pads are one plug
      // is the question a connector exists to answer, and lighting them together is the answer.
      const onHoveredPlug =
        hoveredConnector !== null &&
        el.closest("[data-connector]")?.getAttribute("data-connector") === hoveredConnector;
      const attr = el.getAttribute("data-gpio");
      const power = el.getAttribute("data-pin");
      const inUse = attr !== null && assigned.has(Number(attr));
      const colour =
        power !== null
          ? powerColourFor(power, pinVcc, pinGnd, pinPower)
          : inUse
            ? pinUsed
            : pinFree;
      el.style.fill = colour;
      el.style.fillOpacity = onHoveredPlug ? "1" : inUse ? "0.45" : "0.85";
      el.style.stroke = onHoveredPlug ? theme.palette.text.primary : colour;
      el.style.strokeWidth = onHoveredPlug ? "6" : inUse ? "5" : "3";
    });
  }, [
    assignedKey,
    diagram.svgMarkup,
    pinUsed,
    pinFree,
    pinVcc,
    pinGnd,
    pinPower,
    hoveredConnector,
    theme.palette.text.primary,
  ]);

  const placements: Placement[] = [];
  if (measured) {
    const middle = (measured.imageLeft + measured.imageRight) / 2;
    for (const pin of measured.pins) {
      const matched = pin.gpio === null ? undefined : matchByGpio.get(pin.gpio);
      // An assignment is what the pad is doing now and so wins; the sheet's label is what it is for,
      // and on a power pad it is all there is. A pad with neither still gets no leader line - an
      // unlabelled GND is the same name on every connector, and six of them would crowd out the
      // labels worth reading.
      const label = matched ? matched.map((r) => r.label).join(" / ") : pin.label;
      if (!label) continue;
      placements.push({
        gpio: pin.gpio,
        key: `${pin.gpio ?? pin.power}@${pin.x},${pin.y}`,
        label,
        authored: !matched,
        connector: pin.connector,
        pinX: pin.x,
        pinY: pin.y,
        side: pin.x < middle ? "left" : "right",
        labelY: pin.y,
      });
    }
    stack(placements.filter((p) => p.side === "left"), "left", measured.height);
    stack(placements.filter((p) => p.side === "right"), "right", measured.height);
  }

  return (
    <Box sx={{ width: "100%", maxWidth: 2 * GUTTER + ART_WIDTH }}>
      {/* One positioning context for the art, the markers, the leader lines and the labels, so a
          pin measured here lands where its label and line are drawn. */}
      <Box ref={hostRef} sx={{ position: "relative", width: "100%" }}>
        <Box sx={{ px: `${GUTTER}px` }}>
          <Box ref={artRef} sx={{ position: "relative" }}>
            <Box
              ref={artSheetRef}
              sx={{ "& > svg": { width: "100%", height: "auto", display: "block" } }}
            />
            {/* Stretched over the image, and its viewBox is the image's pixel size, so a marker at
                (cx, cy) lands on the same pixel of the render at any display width. */}
            <Box
              ref={sheetRef}
              sx={{
                position: "absolute",
                inset: 0,
                "& > svg": { width: "100%", height: "100%", display: "block" },
              }}
            />
          </Box>
        </Box>

        <Box
          component="svg"
          sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
        >
          {placements.map(({ key, authored, side, pinX, pinY, labelY }) => {
            const end = side === "left" ? measured!.imageLeft - 6 : measured!.imageRight + 6;
            const bend = side === "left" ? end + 18 : end - 18;
            const stroke = authored ? theme.palette.text.secondary : theme.palette.primary.main;
            return (
              <g key={key} opacity={authored ? 0.55 : 0.85}>
                <path
                  d={`M ${pinX},${pinY} L ${bend},${labelY} L ${end},${labelY}`}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={authored ? 1.5 : 2.25}
                  strokeLinejoin="round"
                />
                {/* Lands the line in one unambiguous pad. Where several sit at connector pitch, the
                    line alone points into the whole cluster. */}
                <circle cx={pinX} cy={pinY} r={3} fill={stroke} />
              </g>
            );
          })}
        </Box>

        {/* Over the sheet, so every pad answers what it is - including the ones no control is on,
            which the labels necessarily say nothing about. */}
        {measured?.pins.map((pad, i) => {
          const { gpio, power, x, y, size } = pad;
          const matched = gpio === null ? undefined : matchByGpio.get(gpio);
          const title = padTitle(pad, matched?.map((r) => r.label).join(" / "));
          return (
            <Tooltip key={`${gpio ?? power}-${i}`} title={title}>
              <Box
                onMouseEnter={() => setHoveredConnector(pad.connector ?? null)}
                onMouseLeave={() => setHoveredConnector(null)}
                sx={{
                  position: "absolute",
                  left: x,
                  top: y,
                  width: size,
                  height: size,
                  transform: "translate(-50%, -50%)",
                  borderRadius: "50%",
                  cursor: "help",
                  "&:hover": {
                    boxShadow: `0 0 0 2px ${power
                      ? powerColourFor(power, pinVcc, pinGnd, pinPower)
                      : matched
                        ? pinUsed
                        : pinFree
                      }`,
                  },
                }}
              />
            </Tooltip>
          );
        })}

        {placements.map(({ key, gpio, label, authored, connector, side, labelY }) => (
          <Tooltip key={key} title={gpio === null ? label : `${label} — GP${gpio}`}>
            <Typography
              variant="caption"
              sx={{
                position: "absolute",
                top: labelY,
                transform: "translateY(-50%)",
                lineHeight: 1.2,
                fontWeight: authored ? 400 : 600,
                color: authored ? "text.secondary" : "primary.main",
                cursor: "help",
                ...(side === "left"
                  ? { left: 0, width: measured!.imageLeft - 12, textAlign: "right" }
                  : { left: measured!.imageRight + 12, width: GUTTER - 12, textAlign: "left" }),
              }}
            >
              {label}
              {/* A power pad has no number to give, so it is the label and nothing else. */}
              {gpio !== null && (
                <Box component="span" sx={{ color: "text.disabled", fontWeight: 400 }}>
                  {" "}
                  GP{gpio}
                </Box>
              )}
              {/* And which plug it arrives on, coloured by what kind of plug that is. On every row
                  rather than once per group: a row is read on its own, and the one thing you want
                  beside a pin is the connector you will find it in. */}
              {connector && (
                <Box
                  component="span"
                  sx={{
                    display: "inline-block",
                    ml: 0.5,
                    px: 0.4,
                    borderRadius: "3px",
                    fontSize: 9,
                    fontWeight: 700,
                    lineHeight: 1.45,
                    letterSpacing: "0.02em",
                    whiteSpace: "nowrap",
                    verticalAlign: "middle",
                    color: CHIP_COLOURS[connectorKind(connector)](theme),
                    bgcolor: alpha(CHIP_COLOURS[connectorKind(connector)](theme), 0.16),
                    border: `1px solid ${alpha(CHIP_COLOURS[connectorKind(connector)](theme), 0.4)}`,
                  }}
                >
                  {shortPlugName(connector)}
                </Box>
              )}
            </Typography>
          </Tooltip>
        ))}
      </Box>

      {/* The pins with no pad to point at, said in words instead - otherwise a board's own wiring is
          the one part of its pinout the drawing never mentions. */}
      {internal.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
          Wired on the board, not brought out:{" "}
          {internal
            .map(({ gpio, wiredTo }) => `${labels.get(wiredTo!) ?? wiredTo} (GP${gpio})`)
            .join(", ")}
          .
        </Typography>
      )}

      <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 1 }}>
        Read-only — edit in the table.
      </Typography>
    </Box>
  );
}
