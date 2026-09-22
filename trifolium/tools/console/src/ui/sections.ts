// Turning the firmware's menu tree into a layout suited to a real screen.
//
// The tree is shaped for a 128x64 OLED: everything nested under "Advanced", four separate Motor
// submenus you scroll between, aliases at the root so common settings are reachable in one click,
// and alternative *views* of the same storage so one screen can edit four motors at once.
//
// The rules below are structural, not name-based. Nothing matches on "Advanced" or "Motor 1", so a
// firmware that renames or reorganises a group still lays out sensibly.

import { isFireModeRow, isVisible, isConfigField, type SchemaNode } from "../schema/types";

export type Store = "device" | "profile";

export const storeOfKey = (key: string): Store =>
  key.startsWith("device:") ? "device" : "profile";

/**
 * Children to lay out: whatever the device says is visible, group or field alike.
 *
 * A hidden group in this firmware is one half of a view toggle - Per Motor RPM versus Per Stage RPM,
 * Idle RPM Custom versus Stage. Both halves write the same storage, so the inactive one is a second
 * way of spelling values the active one already sets.
 *
 * Those groups used to be kept and marked inactive, on the grounds that a browser has room for both
 * where a 128x64 screen does not. That was the wrong trade: it puts two editors for one setting on
 * screen at once, only one of which the blaster is reading, and nothing about "inactive" tells a
 * reader which. Nothing is lost by dropping it - switching RPM Mode back brings the other view and
 * its values straight back, because the values were never the view's to begin with.
 */
export const layoutChildren = (node: SchemaNode): SchemaNode[] =>
  (node.children ?? [])
    .filter(isVisible)
    // Fire-mode rows have a purpose-built editor. The firmware emits one set per mode, with the
    // index resolved, so without this every mode's fields would also appear in the generic form.
    // This is the single choke point the form builders share, so excluding them here covers
    // countFields, pruneToStore, the matrix detector and applyLayout at once.
    .filter((c) => !isFireModeRow(c.key));

const groupChildren = (node: SchemaNode): SchemaNode[] =>
  (node.children ?? []).filter(isVisible);

/**
 * The top-level sections.
 *
 * A group whose visible children are *all* groups is a container rather than a section, so its
 * children are promoted. That unwraps "Advanced" without naming it.
 *
 * Root-level non-groups are dropped: those are the on-device shortcuts, which exist to save
 * scrolling and duplicate a field that appears again in its real home.
 */
export function deriveSections(tree: SchemaNode[]): SchemaNode[] {
  const sections: SchemaNode[] = [];
  for (const node of tree.filter(isVisible)) {
    if (node.kind !== "group") continue;
    const kids = groupChildren(node);
    const isContainer = kids.length > 0 && kids.every((k) => k.kind === "group");
    if (isContainer) sections.push(...kids);
    else sections.push(node);
  }
  return sections;
}

/** Config fields in a subtree, so sections with nothing to edit can be left out. */
export function countFields(node: SchemaNode): number {
  let n = isConfigField(node) ? 1 : 0;
  for (const child of layoutChildren(node)) n += countFields(child);
  return n;
}

/**
 * Copy of a subtree containing only fields belonging to one store, or null if none remain.
 *
 * Sections span both stores - Flywheel / RPM holds profile RPM targets next to device-wide
 * tolerances - but the two are written by different commands with different schema versions and
 * different reboot consequences. Splitting them by store means a tab maps to exactly one write.
 */
export function pruneToStore(node: SchemaNode, store: Store): SchemaNode | null {
  if (node.kind === "group") {
    const kids = layoutChildren(node)
      .map((k) => pruneToStore(k, store))
      .filter((k): k is SchemaNode => k !== null);
    return kids.length ? { ...node, children: kids } : null;
  }
  if (!isConfigField(node) || !node.key) return null;
  return storeOfKey(node.key) === store ? node : null;
}

/**
 * Detects sibling groups that repeat one shape - the four Motor submenus - so they can be laid out
 * as a matrix with a column per instance instead of four near-identical panels.
 *
 * Identified by the child label sequence matching across siblings, which is true of a repeated
 * structure and vanishingly unlikely otherwise.
 */
export function repeatedGroups(group: SchemaNode): SchemaNode[] | null {
  const groups = layoutChildren(group).filter((k) => k.kind === "group");
  if (groups.length < 2) return null;

  const shape = (g: SchemaNode) =>
    layoutChildren(g)
      .map((c) => `${c.kind}:${c.label}`)
      .join("|");

  const first = shape(groups[0]);
  if (!first) return null;
  if (!groups.every((g) => shape(g) === first)) return null;

  return groups.some((g) => countFields(g) > 0) ? groups : null;
}

/** Field rows of a repeated set, taken from the first instance since they share a shape. */
export function matrixRows(groups: SchemaNode[]): SchemaNode[] {
  return layoutChildren(groups[0]).filter(isConfigField);
}

/** Children of a group that are not part of a detected matrix. */
export function nonMatrixChildren(group: SchemaNode, matrix: SchemaNode[] | null): SchemaNode[] {
  const inMatrix = new Set(matrix ?? []);
  return layoutChildren(group).filter((c) => !inMatrix.has(c));
}
