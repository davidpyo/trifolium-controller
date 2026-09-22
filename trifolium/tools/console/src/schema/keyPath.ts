// Reading and writing a value in a DUMP_DEVICE / DUMP_PROFILE payload, given a schema key.
//
// Keys come from the firmware in "store:path" form, matching the JSON exactly as
// DeviceStore::toJson / ProfileStore::toJson emit it:
//
//   device:blasterName
//   device:motorConfig[0].motorKv
//   profile:revRPM[2]
//   profile:fireModes[3].burstLength
//
// There is no mapping table anywhere: the key *is* the JSON path. Firmware older than the resolved
// fire-mode keys emitted `fireModes[*]`; `[*]` is not an index, so such a key parses as unusable and
// reads as undefined rather than throwing - see parseKey().

export type Store = "device" | "profile";

export interface ParsedKey {
  store: Store;
  /** Path segments: strings index objects, numbers index arrays. */
  segments: (string | number)[];
  /**
   * False when a subscript was not a number, which today means only one thing: a `fireModes[*]` key
   * from firmware that predates resolved fire-mode keys. Such a key names no value, so reads return
   * undefined and writes are refused, rather than either throwing and taking the page down.
   */
  usable: boolean;
}

const STORES: Store[] = ["device", "profile"];

export function parseKey(key: string): ParsedKey {
  const colon = key.indexOf(":");
  if (colon < 0) throw new Error(`key "${key}" has no store prefix`);

  const store = key.slice(0, colon) as Store;
  if (!STORES.includes(store)) throw new Error(`key "${key}" has unknown store "${store}"`);

  const segments: (string | number)[] = [];
  let usable = true;

  for (const part of key.slice(colon + 1).split(".")) {
    // Each dotted part is `name` optionally followed by any number of [index] groups.
    const match = /^([A-Za-z_][A-Za-z0-9_]*)((?:\[[^\]]*\])*)$/.exec(part);
    if (!match) throw new Error(`key "${key}" has unparseable segment "${part}"`);

    segments.push(match[1]);
    for (const [, index] of match[2].matchAll(/\[([^\]]*)\]/g)) {
      const n = Number(index);
      if (!Number.isInteger(n) || n < 0) {
        usable = false;
        segments.push(index);
      } else {
        segments.push(n);
      }
    }
  }

  return { store, segments, usable };
}

type Json = unknown;

/** Reads the value a key points at, or undefined if any step of the path is absent. */
export function getByKey(payload: Json, key: string): Json {
  const { segments, usable } = parseKey(key);
  if (!usable) return undefined;

  let cursor: Json = payload;
  for (const segment of segments) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof segment === "number") {
      if (!Array.isArray(cursor)) return undefined;
      cursor = cursor[segment];
    } else {
      if (typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
      cursor = (cursor as Record<string, Json>)[segment];
    }
  }
  return cursor;
}

/**
 * Returns a copy of `payload` with the key set to `value`, creating intermediate objects/arrays as
 * needed. Copy rather than mutate so React state updates stay predictable.
 */
export function setByKey<T extends Json>(payload: T, key: string, value: Json): T {
  const { segments, usable } = parseKey(key);
  if (!usable) return payload;

  const clone = (node: Json, wantArray: boolean): Json => {
    if (Array.isArray(node)) return [...node];
    if (node && typeof node === "object") return { ...(node as object) };
    return wantArray ? [] : {};
  };

  const root = clone(payload, Array.isArray(payload)) as Record<string | number, Json>;
  let cursor: Record<string | number, Json> = root;

  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    const nextIsIndex = typeof segments[i + 1] === "number";
    cursor[segment] = clone(cursor[segment], nextIsIndex);
    cursor = cursor[segment] as Record<string | number, Json>;
  }

  cursor[segments[segments.length - 1]] = value;
  return root as T;
}

/**
 * Builds the smallest payload that sets just these keys, plus the schemaVersion the device
 * requires.
 *
 * LOAD_DEVICE / LOAD_PROFILE overlay onto existing values (`out.x = doc["x"] | out.x`), so a partial
 * object is legal and only what changed needs sending. The device rejects a payload whose
 * schemaVersion is not its own rather than applying it, so this is not optional.
 */
export function buildPatch(
  schemaVersion: number,
  entries: { key: string; value: Json }[],
): Record<string, Json> {
  let patch: Record<string, Json> = { schemaVersion };
  let store: Store | undefined;
  for (const { key, value } of entries) {
    const parsed = parseKey(key);
    // The two stores are separate commands with separate schema versions, so mixing them in one
    // payload would silently drop half the edits.
    if (store && parsed.store !== store) {
      throw new Error(`buildPatch got both "${store}" and "${parsed.store}" keys`);
    }
    store = parsed.store;
    patch = setByKey(patch, key, value);
  }
  return patch;
}
