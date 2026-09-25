import React from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

// The escape hatch, kept permanently.
//
// Two jobs. It is what the console falls back to against firmware that predates DUMP_SCHEMA, where
// there is no field metadata to build a form from. And it is the only way to reach a setting the
// schema does not describe, which is the situation any time the firmware is ahead of this page.
//
// Deliberately does not send anything by itself: edits are applied into the editor's state, and the
// normal Write button sends them, so the same clamping, acks and reboot handling apply.

export interface RawJsonProps {
  device: unknown;
  profiles: unknown[];
  slot: number;
  onApply: (target: "device" | number, value: unknown) => void;
}

export function RawJson({ device, profiles, slot, onApply }: RawJsonProps) {
  const [target, setTarget] = React.useState<"device" | number>("device");
  const current = target === "device" ? device : profiles[target as number];
  const pretty = React.useMemo(() => JSON.stringify(current ?? {}, null, 2), [current]);

  const [draft, setDraft] = React.useState(pretty);
  const [dirty, setDirty] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Follow the selected target and any external reload, but never clobber an in-progress edit.
  React.useEffect(() => {
    if (!dirty) setDraft(pretty);
  }, [pretty, dirty]);

  React.useEffect(() => {
    setTarget((t) => (t === "device" ? t : slot));
  }, [slot]);

  const apply = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setError("Expected a JSON object at the top level.");
      return;
    }
    setError(null);
    setDirty(false);
    onApply(target, parsed);
  };

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <TextField
          select
          size="small"
          label="Showing"
          value={String(target)}
          onChange={(e) => {
            setTarget(e.target.value === "device" ? "device" : Number(e.target.value));
            setDirty(false);
            setError(null);
          }}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="device">Device settings</MenuItem>
          {profiles.map((p, i) => (
            <MenuItem key={i} value={String(i)}>
              {((p as { name?: string })?.name?.trim() || `Slot ${i + 1}`) + ` (profile ${i})`}
            </MenuItem>
          ))}
        </TextField>
        <Button size="small" variant="contained" disabled={!dirty} onClick={apply}>
          Apply to editor
        </Button>
        <Button
          size="small"
          disabled={!dirty}
          onClick={() => {
            setDraft(pretty);
            setDirty(false);
            setError(null);
          }}
        >
          Discard
        </Button>
        <Typography variant="caption" color="text.secondary">
          Applying only changes the editor. Use Write to send it.
        </Typography>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ py: 0 }}>
          {error}
        </Alert>
      )}

      <TextField
        multiline
        minRows={16}
        maxRows={30}
        size="small"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setDirty(true);
        }}
        slotProps={{
          htmlInput: { style: { fontSize: 12, fontFamily: "ui-monospace, monospace" }, spellCheck: false },
        }}
      />
    </Stack>
  );
}
