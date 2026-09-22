// Whether the connected device has a wiring, and whether to ask for one.
//
// The successor to schema/boards.ts. The question changed with MOH-16: there is no board table to
// read a list out of any more, so this is about one stored flag, and the list of things to offer
// comes from schema/presets rather than from the device.

import type { Schema } from "./types";

/**
 * Whether the connected device has a wiring it will actually drive.
 *
 * Absent means yes. Only firmware predating the flag omits it, and such a device does have a
 * pinout - it was compiled with one, or it resolved one from the board table. Treating "missing" as
 * unconfigured would put a picker in front of a working blaster whose firmware has no way to
 * answer it.
 */
export function hasWiring(schema: Schema): boolean {
  return schema.wiringConfigured !== false;
}

/**
 * Whether to show the preset picker instead of the config form.
 *
 * Only ever for a live device. Offline the console renders the checked-in fixture, and an
 * unconfigured fixture would put a picker in front of a form nobody can submit.
 */
export function needsPresetPicker(schema: Schema, live: boolean): boolean {
  return live && !hasWiring(schema);
}
