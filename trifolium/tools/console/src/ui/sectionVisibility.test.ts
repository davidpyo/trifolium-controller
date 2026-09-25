// Does the *form* react to an edit, or only to a dump?
//
// resolveVisibility is tested on its own in schema/visibility.test.ts. This runs the whole pipeline
// the page actually uses - resolve, derive sections, prune to a store, apply the curated layout -
// and asserts against what the user would see. That is the question worth answering: a rule that
// evaluates correctly but never reaches the rendered sections would look identical to no rule.
//
// The device is never consulted. resolveVisibility is a pure function of the form's current values,
// so every assertion here is the state one keystroke after a click, not after a write and re-read.

import { describe, expect, it } from "vitest";
import { resolveVisibility } from "../schema/visibility";
import type { Schema, SchemaNode } from "../schema/types";
import { applyLayout } from "./applyLayout";
import { DEVICE_LAYOUT } from "./layout";
import { countFields, deriveSections, pruneToStore } from "./sections";
import schemaJson from "../fixtures/schema.json";
import deviceJson from "../fixtures/device.json";

const DISPLAY_ROWS = [
  "device:homeScreenDisplayMode",
  "device:showCurrentRpmOnHomeScreen",
  "device:showDpsOnHomeScreen",
  "device:displayBrightness",
  "device:rotateDisplay",
];

/**
 * The fixture with the Display rule attached, standing in for firmware built after MOH-10.
 *
 * The checked-in capture predates the rule, so asserting against it unmodified would only prove the
 * capture is old. What is under test is the console's half: given a device that publishes this rule,
 * does the form follow it.
 */
function withDisplayRule(schema: Schema): Schema {
  const rule = [{ key: "device:hasDisplay", op: "eq" as const, value: "true" }];
  const attach = (nodes: SchemaNode[]): SchemaNode[] =>
    nodes.map((n) => ({
      ...n,
      ...(n.key && DISPLAY_ROWS.includes(n.key) ? { visibleWhen: rule } : {}),
      ...(n.children ? { children: attach(n.children) } : {}),
    }));
  return { ...schema, tree: attach(schema.tree) };
}

const sectionsFor = (schema: Schema, device: unknown): SchemaNode[] => {
  const view = resolveVisibility(schema, { device, profile: {} });
  const pruned = deriveSections(view.tree)
    .map((s) => pruneToStore(s, "device"))
    .filter((s): s is SchemaNode => s !== null && countFields(s) > 0);
  return applyLayout(pruned, DEVICE_LAYOUT);
};

const keysIn = (section: SchemaNode | undefined): string[] => {
  if (!section) return [];
  const out: string[] = [];
  const visit = (node: SchemaNode) => {
    if (node.key) out.push(node.key);
    for (const child of node.children ?? []) visit(child);
  };
  visit(section);
  return out;
};

const displaySection = (device: unknown) =>
  sectionsFor(withDisplayRule(schemaJson as unknown as Schema), device).find(
    (s) => s.label === "Display",
  );

describe("unticking Display Attached", () => {
  const fitted = { ...deviceJson, hasDisplay: true };
  const notFitted = { ...deviceJson, hasDisplay: false };

  it("shows the panel's settings while one is fitted", () => {
    expect(keysIn(displaySection(fitted))).toEqual(
      expect.arrayContaining(["device:hasDisplay", ...DISPLAY_ROWS]),
    );
  });

  /**
   * The whole point of the complaint this answers: the form must react to the click, not to the
   * next DUMP_SCHEMA. Nothing here has talked to a device between the two assertions - only the
   * value in the form changed.
   */
  it("drops them the moment the box is unticked, with no re-read", () => {
    const after = keysIn(displaySection(notFitted));
    for (const key of DISPLAY_ROWS) expect(after).not.toContain(key);
  });

  it("keeps the checkbox itself, or there would be no way back", () => {
    expect(keysIn(displaySection(notFitted))).toContain("device:hasDisplay");
  });

  /**
   * Two sections follow the checkbox, not one, and the second is easy to forget: the I2C pair in
   * the Wiring table is the display's bus, so the firmware hides those rows under the same
   * `hasDisplay` rule. Named here rather than excluded, because "the rest of the form" is the
   * property under test and a section quietly joining the list would otherwise go unnoticed.
   */
  const FOLLOWS_THE_DISPLAY = ["device:i2cSdaPin", "device:i2cSclPin"];

  it("takes the display's own bus pins with it, and nothing else", () => {
    const before = sectionsFor(withDisplayRule(schemaJson as unknown as Schema), fitted);
    const after = sectionsFor(withDisplayRule(schemaJson as unknown as Schema), notFitted);

    const wiringBefore = keysIn(before.find((s) => s.label === "Wiring"));
    const wiringAfter = keysIn(after.find((s) => s.label === "Wiring"));
    // The fixture is a capture, so it only carries these rows once it is post-MOH-16. Skip rather
    // than assert nothing, so a pre-MOH-16 fixture does not read as a pass.
    if (FOLLOWS_THE_DISPLAY.every((k) => wiringBefore.includes(k))) {
      expect(wiringAfter).toEqual(wiringBefore.filter((k) => !FOLLOWS_THE_DISPLAY.includes(k)));
    }

    const others = (list: SchemaNode[]) =>
      list
        .filter((s) => s.label !== "Display" && s.label !== "Wiring")
        .map((s) => `${s.label}:${keysIn(s).length}`);
    expect(others(after)).toEqual(others(before));
  });

  /** And they must not reappear in the trailing catch-all, which would defeat the whole thing. */
  it("does not push them into Other settings instead", () => {
    const after = sectionsFor(withDisplayRule(schemaJson as unknown as Schema), notFitted);
    const everything = after.flatMap((s) => keysIn(s));
    for (const key of DISPLAY_ROWS) expect(everything).not.toContain(key);
  });
});
