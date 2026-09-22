// The wiring presets, and what applying one means.
//
// A board is a pin config preset and nothing more. The firmware has no board table any more, so
// there is no `LIST_BOARDS` to ask and no `SET_BOARD` to send: the console holds the presets, and
// applying one is an ordinary partial `LOAD_DEVICE`.
//
// They are compiled in, not fetched. The built page is one self-contained classic script that has
// to work from `file://`, where an opaque origin makes every fetch fail - so a presets folder
// sitting next to the HTML would break exactly the case the single-file build exists for.

// One folder per board, holding its wiring and its two drawings.
//
// There is no index naming them. The folders *are* the list, so adding a board is adding a folder
// and nothing else: no second place to register it, and no way to add one the console then
// silently does not offer.
//
// `import: "default"` matters: without it the glob hands back module namespace objects, and a
// namespace carries a `default` key of its own. That key would be filtered by nothing here and
// sent to the device as a setting, which the firmware would ignore - a mistake with no symptom
// until a real key collided with it.
const presetFiles = import.meta.glob<PresetFile>("../../../../boards/*/board.json", {
  eager: true,
  import: "default",
});

/**
 * The shape of one `trifolium/boards/<id>/board.json`. See the README there.
 *
 * A preset **is** a `LOAD_DEVICE` payload: the wiring keys sit at the top level beside
 * `schemaVersion`, so the file can be sent to a device with no transform anywhere -
 * a LOAD_DEVICE of the file is the whole of it. The descriptive keys ride along and the firmware
 * ignores what it does not read.
 */
export interface PresetFile {
  kind?: string;
  presetVersion?: number;
  id?: string;
  name?: string;
  notes?: string[];
  /** Board ids a device may still report from the firmware that had a board table. */
  aliases?: string[];
  /** A board no longer offered, kept so a device that stored its id is still recognised. */
  retired?: boolean;
  /** `telem` and `escADC`, recorded so the information is not lost. Nothing reads them. */
  unread?: Record<string, number>;
  schemaVersion?: number;
  /** ...and then the wiring keys, at the top level. */
  [key: string]: unknown;
}

export interface Preset {
  id: string;
  name: string;
  schemaVersion: number;
  notes: string[];
  /** Ids this board answers to besides its own. */
  aliases: string[];
  /** Recognised, but not offered in the picker. */
  retired: boolean;
  /** The wiring keys alone, with the descriptive ones filtered out. */
  wiring: Record<string, unknown>;
}

export const PRESET_KIND = "trifolium-wiring-preset";

/**
 * Keys in a preset file that describe the preset rather than the device.
 *
 * The file doubles as a config payload, so this is the line between the two halves, and it is the
 * one thing the format asks anyone to remember.
 */
const DESCRIPTIVE_KEYS = new Set(["kind", "presetVersion", "id", "name", "notes", "unread",
                                  "schemaVersion", "aliases", "retired"]);

/** `device:boardId` - provenance the device stores and echoes but never interprets. */
export const BOARD_ID_KEY = "device:boardId";
/** `device:wiringConfigured` - the boot gate. False means the device drives no GPIO at all. */
export const WIRING_CONFIGURED_KEY = "device:wiringConfigured";

function collect(): Preset[] {
  const presets: Preset[] = [];
  for (const file of Object.values(presetFiles)) {
    if (file?.kind !== PRESET_KIND) continue;
    if (!file.id) continue;
    const wiring: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(file)) {
      if (!DESCRIPTIVE_KEYS.has(key)) wiring[key] = value;
    }
    presets.push({
      id: file.id,
      name: (file.name as string) ?? file.id,
      schemaVersion: file.schemaVersion ?? 0,
      notes: (file.notes as string[]) ?? [],
      aliases: (file.aliases as string[]) ?? [],
      retired: file.retired === true,
      wiring,
    });
  }

  // Newest first, which under this naming scheme is the id backwards: trifolium_v1_4 before v1_3,
  // and a board whose folder is added tomorrow sorts itself. It is a convention rather than a fact
  // - a family named late in the alphabet leads - and it is the price of never maintaining a list.
  return presets.sort((a, b) => b.id.localeCompare(a.id));
}

export const PRESETS: Preset[] = collect();

export function presetById(id: string | undefined): Preset | undefined {
  if (!id) return undefined;
  return PRESETS.find((p) => p.id === id);
}

/**
 * The preset a stored `boardId` refers to, following the alias table.
 *
 * Aliases exist because the board table used to name FET and ESC variants separately
 * ("trifolium_v1_2_fet"), and a device upgraded from that firmware still carries the old string.
 * The firmware cannot resolve it - there is nothing left on the device to resolve it against - so
 * this is the side that does, which is the point of holding the presets here.
 */
export function presetForBoardId(id: string | undefined): Preset | undefined {
  if (!id) return undefined;
  // Each board carries the ids it answers to, so an alias cannot name a board that does not exist.
  // Two boards claiming one id still can - see the uniqueness test in presets.test.ts.
  return presetById(id) ?? PRESETS.find((p) => p.aliases.includes(id));
}

/** The boards the picker offers: every board that has not been retired. */
export const OFFERED_PRESETS: Preset[] = PRESETS.filter((p) => !p.retired);

/** A label for an id that names no preset, so a custom or unknown wiring still says something. */
export function wiringLabel(id: string | undefined): string {
  if (!id) return "Custom wiring";
  return presetForBoardId(id)?.name ?? id;
}

/**
 * Whether the device's stored wiring still matches the preset it says it came from.
 *
 * The device cannot answer this: `boardId` is provenance it never interprets, and there is no table
 * to compare against. Only the side holding the presets can, which is why the question is asked
 * here. An id naming no preset is not "modified" - it is unknown, which is a different thing.
 */
export function presetDrift(
  device: unknown,
  id: string | undefined,
): { preset: Preset; changed: string[] } | null {
  const preset = presetForBoardId(id);
  if (!preset) return null;
  const values = (device ?? {}) as Record<string, unknown>;
  const changed = Object.keys(preset.wiring)
    // boardId is the provenance itself and wiringConfigured is the boot gate, not wiring: neither
    // differing would mean the pins had moved.
    .filter((key) => key !== "boardId" && key !== "wiringConfigured")
    .filter((key) => JSON.stringify(values[key]) !== JSON.stringify(preset.wiring[key]));
  return { preset, changed };
}

/**
 * The `LOAD_DEVICE` entries that apply a preset, in the console's `{key, value}` form.
 *
 * Store-qualified here rather than in the file, because the file is the wiring and the prefix is
 * this console's addressing. Everything a preset does not name is left exactly as it is on the
 * device - which is the firmware's own rule for a partial load, not something arranged here.
 */
export function presetEntries(preset: Preset): { key: string; value: unknown }[] {
  return Object.entries(preset.wiring).map(([key, value]) => ({ key: `device:${key}`, value }));
}

