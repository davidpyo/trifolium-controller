import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

// Which slot you are editing, and what writing it will cost.
//
// The write and save buttons that used to live here are in the header's Write and Save menus now,
// named for the store they act on. Having them in two places meant "Save" in the corner and "Save
// profile" here did different things a few inches apart.
//
// What stays is the part that is genuinely about the slot: its name, and the warning that writing
// the *active* slot reboots the blaster while writing a spare one does not.

export interface ProfileBarProps {
  slot: number;
  names: string[];
  activeIndex: number;
  /** profile:name for the selected slot, edited in place beside the picker. */
  name: string;
  nameMaxLen?: number;
  nameCharset?: string;
  onName: (value: string) => void;
  onSlotChange: (slot: number) => void;
  /** Opens the copy dialog for this slot. Absent offline, where there is nothing to copy onto. */
  onCopy?: () => void;
  copyDisabled?: boolean;
}

export function ProfileBar({
  slot,
  names,
  activeIndex,
  name,
  nameMaxLen,
  nameCharset,
  onName,
  onSlotChange,
  onCopy,
  copyDisabled,
}: ProfileBarProps) {
  const reboots = slot === activeIndex;

  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: "center", flexWrap: "wrap", px: 1.25, pt: 1.25 }}
    >
      <TextField
        select
        size="small"
        label="Profile slot"
        value={slot}
        onChange={(e) => onSlotChange(Number(e.target.value))}
        sx={{ minWidth: 175 }}
      >
        {names.map((n, i) => (
          <MenuItem key={i} value={i} sx={{ fontSize: 13 }}>
            {n}
            {i === activeIndex ? " (active)" : ""}
          </MenuItem>
        ))}
      </TextField>

      <TextField
        size="small"
        label="Name"
        value={name}
        slotProps={{ htmlInput: { maxLength: nameMaxLen } }}
        onChange={(e) => {
          // The same filter the form field applies, so a name typed here is one the on-device text
          // editor could also produce.
          const filtered = nameCharset
            ? [...e.target.value].filter((c) => nameCharset.includes(c)).join("")
            : e.target.value;
          onName(nameMaxLen ? filtered.slice(0, nameMaxLen) : filtered);
        }}
        sx={{ minWidth: 175 }}
      />

      {/* Belongs beside the slot picker rather than in the header's Write menu: both of its
          arguments are slots, and the one you are looking at is the source. */}
      {onCopy && (
        <Button size="small" variant="outlined" onClick={onCopy} disabled={copyDisabled}>
          Copy to...
        </Button>
      )}

      <Typography variant="caption" color={reboots ? "warning.main" : "success.main"}>
        {reboots ? "Active slot — writing reboots" : "Not active — writing does not reboot"}
      </Typography>
    </Stack>
  );
}
