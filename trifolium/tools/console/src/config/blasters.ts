// The blaster configs the new-blaster wizard offers: the settings and profiles of a published
// build, to load with a board instead of the firmware defaults.
//
// One file per blaster in trifolium/blasters/, each a Full Backup saved from a finished build.
// Compiled in rather than fetched for the reason the boards are (see schema/presets.ts), and the
// folder is the list: adding a blaster is adding a file.

import { wiringLabel, type Preset } from "../schema/presets";
import { walk, type Schema } from "../schema/types";
import { BUNDLE_KIND, type ConfigBundle } from "./bundle";

const blasterFiles = import.meta.glob<ConfigBundle>("../../../../blasters/*.json", {
  eager: true,
  import: "default",
});

export interface Blaster {
  /** The file's name, less `.json`. */
  id: string;
  /** The blaster's own name, from the config. */
  name: string;
  /** The name and the board the config was saved on, as the picker lists it. */
  label: string;
  bundle: ConfigBundle;
}

export function collectBlasters(files: Record<string, ConfigBundle>): Blaster[] {
  const blasters: Blaster[] = [];
  for (const [path, bundle] of Object.entries(files)) {
    if (bundle?.kind !== BUNDLE_KIND || !bundle.device || !Array.isArray(bundle.profiles)) continue;
    const id = path.slice(path.lastIndexOf("/") + 1).replace(/\.json$/, "");
    const name = (bundle.device as { blasterName?: string }).blasterName?.trim() || id;
    blasters.push({ id, name, label: `${name} (built on ${wiringLabel(bundle.board)})`, bundle });
  }
  return blasters.sort((a, b) => a.label.localeCompare(b.label));
}

export const BLASTERS: Blaster[] = collectBlasters(blasterFiles);

/** Why this firmware would refuse the blaster's config, or null when it takes it. */
export function schemaMismatch(bundle: ConfigBundle, schema: Schema): string | null {
  if (bundle.deviceSchemaVersion !== schema.deviceSchemaVersion) {
    return `holds device settings for schema v${bundle.deviceSchemaVersion}, and this firmware speaks v${schema.deviceSchemaVersion}`;
  }
  if (bundle.profileSchemaVersion !== schema.profileSchemaVersion) {
    return `holds profiles for schema v${bundle.profileSchemaVersion}, and this firmware speaks v${schema.profileSchemaVersion}`;
  }
  return null;
}

/** The device settings the schema shows as pins, by their name in the device config. */
export function pinKeys(schema: Schema): Set<string> {
  const keys = new Set<string>();
  walk(schema.tree, (node) => {
    if (node.display === "pin" && node.key?.startsWith("device:")) {
      keys.add(node.key.slice("device:".length).replace(/\[\d+\]$/, ""));
    }
  });
  return keys;
}

/**
 * The loads that set a device up as a board with a blaster's config, in the order to send them.
 *
 * The pins are the board's: a config saved on one board need not line up with another's. Every
 * other setting is the config's, including how the pusher is driven, which is not a pin. A pin
 * the board does not name is left as the device has it.
 *
 * Device settings first. A profile loaded into the active slot is clamped as it arrives, against
 * the device settings live at the time, and some of its limits follow them - the DPS cap follows
 * the solenoid timings - so a profile sent first would be cut to the old device's limits.
 */
export function blasterLoads(
  bundle: ConfigBundle,
  board: Preset,
  schema: Schema,
): { command: string; payload: Record<string, unknown> }[] {
  const pins = pinKeys(schema);
  const settings = Object.fromEntries(
    Object.entries(bundle.device as Record<string, unknown>).filter(([key]) => !pins.has(key)),
  );
  return [
    {
      command: "LOAD_DEVICE",
      payload: {
        ...board.wiring,
        ...settings,
        boardId: board.id,
        wiringConfigured: true,
        schemaVersion: schema.deviceSchemaVersion,
      },
    },
    ...bundle.profiles.slice(0, schema.profileCount).map((profile, slot) => ({
      command: `LOAD_PROFILE ${slot}`,
      payload: { ...(profile as object), schemaVersion: schema.profileSchemaVersion },
    })),
  ];
}
