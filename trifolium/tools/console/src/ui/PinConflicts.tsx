import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { walk, type PinConflict, type Schema } from "../schema/types";

// What the boot-time conflict engine had to give up, from DUMP_SCHEMA's header.
//
// This is the only durable channel for it. The engine also calls logger.error, but src/bootStatus.h
// records why that does not reach anyone: boot faults print before the host has re-enumerated the
// USB CDC port, so nothing catches them live. Without this panel a resolved
// conflict is invisible - the form goes on showing the pin the user typed while the device has
// detached it, and the input simply does nothing.
//
// Nothing is rendered when the array is empty, and that is deliberate rather than lazy. An empty
// list means nothing *collided*, not that the wiring is right: a pin can be wrong, unwired or on
// the wrong header without ever contesting another claim. A green "no conflicts" badge would read
// as an all-clear the firmware never gave.

/** PIN_NOT_USED. A conflict can name no pin at all - a motor whose ESC channel is unwired. */
const PIN_UNUSED = 255;

/**
 * What the chip cannot do, as opposed to what something else already claimed.
 *
 * The firmware puts both in one array because both end in something being taken away, and both are
 * resolved at the same moment. They read differently though: a collision names two things the user
 * chose, and a capability names one thing the silicon does not offer.
 */
const CAPABILITY: Record<string, string> = {
  notAnAdcPin: "has no ADC channel — only GPIO 26-29 do",
  i2cPair: "is not a pair any I2C block can serve — a GPIO's I2C role is fixed by pin % 4",
};

/** The schema row label for a device field, so the banner names the field the way the form does. */
export function labelsByField(schema: Schema): Map<string, string> {
  const out = new Map<string, string>();
  walk(schema.tree, (node) => {
    if (node.key?.startsWith("device:")) out.set(node.key.slice("device:".length), node.label);
  });
  return out;
}

/**
 * One conflict as a sentence.
 *
 * `against` is either another settings field or a fixture on the board ("i2cScl", an ESC channel),
 * and the firmware does not say which - so it is passed through the same label lookup and falls
 * back to its own spelling, which is what a board fixture wants anyway.
 */
export function describeConflict(entry: PinConflict, labels: Map<string, string>): string {
  const name = (field: string) => labels.get(field) ?? field;
  const pin = entry.pin === PIN_UNUSED ? null : `GPIO ${entry.pin}`;

  switch (entry.action) {
    case "pinCleared":
      return CAPABILITY[entry.against]
        ? `${name(entry.field)} is ${pin}, which ${CAPABILITY[entry.against]}. It is detached for this boot.`
        : `${name(entry.field)} is ${pin}, which ${name(entry.against)} already claims. It is detached for this boot.`;
    case "motorDisabled":
      return pin
        ? `${name(entry.field)} shares ${pin} with ${name(entry.against)}, so the motor is disabled for this boot.`
        : `${name(entry.field)} has no ESC pin in this wiring, so the motor is disabled.`;
    case "pusherDisabled":
      return pin
        ? `The pusher is ${pin}, which ${name(entry.against)} already claims, so the pusher is disabled for this boot.`
        : "The pusher ESC channel has no pin in this wiring, so the pusher is disabled.";
    case "displayOff":
      return CAPABILITY[entry.against]
        ? `The I2C pair ${CAPABILITY[entry.against]}. The display is off and the bus was never started, which is what keeps an illegal pin out of setSDA().`
        : `The I2C bus needs ${pin}, which ${name(entry.against)} already claims, so the display is off for this boot.`;
    case "pinWarning":
      return `${name(entry.field)} is ${pin}, which ${CAPABILITY[entry.against] ?? `is flagged: ${entry.against}`}. Nothing was changed — this is worth a look, not a fix.`;
    default:
      // Firmware newer than this console can add an action. Say what it said rather than dropping
      // the entry, which would hide the one thing this panel exists to show.
      return `${name(entry.field)}${pin ? ` (${pin})` : ""} - ${entry.action}, against ${entry.against}.`;
  }
}

export function PinConflicts({ schema }: { schema: Schema }) {
  const all = schema.pinConflicts ?? [];
  // An advisory took nothing away, so it must not raise the alarm a loss does. Nothing records one
  // today; the split is what keeps one from reading as a fault if something does.
  const entries = all.filter((e) => e.action !== "pinWarning");
  const warnings = all.filter((e) => e.action === "pinWarning");
  if (!entries.length && !warnings.length) return null;

  const labels = labelsByField(schema);

  // The one resolution that takes away the route used to fix it. Called out separately for the
  // same reason pinConflicts.cpp logs it separately, rather than as one line among several.
  const menuLost = entries.some((e) => e.field === "menuButtonPin" && e.action === "pinCleared");

  return (
    <Alert severity={entries.length ? "warning" : "info"} sx={{ py: 0.5 }}>
      <AlertTitle sx={{ mb: 0.25, fontSize: 13 }}>
        {!entries.length
          ? `${warnings.length} pin${warnings.length === 1 ? "" : "s"} worth a look`
          : entries.length === 1
            ? "This device resolved a pin conflict at boot"
            : `This device resolved ${entries.length} pin conflicts at boot`}
      </AlertTitle>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {[...entries, ...warnings].map((entry, i) => (
          <Typography key={`${entry.field}-${i}`} component="li" variant="caption" sx={{ display: "block" }}>
            {describeConflict(entry, labels)}
          </Typography>
        ))}
      </Box>
      {menuLost && (
        <Typography variant="caption" sx={{ display: "block", mt: 0.5, fontWeight: 600 }}>
          The menu button is unassigned, so the on-device menu cannot be opened. It can only be put
          back from here.
        </Typography>
      )}
      {entries.length > 0 && (
        <Typography variant="caption" sx={{ display: "block", mt: 0.5 }}>
          Resolved in RAM only — the stored config still holds what you set, so the fields below
          show your values and this returns on every boot until they change.
        </Typography>
      )}
    </Alert>
  );
}
