import { describe, expect, it } from "vitest";
import { buildPatch, getByKey, parseKey, setByKey } from "./keyPath";
import { asBound, snapReal, snapToGrid, steppedReal, steppedToGrid } from "./grid";
import { fireModeLeafOf, isFireModeRow, storageOf, walk, type Schema, type SchemaNode } from "./types";

import schemaJson from "../fixtures/schema.json";
import deviceJson from "../fixtures/device.json";
import profile0 from "../fixtures/profile0.json";
import profile1 from "../fixtures/profile1.json";
import profile2 from "../fixtures/profile2.json";

const schema = schemaJson as unknown as Schema;

const allNodes = (): SchemaNode[] => {
  const out: SchemaNode[] = [];
  walk(schema.tree, (n) => out.push(n));
  return out;
};

const b = asBound;

describe("steppedToGrid", () => {
  // Ported from src/menu.h. These are the cases that make it different from "add step to value":
  // it moves to the next multiple of step, and rounds the bounds onto that grid too.
  it("steps to the next multiple, not current + step", () => {
    expect(steppedToGrid(b(23), 1, b(5), b(5), b(50))).toBe(25);
    expect(steppedToGrid(b(23), -1, b(5), b(5), b(50))).toBe(20);
  });

  it("holds at the grid-aligned bound without wrap", () => {
    expect(steppedToGrid(b(50), 1, b(5), b(5), b(50))).toBe(50);
    expect(steppedToGrid(b(5), -1, b(5), b(5), b(50))).toBe(5);
  });

  it("wraps between grid-aligned bounds when asked", () => {
    expect(steppedToGrid(b(50), 1, b(5), b(5), b(50), true)).toBe(5);
    expect(steppedToGrid(b(5), -1, b(5), b(5), b(50), true)).toBe(50);
  });

  it("rounds a non-grid ceiling down before using it", () => {
    // hi = 47 with step 5 means the top reachable value is 45.
    expect(steppedToGrid(b(44), 1, b(5), b(0), b(47))).toBe(45);
    expect(steppedToGrid(b(45), 1, b(5), b(0), b(47))).toBe(45);
  });

  it("is a no-op for a zero step or no direction", () => {
    expect(steppedToGrid(b(7), 1, b(0), b(0), b(10))).toBe(7);
    expect(steppedToGrid(b(7), 0, b(5), b(0), b(10))).toBe(7);
  });
});

describe("snapToGrid", () => {
  it("snaps to the nearest grid point and clamps", () => {
    expect(snapToGrid(b(23), b(5), b(5), b(50))).toBe(25);
    expect(snapToGrid(b(22), b(5), b(5), b(50))).toBe(20);
    expect(snapToGrid(b(1), b(5), b(5), b(50))).toBe(5);
    expect(snapToGrid(b(9999), b(5), b(5), b(50))).toBe(50);
  });
});

describe("snapReal", () => {
  // Bounds arrive scaled by 10^decimals while the stored value is a real float. KP is 0.0-2.0
  // step 0.1, which the schema reports as lo=0 hi=200 step=10 decimals=2.
  const kp = { lo: b(0), hi: b(200), step: b(10), decimals: 2 };

  it("keeps float values in real units", () => {
    expect(snapReal(0.2, kp)).toBeCloseTo(0.2, 5);
    expect(snapReal(1.24, kp)).toBeCloseTo(1.2, 5);
    expect(snapReal(5, kp)).toBeCloseTo(2, 5);
  });

  it("treats an int field as the unscaled case", () => {
    expect(snapReal(23, { lo: b(5), hi: b(50), step: b(5) })).toBe(25);
  });
});

describe("steppedReal", () => {
  // The arrow keys. Same scaling trap as snapReal: stepping a real 0.2 against scaled bounds
  // walked it to 10, five times KP's own ceiling, because the value and the grid were in
  // different spaces.
  const kp = { lo: b(0), hi: b(200), step: b(10), decimals: 2 };
  const calibration = { lo: b(500), hi: b(1500), step: b(100), decimals: 3 };

  it("steps a float by its real step", () => {
    expect(steppedReal(0.2, 1, kp)).toBeCloseTo(0.3, 5);
    expect(steppedReal(0.2, -1, kp)).toBeCloseTo(0.1, 5);
  });

  it("holds at the real bound rather than leaving it", () => {
    expect(steppedReal(2, 1, kp)).toBeCloseTo(2, 5);
    expect(steppedReal(0, -1, kp)).toBeCloseTo(0, 5);
  });

  it("stays inside a range that does not start at zero", () => {
    expect(steppedReal(1, 1, calibration)).toBeCloseTo(1.1, 5);
    expect(steppedReal(1, -1, calibration)).toBeCloseTo(0.9, 5);
    expect(steppedReal(1.5, 1, calibration)).toBeCloseTo(1.5, 5);
  });

  it("treats an int field as the unscaled case", () => {
    expect(steppedReal(23, 1, { lo: b(5), hi: b(50), step: b(5) })).toBe(25);
    expect(steppedReal(23, -1, { lo: b(5), hi: b(50), step: b(5) })).toBe(20);
  });
});

