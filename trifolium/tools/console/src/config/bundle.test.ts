import { describe, expect, it } from "vitest";
import { diffKeys } from "./bundle";
import type { Schema } from "../schema/types";

// A tree small enough to reason about, with one key per store and one nested path, since diffKeys
// walks the tree rather than the payload.
const schema = {
  cmd: "DUMP_SCHEMA",
  fw: "2.0.1",
  deviceSchemaVersion: 5,
  profileSchemaVersion: 2,
  activeProfileIndex: 0,
  profileCount: 1,
  maxFireModes: 10,
  activeModeCount: 1,
  fireModeCaps: null,
  tree: [
    {
      label: "Device",
      kind: "group" as const,
      children: [
        { label: "Menu Button Pin", kind: "int" as const, key: "device:menuButtonPin" },
        { label: "SDA", kind: "int" as const, key: "device:i2cSdaPin" },
        { label: "Blaster Name", kind: "text" as const, key: "device:blasterName" },
        { label: "Extend High", kind: "int" as const, key: "device:solenoidExtendTimeHigh_ms" },
      ],
    },
    {
      label: "Profile",
      kind: "group" as const,
      children: [{ label: "Dwell", kind: "int" as const, key: "profile:dwellTime_ms" }],
    },
  ],
} as unknown as Schema;

const device = {
  menuButtonPin: 19,
  i2cSdaPin: 14,
  blasterName: "example",
  solenoidExtendTimeHigh_ms: 25,
};
const profiles = [{ dwellTime_ms: 1000 }];
const from = { device, profiles };

describe("diffKeys", () => {
  it("names the keys that actually changed, and only those", () => {
    const to = { device: { ...device, menuButtonPin: 22 }, profiles };
    expect([...diffKeys(schema, from, to)]).toEqual(["device:menuButtonPin"]);
  });

  it("finds a change in a profile slot, tagged with the slot", () => {
    const to = { device, profiles: [{ dwellTime_ms: 900 }] };
    expect([...diffKeys(schema, from, to)]).toEqual(["0:profile:dwellTime_ms"]);
  });

  it("reports nothing for an identical payload", () => {
    expect(diffKeys(schema, from, { device: { ...device }, profiles }).size).toBe(0);
  });

  // The MOH-16 blocker, and the reason this file exists. The firmware has always treated a partial
  // LOAD_DEVICE as "change what I mention and nothing else", but diffKeys walked the whole schema
  // tree, read an absent key as undefined, counted it as different from what the device held, and
  // then wrote it. A wiring-only payload would have blanked every setting it did not name.
  describe("a payload that only mentions some keys", () => {
    const wiringOnly = { device: { menuButtonPin: 22, i2cSdaPin: 14 }, profiles };

    it("reports the key it does mention and changes", () => {
      expect([...diffKeys(schema, from, wiringOnly)]).toContain("device:menuButtonPin");
    });

    it("says nothing about the keys it is silent on", () => {
      const changed = diffKeys(schema, from, wiringOnly);
      expect(changed.has("device:blasterName")).toBe(false);
      expect(changed.has("device:solenoidExtendTimeHigh_ms")).toBe(false);
    });

    it("reports exactly one change, not three", () => {
      expect(diffKeys(schema, from, wiringOnly).size).toBe(1);
    });

    it("does not confuse silence with a key it mentions unchanged", () => {
      const changed = diffKeys(schema, from, wiringOnly);
      expect(changed.has("device:i2cSdaPin")).toBe(false);
    });
  });

  // Silence is not a value, but an explicit null is one - a hand-edited file can carry it, and the
  // device would read it as a type mismatch rather than as "leave this alone".
  it("treats an explicit null as a change, unlike an absent key", () => {
    const withNull = { device: { ...device, blasterName: null }, profiles };
    expect([...diffKeys(schema, from, withNull)]).toEqual(["device:blasterName"]);
  });
});
