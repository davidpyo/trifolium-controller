import { describe, expect, it } from "vitest";
import schema from "../fixtures/schema.json";
import { walk, type Schema } from "../schema/types";
import { FIRE_MODE_HELP, SETTING_HELP, helpFor, optionHelpFor } from "./settings";

const anyIndex = (key: string) => key.replace(/\[\d+\]/g, "[*]");

/** Every setting this firmware's schema offers, one key per repeated row. */
function settingKeys(): Set<string> {
  const keys = new Set<string>();
  walk((schema as unknown as Schema).tree, (node) => {
    if (node.key && node.kind !== "group" && node.kind !== "action") keys.add(anyIndex(node.key));
  });
  return keys;
}

describe("the settings' help", () => {
  it("names no setting the schema no longer has", () => {
    const keys = settingKeys();
    expect(Object.keys(SETTING_HELP).filter((key) => !keys.has(key))).toEqual([]);
  });

  it("covers every setting the schema has", () => {
    expect([...settingKeys()].filter((key) => !(key in SETTING_HELP))).toEqual([]);
  });

  it("describes exactly the firing modes the schema lists", () => {
    let ids: unknown;
    walk((schema as unknown as Schema).tree, (node) => {
      if (node.key && anyIndex(node.key) === "profile:fireModes[*].burstMode") ids ??= node.optionValues;
    });
    expect(Object.keys(FIRE_MODE_HELP).sort()).toEqual([...(ids as string[])].sort());
  });

  it("finds one line for every motor, stage or switch of a repeated row", () => {
    expect(helpFor("device:escPins[2]")).toBe(SETTING_HELP["device:escPins[*]"]);
    expect(helpFor("device:motorConfig[3].kp")).toBe(SETTING_HELP["device:motorConfig[*].kp"]);
    expect(helpFor(undefined)).toBeUndefined();
  });

  it("describes a firing mode only in the fire-mode list", () => {
    expect(optionHelpFor("profile:fireModes[4].burstMode", "plasma")).toBe(FIRE_MODE_HELP.plasma);
    expect(optionHelpFor("device:selectFireType", "switch")).toBeUndefined();
  });
});
