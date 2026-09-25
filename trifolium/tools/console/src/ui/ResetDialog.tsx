import React from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

/**
 * Confirming a reset, with the friction matched to what is actually lost.
 *
 * The four resets are not equally bad and pretending they are is its own failure: a dialog that
 * cries wolf on the cheap one teaches people to confirm the expensive one without reading. So the
 * severity, the wording and the typed word all differ, and each says what survives as well as what
 * goes - "profiles are untouched" is the sentence that lets someone act.
 *
 * The typed word is what is being reset rather than a constant "RESET". Typing the same four
 * letters for every destructive action is muscle memory within a day, which is exactly the reflex
 * a confirmation exists to interrupt; typing WIRING when you meant DEVICE fails closed.
 *
 * Ordered least to most, which is also the order the menu offers them. Wiring sits above device
 * settings because it is the one thing no other reset reaches and the one a user may not be able
 * to reconstruct without opening the blaster - a setting can be re-tuned from memory, a pin number
 * cannot. "Everything" is last by breadth, and it still does not include the wiring.
 */
export type ResetKind = "profile" | "device" | "wiring" | "everything";

export interface ResetPlan {
  kind: ResetKind;
  /** Profile slot, for kind "profile" only. */
  slot?: number;
  /** The slot's name, so the dialog and the typed word name the thing the user can see. */
  profileName?: string;
}

interface Copy {
  title: string;
  word: string;
  severity: "warning" | "error";
  action: string;
  lost: React.ReactNode;
  kept: string;
}

export function resetCopy(plan: ResetPlan): Copy {
  if (plan.kind === "everything") {
    return {
      title: "Reset everything to defaults?",
      word: "EVERYTHING",
      severity: "error",
      action: "Reset everything",
      lost: (
        <>
          All three profile slots <em>and</em> every device setting, in one go. This is the OLED
          menu&rsquo;s Factory Reset All, and there is nothing to undo it with but a backup.
        </>
      ),
      // Says what it does not reach, because the word "everything" otherwise promises more than
      // the command does - the firmware preserves the wiring here exactly as it does for a device
      // reset, and someone who assumed otherwise would reset twice.
      kept: "Your wiring and board still survive, by the same rule that protects them from a device reset. Reset Wiring separately if you want those back to the board's defaults too.",
    };
  }
  if (plan.kind === "wiring") {
    return {
      title: "Reset wiring to board defaults?",
      word: "WIRING",
      severity: "error",
      action: "Reset wiring",
      lost: (
        <>
          Every pin goes back to what this board ships with - the switches, the menu button, the
          LED, and the pusher&rsquo;s gate pin and driver. Anything you set by hand is replaced.
        </>
      ),
      kept: "Tuning, profiles, the board itself and every other device setting are untouched.",
    };
  }
  if (plan.kind === "device") {
    return {
      title: "Reset device settings to defaults?",
      word: "DEVICE",
      severity: "error",
      action: "Reset device settings",
      lost: (
        <>
          Every device setting goes back to its factory value - the blaster name, display options,
          shot counter, battery limits, solenoid timings and the rest.
        </>
      ),
      // Worth stating plainly: this is the firmware's own rule, not a promise the console invents.
      kept: "Your wiring and board survive, because the device preserves everything with no on-screen row. Profiles are untouched - reset those separately.",
    };
  }
  return {
    title: `Reset ${plan.profileName ?? "this profile"} to defaults?`,
    word: (plan.profileName?.trim() || `SLOT${(plan.slot ?? 0) + 1}`).toUpperCase(),
    severity: "warning",
    action: "Reset profile",
    lost: (
      <>
        This slot&rsquo;s whole setup: its name, fire modes, RPM targets, dwell and idle timings,
        and per-motor tuning.
      </>
    ),
    kept: "The other profile slots, your wiring and every device setting are untouched.",
  };
}

export interface ResetDialogProps {
  plan: ResetPlan;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ResetDialog({ plan, busy, onCancel, onConfirm }: ResetDialogProps) {
  const copy = resetCopy(plan);
  const [typed, setTyped] = React.useState("");

  // Case-insensitive: the point is a deliberate act, not a typing test. Whitespace trimmed for the
  // same reason - a trailing space is not a second thought.
  const matches = typed.trim().toUpperCase() === copy.word;

  return (
    <Dialog open onClose={busy ? undefined : onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>{copy.title}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <Alert severity={copy.severity} sx={{ py: 0.5 }}>
            {copy.lost}
          </Alert>
          <Typography variant="body2" color="text.secondary">
            {copy.kept}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            The device saves the change and restarts. This cannot be undone from here - use Save
            first if you have not got a backup.
          </Typography>
          <TextField
            size="small"
            autoFocus
            label={`Type ${copy.word} to confirm`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches && !busy) onConfirm();
            }}
            disabled={busy}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          onClick={onConfirm}
          color={copy.severity}
          variant="contained"
          disabled={busy || !matches}
        >
          {busy ? "Resetting..." : copy.action}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
