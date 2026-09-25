// Re-evaluating the firmware's declarative `visibleWhen` rules against the form's current values.
//
// The device answers "is this row visible" once, when it builds a DUMP_SCHEMA. Every edit after
// that leaves the answer stale until the next dump, which is a whole round trip and a reboot away
// for anything that reboots. So the firmware publishes the *rule* next to its answer, and this
// re-runs it as the user types.
//
// Two things keep that honest, and both are load-bearing:
//
//   * Only rows carrying a rule are re-evaluated. Fifteen bindings deliberately carry none: their
//     visibility follows a resolved pin or a board property, and both are settled at boot from the
//     post-conflict wiring. Re-deriving one from unsaved form state would show, say, a Boot Action
//     row for a pin the device never attached.
//   * A rule whose term names nothing readable keeps the device's own answer. A profile that has
//     not loaded yet, or a key this console cannot resolve, is a reason to defer to the device
//     rather than to guess - guessing here hides a row the user is looking for.
//
// The rule is the device's own, published in the schema - not a second opinion about it.

import { getByKey } from "./keyPath";
import type { Schema, SchemaNode, VisibilityTerm } from "./types";

/** The two stored payloads a rule can read, keyed by the store prefix its terms use. */
export interface VisibilityPayloads {
  device: unknown;
  profile: unknown;
}

/**
 * One term's verdict, or null when its key names nothing in the payloads.
 *
 * The stored value is a JSON boolean for a toggle and a name for an enum, while the rule spells
 * both as a string - so the boolean is normalised rather than the rule carrying two encodings.
 */
export function termHolds(term: VisibilityTerm, payloads: VisibilityPayloads): boolean | null {
  const source = term.key.startsWith("device:") ? payloads.device : payloads.profile;
  const actual = getByKey(source, term.key);
  if (actual === undefined || actual === null) return null;

  // String() covers both: a JSON boolean becomes "true"/"false", an enum's stored id is already
  // the string the rule carries.
  const same = String(actual) === term.value;
  return term.op === "ne" ? !same : same;
}

/** A node's whole rule, or null when any term names nothing readable. Terms are ANDed. */
export function ruleHolds(
  terms: VisibilityTerm[] | undefined,
  payloads: VisibilityPayloads,
): boolean | null {
  if (!terms?.length) return null;
  let all = true;
  for (const term of terms) {
    const held = termHolds(term, payloads);
    if (held === null) return null;
    all = all && held;
  }
  return all;
}

/**
 * A copy of `nodes` with `visible` recomputed wherever a rule says so.
 *
 * `visible` keeps its "absent means true" encoding rather than being written as a boolean, so
 * everything downstream goes on reading it exactly as it reads a node straight off the wire.
 */
export function resolveNodes(nodes: SchemaNode[], payloads: VisibilityPayloads): SchemaNode[] {
  let moved = false;

  const out = nodes.map((node) => {
    const held = ruleHolds(node.visibleWhen, payloads);
    const wants = held === null ? node.visible : held ? undefined : (false as const);
    const children = node.children ? resolveNodes(node.children, payloads) : undefined;

    if (wants === node.visible && children === node.children) return node;
    moved = true;

    const next: SchemaNode = { ...node };
    if (wants === undefined) delete next.visible;
    else next.visible = wants;
    if (children) next.children = children;
    return next;
  });

  // Identity is the memoisation signal downstream: every edit re-runs this, and only the handful of
  // rows with a rule should force the sections to be rebuilt.
  return moved ? out : nodes;
}

/** The schema as it applies to the values currently in the form. */
export function resolveVisibility(schema: Schema, payloads: VisibilityPayloads): Schema {
  const tree = resolveNodes(schema.tree, payloads);
  return tree === schema.tree ? schema : { ...schema, tree };
}
