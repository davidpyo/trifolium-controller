import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { LogLine } from "../serial/transport";

const COLOUR: Record<LogLine["kind"], string> = {
  out: "text.secondary",
  in: "text.primary",
  ok: "success.main",
  err: "error.main",
};

export const clock = (at: number) => new Date(at).toTimeString().slice(0, 8);

export const logToText = (lines: LogLine[]): string =>
  lines.map((l) => `${clock(l.at)} ${l.kind === "in" ? "(device) " : ""}${l.text}`).join("\n");

/**
 * The device conversation.
 *
 * Worth the space it takes: the firmware's replies are the only evidence of what a write actually
 * did - which values were clamped, whether a payload was refused, whether the device rebooted
 * underneath you. Timestamped because "did that just happen, or is it from before?" is the usual
 * question.
 *
 * Controls sit inside the output rather than above it, so they cost no vertical space. They stay
 * visible: hiding them until hover saved nothing and left the log looking like a dead panel.
 */
export function Lines({ lines, dense = true }: { lines: LogLine[]; dense?: boolean }) {
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Pin to the newest line by setting scrollTop rather than calling scrollIntoView: a plain property
  // assignment degrades to a no-op where the DOM is only partly implemented, instead of throwing and
  // taking the render down with it.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <Box
      ref={scrollRef}
      sx={{
        height: "100%",
        overflowY: "auto",
        px: 1,
        py: 0.5,
        fontSize: dense ? 12 : 13,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        lineHeight: 1.5,
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
            <Box component="span" sx={{ color: "text.disabled", mr: 1 }}>
              {clock(l.at)}
            </Box>
            {l.kind === "in" ? `(device) ${l.text}` : l.text}
          </Box>
        ))
      )}
    </Box>
  );
}
