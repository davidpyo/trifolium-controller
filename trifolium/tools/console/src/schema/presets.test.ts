import { describe, expect, it } from "vitest";
import {
  PRESETS,
  PRESET_KIND,
  presetById,
  presetDrift,
  presetEntries,
  presetForBoardId,
  wiringLabel,
} from "./presets";
import { hasWiring, needsPresetPicker } from "./wiring";
import type { Schema } from "./types";
import trifoliumV12 from "../../../../boards/trifolium_v1_2/board.json";
import diana from "../../../../boards/diana_v1_0/board.json";

const base: Schema = {
  cmd: "DUMP_SCHEMA",
  fw: "2.0.1",
  deviceSchemaVersion: 5,
  profileSchemaVersion: 2,
  activeProfileIndex: 0,
  profileCount: 3,
  maxFireModes: 10,
  activeModeCount: 3,
  fireModeCaps: null,
  tree: [],
};

const wired: Schema = { ...base, boardId: "trifolium_v1_2", wiringConfigured: true };
const bare: Schema = { ...base, boardId: "", wiringConfigured: false };

describe("the presets this console ships", () => {
  it("finds a board by its folder, with nothing registering it anywhere", () => {
    // The folders are the list. This is the assertion that would fail if the glob stopped matching
    // - which, with no index to disagree with, is otherwise a silently shorter picker.
    expect(PRESETS.map((p) => p.id)).toContain("trifolium_v1_2");
    expect(PRESETS.map((p) => p.id)).toContain("rp2040_zero");
    expect(PRESETS.length).toBeGreaterThanOrEqual(7);
  });

  it("offers them newest first, by sorting the id backwards", () => {
    const ids = PRESETS.map((p) => p.id);
    expect(ids).toEqual([...ids].sort((a, b) => b.localeCompare(a)));
    expect(ids.indexOf("trifolium_v1_4")).toBeLessThan(ids.indexOf("trifolium_v1_2"));
  });

  it("gives every board a unique id", () => {
    // Two folders naming one id would have the picker offer the same board twice, and which of
    // the two a stored id resolved to would be down to glob order.
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
  });

  // The collapse MOH-16 made: FET and ESC were the same PCB, differing only in two stored fields.
  it("has one entry per board, not one per pusher driver", () => {
    expect(PRESETS.map((p) => p.id)).not.toContain("trifolium_v1_2_fet");
    expect(PRESETS.map((p) => p.id)).not.toContain("trifolium_v1_2_esc");
  });

  it("carries the wiring rather than a whole config", () => {
    const preset = presetById("trifolium_v1_2")!;
    expect(preset.wiring.escPins).toEqual([0, 1, 2, 3]);
    // Tuning is the thing a preset must never carry: applying one to fix a pin would silently
    // reset somebody's solenoid timings.
    expect(preset.wiring).not.toHaveProperty("solenoidExtendTimeHigh_ms");
    expect(preset.wiring).not.toHaveProperty("motorConfig");
    expect(preset.wiring).not.toHaveProperty("blasterName");
  });

  it("arms the device, because an id alone must not", () => {
    for (const preset of PRESETS) expect(preset.wiring.wiringConfigured).toBe(true);
  });

  /**
   * The file doubles as a LOAD_DEVICE payload, so the descriptive keys sit beside the wiring ones
   * and something has to tell them apart. If that filter leaked, the console would send `kind` and
   * `notes` to the device as settings - which the firmware would ignore, making the mistake
   * invisible until a key name collided.
   */
  it("keeps the descriptive keys out of what gets sent to the device", () => {
    const preset = presetById("trifolium_v1_2")!;
    for (const key of ["kind", "presetVersion", "id", "name", "notes", "unread"]) {
      expect(preset.wiring).not.toHaveProperty(key);
    }
    // schemaVersion too: buildPatch() stamps the device's own, so a second one would be a stale
    // value overwriting a correct one.
    expect(preset.wiring).not.toHaveProperty("schemaVersion");
  });

  it("keeps telem and escADC out of the wiring - nothing reads either", () => {
    expect(trifoliumV12.unread.telem).toBe(4);
    const preset = presetById("trifolium_v1_2")!;
    expect(preset.wiring).not.toHaveProperty("telem");
    expect(preset.wiring).not.toHaveProperty("escADC");
  });

  /**
   * The property that makes a board file loadable with no transform: it is already a valid
   * payload, schemaVersion and all.
   */
  it("is loadable as it stands, with no transform", () => {
    // Not a literal version: this side cannot see the firmware, so a number here would only detect
    // its own edit. What holds is that every preset agrees with every other - one file left behind
    // by a bump is a preset the device would refuse on its own.
    expect(trifoliumV12.schemaVersion).toBeGreaterThan(0);
    const versions = new Set(PRESETS.map((p) => p.schemaVersion));
    expect([...versions]).toEqual([trifoliumV12.schemaVersion]);
    expect(trifoliumV12.wiringConfigured).toBe(true);
    expect(trifoliumV12.escPins).toEqual([0, 1, 2, 3]);
  });

  it("is what it says it is", () => {
    expect(trifoliumV12.kind).toBe(PRESET_KIND);
  });
});