describe("parseKey", () => {
  it("splits store, names and subscripts", () => {
    expect(parseKey("device:blasterName")).toMatchObject({
      store: "device",
      segments: ["blasterName"],
      usable: true,
    });
    expect(parseKey("profile:fireModes[2].burstLength").segments).toEqual([
      "fireModes",
      2,
      "burstLength",
    ]);
    expect(parseKey("device:motorConfig[0].kp").segments).toEqual(["motorConfig", 0, "kp"]);
    expect(parseKey("profile:revRPM[2]").segments).toEqual(["revRPM", 2]);
  });

  it("treats a non-index subscript as naming nothing, rather than throwing", () => {
    // Only firmware older than resolved fire-mode keys emits this. It names no single value, so it
    // must read as absent and refuse a write - never throw, which would take the whole page down
    // over one stale row.
    const parsed = parseKey("profile:fireModes[*].burstLength");
    expect(parsed.usable).toBe(false);
    expect(getByKey({ fireModes: [{ burstLength: 3 }] }, "profile:fireModes[*].burstLength"))
      .toBeUndefined();
    const before = { fireModes: [{ burstLength: 3 }] };
    expect(setByKey(before, "profile:fireModes[*].burstLength", 9)).toBe(before);
  });

  it("rejects a key with no store", () => {
    expect(() => parseKey("blasterName")).toThrow(/store/);
  });

  it("parses every key the firmware actually emits", () => {
    const keys = allNodes()
      .map((n) => n.key)
      .filter((k): k is string => !!k);
    expect(keys.length).toBeGreaterThan(50);
    for (const key of keys) expect(() => parseKey(key)).not.toThrow();
  });
});

describe("setByKey", () => {
  it("does not mutate its input", () => {
    const before = { a: { b: 1 } };
    const after = setByKey(before, "device:a.b", 2);
    expect(before.a.b).toBe(1);
    expect(getByKey(after, "device:a.b")).toBe(2);
  });

  it("creates arrays for numeric segments and objects for names", () => {
    const out = setByKey({}, "device:motorConfig[1].kp", 0.5);
    expect(Array.isArray((out as { motorConfig: unknown }).motorConfig)).toBe(true);
    expect(getByKey(out, "device:motorConfig[1].kp")).toBe(0.5);
  });

  it("round-trips against a real payload", () => {
    const out = setByKey(deviceJson, "device:motorConfig[2].motorKv", 4321);
    expect(getByKey(out, "device:motorConfig[2].motorKv")).toBe(4321);
    // Siblings untouched.
    expect(getByKey(out, "device:motorConfig[1].motorKv")).toBe(
      getByKey(deviceJson, "device:motorConfig[1].motorKv"),
    );
  });
});

describe("buildPatch", () => {
  it("carries the schema version and only the named keys", () => {
    const patch = buildPatch(2, [
      { key: "device:iThreshold", value: 100 },
      { key: "device:motorConfig[0].kp", value: 0.3 },
    ]);
    expect(patch).toEqual({
      schemaVersion: 2,
      iThreshold: 100,
      motorConfig: [{ kp: 0.3 }],
    });
  });

  it("refuses to mix stores, which would silently drop half the edits", () => {
    expect(() =>
      buildPatch(2, [
        { key: "device:iThreshold", value: 1 },
        { key: "profile:spindownSpeed", value: 1 },
      ]),
    ).toThrow(/both/);
  });
});

