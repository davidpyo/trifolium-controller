// What the hookup view draws: the parts this configuration uses, each lead of each part, and the
// pad (or other part) that lead is wired to.
//
// Pure, like everything the view draws from. The settings say which parts there are and which GPIO
// each signal is on; the marker sheet says where that GPIO's pad is and which plug it shares with a
// ground or supply pad. A part's ground goes to the ground in its own plug where the board has one,
// which is how the board is meant to be wired, and to the nearest logic ground where it does not.
//
// Rows are discovered here as they are in the table: a pin setting this file has no picture for is
// still drawn, as a plain labelled plug, so a firmware that adds a control is never silently left
// off the diagram.

import { getByKey } from "../../schema/keyPath";
import { isVisible, type Schema } from "../../schema/types";
import type { DiagramMarker } from "../../schema/wiringDiagrams";
import { collectWiring } from "../WiringTable";
import type { Pad, PadSheet } from "./pads";

/** 255 is the firmware's "unused" sentinel. */
const UNUSED = 255;

/** What a wire carries, which is all its colour says. */
export type Net = "signal" | "gnd" | "vcc";

export type PartKind =
  | "microswitch"
  | "button"
  | "selector"
  | "pot"
  | "oled"
  | "esc"
  | "solenoid"
  | "driver"
  | "led"
  | "battery"
  | "plug";

export type Target =
  | { kind: "pad"; pad: Pad }
  | { kind: "part"; part: string; lead: string }
  /** Nothing on this board to wire it to; `text` says what it wanted. */
  | { kind: "missing"; text: string };

export interface Lead {
  /** Unique within its part. */
  id: string;
  /** The name printed beside the leg, where a real part marks it: C, NO, NC, +, SDA... */
  leg?: string;
  net: Net;
  /**
   * The edge the leg leaves the part from: towards the board, or away from it underneath, which is
   * where power leads go so they do not cross the signal side on their way to the battery.
   */
  edge: "board" | "under";
  /** The GPIO the lead carries, on a signal. */
  gpio?: number;
  /** Null for a leg that is there but not wired, like the NC leg of a normally open switch. */
  target: Target | null;
}

export interface Part {
  id: string;
  kind: PartKind;
  label: string;
  /** A second line, quieter: "normally closed", "on ESC 3", "4S". */
  note?: string;
  leads: Lead[];
}

export interface Hookup {
  parts: Part[];
  sheet: PadSheet;
  /** True when the board has no drawing and `sheet` was made up to suit the parts. */
  generic: boolean;
}

// What a lead wants before there is a sheet to find it on.
type Want =
  | { kind: "gpio"; gpio: number }
  | { kind: "ground"; near?: number }
  /**
   * A supply pad. `only` refuses anything not named for that voltage, for a part that must never
   * see another: a speed pot's wiper is an ADC pin, which 5 V damages.
   */
  | { kind: "supply"; near?: number; prefer?: RegExp; only?: RegExp }
  | { kind: "battery"; side: "+" | "-" }
  | { kind: "solenoid"; side: "+" | "-" }
  | { kind: "plug"; connector: RegExp; side: "+" | "-" }
  | { kind: "part"; part: string; lead: string }
  | { kind: "none" };

interface LeadSpec extends Omit<Lead, "target"> {
  want: Want;
}

interface PartSpec extends Omit<Part, "leads"> {
  leads: LeadSpec[];
  /** Which side of a made-up board it belongs on: inputs left, outputs right. */
  output?: boolean;
}

const SWITCHES = ["trigger", "rev", "cycle", "dart", "idle", "safety"] as const;

const isBatteryPad = (p: Pad) => /batt/i.test(p.label ?? "") || /xt30 in|batt/i.test(p.connector ?? "");
const isSolenoidPad = (p: Pad) =>
  /solenoid/i.test(p.label ?? "") || /xt30 out|solenoid/i.test(p.connector ?? "");
/** Pads that carry pack current. A switch's ground does not belong on one. */
export const isHeavy = (p: Pad) => isBatteryPad(p) || isSolenoidPad(p) || /power|xt30/i.test(p.connector ?? "");
const isGround = (p: Pad) =>
  p.gpio === null &&
  /^(gnd|g|0v)$/i.test(p.power ?? "") &&
  // A switched return is a load's low side, not a ground to share.
  !/switched/i.test(p.label ?? "");