describe("turning a stored board id back into a preset", () => {
  it("matches an id written by this firmware", () => {
    expect(presetForBoardId("diana_v1_0")?.name).toBe("Diana v1.0");
  });

  // The upgrade path: the board table named FET and ESC variants separately, and a device that ran
  // that firmware still carries the old string. The firmware cannot resolve it - there is nothing
  // left on the device to resolve it against - so this side has to.
  it("follows the alias table for an id the board table wrote", () => {
    expect(presetForBoardId("trifolium_v1_2_fet")?.id).toBe("trifolium_v1_2");
    expect(presetForBoardId("trifolium_v1_2_esc")?.id).toBe("trifolium_v1_2");
    expect(presetForBoardId("trifolium_v1_0_esc")?.id).toBe("trifolium_v1_0");
  });

  it("lets no two boards claim one old id", () => {
    // What moving the aliases into the boards gave up: an alias can no longer name a board that
    // does not exist, but two boards can now both answer to one id, and the winner would be glob
    // order.
    const claimed = PRESETS.flatMap((p) => p.aliases);
    expect(new Set(claimed).size).toBe(claimed.length);
  });

  it("lets no alias shadow a real board id", () => {
    const ids = new Set(PRESETS.map((p) => p.id));
    for (const alias of PRESETS.flatMap((p) => p.aliases)) expect(ids.has(alias)).toBe(false);
  });

  it("keeps the aliases out of what gets sent to the device", () => {
    // They are descriptive, like `notes`. Sending an array of old board ids as a setting is the
    // kind of thing the firmware ignores until a key name collides.
    expect(presetById("trifolium_v1_2")!.wiring).not.toHaveProperty("aliases");
    expect(presetById("trifolium_v1_2")!.wiring).not.toHaveProperty("retired");
  });

  it("returns nothing rather than guessing at an id it does not know", () => {
    expect(presetForBoardId("some_future_board")).toBeUndefined();
    expect(presetForBoardId("")).toBeUndefined();
  });
});

describe("naming a wiring", () => {
  it("names a preset it recognises", () => {
    expect(wiringLabel("trifolium_v1_4")).toBe("Trifolium v1.4");
  });

  it("names an old id by the preset it aliases to", () => {
    expect(wiringLabel("trifolium_v1_1_esc")).toBe("Trifolium v1.1");
  });

  // Unknown is not custom: the device stored a name this console has never heard of, which is a
  // different thing from a wiring nobody based on a preset. Showing the id says which it is.
  it("falls back to the id itself rather than calling an unknown board custom", () => {
    expect(wiringLabel("some_future_board")).toBe("some_future_board");
  });

  it("calls an empty id custom", () => {
    expect(wiringLabel("")).toBe("Custom wiring");
    expect(wiringLabel(undefined)).toBe("Custom wiring");
  });
});

