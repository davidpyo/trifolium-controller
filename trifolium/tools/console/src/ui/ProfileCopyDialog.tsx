import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";

export interface ProfileCopyDialogProps {
  /** The slot being copied from, and every slot's name for the picker. */
  from: number;
  names: string[];
  /** Currently chosen destination, or null until one is picked. */
  to: number | null;
  /** Which slot the device booted into - copying onto it restarts the blaster. */
  activeIndex: number;
  /** Unsaved edits on the source slot, which would otherwise be copied without being stored. */
  sourceDirty: boolean;
  busy: boolean;
  onPick: (to: number) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Confirms overwriting one profile slot with another.
 *
 * A dialog rather than a two-click control because the destination is destroyed and there is no
 * undo: the console holds no copy of a slot once the device has been told to replace it.
 *
 * The destination keeps its own name. That is what ProfileStore::copyProfile does on the OLED, and
 * it is the behaviour worth matching - three slots called Medium is a worse outcome than a name
 * that has to be retyped.
 */
export function ProfileCopyDialog({
  from,
  names,
  to,
  activeIndex,
  sourceDirty,
  busy,
  onPick,
  onCancel,
  onConfirm,
}: ProfileCopyDialogProps) {
  const name = (i: number) => names[i] ?? `Slot ${i + 1}`;
  const targets = names.map((_, i) => i).filter((i) => i !== from);
  const reboots = to !== null && to === activeIndex;

  return (
    <Dialog open onClose={busy ? undefined : onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>Copy {name(from)} onto another slot</DialogTitle>
      <DialogContent>
        <TextField
          select
          size="small"
          label="Copy to"
          value={to ?? ""}
          onChange={(e) => onPick(Number(e.target.value))}
          sx={{ minWidth: 220, mt: 1, mb: 1.5 }}
          disabled={busy}
        >
          {targets.map((i) => (
            <MenuItem key={i} value={i} sx={{ fontSize: 13 }}>
              {name(i)}
              {i === activeIndex ? " (active)" : ""}
            </MenuItem>
          ))}
        </TextField>
        <DialogContentText component="div">
          {sourceDirty ? (
            <p>
              <strong>{name(from)} has unsaved edits.</strong> A copy sends what the device has
              stored, so those edits would not travel with it and the two slots would disagree with
              what you are looking at. Write or re-read this slot first.
            </p>
          ) : (
            <p>
              Every setting in {name(from)} replaces {to === null ? "the destination" : name(to)} -
              RPMs, fire modes, timings, switch positions. There is no undo.
            </p>
          )}
          <p>
            The destination keeps its own name, so {to === null ? "it" : name(to)} stays called that.
          </p>
          {reboots && (
            <p>
              {name(to!)} is the slot this device booted into, so writing it restarts the blaster.
              The console reconnects by itself.
            </p>
          )}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          onClick={onConfirm}
          color="warning"
          variant="contained"
          disabled={busy || to === null || sourceDirty}
        >
          {busy ? "Copying..." : "Copy"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
