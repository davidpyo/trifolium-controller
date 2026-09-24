import { describe, expect, it } from "vitest";
import { optionIndexFor, optionValueAt, withSlotNames } from "./enumValue";
import type { SchemaNode } from "./types";

const idValued: SchemaNode = {
  label: "Menu Button",
  kind: "enum",
  key: "device:bootAction[0]",
  lo: 0,
  hi: 2,
  step: 1,
  options: ["None", "Bootloader", "ESC Passthrough"],
  optionValues: ["none", "bootloader", "esc_passthrough"],
};

// Switch position assignment: stores -1 for "Default", so options run one ahead of the value span.
const indexValued: SchemaNode = {
  label: "Position 1",
  kind: "enum",
  key: "profile:switchPositionAssignment[0]",
  lo: -1,
  hi: 2,
  step: 1,
  options: ["Default", "Mode 1", "Mode 2", "Mode 3"],
};

describe("id-valued enums", () => {
  it("selects the option whose id is stored", () => {
    expect(optionIndexFor(idValued, "esc_passthrough")).toBe(2);
    expect(optionIndexFor(idValued, "none")).toBe(0);
  });

  it("writes the id, not the ordinal", () => {
    expect(optionValueAt(idValued, 2)).toBe("esc_passthrough");
    expect(optionValueAt(idValued, 0)).toBe("none");
  });

  it("round-trips every option", () => {
    idValued.optionValues!.forEach((id, i) => {
      expect(optionIndexFor(idValued, id)).toBe(i);
      expect(optionValueAt(idValued, i)).toBe(id);
    });
  });

  it("falls back to the first option for an id this build does not know", () => {
    // Matches the firmware, which keeps the default rather than guessing at an unknown name.
    expect(optionIndexFor(idValued, "something_else")).toBe(0);
  });

  it("does not read a stale integer as an ordinal", () => {
    // A pre-v4 value reaching a v4 schema must not silently select option 2 - the device speaks
    // ids now, so there is nothing to infer from the number.
    expect(optionIndexFor(idValued, 2)).toBe(0);
  });
});

describe("index-valued enums", () => {
  it("offsets the selection by lo", () => {
    expect(optionIndexFor(indexValued, -1)).toBe(0);
    expect(optionIndexFor(indexValued, 0)).toBe(1);
    expect(optionIndexFor(indexValued, 2)).toBe(3);
  });

  it("writes a number offset by lo", () => {
    // The regression this base exists for: picking "Default" must send -1, not 0.
    expect(optionValueAt(indexValued, 0)).toBe(-1);
    expect(optionValueAt(indexValued, 1)).toBe(0);
  });

  it("clamps a value outside the span", () => {
    expect(optionIndexFor(indexValued, 99)).toBe(3);
    expect(optionIndexFor(indexValued, -99)).toBe(0);
  });
});

const bootAction: SchemaNode = {
  label: "Rev Switch",
  kind: "enum",
  key: "device:bootAction[2]",
  lo: 0,
  hi: 6,
  step: 1,
  options: ["None", "Bootloader", "ESC Passthrough", "Idle Hold", "Slot 1", "Slot 2", "Slot 3"],
  optionValues: ["none", "bootloader", "esc_passthrough", "idle_hold", "profile_0", "profile_1",
    "profile_2"],
};

describe("profile slots named in the options", () => {
  it("follows each slot with the name of the profile in it", () => {
    expect(withSlotNames(bootAction, ["Low", "Medium", "High"]).options).toEqual([
      "None", "Bootloader", "ESC Passthrough", "Idle Hold", "Slot 1 · Low", "Slot 2 · Medium",
      "Slot 3 · High",
    ]);
  });

  it("leaves a slot as the firmware labels it when its profile has no name or is not read yet", () => {
    expect(withSlotNames(bootAction, ["", "  ", undefined]).options?.slice(4)).toEqual([
      "Slot 1", "Slot 2", "Slot 3",
    ]);
    expect(withSlotNames(bootAction, []).options?.slice(4)).toEqual(["Slot 1", "Slot 2", "Slot 3"]);
  });

  it("keeps two slots holding profiles of the same name apart", () => {
    const named = withSlotNames(bootAction, ["Low", "Low", " High "]).options?.slice(4);
    expect(named).toEqual(["Slot 1 · Low", "Slot 2 · Low", "Slot 3 · High"]);
  });

  it("changes only the labels, and nothing on a node without slots", () => {
    const named = withSlotNames(bootAction, ["Low"]);
    expect(named.optionValues).toEqual(bootAction.optionValues);
    expect(optionValueAt(named, 4)).toBe("profile_0");
    expect(optionIndexFor(named, "profile_0")).toBe(4);
    expect(withSlotNames(idValued, ["Low"])).toBe(idValued);
    expect(withSlotNames(indexValued, ["Low"])).toBe(indexValued);
  });
});
