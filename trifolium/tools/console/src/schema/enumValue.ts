import type { SchemaNode } from "./types";

/**
 * Two kinds of node arrive with `kind: "enum"`, and they store their value differently.
 *
 * A node the firmware gave `optionValues` is backed by a C++ enum, and its config value is a
 * stable name ("esc_passthrough") rather than an ordinal - see the firmware's `enumIds.h`. The ids
 * are parallel to `options`, so moving between the two is a lookup.
 *
 * A node without `optionValues` stores a number, because there the number *is* the meaning: a fire
 * mode index, a profile index. Those use `lo` as the base, which matters for switch position
 * assignment - it stores -1 for "Default" (NO_FIRE_MODE) with mode indices from 0, so its options
 * list is one longer than its value span and everything is shifted by one.
 */

/** Which option is currently selected. Falls back to the first option when nothing matches. */
export function optionIndexFor(node: SchemaNode, value: unknown): number {
  const options = node.options ?? [];
  const ids = node.optionValues;

  if (ids) {
    const index = ids.indexOf(typeof value === "string" ? value : "");
    return index >= 0 ? index : 0;
  }

  const base = node.lo ?? 0;
  const stored = typeof value === "number" ? value : base;
  return Math.min(Math.max(stored - base, 0), Math.max(options.length - 1, 0));
}

/**
 * The node with each profile-slot option (id `profile_<n>`) followed by the name of the profile in
 * that slot - "Slot 1 · Low". The firmware's labels stop at the slot number, which is all an OLED row
 * has room for. A slot whose profile has no name, or has not been read, keeps its label.
 */
export function withSlotNames(
  node: SchemaNode,
  names: readonly (string | undefined)[],
): SchemaNode {
  const ids = node.optionValues;
  if (!ids || !node.options) return node;
  let named = false;
  const options = node.options.map((label, i) => {
    const slot = /^profile_(\d+)$/.exec(ids[i] ?? "");
    const name = slot ? names[Number(slot[1])]?.trim() : undefined;
    if (!name) return label;
    named = true;
    return `${label} · ${name}`;
  });
  return named ? { ...node, options } : node;
}

/**
 * An index picker's node - a fire mode or a profile slot - with one option per entry in `names`,
 * the list as edited here. The firmware lists what it held when it last described itself, so a mode
 * added or a profile renamed since would not show until written. The options below `lo` 0 - a
 * position's "Default" - stay first.
 */
export function withIndexOptions(node: SchemaNode, names: readonly string[]): SchemaNode {
  const lead = (node.options ?? []).slice(0, Math.max(0, -(node.lo ?? 0)));
  return { ...node, options: [...lead, ...names], hi: names.length - 1 };
}

/** What to write for the option at `index` - an id for an id-valued node, a number otherwise. */
export function optionValueAt(node: SchemaNode, index: number): string | number {
  const ids = node.optionValues;
  if (ids) {
    return ids[index] ?? "";
  }
  return index + (node.lo ?? 0);
}
