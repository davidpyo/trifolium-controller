import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import { Chip } from "./TopBar";

// Which slot you are editing, and what writing it will cost: writing the slot the blaster booted
// with restarts it, writing a spare one does not.

export interface ProfileBarProps {
  slot: number;
  names: string[];
  activeIndex: number;
  /** Slots holding unsaved edits. */
  dirtySlots: ReadonlySet<number>;
  /** profile:name for the selected slot, edited in place beside the tabs. */
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
  dirtySlots,
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
    <Box sx={{ mb: 1.5 }}>
      <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", alignItems: "center" }}>
        <Box
          role="tablist"
          aria-label="Profile slot"
          sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}
        >
          {names.map((n, i) => (
            <Box
              key={i}
              component="button"
              type="button"
              role="tab"
              aria-selected={i === slot}
              onClick={() => onSlotChange(i)}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.75,
                border: 1,
                borderColor: i === slot ? "primary.main" : "divider",
                boxShadow: (t) =>
                  i === slot ? `inset 0 -2px 0 ${t.palette.primary.main}` : "none",
                color: i === slot ? "primary.main" : "text.primary",
                bgcolor: "background.paper",
                borderRadius: 2,
                px: 1.75,
                py: 0.85,
                font: "inherit",
                fontWeight: 550,
                cursor: "pointer",
              }}
            >
              {n}
              {i === activeIndex && <Chip tone="accent">Active</Chip>}
              {dirtySlots.has(i) && (
                <Box
                  component="span"
                  title="Unsaved changes"
                  sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: "warning.main" }}
                />
              )}
            </Box>
          ))}
        </Box>
        <Box sx={{ ml: "auto", display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
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
            sx={{ width: 170 }}
          />
          {/* Beside the slot tabs: both of its arguments are slots, and the one shown is the source. */}
          {onCopy && (
            <Button size="small" variant="outlined" onClick={onCopy} disabled={copyDisabled}>
              Copy to...
            </Button>
          )}
        </Box>
      </Box>
      <Box sx={{ mt: 1, fontSize: 12.5, color: reboots ? "warning.main" : "text.secondary" }}>
        {reboots
          ? "This is the active slot, so writing it restarts the blaster."
          : "Not the active slot. Writing it does not restart the blaster."}
      </Box>
    </Box>
  );
}