const isSupply = (p: Pad) =>
  p.gpio === null &&
  /^(vcc|v\+|5v|3v3|3\.3v|vbus|vsys)$/i.test(p.power ?? "") &&
  // A pad that power arrives on is not one to take it from.
  !/from/i.test(p.label ?? "");
const isPositive = (p: Pad) =>
  p.gpio === null && (/^(vcc|v\+|5v|3v3|vbat)$/i.test(p.power ?? "") || /\+/.test(p.label ?? ""));

const distance = (a: Pad, b: Pad) => Math.hypot(a.x - b.x, a.y - b.y);

/** The pad of `candidates` in `ref`'s plug, else the nearest to it, else the first. */
function nearest(candidates: Pad[], ref: Pad | undefined): Pad | undefined {
  if (!candidates.length) return undefined;
  if (!ref) return candidates[0];
  const samePlug = ref.connector ? candidates.filter((p) => p.connector === ref.connector) : [];
  const pool = samePlug.length ? samePlug : candidates;
  return pool.reduce((best, p) => (distance(p, ref) < distance(best, ref) ? p : best));
}

function resolve(want: Want, sheet: PadSheet): Target | null {
  const pads = sheet.pads;
  const heavy = (p: Pad) => !sheet.invented && isHeavy(p);
  const padFor = (gpio: number | undefined) =>
    gpio === undefined ? undefined : pads.find((p) => p.gpio === gpio);
  switch (want.kind) {
    case "none":
      return null;
    case "part":
      return { kind: "part", part: want.part, lead: want.lead };
    case "gpio": {
      const pad = padFor(want.gpio);
      return pad
        ? { kind: "pad", pad }
        : { kind: "missing", text: `GP${want.gpio} — not on board` };
    }
    case "ground": {
      const ref = padFor(want.near);
      // A ground for a signal that is not on the board is not near anything, and guessing one from
      // the far side of the board would be worse than saying so.
      const pad =
        want.near !== undefined && !ref
          ? undefined
          : nearest(pads.filter((p) => isGround(p) && !heavy(p)), ref);
      return pad ? { kind: "pad", pad } : { kind: "missing", text: "GND" };
    }
    case "supply": {
      const all = pads.filter(
        (p) =>
          isSupply(p) &&
          !heavy(p) &&
          (!want.only || want.only.test(p.power ?? "") || want.only.test(p.label ?? "")),
      );
      const ref = padFor(want.near);
      const inPlug = ref?.connector ? all.filter((p) => p.connector === ref.connector) : [];
      const preferred = want.prefer ? all.filter((p) => want.prefer!.test(p.power ?? "")) : [];
      const pad = nearest(inPlug.length ? inPlug : preferred.length ? preferred : all, ref);
      return pad ? { kind: "pad", pad } : { kind: "missing", text: "3V3" };
    }
    case "battery":
    case "solenoid":
    case "plug": {
      const all = pads.filter((p) =>
        want.kind === "battery"
          ? !sheet.invented && isBatteryPad(p)
          : want.kind === "solenoid"
            ? !sheet.invented && isSolenoidPad(p)
            : want.connector.test(p.connector ?? ""),
      );
      // Pads named for it before the rest of a plug named for it: a Diana's "Power and Solenoid"
      // plug has the ESCs' pads in it too, and the solenoid does not go on those.
      const named =
        want.kind === "plug" ? [] : all.filter((p) => (want.kind === "battery" ? /batt/i : /solenoid/i).test(p.label ?? ""));
      const group = named.length ? named : all;
      const pad = group.find((p) => (want.side === "+" ? isPositive(p) : !isPositive(p) && p.gpio === null));
      if (pad) return { kind: "pad", pad };
      return want.kind === "battery"
        ? null // A board with no battery pads is powered some other way; nothing to draw.
        : { kind: "missing", text: want.kind === "solenoid" ? "Solenoid output" : "LED" };
    }
  }
}

