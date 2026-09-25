import React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { OFFERED_PRESETS, PRESETS, type Preset } from "../schema/presets";

export interface PresetPickerProps {
  busy: boolean;
  /** The board id the device already stored, if any - see the upgrade note below. */
  storedBoardId?: string;
  /** The preset that id names, resolved through the alias table by the caller. */
  suggested?: Preset;
  onApply: (preset: Preset) => void;
  onCustom: () => void;
}

/**
 * The first thing a device with no wiring shows.
 *
 * Three ways to get here, and the copy has to serve all of them: a device flashed with the released
 * .uf2, which ships with no wiring at all; a device whose wiring was cleared with RESET_PINS; and a
 * device upgraded across MOH-16, whose stored config named a board this firmware has no pinout for.
 * The last of those still carries the board id, which is what `suggested` is - the console holds the
 * presets, so it is the side that can turn that id back into pins.
 *
 * This replaces the form rather than sitting alongside it. With no wiring the device drives nothing:
 * motors, pusher and display are all unbuilt, so there is nothing for the form to edit.
 */
export function PresetPicker({
  busy,
  storedBoardId,
  suggested,
  onApply,
  onCustom,
}: PresetPickerProps) {
  const [id, setId] = React.useState(suggested?.id ?? "");
  // Resolved against every board, not just the offered ones: a retired board still has to apply.
  const chosen = PRESETS.find((p) => p.id === id);

  // A retired board is recognised but not listed - except when the device reported it, which is
  // the case `retired` exists for. Leaving it out there would suggest a board the list cannot show.
  const offered = suggested?.retired ? [suggested, ...OFFERED_PRESETS] : OFFERED_PRESETS;

  if (!offered.length) {
    return (
      <Alert severity="error">
        This device has no wiring, and this console was built with no presets to offer. Nothing here
        can configure it.
      </Alert>
    );
  }

  return (
    <Stack spacing={2} sx={{ maxWidth: 560 }}>
      <Box>
        <Typography variant="h6" gutterBottom>
          Which board is this wired as?
        </Typography>
        <Typography variant="body2" color="text.secondary">
          This blaster has no wiring set, so it drives no pins at all — no motors, no pusher, no
          screen. Picking a board loads that board&rsquo;s pin assignments. Nothing else is touched:
          your profiles, tuning and fire modes are not part of a wiring preset.
        </Typography>
      </Box>

      {suggested && storedBoardId && (
        <Alert severity="info" sx={{ py: 0.5 }}>
          This device previously ran as <strong>{storedBoardId}</strong>. That firmware kept the pin
          assignments compiled in; this one stores them, so they need loading once.{" "}
          <strong>{suggested.name}</strong> is the matching preset and is selected below.
        </Alert>
      )}

      <TextField
        select
        size="small"
        label="Board"
        value={id}
        disabled={busy}
        onChange={(e) => setId(e.target.value)}
        helperText="Pick the controller board, not the blaster it is fitted to."
      >
        {offered.map((preset) => (
          <MenuItem key={preset.id} value={preset.id}>
            {preset.name}
          </MenuItem>
        ))}
      </TextField>

      {chosen?.notes.map((note) => (
        <Typography key={note} variant="caption" color="text.secondary">
          {note}
        </Typography>
      ))}

      <Alert severity="warning" sx={{ py: 0 }}>
        Pick the board you actually have. A wrong choice drives the wrong pins on real hardware.
      </Alert>

      <Box>
        <Button variant="contained" disabled={!chosen || busy} onClick={() => chosen && onApply(chosen)}>
          {busy ? "Applying..." : "Load this wiring and restart"}
        </Button>
        <Typography variant="caption" sx={{ display: "block", mt: 1 }} color="text.secondary">
          The device saves the wiring and restarts; the console reconnects on its own. You can
          change any pin afterwards from the Device tab.
        </Typography>
      </Box>

      <Box>
        {/*
          The custom path. Not a preset called "generic", deliberately: a template for a bare Pico
          would be backed by no schematic, so every default in it would be a fabrication that then
          gets driven - and a wrong default is worse than an absent one. This leaves every pin
          unused and opens the wiring table so each one is answered rather than proposed.
        */}
        <Button size="small" disabled={busy} onClick={onCustom}>
          My board is not listed — wire it by hand
        </Button>
        <Typography variant="caption" sx={{ display: "block" }} color="text.secondary">
          Opens the wiring table with every pin unused. The blaster stays inert until you say the
          wiring is complete.
        </Typography>
      </Box>
    </Stack>
  );
}
