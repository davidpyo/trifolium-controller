// Rearranges the schema's sections into the curated layout, without losing anything.

import { isConfigField, isVisible, type SchemaNode } from "../schema/types";
import { FALLTHROUGH_LABEL, RENDERED_ELSEWHERE, type SectionSpec } from "./layout";
import { layoutChildren } from "./sections";

/** A field, plus the group it came from, so a group's own sub-structure can be preserved. */
interface Located {
  node: SchemaNode;
  /** Ancestor groups between the section root and this field, outermost first. */
  path: SchemaNode[];
}

function collect(node: SchemaNode, path: SchemaNode[], out: Located[]): void {
  for (const child of layoutChildren(node)) {
    if (child.kind === "group") collect(child, [...path, child], out);
    else if (isConfigField(child) && child.key) out.push({ node: child, path });
  }
}

/**
 * Rebuilds a subtree containing exactly the given fields, preserving the group nesting they came
 * from.
 *
 * Nesting is kept because it carries meaning the flat key list does not: "Motor 1" as a group is
 * what lets the matrix layout recognise the four motors as repetitions of one shape.
 */
function rebuild(label: string, located: Located[]): SchemaNode {
  const root: SchemaNode = { label, kind: "group", children: [] };

  for (const { node, path } of located) {
    let cursor = root;
    for (const ancestor of path) {
      let next = (cursor.children ?? []).find(
        (c) => c.kind === "group" && c.label === ancestor.label,
      );
      if (!next) {
        next = { ...ancestor, children: [] };
        cursor.children = [...(cursor.children ?? []), next];
      }
      cursor = next;
    }
    cursor.children = [...(cursor.children ?? []), node];
  }
  return root;
}

/**
 * Applies a layout to the schema's sections for one store.
 *
 * Returns sections in the layout's order, then one trailing section holding every field the layout
 * did not mention. That trailing section is the safety net: a field added in firmware appears there
 * rather than vanishing because this file has not been updated.
 */
export function applyLayout(sections: SchemaNode[], specs: SectionSpec[]): SchemaNode[] {
  const located: Located[] = [];
  for (const section of sections.filter(isVisible)) {
    collect(section, [], located);
  }

  const byKey = new Map<string, Located>();
  for (const item of located) {
    // The same field is reachable by more than one path (shortcuts, submenus mounted twice); the
    // first sighting wins, which is the order the firmware lists them in.
    if (!byKey.has(item.node.key!)) byKey.set(item.node.key!, item);
  }

  // Claimed before anything else, so a field another component renders cannot also fall through
  // into the trailing section and appear twice.
  const claimed = new Set<string>(Object.keys(RENDERED_ELSEWHERE));
  const out: SchemaNode[] = [];

  for (const spec of specs) {
    const picked: Located[] = [];

    for (const key of spec.keys) {
      const hit = byKey.get(key);
      if (hit && !claimed.has(key)) {
        // Keyed picks are flattened: the layout has already named the section, so keeping the
        // firmware's ancestor group would nest "Display" inside "Display". Absorbed sections below
        // keep their nesting, because there it carries meaning - "Motor 1".."Motor 4" as sibling
        // groups is what lets the matrix layout recognise them as repetitions of one shape.
        picked.push({ node: hit.node, path: [] });
        claimed.add(key);
      }
    }

    for (const from of spec.absorb ?? []) {
      const source = sections.find((s) => s.label === from);
      if (!source) continue;
      const fromSection: Located[] = [];
      collect(source, [], fromSection);
      for (const item of fromSection) {
        if (claimed.has(item.node.key!)) continue;
        picked.push(item);
        claimed.add(item.node.key!);
      }
    }

    if (picked.length) out.push(rebuild(spec.label, picked));
  }

  const leftovers = [...byKey.values()].filter((i) => !claimed.has(i.node.key!));
  if (leftovers.length) out.push(rebuild(FALLTHROUGH_LABEL, leftovers));

  return out;
}
