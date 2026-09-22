// Shape of a DUMP_SCHEMA reply.
//
// The firmware generates this by walking its live menu tree (src/schemaDump.cpp), so nothing here
// hardcodes a bound, a label or a range. If a field's limits change in firmware, this console
// follows without an edit. That is the whole point of the design - do not add a second copy of any
// bound to this codebase.
//
// Fields the firmware omits when they hold their default value are optional here, which is why
// several are typed as a literal (`visible?: false`) rather than boolean: absent means the default.

export type ItemKind = "group" | "action" | "bool" | "int" | "float" | "enum" | "text";

/**
 * One clause of a `visibleWhen` rule. Terms are ANDed.
 *
 * `value` is always a string: the stored id for an enum, "true"/"false" for a bool. The firmware
 * spells both that way rather than giving bools a second encoding, so the reader normalises the
 * config's JSON boolean to match rather than the rule carrying two shapes.
 */
export interface VisibilityTerm {
  key: string;
  op: "eq" | "ne";
  value: string;
}

/** Why a row may legitimately have no `key`. Absent means "config", the only kind with a key. */
export type ItemStorage = "config" | "derived" | "live";

export interface SchemaNode {
  label: string;
  kind: ItemKind;

  /** "store:path", e.g. "profile:spindownSpeed" or "device:motorConfig[0].kp". */
  key?: string;

  /**
   * "derived" is an editing view over fields other rows already expose - per-stage RPM writes
   * revRPM[]/idleRPM[], which the per-motor rows carry by key. "live" is runtime state that is
   * never persisted, i.e. the active fire mode. Both are keyless by design.
   */
  storage?: Exclude<ItemStorage, "config">;

  /** Omitted when true. A hidden row is one the current configuration does not use. */
  visible?: false;
  /**
   * The rule behind `visible`, for rows whose visibility follows a stored setting.
   *
   * Its absence is an interface, not an omission: most rows carry none, because their rule reads a
   * resolved pin or a board property, both of which are settled at boot and would be wrong to
   * re-derive from an unsaved form. Re-evaluate only what carries a rule - see schema/visibility.
   */
  visibleWhen?: VisibilityTerm[];
  /** Omitted when true. Row stays but refuses editing, with `locked` explaining why. */
  editable?: false;
  locked?: string;

  /** Omitted when false. Setting only takes effect after a reboot. */
  reboot?: true;
  /**
   * Omitted when true. False for real settings with no on-device editor (pins and friends).
   *
   * The console deliberately does not read this. It is a firmware-side marker - "no OLED row", and
   * so "survives a factory reset" - and a browser has no reason to render such a field differently
   * from any other. Kept in the type because it is on the wire.
   */
  onDevice?: false;

  /** "seconds" means stored in ms, shown in whole seconds. `step` is the display granularity. */
  display?: string;

  // Present for int/float/enum. Integers in the *stored* unit; float scales by 10^decimals.
  lo?: number;
  hi?: number;
  step?: number;
  decimals?: number;

  /** Present for enum. Indexed by the stored ordinal. */
  options?: string[];
  /**
   * The stored value for each option, parallel to `options`. Present on every enum backed by a
   * C++ enum, whose config value is a name rather than an ordinal - see the firmware's enumIds.h.
   * Absent where the value genuinely is its number (a fire-mode or profile index).
   */
  optionValues?: string[];

  // Present for text.
  maxLen?: number;
  charset?: string;

  /** Present only if the walker hit its depth cap, which would be a firmware bug. */
  truncated?: true;

  children?: SchemaNode[];
}

/**
 * One resolution the boot-time conflict engine made, from the schema header's `pinConflicts`.
 *
 * Resolution happens in RAM only - the stored config keeps what the user wrote, so the array
 * re-reports on every boot rather than the intent being erased. That is what makes this worth
 * showing: the form goes on displaying the pin the user typed while the device is not using it.
 */
export interface PinConflict {
  /** The losing setting: a stored pin key's leaf ("triggerSwitchPin"), "motor3", or "pusher". */
  field: string;
  /** The contested GPIO, or 255 when there was none to contest. */
  pin: number;
  /**
   * What it lost to: another pin field, an output like "i2cScl", or - for the two capability
   * verdicts - what the chip cannot do ("notAnAdcPin", "i2cPair").
   */
  against: string;
  /**
   * `pinWarning` is the one that took nothing away: the pin works and is simply worth a look.
   * Nothing in the firmware records one today, but it stays rendered and counted apart, so an
   * advisory can never read as a fault.
   */
  action: "pinCleared" | "motorDisabled" | "pusherDisabled" | "displayOff" | "pinWarning";
}

