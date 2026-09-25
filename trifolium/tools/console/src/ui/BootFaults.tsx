import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { BootStatus, ConfigFault } from "../schema/types";

// The config-load paths that discarded user data at boot, from DUMP_BOOT's `configFaults`.
//
// Each of these already prints over serial, and each prints into the same gap everything else at
// boot does - before the host has re-enumerated the port - so the one time it matters, a user
// asking where their settings went, nobody can answer. This is the answer.
//
// Only a file read off flash is recorded. A bad upload fails in front of the host that sent it and
// needs no durable record, which is why a LOAD_DEVICE refusal never turns up here.

/**
 * What was lost, and what the user should do about it.
 *
 * `detail` is free text from the firmware - the version it refused, the board id it did not know -
 * so it is shown as evidence rather than parsed.
 */
function describe(fault: ConfigFault): { text: string; advice?: string } {
  switch (fault.fault) {
    case "deviceVersionRefused":
      return {
        text: "The stored device settings could not be migrated to this firmware, so every device setting went back to its factory default.",
        advice:
          "The wiring went with them. Load a backup if you have one, rather than re-typing from the form below.",
      };
    case "profileVersionRefused":
      return {
        text: "A stored profile could not be migrated to this firmware, so that slot is holding factory defaults.",
        advice: "Check each slot below before writing anything: a write saves the defaults over it.",
      };
    case "wiringUnavailable":
      return {
        text: "The stored config predates this firmware's stored wiring, so the device came up driving nothing.",
        // The distinction the picker cannot make on its own, and the reason this panel exists: it
        // looks like a device nobody configured, and it is one whose pins this build cannot know.
        advice:
          "Nothing was lost but the pin assignments — your tuning, profiles and switch wiring are still there. This firmware has no board table to rebuild the rest from, so load the matching preset once; the picker has it selected.",
      };
    default:
      // Firmware newer than this console can record a fault this build has no wording for. Say
      // that something was discarded rather than dropping the entry.
      return { text: `Boot fault "${fault.fault}" — some stored configuration was discarded.` };
  }
}

export function BootFaults({ boot }: { boot: BootStatus | null }) {
  const faults = boot?.configFaults ?? [];
  if (!faults.length) return null;

  return (
    <Alert severity="error" sx={{ py: 0.5 }}>
      <AlertTitle sx={{ mb: 0.25, fontSize: 13 }}>
        {faults.length === 1
          ? "This device discarded stored settings at boot"
          : `This device discarded stored settings at boot (${faults.length} faults)`}
      </AlertTitle>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {faults.map((fault, i) => {
          const { text, advice } = describe(fault);
          return (
            <Box component="li" key={`${fault.fault}-${i}`}>
              <Typography variant="caption" sx={{ display: "block" }}>
                {text}
                {fault.detail && (
                  <Box component="span" sx={{ color: "text.secondary" }}>
                    {" "}
                    ({fault.detail})
                  </Box>
                )}
              </Typography>
              {advice && (
                <Typography variant="caption" sx={{ display: "block", fontWeight: 600 }}>
                  {advice}
                </Typography>
              )}
            </Box>
          );
        })}
      </Box>
    </Alert>
  );
}
