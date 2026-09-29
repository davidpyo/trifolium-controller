import React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { BLASTERS, type Blaster } from "../config/blasters";
import { OFFERED_PRESETS, PRESETS, type Preset } from "../schema/presets";

const NO_BLASTER = "none";

export interface PresetPickerProps {
  busy: boolean;
  /** The board id the device already stored, if any - see the upgrade note below. */
  storedBoardId?: string;
  /** The preset that id names, resolved through the alias table by the caller. */
  suggested?: Preset;
  onApply: (preset: Preset) => void;
  /**
   * Offers a blaster config to load with the board. Only for a device with no wiring: a config
   * replaces every setting and profile, which on a device already set up is a Full Backup's job.
   */
  onApplyBlaster?: (board: Preset, blaster: Blaster) => void;
  onCustom: () => void;
}

/**
 * The first thing a device with no wiring shows: the board to wire it as, and optionally a blaster
 * config to start from instead of the firmware defaults.
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
  onApplyBlaster,
  onCustom,
}: PresetPickerProps) {
  const [id, setId] = React.useState(suggested?.id ?? "");
  // Resolved against every board, not just the offered ones: a retired board still has to apply.
  const chosen = PRESETS.find((p) => p.id === id);

  const offersBlasters = onApplyBlaster !== undefined && BLASTERS.length > 0;
  const [blasterId, setBlasterId] = React.useState(NO_BLASTER);
  const blaster = offersBlasters ? BLASTERS.find((b) => b.id === blasterId) : undefined;

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
        {offersBlasters ? (
          <Typography variant="body2" color="text.secondary">
            This blaster has no wiring set, so it drives no pins at all — no motors, no pusher, no
            screen. Picking a board loads that board&rsquo;s pin assignments. Load a blaster config
            with it to start from one of the published builds rather than the firmware defaults.
          </Typography>
        ) : (
          <Typography variant="body2" color="text.secondary">
            This blaster has no wiring set, so it drives no pins at all — no motors, no pusher, no
            screen. Picking a board loads that board&rsquo;s pin assignments. Nothing else is
            touched: your profiles, tuning and fire modes are not part of a wiring preset.
          </Typography>
        )}
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

      {offersBlasters && (
        <TextField
          select
          size="small"
          label="Blaster config"
          value={blasterId}
          disabled={busy}
          onChange={(e) => setBlasterId(e.target.value)}
          helperText="A published build's settings and profiles, in place of the firmware defaults. The pins stay the board's."
        >
          <MenuItem value={NO_BLASTER}>None (firmware defaults)</MenuItem>
          {BLASTERS.map((b) => (
            <MenuItem key={b.id} value={b.id}>
              {b.label}
            </MenuItem>
          ))}
        </TextField>
      )}

      <Alert severity="warning" sx={{ py: 0 }}>
        Pick the board you actually have. A wrong choice drives the wrong pins on real hardware.
      </Alert>

      <Box>
        <Button
          variant="contained"
          disabled={!chosen || busy}
          onClick={() => {
            if (!chosen) return;
            if (blaster) onApplyBlaster?.(chosen, blaster);
            else onApply(chosen);
          }}
        >
          {busy
            ? "Applying..."
            : blaster
              ? "Load the wiring and config, and restart"
              : "Load this wiring and restart"}
        </Button>
        <Typography variant="caption" sx={{ display: "block", mt: 1 }} color="text.secondary">
          {blaster
            ? "The device saves its settings and then each profile, restarting as it goes; the " +
              "console reconnects on its own. If your build wires anything differently from the " +
              "board's usual pins, change it afterwards in the Wiring tab."
            : "The device saves the wiring and restarts; the console reconnects on its own. You " +
              "can change any pin afterwards from the Device tab."}
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