/** Per-mode resolution of the fields the shared fire-mode editor exposes. */
export interface FireModeCapField {
  /**
   * The shared row's declared key, subscript included - the firmware emits it unresolved here, since
   * a capability describes what a burst mode allows wherever it is used rather than in one slot.
   * Match it on the leaf, not whole: a tree row names a mode, this does not.
   */
  key: string;
  visible: boolean;
  lo?: number;
  hi?: number;
  step?: number;
}

export interface FireModeCap {
  burstMode: string;
  name: string;
  fields: FireModeCapField[];
}

export interface Schema {
  cmd: "DUMP_SCHEMA";
  fw: string;
  /**
   * Which preset the device's wiring says it came from, or "" for wiring nobody based on one.
   *
   * Provenance: the firmware stores it, echoes it and never interprets it. Matching it against a
   * preset is this console's job, because this is the side holding the presets - see
   * schema/presets. Optional, because firmware predating it omits the field.
   */
  boardId?: string;
  /**
   * The boot gate. False means the device drives no GPIO at all - no motors, pusher or screen.
   *
   * Absent must not read as false: firmware predating this field does have a pinout, and putting a
   * preset picker in front of a working blaster would be the worse mistake. See hasWiring().
   */
  wiringConfigured?: boolean;
  deviceSchemaVersion: number;
  profileSchemaVersion: number;
  activeProfileIndex: number;
  profileCount: number;
  maxFireModes: number;
  activeModeCount: number;
  /**
   * Null when the mode list is full: the firmware refuses to borrow a live slot to probe with. The
   * tree still carries correct bounds for every mode that exists, so all that is lost is the preview
   * of what a not-yet-selected mode would allow.
   */
  fireModeCaps: FireModeCap[] | null;
  /**
   * What the boot-time conflict engine had to give up, empty on a healthy device.
   *
   * Optional only for firmware predating the engine. An absent array is not an all-clear and
   * neither is an empty one - it says nothing collided, not that the wiring is right.
   */
  pinConflicts?: PinConflict[];
  tree: SchemaNode[];
}

/** A DUMP_BOOT reply. Boot faults print before a host can attach, so this is the durable channel. */
export interface BootStatus {
  cmd: "DUMP_BOOT";
  ok: boolean;
  display: { probed: boolean; ok: boolean; err: string };
  wiring: { boardId: string; configured: boolean };
  /**
   * The config-load paths that discarded user data on this boot. Optional for firmware predating
   * them; absent and empty mean different things, so don't collapse them.
   */
  configFaults?: ConfigFault[];
}

export interface ConfigFault {
  /**
   * `wiringUnavailable` is the MOH-16 upgrade: the stored config predates stored wiring, and with
   * the board table gone there is nothing left on the device to rebuild the pins from. Its
   * `detail` is the board id that config named, which is exactly what picks the right preset.
   */
  fault: "deviceVersionRefused" | "profileVersionRefused" | "wiringUnavailable";
  /** Free text from the firmware - the refused version, or the board id a preset can be found by. */
  detail: string;
}

// --- Convenience readers, so the "absent means default" rule lives in one place ----------------

export const isVisible = (n: SchemaNode): boolean => n.visible !== false;
export const isEditable = (n: SchemaNode): boolean => n.editable !== false;
export const needsReboot = (n: SchemaNode): boolean => n.reboot === true;
export const storageOf = (n: SchemaNode): ItemStorage => n.storage ?? "config";

/** True for rows that edit one concrete stored setting, i.e. what a generic config form renders. */
export const isConfigField = (n: SchemaNode): boolean =>
  storageOf(n) === "config" &&
  n.key !== undefined &&
  n.kind !== "group" &&
  n.kind !== "action";

/**
 * True for a row of the Select-Fire mode editor, whatever subscript it carries.
 *
 * Matches the subscript loosely on purpose. Current firmware resolves the index per mode
 * ("profile:fireModes[2].burstLength"); firmware from before that emits one shared row spelled
 * "[*]". Either way the row belongs to the purpose-built editor and not to the generic form, so
 * every caller that is asking "is this the generic form's business" wants this, not the index.
 */
export const isFireModeRow = (key: string | undefined): boolean =>
  key?.startsWith("profile:fireModes[") ?? false;

/** The mode a fire-mode row edits, or null when the subscript is not one - see isFireModeRow. */
export const fireModeIndexOf = (key: string | undefined): number | null => {
  const m = /^profile:fireModes\[(\d+)\]\./.exec(key ?? "");
  return m ? Number(m[1]) : null;
};

/** The property a fire-mode row edits, with the mode subscript stripped off. */
export const fireModeLeafOf = (key: string | undefined): string => key?.split(".").pop() ?? "";

/** Depth-first walk over the tree, parents before children. */
export function walk(
  nodes: SchemaNode[],
  visit: (node: SchemaNode, path: SchemaNode[]) => void,
  path: SchemaNode[] = [],
): void {
  for (const node of nodes) {
    visit(node, path);
    if (node.children) walk(node.children, visit, [...path, node]);
  }
}
