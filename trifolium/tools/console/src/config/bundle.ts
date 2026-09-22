// Saving and loading a whole configuration as one file on the host machine.
//
// The original tool could open and save the raw JSON of a single store. A bundle is more useful as a
// backup: one file holds device settings and every profile slot, plus the firmware and board it came
// from, so a restore does not depend on remembering which dump was which.

import { getByKey } from "../schema/keyPath";
import { fireModeLeafOf, isFireModeRow, storageOf, walk, type Schema } from "../schema/types";

export const BUNDLE_KIND = "trifolium-config";
export const BUNDLE_VERSION = 1;

export interface ConfigBundle {
  kind: typeof BUNDLE_KIND;
  bundleVersion: number;
  /** Provenance, for the human reading the file and for the mismatch warnings below. */
  savedAt: string;
  fw: string;
  /**
   * Which preset the wiring came from, or "" for wiring nobody based on one. Named `board` rather
   * than `boardId` because the field is the bundle format's, not the schema's - renaming it would
   * make every saved backup unreadable to gain nothing.
   */
  board: string;
  deviceSchemaVersion: number;
  profileSchemaVersion: number;
  device: unknown;
  profiles: unknown[];
}

export function buildBundle(
  schema: Schema,
  device: unknown,
  profiles: unknown[],
  now: string,
): ConfigBundle {
  return {
    kind: BUNDLE_KIND,
    bundleVersion: BUNDLE_VERSION,
    savedAt: now,
    fw: schema.fw,
    board: schema.boardId ?? "",
    deviceSchemaVersion: schema.deviceSchemaVersion,
    profileSchemaVersion: schema.profileSchemaVersion,
    device,
    profiles,
  };
}

export interface BundleCheck {
  bundle?: ConfigBundle;
  /** Fatal: the file is not usable at all. */
  error?: string;
  /** Non-fatal, but the user should know before pushing this to a device. */
  warnings: string[];
}

/**
 * Validates a file before it is allowed anywhere near the device.
 *
 * The schema-version check matters more than it looks: the firmware refuses a payload whose version
 * is not its own, so pushing a stale file fails outright. It used to be worse - a mismatch made the
 * device reset every setting to factory defaults - which is exactly why a stale dump should be caught
 * here with an explanation rather than sent hopefully.
 */
export function checkBundle(text: string, schema: Schema): BundleCheck {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { error: `Not valid JSON: ${(e as Error).message}`, warnings: [] };
  }

  const bundle = parsed as Partial<ConfigBundle>;
  if (bundle.kind !== BUNDLE_KIND) {
    return {
      error:
        "This is not a Trifolium config bundle. A single DUMP_DEVICE or DUMP_PROFILE dump can be pasted into the raw JSON view instead.",
      warnings: [],
    };
  }
  if (typeof bundle.bundleVersion !== "number" || bundle.bundleVersion > BUNDLE_VERSION) {
    return {
      error: `Bundle format v${bundle.bundleVersion} is newer than this console understands (v${BUNDLE_VERSION}).`,
      warnings: [],
    };
  }

  const warnings: string[] = [];
  if (bundle.deviceSchemaVersion !== schema.deviceSchemaVersion) {
    warnings.push(
      `Device settings were saved as schema v${bundle.deviceSchemaVersion}, this firmware speaks v${schema.deviceSchemaVersion}. The device will refuse them.`,
    );
  }
  if (bundle.profileSchemaVersion !== schema.profileSchemaVersion) {
    warnings.push(
      `Profiles were saved as schema v${bundle.profileSchemaVersion}, this firmware speaks v${schema.profileSchemaVersion}. The device will refuse them.`,
    );
  }
  if (bundle.board && schema.boardId !== undefined && bundle.board !== schema.boardId) {
    warnings.push(
      `Saved from a ${bundle.board}, and this device is wired as ${schema.boardId || "a custom board"}. Pin assignments in particular may not transfer.`,
    );
  }
  if (bundle.fw && bundle.fw !== schema.fw) {
    warnings.push(`Saved from firmware ${bundle.fw}, this device runs ${schema.fw}.`);
  }
  if (!Array.isArray(bundle.profiles)) {
    return { error: "Bundle has no profiles array.", warnings };
  }

  return { bundle: bundle as ConfigBundle, warnings };
}

/**
 * Every key whose value differs between two payload sets, in the dirty-set form the app uses.
 *
 * Loading a file replaces local state wholesale, and the honest way to report that is the set of
 * fields that actually changed - not "everything is dirty", which would send fields the device
 * already agrees with.
 *
 * A key the incoming payload does not carry is *not* changed. That distinction only started to
 * matter with MOH-16: the firmware has always treated a partial LOAD_DEVICE as "change what I
 * mention and nothing else", but this walked the whole schema tree, read an absent key as
 * `undefined`, counted it as different from whatever the device held, and then wrote it. A file
 * describing only the wiring would have blanked every setting it did not name.
 */
export function diffKeys(
  schema: Schema,
  from: { device: unknown; profiles: unknown[] },
  to: { device: unknown; profiles: unknown[] },
): Set<string> {
  const changed = new Set<string>();

  const concreteKeys: string[] = [];
  // Fire-mode properties by leaf name. The tree names them per mode, but only for the modes the
  // *active* profile has, and a bundle spans all three slots - so the property list is taken from
  // the tree and the mode indices from each slot's own fireModes array below.
  const fireModeLeaves: string[] = [];
  walk(schema.tree, (node) => {
    if (!node.key || storageOf(node) !== "config") return;
    if (isFireModeRow(node.key)) fireModeLeaves.push(fireModeLeafOf(node.key));
    else concreteKeys.push(node.key);
  });

  // `undefined` on the right means the payload is silent about this key, which is not a value.
  // JSON has no undefined, so nothing a file can legitimately contain reaches this as one.
  const differs = (a: unknown, b: unknown) =>
    b !== undefined && JSON.stringify(a) !== JSON.stringify(b);

  for (const key of new Set(concreteKeys)) {
    if (key.startsWith("device:")) {
      if (differs(getByKey(from.device, key), getByKey(to.device, key))) changed.add(key);
    } else {
      for (let slot = 0; slot < Math.max(from.profiles.length, to.profiles.length); slot++) {
        if (differs(getByKey(from.profiles[slot], key), getByKey(to.profiles[slot], key))) {
          changed.add(`${slot}:${key}`);
        }
      }
    }
  }

  // Per-mode fields, across every mode each slot actually holds.
  for (const leaf of new Set(fireModeLeaves)) {
    for (let slot = 0; slot < Math.max(from.profiles.length, to.profiles.length); slot++) {
      const count = Math.max(
        ((from.profiles[slot] as { fireModes?: unknown[] })?.fireModes ?? []).length,
        ((to.profiles[slot] as { fireModes?: unknown[] })?.fireModes ?? []).length,
      );
      for (let i = 0; i < count; i++) {
        const key = `profile:fireModes[${i}].${leaf}`;
        if (differs(getByKey(from.profiles[slot], key), getByKey(to.profiles[slot], key))) {
          changed.add(`${slot}:${key}`);
        }
      }
    }
  }

  return changed;
}

/** Hands the browser a file to save. */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Filename that says which blaster and when, so a folder of backups stays readable. */
export function bundleFilename(device: unknown, now: Date): string {
  const name = ((device as { blasterName?: string })?.blasterName ?? "trifolium")
    .trim()
    .replace(/[^A-Za-z0-9-_]+/g, "-")
    .replace(/^-|-$/g, "");
  const stamp = now.toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return `${name || "trifolium"}-${stamp}.json`;
}
