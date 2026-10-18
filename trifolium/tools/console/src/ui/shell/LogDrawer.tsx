import React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import Switch from "@mui/material/Switch";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import type { LogLine } from "../../serial/transport";
import { Lines } from "../LogView";

// The device conversation, at the foot of the page. Open, it is the last five lines with its tools
// on the same row as its title; folded, it is one line, the latest. Full screen shows the lot.

type Filter = "all" | "device" | "console" | "errors";

const FILTERS: { id: Filter; label: string; keep: (l: LogLine) => boolean }[] = [
  { id: "all", label: "All", keep: () => true },
  { id: "device", label: "Device", keep: (l) => l.kind === "in" || l.kind === "out" },
  { id: "console", label: "Console", keep: (l) => l.kind === "ok" || l.kind === "err" },
  { id: "errors", label: "Errors", keep: (l) => l.kind === "err" },
];

/** Lines shown at first: enough to read what a write just did, little enough to leave the page. */
export const LOG_LINES_SHOWN = 5;
const LINE_PX = 18; // Lines sets 12 px type on a 1.5 line height
const PAD_PX = 8;
const linesTall = (n: number) => n * LINE_PX + PAD_PX;
export const LOG_DEFAULT_PX = linesTall(LOG_LINES_SHOWN);
const LOG_MIN_PX = linesTall(2);
/** The log may take up to this share of the window; the page keeps the rest. */
const LOG_MAX_SHARE = 0.6;

export const clampLogHeight = (px: number, windowPx: number) =>
  Math.round(Math.min(Math.max(px, LOG_MIN_PX), Math.max(LOG_MIN_PX, windowPx * LOG_MAX_SHARE)));

/**
 * The open log's top edge: drag it to resize, double-click it for the default height again. A
 * separator, so the arrow keys move it a line at a time and Home puts it back.
 */
function ResizeHandle({ height, onResize }: { height: number; onResize: (px: number) => void }) {
  const start = React.useRef<{ y: number; h: number } | null>(null);
  const set = (px: number) => onResize(clampLogHeight(px, window.innerHeight));
  return (
    <Box
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the log"
      aria-valuenow={height}
      aria-valuemin={LOG_MIN_PX}
      tabIndex={0}
      onPointerDown={(e: React.PointerEvent<HTMLDivElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { y: e.clientY, h: height };
      }}
      onPointerMove={(e: React.PointerEvent<HTMLDivElement>) => {
        if (start.current) set(start.current.h + (start.current.y - e.clientY));
      }}
      onPointerUp={() => (start.current = null)}
      onPointerCancel={() => (start.current = null)}
      onDoubleClick={() => set(LOG_DEFAULT_PX)}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "ArrowUp") set(height + LINE_PX);
        else if (e.key === "ArrowDown") set(height - LINE_PX);
        else if (e.key === "Home") set(LOG_DEFAULT_PX);
        else return;
        e.preventDefault();
      }}
      sx={{
        height: 6,
        mt: "-3px",
        mb: "-3px",
        position: "relative",
        zIndex: 1,
        cursor: "ns-resize",
        touchAction: "none",
        "&:hover, &:focus-visible": { bgcolor: "primary.main", opacity: 0.6, outline: "none" },
      }}
    />
  );
}

