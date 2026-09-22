import React from "react";

// Which fields have been edited but not yet sent to the blaster.
//
// A context rather than a prop because the editors are reached by several routes - the generic form,
// the motor matrix, the wiring table, the RPM editor - and every one of them ends up calling
// FieldControl. Threading a set through all of them would mean four chances to forget.
//
// Keys are plain schema keys ("device:motorKv", "profile:revRPM[0]"), already narrowed to the slot
// on screen: App holds profile edits as "slot:key" so the three slots stay independent, and that
// spelling is not something a field should have to know about.

export const DirtyKeys = React.createContext<ReadonlySet<string>>(new Set<string>());

/** True when this field holds an edit the device has not been told about yet. */
export function useIsDirty(key: string | undefined): boolean {
  const dirty = React.useContext(DirtyKeys);
  return key !== undefined && dirty.has(key);
}
