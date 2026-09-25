import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import type { LoadIntent } from "./TopBar";

export interface LoadKindDialogProps {
  /** The dropped file, named so the choice is made about something specific. */
  fileName: string;
  /** Name of the slot a profile would land in, which is the one the Profile tab shows. */
  profileName: string;
  onPick: (intent: LoadIntent) => void;
  onCancel: () => void;
}

/**
 * Asks which store a dropped backup is for.
 *
 * The menu declares the kind before the picker opens so that a wrong file is refused rather than
 * guessed at; a drag has no such step, so the question moves after the drop. The answer still goes
 * through the same check, so choosing wrongly here is an error and not a silent misfile.
 */
export function LoadKindDialog({ fileName, profileName, onPick, onCancel }: LoadKindDialogProps) {
  const choices: { intent: LoadIntent; label: string; detail: string }[] = [
    {
      intent: "bundle",
      label: "Full Backup",
      detail: "Replaces device settings and all profiles",
    },
    { intent: "device", label: "Device Config", detail: "Replaces device settings only" },
    {
      intent: "profile",
      label: `Profile into ${profileName}`,
      detail: "Replaces the slot shown on the Profile tab",
    },
  ];

  return (
    <Dialog open onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle>Load {fileName}</DialogTitle>
      <DialogContent>
        <DialogContentText component="div">
          <p>What is this file? Loading it as the wrong kind is refused, not guessed at.</p>
        </DialogContentText>
        <List dense disablePadding>
          {choices.map((choice) => (
            <ListItemButton
              key={choice.intent}
              onClick={() => onPick(choice.intent)}
              sx={{ borderRadius: 1 }}
            >
              <ListItemText primary={choice.label} secondary={choice.detail} />
            </ListItemButton>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}
