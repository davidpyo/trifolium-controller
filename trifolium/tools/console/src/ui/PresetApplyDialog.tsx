import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import type { Preset } from "../schema/presets";

export interface PresetApplyDialogProps {
  preset: Preset;
  /** What the device says its wiring came from, for the "you are replacing this" line. */
  from: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Confirms loading a wiring preset onto a device that already has a wiring.
 *
 * Worth a dialog for one reason: a wrong board puts a wrong pinout on live hardware, which is why
 * the firmware gives none of these fields an OLED row. The second thing it has to say is what a
 * preset does and does not cover - it replaces every pin, including any the user set by hand, and
 * touches nothing else at all.
 *
 * Not shown on a device with no wiring: there is nothing to overwrite there, and the picker itself
 * already carries the warning.
 */
export function PresetApplyDialog({
  preset,
  from,
  busy,
  onCancel,
  onConfirm,
}: PresetApplyDialogProps) {
  return (
    <Dialog open onClose={busy ? undefined : onCancel} maxWidth="sm">
      <DialogTitle>Load the {preset.name} wiring?</DialogTitle>
      <DialogContent>
        <DialogContentText component="div">
          <p>
            This device is currently wired as <strong>{from}</strong>. Loading this preset repoints
            every motor, pusher, screen and switch pin at {preset.name}&rsquo;s. If that is not the
            board in your hands, it will drive the wrong pins.
          </p>
          <p>
            Every pin moves, including any you set by hand. Profiles, tuning and fire modes are not
            part of a wiring preset and are not touched.
          </p>
          {preset.notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
          <p>The device saves the wiring and restarts.</p>
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={onConfirm} color="warning" variant="contained" disabled={busy}>
          {busy ? "Loading..." : "Load wiring"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