export function LogDrawer({
  lines,
  open,
  verbose,
  onToggleVerbose,
  verboseDisabled,
  onToggle,
  onClear,
  onSave,
  height,
  onResize,
}: {
  lines: LogLine[];
  open: boolean;
  verbose: boolean;
  /** Switches the blaster's verbose logging; absent while nothing is connected. */
  onToggleVerbose?: () => void;
  verboseDisabled?: boolean;
  onToggle: () => void;
  onClear: () => void;
  onSave: () => void;
  /** The open log's height in px, lines and padding. */
  height: number;
  onResize: (px: number) => void;
}) {
  const [filter, setFilter] = React.useState<Filter>("all");
  const [full, setFull] = React.useState(false);
  const shown = lines.filter(FILTERS.find((f) => f.id === filter)!.keep);
  const last = lines[lines.length - 1];

  const tools = (
    <Box sx={{ display: "flex", gap: 0.5, alignItems: "center", flexWrap: "wrap", pr: 1 }}>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={filter}
        aria-label="Filter the log"
        onChange={(_, v: Filter | null) => v && setFilter(v)}
        sx={{
          display: { xs: "none", sm: "inline-flex" },
          "& .MuiToggleButton-root": { py: 0, px: 1, fontSize: 11.5, textTransform: "none" },
        }}
      >
        {FILTERS.map((f) => (
          <ToggleButton key={f.id} value={f.id}>
            {f.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      {(
        [
          ["Save", onSave, !lines.length],
          ["Clear", onClear, !lines.length],
          ["Full screen", () => setFull(true), false],
        ] as const
      ).map(([label, act, off]) => (
        <Button
          key={label}
          size="small"
          color="inherit"
          disabled={off}
          onClick={act}
          sx={{ color: "text.secondary", py: 0, minWidth: 0, fontSize: 12 }}
        >
          {label}
        </Button>
      ))}
    </Box>
  );

  return (
    <Box sx={{ borderTop: 1, borderColor: "divider", bgcolor: "background.paper", fontSize: 12.5 }}>
      {open && <ResizeHandle height={height} onResize={onResize} />}
      <Box sx={{ display: "flex", alignItems: "center", minWidth: 0 }}>
        <Box
          component="button"
          type="button"
          aria-expanded={open}
          aria-label={open ? "Hide the log" : "Show the log"}
          onClick={onToggle}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.25,
            flex: 1,
            minWidth: 0,
            px: 1.5,
            py: 0.5,
            border: 0,
            bgcolor: "transparent",
            color: "inherit",
            font: "inherit",
            textAlign: "left",
            cursor: "pointer",
          }}
        >
          <Box
            component="span"
            sx={{ fontWeight: 650, fontSize: 12, display: "flex", alignItems: "center", gap: 0.75 }}
          >
            <Box component="span" aria-hidden sx={{ color: "text.disabled", fontSize: 10 }}>
              {open ? "▼" : "▲"}
            </Box>
            Log
          </Box>
          {/* Only while folded: open, the same line is in the list below, and saying it twice would
              leave two of every message on the page. */}
          <Box
            component="span"
            sx={{
              fontFamily: "ui-monospace, Consolas, monospace",
              fontSize: 11.5,
              color: "text.secondary",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
              flex: 1,
            }}
          >
            {!open &&
              (last
                ? `${last.kind === "out" ? "→ " : last.kind === "in" ? "← " : ""}${last.text}`
                : "Nothing yet")}
          </Box>
        </Box>
        {onToggleVerbose && (
          <VerboseSwitch on={verbose} disabled={verboseDisabled} onToggle={onToggleVerbose} />
        )}
        {open && tools}
      </Box>
      {open && (
        <Box
          role="log"
          sx={{
            height,
            bgcolor: "action.hover",
            borderTop: 1,
            borderColor: "divider",
          }}
        >
          <Lines lines={shown} />
        </Box>
      )}
      <Dialog open={full} onClose={() => setFull(false)} fullScreen>
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            bgcolor: "background.default",
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              px: 1.5,
              py: 0.5,
              borderBottom: 1,
              borderColor: "divider",
            }}
          >
            <Box sx={{ fontWeight: 650 }}>Device log ({lines.length} lines)</Box>
            <IconButton
              aria-label="Exit full screen"
              sx={{ ml: "auto" }}
              onClick={() => setFull(false)}
            >
              &#x2715;
            </IconButton>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <Lines lines={shown} dense={false} />
          </Box>
        </Box>
      </Dialog>
    </Box>
  );
}

/**
 * Verbose logging, beside the log it fills. A stored setting, so each switch is a flash write and a
 * restart, which the tooltip says before anyone finds out; on, it stays amber so a log full of
 * switch presses has an obvious cause.
 */
function VerboseSwitch({
  on,
  disabled,
  onToggle,
}: {
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <Tooltip title="Switch presses, state changes and shots in the log. Switching it restarts the blaster.">
      <Box
        component="label"
        sx={{
          display: "flex",
          alignItems: "center",
          flex: "none",
          pl: 1,
          pr: 0.5,
          fontSize: 12,
          fontWeight: on ? 650 : 400,
          color: on ? "warning.main" : "text.secondary",
          cursor: disabled ? "default" : "pointer",
        }}
      >
        Verbose
        <Switch
          size="small"
          color="warning"
          checked={on}
          disabled={disabled}
          onChange={onToggle}
          slotProps={{ input: { "aria-label": "Verbose logging" } }}
        />
      </Box>
    </Tooltip>
  );
}
