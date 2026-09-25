import React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { LogLine } from "../serial/transport";

const COLOUR: Record<LogLine["kind"], string> = {
  out: "text.secondary",
  in: "text.primary",
  ok: "success.main",
  err: "error.main",
};

/**
 * The device conversation, kept at the top where the original tool had it.
 *
 * Worth the space: the firmware's replies are the only evidence of what a write actually did - which
 * values got clamped, whether a payload was refused, whether the device rebooted underneath you.
 */
export function LogPanel({ lines, onClear }: { lines: LogLine[]; onClear: () => void }) {
  const [open, setOpen] = React.useState(true);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Pin to the newest line by setting scrollTop rather than calling scrollIntoView: it is a plain
  // property assignment, so it degrades to a no-op anywhere the DOM is only partly implemented
  // instead of throwing and taking the whole render down.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, open]);

  return (
    <Paper variant="outlined">
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", px: 1.5, py: 0.5, minHeight: 40 }}
      >
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
          Device log{lines.length ? ` (${lines.length})` : ""}
        </Typography>
        {lines.length > 0 && (
          <Button size="small" onClick={onClear}>
            Clear
          </Button>
        )}
        <Button size="small" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Show"}
        </Button>
      </Stack>
      <Collapse in={open}>
        <Box
          ref={scrollRef}
          sx={{
            px: 1.5,
            pb: 1,
            fontSize: 12,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            height: 132,
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {lines.length === 0 ? (
            <Typography variant="caption" color="text.secondary">
              Nothing yet. Connect a device to see the exchange.
            </Typography>
          ) : (
            lines.map((l, i) => (
              <Box key={i} sx={{ color: COLOUR[l.kind] }}>
                {l.kind === "in" ? `  (device) ${l.text}` : l.text}
              </Box>
            ))
          )}
        </Box>
      </Collapse>
    </Paper>
  );
}