describe("whether the wiring still matches its preset", () => {
  const asStored = (preset: { id: string }) => ({ ...presetById(preset.id)!.wiring });

  it("sees no drift in a device wired exactly as the preset says", () => {
    expect(presetDrift(asStored(trifoliumV12), "trifolium_v1_2")?.changed).toEqual([]);
  });

  it("names the field a user moved", () => {
    const moved = { ...asStored(trifoliumV12), menuButtonPin: 22 };
    expect(presetDrift(moved, "trifolium_v1_2")?.changed).toEqual(["menuButtonPin"]);
  });

  it("catches a moved pin inside the ESC array, not just the scalars", () => {
    const moved = { ...asStored(trifoliumV12), escPins: [0, 1, 2, 7] };
    expect(presetDrift(moved, "trifolium_v1_2")?.changed).toEqual(["escPins"]);
  });

  // boardId is the provenance itself and wiringConfigured is the boot gate. Neither differing
  // would mean a pin had moved, and a device disarmed with RESET_PINS is not a modified wiring.
  it("ignores the provenance and the boot gate", () => {
    const disarmed = { ...asStored(trifoliumV12), wiringConfigured: false, boardId: "" };
    expect(presetDrift(disarmed, "trifolium_v1_2")?.changed).toEqual([]);
  });

  it("compares an aliased id against the preset it aliases to", () => {
    expect(presetDrift(asStored(trifoliumV12), "trifolium_v1_2_fet")?.changed).toEqual([]);
  });

  it("says nothing at all about an id naming no preset - unknown is not modified", () => {
    expect(presetDrift(asStored(trifoliumV12), "some_future_board")).toBeNull();
    expect(presetDrift(asStored(diana), "")).toBeNull();
  });
});

describe("applying a preset", () => {
  it("produces store-qualified entries for exactly the keys the file names", () => {
    const entries = presetEntries(presetById("diana_v1_0")!);
    const descriptive = ["kind", "presetVersion", "id", "name", "notes", "unread", "schemaVersion",
                         "aliases", "retired"];
    // `default` is the JSON module namespace's own, not a key in the file.
    const inFile = Object.keys(diana).filter((k) => k !== "default" && !descriptive.includes(k));
    expect(inFile.length).toBeGreaterThan(10);
    expect(entries.map((e) => e.key)).toEqual(inFile.map((k) => `device:${k}`));
  });

  // The whole safety property of a partial load: the firmware leaves a key the payload never
  // mentions at whatever it already held, so a preset cannot reach anyone's tuning.
  it("names no key outside the wiring", () => {
    for (const preset of PRESETS) {
      for (const { key } of presetEntries(preset)) {
        expect(key).not.toMatch(/solenoid|motorConfig|blasterName|revRPM/);
      }
    }
  });
});

describe("whether to ask for a wiring", () => {
  it("reads a wired device as wired", () => {
    expect(hasWiring(wired)).toBe(true);
    expect(needsPresetPicker(wired, true)).toBe(false);
  });

  it("asks a bare device, but only when it is really attached", () => {
    expect(needsPresetPicker(bare, true)).toBe(true);
    expect(needsPresetPicker(bare, false)).toBe(false);
  });

  // The case that decides whether a picker is shoved in front of a working blaster: firmware
  // predating the flag omits it entirely, and it does have a pinout.
  it("treats a missing flag as wired, not as bare", () => {
    const old: Schema = { ...base, wiringConfigured: undefined, boardId: undefined };
    expect(hasWiring(old)).toBe(true);
    expect(needsPresetPicker(old, true)).toBe(false);
  });
});

describe("the picker gate versus the boot gate", () => {
  // wiringConfigured answers two questions - "may this device drive GPIO" and "does the console
  // need a board chosen" - and they part company exactly once: when the user has declined the
  // picker to wire by hand. The device still reports no wiring, so needsPresetPicker() still says
  // yes, and the console has to hold that second answer itself or the Wiring tab it just sent the
  // user to does not render.
  it("still asks for a board on a device nobody has answered for", () => {
    expect(needsPresetPicker(bare, true)).toBe(true);
  });

  it("leaves the boot gate shut, so silencing the picker cannot arm a blaster", () => {
    expect(hasWiring(bare)).toBe(false);
  });
});
