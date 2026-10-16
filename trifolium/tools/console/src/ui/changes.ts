// Staged edits as a reviewer reads them: which setting, where it lives, what it was and what it will be.
//
// The dirty set only records *that* a key was edited. What it was comes from the baseline - the values
// as the device last reported them - so a change can be shown as "was 20 → 22" and put back exactly.

import { getByKey } from "../schema/keyPath";
import { optionIndexFor } from "../schema/enumValue";
import { walk, type Schema, type SchemaNode } from "../schema/types";

export interface Values {
  device: unknown;
  profiles: unknown[];
}

/** Where a change is edited, for the review sheet's link back to it. */
export type ChangeView = "overview" | "profiles" | "blaster" | "wiring";

export interface Change {
  /** The dirty mark: "device:key", or "slot:profile:key". */
  mark: string;
  /** The schema key, without the slot. */
  key: string;
  /** null for the device store, else the profile slot. */
  slot: number | null;
  label: string;
  /** The section or group it sits in, for context under the label. */
  where: string;
  from: string;
  to: string;
  view: ChangeView;
  /** The row is not shown with the current settings, but the edit is still written. */
  hidden: boolean;
}

/** "1:profile:name" -> [1, "profile:name"]; "device:x" -> [null, "device:x"]. */
export function splitMark(mark: string): [number | null, string] {
  if (mark.startsWith("device:")) return [null, mark];
  const at = mark.indexOf(":");
  return [Number(mark.slice(0, at)), mark.slice(at + 1)];
}

const FIRE_MODES = "profile:fireModes";
const MODE_COUNT = "profile:activeModeCount";

/** Every keyed node, with the labels of the groups above it. */
function indexTree(tree: SchemaNode[]): Map<string, { node: SchemaNode; groups: string[] }> {
  const out = new Map<string, { node: SchemaNode; groups: string[] }>();
  walk(tree, (node, path) => {
    if (node.key && !out.has(node.key)) {
      out.set(node.key, {
        node,
        groups: path.filter((p) => p.kind === "group").map((p) => p.label),
      });
    }
  });
  return out;
}

/**
 * The units a label can end in. A list rather than "any parenthesis", because labels also end in
 * a qualifier - Idle RPM (Custom), Stage 1 (M2, M4), Motor 3 (off) - that is part of the name.
 */
const UNITS = new Set(["ms", "s", "mV", "V", "mV/cell", "RPM", "%", "dps"]);

/** A label the console shows without its unit, which a field carries as an adornment instead. */
export function splitUnit(label: string): { name: string; unit?: string } {
  const m = /^(.*\S)\s*\(([^()]+)\)$/.exec(label);
  return m && UNITS.has(m[2]) ? { name: m[1], unit: m[2] } : { name: label };
}

/** A stored value as a reviewer reads it, in the unit its row shows. */
export function formatValue(node: SchemaNode | undefined, value: unknown): string {
  if (value === undefined || value === null) return "not set";
  if (!node) return typeof value === "object" ? JSON.stringify(value) : String(value);
  switch (node.kind) {
    case "bool":
      return value === true ? "On" : "Off";
    case "enum": {
      const i = optionIndexFor(node, value);
      return node.options?.[i] ?? String(value);
    }
    case "text":
      return value === "" ? "(blank)" : String(value);
    case "int":
    case "float": {
      if (node.display === "pin") return value === (node.hi ?? 255) ? "unused" : `GPIO ${value}`;
      if (node.display === "seconds" && typeof value === "number") return `${value / 1000} s`;
      const unit = splitUnit(node.label).unit;
      return unit ? `${value} ${unit}` : String(value);
    }
    default:
      return String(value);
  }
}

const modeNames = (modes: unknown): string => {
  if (!Array.isArray(modes) || !modes.length) return "none";
  return modes
    .map((m) => {
      const mode = m as { name?: string; burstMode?: string };
      return mode.name?.trim() || String(mode.burstMode ?? "?").toUpperCase();
    })
    .join(" · ");
};

/**
 * The staged edits, device first and then each slot in turn, in the order a write sends them.
 *
 * A fire-mode list that changed length is one change, not one per field: it is written as a whole
 * array, and reverted as one.
 */
