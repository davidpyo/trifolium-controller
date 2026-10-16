import { describe, expect, it } from "vitest";
import fixtureSchema from "../fixtures/schema.json";
import fixtureDevice from "../fixtures/device.json";
import fixtureProfile0 from "../fixtures/profile0.json";
import fixtureProfile1 from "../fixtures/profile1.json";
import fixtureProfile2 from "../fixtures/profile2.json";
import { setByKey } from "../schema/keyPath";
import type { Schema } from "../schema/types";
import {
  formatValue,
  listChanges,
  marksToRevert,
  splitMark,
  splitUnit,
  type Values,
} from "./changes";

const schema = fixtureSchema as unknown as Schema;
const baseline: Values = {
  device: fixtureDevice,
  profiles: [fixtureProfile0, fixtureProfile1, fixtureProfile2],
};

const changesFor = (marks: string[], edit: (v: Values) => Values) =>
  listChanges({
    schema,
    dirty: new Set(marks),
    baseline,
    current: edit(structuredClone(baseline)),
    hiddenKeys: new Set(["device:displayBrightness"]),
    wiringKeys: new Set(["device:triggerSwitchPin"]),
  });

describe("splitMark", () => {
  it("separates a profile slot from its key and leaves a device key alone", () => {
    expect(splitMark("2:profile:revRPM[1]")).toEqual([2, "profile:revRPM[1]"]);
    expect(splitMark("device:blasterName")).toEqual([null, "device:blasterName"]);
  });
});

describe("splitUnit", () => {
  it("takes a trailing unit off a label, and nothing else", () => {
    expect(splitUnit("Retract Time (ms)")).toEqual({ name: "Retract Time", unit: "ms" });
    expect(splitUnit("Spindown Speed")).toEqual({ name: "Spindown Speed" });
    expect(splitUnit("Low V Cutoff (mV/cell)")).toEqual({ name: "Low V Cutoff", unit: "mV/cell" });
  });

  it("leaves a qualifier that is part of the name where it is", () => {
    expect(splitUnit("Idle RPM (Custom)")).toEqual({ name: "Idle RPM (Custom)" });
    expect(splitUnit("Stage 1 (M2, M4)")).toEqual({ name: "Stage 1 (M2, M4)" });
    expect(splitUnit("Motor 3 (off)")).toEqual({ name: "Motor 3 (off)" });
  });
});

describe("listChanges", () => {
  it("names a change, says where it lives, and shows it before and after in its row's unit", () => {
    const [c] = changesFor(["device:solenoidRetractTime_ms"], (v) => ({
      ...v,
      device: setByKey(v.device as object, "device:solenoidRetractTime_ms", 22),
    }));
    expect(c.label).toBe("Retract Time");
    expect(c.slot).toBeNull();
    expect(c.view).toBe("blaster");
    expect(c.to).toBe("22 ms");
    expect(c.from).not.toBe(c.to);
  });

  it("orders the device's changes before each profile's, as a write sends them", () => {
    const list = changesFor(["1:profile:spindownSpeed", "device:blasterName"], (v) => ({
      device: setByKey(v.device as object, "device:blasterName", "renamed"),
      profiles: v.profiles.map((p, i) =>
        i === 1 ? setByKey(p as object, "profile:spindownSpeed", 200) : p,
      ),
    }));
    expect(list.map((c) => c.slot)).toEqual([null, 1]);
    expect(list[0].view).toBe("overview");
    expect(list[1].view).toBe("profiles");
  });

  it("sends a pin to the Wiring page and says unused rather than 255", () => {
    const [c] = changesFor(["device:triggerSwitchPin"], (v) => ({
      ...v,
      device: setByKey(v.device as object, "device:triggerSwitchPin", 255),
    }));
    expect(c.view).toBe("wiring");
    expect(c.to).toBe("unused");
  });

  it("flags an edit to a row the current settings hide, which is still written", () => {
    const [c] = changesFor(["device:displayBrightness"], (v) => ({
      ...v,
      device: setByKey(v.device as object, "device:displayBrightness", 100),
    }));
    expect(c.hidden).toBe(true);
  });

  it("folds a fire-mode list that changed length into one change", () => {
    const list = changesFor(
      ["0:profile:fireModes", "0:profile:activeModeCount", "0:profile:fireModes[1].burstMode"],
      (v) => ({
        ...v,
        profiles: v.profiles.map((p, i) =>
          i === 0
            ? { ...(p as object), fireModes: (p as { fireModes: unknown[] }).fireModes.slice(0, 1) }
            : p,
        ),
      }),
    );
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe("Fire modes");
  });
});

describe("marksToRevert", () => {
  it("reverts a fire-mode list together with its count and the fields inside it", () => {
    const dirty = new Set([
      "0:profile:fireModes",
      "0:profile:activeModeCount",
      "0:profile:fireModes[2].targetDPS",
      "1:profile:fireModes[0].targetDPS",
      "device:blasterName",
    ]);
    expect(marksToRevert("0:profile:fireModes", dirty).sort()).toEqual(
      [
        "0:profile:activeModeCount",
        "0:profile:fireModes",
        "0:profile:fireModes[2].targetDPS",
      ].sort(),
    );
    expect(marksToRevert("device:blasterName", dirty)).toEqual(["device:blasterName"]);
  });
});

describe("formatValue", () => {
  it("reads a bool as On or Off and a missing value as not set", () => {
    expect(formatValue({ label: "x", kind: "bool" }, true)).toBe("On");
    expect(formatValue({ label: "x", kind: "bool" }, undefined)).toBe("not set");
  });
});