describe("the schema and the real payloads agree", () => {
  // The load-bearing check. Keys come from the firmware's menu tree; the values come from its JSON
  // serialisers. Nothing in the firmware enforces that the two match, so a typo in a key would look
  // like an empty field in the console and silently write to the wrong place.
  it("resolves every device key in a real DUMP_DEVICE", () => {
    const missing = allNodes()
      .filter((n) => n.key?.startsWith("device:"))
      .filter((n) => storageOf(n) === "config")
      .filter((n) => getByKey(deviceJson, n.key!) === undefined)
      .map((n) => `${n.label} (${n.key})`);
    expect(missing).toEqual([]);
  });

  it("resolves every profile key in a real DUMP_PROFILE", () => {
    const missing = allNodes()
      .filter((n) => n.key?.startsWith("profile:") && !isFireModeRow(n.key))
      .filter((n) => storageOf(n) === "config")
      .filter((n) => getByKey(profile0, n.key!) === undefined)
      .map((n) => `${n.label} (${n.key})`);
    expect(missing).toEqual([]);
  });

  it("resolves every fire-mode property on every mode the profile holds", () => {
    // Derives the property list from the schema and the indices from activeModeCount, so it reads
    // the same whether the firmware names the rows per mode or shares one set across them.
    const leaves = new Set(
      allNodes()
        .map((n) => n.key)
        .filter((k): k is string => isFireModeRow(k))
        .map(fireModeLeafOf),
    );
    expect(leaves.size).toBeGreaterThan(0);

    // activeModeCount describes the ACTIVE profile, so the rows have to be resolved against that
    // profile rather than slot 0 - profiles hold different numbers of modes, and checking slot 0
    // against the active profile's count fails the moment they differ.
    const profiles = [profile0, profile1, profile2];
    const active = profiles[schema.activeProfileIndex] ?? profile0;

    const missing: string[] = [];
    for (let i = 0; i < schema.activeModeCount; i++) {
      for (const leaf of leaves) {
        const key = `profile:fireModes[${i}].${leaf}`;
        if (getByKey(active, key) === undefined) missing.push(key);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("fireModeCaps", () => {
  it("reports the per-mode burst length rules the firmware enforces", () => {
    const caps = schema.fireModeCaps;
    expect(caps).not.toBeNull();
    const burstLengthFor = (name: string) =>
      caps!
        .find((c) => c.name === name)
        ?.fields.find((f) => f.key.endsWith("burstLength"));

    // AUTO reads burstLength as "rounds while held", so it keeps the wide range. The short-burst
    // modes cap at 10, and BINARY allows 1 for one-dart-per-edge.
    expect(burstLengthFor("AUTO")).toMatchObject({ visible: true, lo: 1, hi: 500 });
    expect(burstLengthFor("BURST")).toMatchObject({ visible: true, lo: 2, hi: 10 });
    expect(burstLengthFor("BINARY")).toMatchObject({ visible: true, lo: 1, hi: 10 });
    // Modes that ignore it report the row as hidden.
    expect(burstLengthFor("SAFE")?.visible).toBe(false);
    expect(burstLengthFor("SEMI")?.visible).toBe(false);
  });
});

describe("enum option index vs stored value", () => {
  // The bug this locks in: switchPositionAssignment stores -1 for "Default" with mode indices from
  // 0, so its option list is one longer than its value range. A widget that treats the option index
  // as the value silently assigns fire mode 0 when the user picks "Default".
  const nodeFor = (key: string) =>
    allNodes().find((n) => n.key === key);

  it("switch position assignment has a -1 floor and one more option than modes", () => {
    const node = nodeFor("profile:switchPositionAssignment[0]");
    expect(node).toBeDefined();
    expect(node!.lo).toBe(-1);
    expect(node!.hi).toBe(schema.activeModeCount - 1);
    // Options are "Default" plus one per mode, so the count exceeds the value span by one.
    expect(node!.options?.length).toBe(schema.activeModeCount + 1);
    expect(node!.options?.[0]).toBe("Default");
  });

  it("every other enum is a plain 0-based ordinal", () => {
    const offset = allNodes()
      .filter((n) => n.kind === "enum" && n.key && !n.key.includes("switchPositionAssignment"))
      .filter((n) => (n.lo ?? 0) !== 0)
      .map((n) => `${n.label} (lo=${n.lo})`);
    expect(offset).toEqual([]);
  });

  it("option count matches the value span for plain enums", () => {
    const mismatched = allNodes()
      .filter((n) => n.kind === "enum" && n.options && (n.lo ?? 0) === 0)
      .filter((n) => n.options!.length !== (n.hi ?? 0) - (n.lo ?? 0) + 1)
      .map((n) => `${n.label}: ${n.options!.length} options for ${n.lo}..${n.hi}`);
    expect(mismatched).toEqual([]);
  });
});