/** What the settings ask for, as parts whose leads say what they want rather than where it is. */
function specify(schema: Schema, device: unknown, internal: Set<number>): PartSpec[] {
  const read = (key: string) => getByKey(device as never, key);
  const assigned = new Map<string, { gpio: number; label: string }>();
  for (const row of collectWiring(schema)) {
    if (!row.pin?.key || !isVisible(row.pin)) continue;
    const value = read(row.pin.key);
    if (typeof value === "number" && value !== UNUSED) {
      assigned.set(row.pin.key, { gpio: value, label: row.label });
    }
  }
  const used = new Set<string>();
  const take = (key: string) => {
    used.add(key);
    return assigned.get(key);
  };

  const parts: PartSpec[] = [];
  const signal = (id: string, gpio: number, leg?: string): LeadSpec => ({
    id,
    leg,
    net: "signal",
    edge: "board",
    gpio,
    want: { kind: "gpio", gpio },
  });
  const ground = (id: string, near: number | undefined, leg?: string): LeadSpec => ({
    id,
    leg,
    net: "gnd",
    edge: "board",
    want: { kind: "ground", near },
  });
  const toBattery = (): LeadSpec[] => [
    { id: "+", leg: "+", net: "vcc", edge: "under", want: { kind: "part", part: "battery", lead: "+" } },
    { id: "-", leg: "−", net: "gnd", edge: "under", want: { kind: "part", part: "battery", lead: "-" } },
  ];

  const microswitch = (id: string, label: string, gpio: number, closed: boolean): PartSpec => ({
    id,
    kind: "microswitch",
    label,
    note: closed ? "normally closed" : undefined,
    leads: [
      ground("C", gpio, "C"),
      { ...signal("NO", gpio, "NO"), want: closed ? { kind: "none" } : { kind: "gpio", gpio } },
      { ...signal("NC", gpio, "NC"), want: closed ? { kind: "gpio", gpio } : { kind: "none" } },
    ],
  });

  // The switches.
  for (const name of SWITCHES) {
    const pin = take(`device:${name}SwitchPin`);
    if (!pin) continue;
    parts.push(
      microswitch(name, pin.label, pin.gpio, read(`device:${name}SwitchNormallyClosed`) === true),
    );
  }

  // The menu button, which on BUTTON select-fire may be the mode button as well.
  const selectType = read("device:selectFireType");
  const menu = take("device:menuButtonPin");
  const selects = [0, 1, 2].map((i) => take(`device:select${i}Pin`));
  const button = (id: string, label: string, gpio: number, closed: boolean, note?: string): PartSpec =>
    closed
      ? { ...microswitch(id, label, gpio, true), note }
      : {
          id,
          kind: "button",
          label,
          note,
          leads: [signal("S", gpio), ground("G", gpio)],
        };
  if (menu) {
    const doubles = selectType === "button" && selects[0]?.gpio === menu.gpio;
    parts.push(
      button(
        "menu",
        menu.label,
        menu.gpio,
        read("device:menuButtonNormallyClosed") === true,
        doubles ? "and mode button" : undefined,
      ),
    );
  }

  // The selector: positions to ground for SWITCH, a binary-coded rotary for ENCODER, one button for
  // BUTTON. Off and Screen read none of the select pins, so there is nothing to wire.
  const wiredSelects = selects
    .map((pin, i) => (pin ? { ...pin, index: i } : undefined))
    .filter((p): p is { gpio: number; label: string; index: number } => !!p);
  if ((selectType === "switch" || selectType === "encoder") && wiredSelects.length) {
    const encoder = selectType === "encoder";
    parts.push({
      id: "selector",
      kind: "selector",
      label: encoder ? "Select-fire encoder" : "Select-fire switch",
      leads: [
        ground("C", wiredSelects[0].gpio, "C"),
        // An encoder's lines are bits, select0 the lowest, counting only the wired lines.
        ...wiredSelects.map((p, bit) =>
          signal(`S${p.index}`, p.gpio, encoder ? String(1 << bit) : String(p.index + 1)),
        ),
      ],
    });
  } else if (selectType === "button" && selects[0] && selects[0].gpio !== menu?.gpio) {
    parts.push(button("mode", "Mode button", selects[0].gpio, false));
  }

  // The speed pot.
  const pot = take("device:speedPotPin");
  if (pot) {
    parts.push({
      id: "pot",
      kind: "pot",
      label: pot.label,
      note: read("device:speedPotReversed") === true ? "reversed" : undefined,
      leads: [
        // 3.3 V only: a board with no pad marked 3.3 V gets "3V3" to find, never a guess at VCC.
        { id: "+", leg: "+", net: "vcc", edge: "board", want: { kind: "supply", near: pot.gpio, only: /3v3|3\.3/i } },
        signal("W", pot.gpio, "W"),
        ground("-", pot.gpio, "−"),
      ],
    });
  }

  // The display.
  const sda = take("device:i2cSdaPin");
  const scl = take("device:i2cSclPin");
  if (read("device:hasDisplay") !== false && sda && scl) {
    parts.push({
      id: "oled",
      kind: "oled",
      label: "OLED display",
      leads: [
        ground("GND", sda.gpio, "GND"),
        { id: "VCC", leg: "VCC", net: "vcc", edge: "board", want: { kind: "supply", near: sda.gpio, prefer: /3v3|3\.3/i } },
        signal("SCL", scl.gpio, "SCL"),
        signal("SDA", sda.gpio, "SDA"),
      ],
    });
  }

  // The pusher, worked out before the ESCs because on ESC drive it takes one of their channels.
  const pusherType = read("device:pusherType");
  const hasPusher = typeof pusherType === "string" && pusherType !== "none";
  const pusherLabel = typeof pusherType === "string" && pusherType.startsWith("solenoid") ? "Solenoid" : "Pusher";
  const onEsc = read("device:pusherDrive") === "esc";
  const channel = onEsc ? Number(/(\d)/.exec(String(read("device:pusherEscChannel")))?.[1]) - 1 : -1;
  const fet = take("device:pusherFetPin");

  // The flywheel ESCs: one per wired channel whose motor is enabled.
  const motorCount = Array.isArray(read("device:escPins")) ? (read("device:escPins") as unknown[]).length : 4;
  for (let i = 0; i < motorCount; i++) {
    const pin = take(`device:escPins[${i}]`);
    if (!pin) continue;
    if (hasPusher && i === channel) {
      parts.push({
        id: "pusher",
        kind: "driver",
        label: `${pusherLabel} driver`,
        note: `on ESC ${i + 1} plug`,
        output: true,
        leads: [signal("S", pin.gpio, "S"), ground("G", pin.gpio, "G"), ...toBattery()],
      });
      continue;
    }
    if (read(`device:motorConfig[${i}].enabled`) === false) continue;
    parts.push({
      id: `esc${i}`,
      kind: "esc",
      label: `ESC ${i + 1}`,
      output: true,
      leads: [signal("S", pin.gpio, "S"), ground("G", pin.gpio, "G"), ...toBattery()],
    });
  }

  // The pusher on FET drive: the board's own FET where the pin is wired on the board, otherwise a
  // driver on whatever pad the pin is.
  if (hasPusher && !onEsc && fet) {
    if (internal.has(fet.gpio)) {
      parts.push({
        id: "pusher",
        kind: "solenoid",
        label: pusherLabel,
        note: "on the board's FET",
        output: true,
        leads: [
          { id: "+", leg: "+", net: "vcc", edge: "board", want: { kind: "solenoid", side: "+" } },
          { id: "-", leg: "−", net: "gnd", edge: "board", want: { kind: "solenoid", side: "-" } },
        ],
      });
    } else {
      parts.push({
        id: "pusher",
        kind: "driver",
        label: `${pusherLabel} driver`,
        output: true,
        leads: [signal("S", fet.gpio, "S"), ground("G", fet.gpio, "G"), ...toBattery()],
      });
    }
  }

  // The LED. A board that wires it itself brings it out on its own plug.
  const led = take("device:ledDataPin");
  if (led) {
    const own = internal.has(led.gpio);
    parts.push({
      id: "led",
      kind: "led",
      label: "LED",
      output: true,
      leads: own
        ? [
            { id: "+", leg: "+", net: "vcc", edge: "board", want: { kind: "plug", connector: /led/i, side: "+" } },
            { id: "-", leg: "−", net: "gnd", edge: "board", want: { kind: "plug", connector: /led/i, side: "-" } },
          ]
        : [signal("+", led.gpio, "+"), ground("-", led.gpio, "−")],
    });
  }

  // Anything else with a pin: a plug and a label. One the board wires itself needs nothing.
  for (const [key, pin] of assigned) {
    if (used.has(key) || internal.has(pin.gpio)) continue;
    parts.push({
      id: key,
      kind: "plug",
      label: pin.label,
      output: true,
      leads: [signal("S", pin.gpio)],
    });
  }

  // The pack, last so every lead that wants it already exists.
  const wantsBattery = parts.some((p) => p.leads.some((l) => l.want.kind === "part"));
  const batteryType = read("device:batteryType");
  parts.push({
    id: "battery",
    kind: "battery",
    label: "Battery",
    note: typeof batteryType === "string" ? `${batteryType.toUpperCase()} LiPo` : undefined,
    leads: [
      { id: "+", leg: "+", net: "vcc", edge: "board", want: { kind: "battery", side: "+" } },
      { id: "-", leg: "−", net: "gnd", edge: "board", want: { kind: "battery", side: "-" } },
    ],
    output: wantsBattery,
  });
  return parts;
}

