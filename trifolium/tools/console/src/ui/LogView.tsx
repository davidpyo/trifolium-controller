import React from "react";
import Box from "@mui/material/Box";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { LogLine } from "../serial/transport";

const COLOUR: Record<LogLine["kind"], string> = {
  out: "text.secondary",
  in: "text.primary",
  ok: "success.main",
  err: "error.main",
};

const clock = (at: number) => new Date(at).toTimeString().slice(0, 8);

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
function Lines({ lines, dense = true }: { lines: LogLine[]; dense?: boolean }) {
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

export interface LogViewProps {
  lines: LogLine[];
  onClear: () => void;
  onSave: () => void;
  /** Floor, not a fixed size - the box stretches to whatever the row's tallest panel sets. */
  minHeight?: number;
}

/** Big enough to hit without aiming, since these are now on screen the whole time. */
const iconSx = { p: 0.5, fontSize: 18, lineHeight: 1 } as const;

export function LogView({ lines, onClear, onSave, minHeight = 132 }: LogViewProps) {
  const [full, setFull] = React.useState(false);

  const controls = (inDialog: boolean) => (
    <Stack
      direction="row"
      spacing={0.25}
      sx={{
        // Floating over the output inline (so the controls cost no height), inline in the
        // full-screen header where there is room for them.
        ...(inDialog
          ? {}
          : {
              position: "absolute",
              top: 3,
              right: 3,
              zIndex: 1,
              // The log scrolls underneath, so the strip needs its own ground to stay legible.
              border: 1,
              borderColor: "divider",
              boxShadow: 1,
            }),
        borderRadius: 1,
        bgcolor: "background.paper",
      }}
    >
      <Tooltip title="Save the log to a file">
        <span>
          <IconButton size="medium" sx={iconSx} disabled={!lines.length} onClick={onSave}>
            &#x2913;
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Clear the log">
        <span>
          {/* A bin, not a cross: the cross next to it closes full screen, and two glyphs that both
              mean "dismiss" sat side by side doing very different things. */}
          <IconButton size="medium" sx={iconSx} disabled={!lines.length} onClick={onClear}>
            &#x1F5D1;
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={inDialog ? "Exit full screen" : "Expand to full screen"}>
        <IconButton size="medium" sx={iconSx} onClick={() => setFull(!inDialog)}>
          {inDialog ? "✕" : "⛶"}
        </IconButton>
      </Tooltip>
    </Stack>
  );

  return (
    <>
      <Box
        className="log-host"
        sx={{
          position: "relative",
          flexGrow: 1,
          minWidth: 0,
          // Matches the row rather than driving it. alignSelf:"stretch" against a parent that is
          // alignItems:"stretch" makes this as tall as whichever neighbour is taller - the identity
          // panel or the button column - and the absolutely-positioned output below is what stops
          // it growing past them: a log box whose own content set the height climbed with every
          // line until the header owned the page. minHeight is the floor for a short row.
          alignSelf: "stretch",
          minHeight,
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          bgcolor: "action.hover",
          overflow: "hidden",
        }}
      >
        {controls(false)}
        {/*
          Out of flow on purpose. In normal flow the output's own height is what the flex row
          measures, so the box grew as the log filled - the fix has to be that the content cannot
          report a height at all, not a maxHeight guess at what the neighbours come to.
        */}
        <Box sx={{ position: "absolute", inset: 0 }}>
          <Lines lines={lines} />
        </Box>
      </Box>

      <Dialog open={full} onClose={() => setFull(false)} fullScreen>
        <Box sx={{ position: "relative", height: "100%", bgcolor: "background.default" }}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: "center", px: 1.5, py: 0.5, borderBottom: 1, borderColor: "divider" }}
          >
            <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
              Device log ({lines.length} lines)
            </Typography>
            {controls(true)}
          </Stack>
          <Box sx={{ height: "calc(100% - 40px)" }}>
            <Lines lines={lines} dense={false} />
          </Box>
        </Box>
      </Dialog>
    </>
  );
}
