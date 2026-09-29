import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BLASTERS, blasterLoads, collectBlasters, pinKeys, schemaMismatch } from "./blasters";
import type { ConfigBundle } from "./bundle";
import type { Preset } from "../schema/presets";
import type { Schema } from "../schema/types";
import fixture from "../fixtures/schema.json";

const schema = fixture as unknown as Schema;

const bundle = (over: Partial<ConfigBundle> = {}): ConfigBundle => ({
  kind: "trifolium-config",
  bundleVersion: 1,
  savedAt: "2026-09-25T00:00:00.000Z",
  fw: "2.1.0",
  board: "trifolium_v1_4",
  deviceSchemaVersion: schema.deviceSchemaVersion,
  profileSchemaVersion: schema.profileSchemaVersion,
  device: { schemaVersion: schema.deviceSchemaVersion, blasterName: "Kit", boardId: "trifolium_v1_4" },
  profiles: [{ name: "Low" }, { name: "Medium" }, { name: "High" }],
  ...over,
});

const board: Preset = {
  id: "trifolium_v1_2",
  name: "Trifolium v1.2",
  schemaVersion: schema.deviceSchemaVersion,
  notes: [],
  aliases: [],
  retired: false,
  wiring: {
    boardId: "trifolium_v1_2",
    wiringConfigured: true,
    menuButtonPin: 19,
    pusherFetPin: 24,
    pusherDrive: "fet",
  },
};

describe("the blasters this console ships", () => {
  it("offers every file in the blasters folder", () => {
    // The folder is the list, so a file the glob or the filter drops is a blaster nobody is
    // offered and nothing else would notice.
    const folder = fileURLToPath(new URL("../../../../blasters/", import.meta.url));
    const files = readdirSync(folder).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    expect(BLASTERS.map((b) => `${b.id}.json`).sort()).toEqual(files.sort());
  });

  it("are all written for the firmware this console was built with", () => {
    for (const blaster of BLASTERS) expect(schemaMismatch(blaster.bundle, schema), blaster.id).toBeNull();
  });

  it("each carry a profile for every slot", () => {
    for (const blaster of BLASTERS) expect(blaster.bundle.profiles, blaster.id).toHaveLength(schema.profileCount);
  });

  it("are named for the blaster and the board it was built on", () => {
    const [kit] = collectBlasters({ "../blasters/kit.json": bundle() });
    expect(kit.id).toBe("kit");
    expect(kit.name).toBe("Kit");
    expect(kit.label).toBe("Kit (built on Trifolium v1.4)");
  });

  it("skips a file that is not a full backup", () => {
    const board = { kind: "trifolium-wiring-preset" } as unknown as ConfigBundle;
    expect(collectBlasters({ "../blasters/board.json": board })).toEqual([]);
  });
});

describe("setting a device up as a blaster", () => {
  it("refuses a config written for another schema", () => {
    expect(schemaMismatch(bundle({ deviceSchemaVersion: 2 }), schema)).toMatch(/device settings for schema v2/);
    expect(schemaMismatch(bundle({ profileSchemaVersion: 1 }), schema)).toMatch(/profiles for schema v1/);
    expect(schemaMismatch(bundle(), schema)).toBeNull();
  });

  it("loads the device settings, then each slot", () => {
    const loads = blasterLoads(bundle(), board, schema);
    expect(loads.map((l) => l.command)).toEqual([
      "LOAD_DEVICE",
      "LOAD_PROFILE 0",
      "LOAD_PROFILE 1",
      "LOAD_PROFILE 2",
    ]);
    expect(loads[0].payload).toMatchObject({ blasterName: "Kit", schemaVersion: schema.deviceSchemaVersion });
    expect(loads[2].payload).toMatchObject({ name: "Medium", schemaVersion: schema.profileSchemaVersion });
  });

  it("keeps the board's pins and takes every other setting from the config", () => {
    // A config saved on one board need not line up with another's pins. How the pusher is driven
    // is not a pin, so the config's choice stands.
    const config = bundle({
      device: {
        menuButtonPin: 8,
        pusherDrive: "esc",
        blasterName: "Kit",
        boardId: "trifolium_v1_4",
        wiringConfigured: false,
      },
    });
    const device = blasterLoads(config, board, schema)[0].payload;
    expect(device.menuButtonPin).toBe(19);
    expect(device.pusherFetPin).toBe(24);
    expect(device.pusherDrive).toBe("esc");
    expect(device.blasterName).toBe("Kit");
    expect(device.boardId).toBe("trifolium_v1_2");
    expect(device.wiringConfigured).toBe(true);
  });

  it("leaves a pin the board does not name as the device has it", () => {
    const config = bundle({ device: { safetySwitchPin: 5, escPins: [0, 1, 2, 3] } });
    const device = blasterLoads(config, board, schema)[0].payload;
    expect(device).not.toHaveProperty("safetySwitchPin");
    expect(device).not.toHaveProperty("escPins");
  });

  it("knows the pins from the schema, an array of them by its name", () => {
    const pins = pinKeys(schema);
    expect(pins).toContain("escPins");
    expect(pins).toContain("menuButtonPin");
    expect(pins).not.toContain("pusherDrive");
  });

  it("sends no more slots than the device has", () => {
    const four = bundle({ profiles: [{}, {}, {}, {}] });
    expect(blasterLoads(four, board, { ...schema, profileCount: 2 })).toHaveLength(3);
  });
});