/**
 * A board for a configuration with no drawing: a pad for every GPIO the parts use, with a ground
 * (and a supply, where the part takes one) beside them, in a plug named for the part - inputs down
 * the left edge and outputs down the right. It answers which pin each wire goes to, which is all a
 * board with no drawing can say. The schematic block spaces the plugs to line up with their parts.
 */
function inventSheet(parts: PartSpec[]): PadSheet {
  const pads: Pad[] = [];
  const rows = { left: 0, right: 0 };
  for (const part of parts) {
    if (part.kind === "battery") continue;
    const side = part.output ? "right" : "left";
    // In the order of the part's own legs, so no two of its wires cross on the way over.
    const own: Omit<Pad, "x" | "y" | "r" | "connector">[] = [];
    const has = (power: string) => own.some((p) => p.power === power);
    for (const lead of part.leads) {
      const want = lead.want;
      if (want.kind === "gpio") {
        if (!pads.some((p) => p.gpio === want.gpio) && !own.some((p) => p.gpio === want.gpio)) {
          own.push({ gpio: want.gpio });
        }
      } else if (want.kind === "supply" && !has("3V3")) own.push({ gpio: null, power: "3V3" });
      else if (want.kind === "ground" && !has("GND")) own.push({ gpio: null, power: "GND" });
    }
    for (const pad of own) pads.push({ ...pad, connector: part.label, x: side === "left" ? 0 : 1, y: rows[side]++, r: 0 });
  }
  return { viewBox: { x: 0, y: 0, w: 1, h: Math.max(rows.left, rows.right, 1) }, pads, invented: true };
}

export function buildHookup(
  schema: Schema,
  device: unknown,
  sheet: PadSheet | undefined,
  markers: DiagramMarker[] = [],
): Hookup {
  const internal = new Set(markers.filter((m) => m.wiredTo).map((m) => m.gpio));
  const specs = specify(schema, device, internal);
  const generic = !sheet;
  const board = sheet ?? inventSheet(specs);
  const wantsBattery = specs.some((s) => s.leads.some((l) => l.want.kind === "part"));
  const parts = specs
    .map(({ leads, output: _output, ...part }) => ({
      ...part,
      leads: leads.map(({ want, ...lead }) => ({ ...lead, target: resolve(want, board) })),
    }))
    // A battery with nothing to wire to is not worth drawing on its own.
    .filter((p) => p.kind !== "battery" || wantsBattery || p.leads.some((l) => l.target));
  return { parts, sheet: board, generic };
}

/** Every GPIO a part's leads carry, for lighting it from the table. */
export const gpiosOf = (part: Part): number[] =>
  part.leads.flatMap((l) => (l.gpio !== undefined && l.target ? [l.gpio] : []));