export function listChanges(args: {
  schema: Schema;
  dirty: ReadonlySet<string>;
  baseline: Values;
  current: Values;
  /** Keys whose rows the form is not showing with the current settings. */
  hiddenKeys: ReadonlySet<string>;
  /** Device keys that live on the Wiring page. */
  wiringKeys: ReadonlySet<string>;
  /** Section label by key, from the laid-out form; falls back to the tree's own groups. */
  sectionOf?: (key: string) => string | undefined;
}): Change[] {
  const { schema, dirty, baseline, current, hiddenKeys, wiringKeys, sectionOf } = args;
  const tree = indexTree(schema.tree);
  // The tree names fire-mode fields only for the modes the active profile has, so a field of a mode
  // added since is found by its leaf instead.
  const modeLeaves = new Map<string, SchemaNode>();
  for (const [key, { node }] of tree) {
    const leaf = /^profile:fireModes\[\d+\]\.(\w+)$/.exec(key)?.[1];
    if (leaf && !modeLeaves.has(leaf)) modeLeaves.set(leaf, node);
  }
  const wholeModes = new Set(
    [...dirty].filter((m) => m.endsWith(`:${FIRE_MODES}`)).map((m) => splitMark(m)[0]),
  );

  const out: Change[] = [];
  for (const mark of dirty) {
    const [slot, key] = splitMark(mark);
    if (slot !== null && wholeModes.has(slot)) {
      if (key === MODE_COUNT || key.startsWith(`${FIRE_MODES}[`)) continue;
    }
    const before = slot === null ? baseline.device : baseline.profiles[slot];
    const after = slot === null ? current.device : current.profiles[slot];

    if (key === FIRE_MODES) {
      out.push({
        mark,
        key,
        slot,
        label: "Fire modes",
        where: "Fire Modes",
        from: modeNames(getByKey(before as never, key)),
        to: modeNames(getByKey(after as never, key)),
        view: "profiles",
        hidden: false,
      });
      continue;
    }

    const found = tree.get(key);
    const modeIndex = /^profile:fireModes\[(\d+)\]\.(\w+)$/.exec(key);
    const node = found?.node ?? (modeIndex ? modeLeaves.get(modeIndex[2]) : undefined);
    const groups = found?.groups ?? [];
    const leafLabel = node ? splitUnit(node.label).name : (key.split(/[:.]/).pop() ?? key);
    // A field inside a repeated group (Motor 2, Mode 3) is named for its group as well, since the
    // label alone - KP, Target DPS - is ambiguous across the set.
    const parent = groups.length > 1 ? groups[groups.length - 1] : undefined;
    const label = modeIndex
      ? `Mode ${Number(modeIndex[1]) + 1} · ${leafLabel}`
      : parent && /\d/.test(parent)
        ? `${parent} · ${leafLabel}`
        : leafLabel;

    out.push({
      mark,
      key,
      slot,
      label,
      where: sectionOf?.(key) ?? (modeIndex ? "Fire Modes" : (groups[0] ?? "")),
      from: formatValue(node, getByKey(before as never, key)),
      to: formatValue(node, getByKey(after as never, key)),
      view:
        slot !== null
          ? "profiles"
          : wiringKeys.has(key)
            ? "wiring"
            : key === "device:blasterName"
              ? "overview"
              : "blaster",
      hidden: hiddenKeys.has(key),
    });
  }

  const order = (c: Change) => (c.slot === null ? -1 : c.slot);
  out.sort((a, b) => order(a) - order(b));
  return out;
}

/** What one store is called in the review. */
export const storeTitle = (slot: number | null, profileName: (slot: number) => string): string =>
  slot === null ? "Blaster settings" : `Profile ${profileName(slot)}`;

/**
 * The marks a revert of `mark` clears. Reverting a whole fire-mode list also clears the per-field
 * marks inside it and its count, which only ever move with it.
 */
export function marksToRevert(mark: string, dirty: ReadonlySet<string>): string[] {
  const [slot, key] = splitMark(mark);
  if (key !== FIRE_MODES) return [mark];
  const prefix = `${slot}:`;
  return [...dirty].filter(
    (m) => m === mark || m === `${prefix}${MODE_COUNT}` || m.startsWith(`${prefix}${FIRE_MODES}[`),
  );
}

/**
 * A folded section's one line: its first few settings and their values, so it can stay folded and
 * still say what it holds.
 */
export function sectionSummary(
  section: SchemaNode,
  valueOf: (key: string) => unknown,
  limit = 4,
): string {
  const parts: string[] = [];
  walk([section], (node) => {
    if (parts.length >= limit || !node.key || node.kind === "group" || node.visible === false)
      return;
    if (node.storage) return; // derived and live rows hold no value of their own
    parts.push(`${splitUnit(node.label).name} ${formatValue(node, valueOf(node.key))}`);
  });
  return parts.join(" · ");
}
