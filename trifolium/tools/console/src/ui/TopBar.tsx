import React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { compareVersions } from "../firmware/releases";

// Which blaster this is, on which board, and whether it is connected: what you check before doing
// anything else. Everything that acts on the blaster lives on the page it belongs to now - writing
// in the unsaved-changes bar, restarts and resets under Maintenance, backups on Overview.

/** What kind of file the user says they are loading, so a mismatch is an error rather than a guess. */
export type LoadIntent = "bundle" | "device" | "profile";

/** Shared by the hidden picker in App and the drop targets. */
export const CONFIG_ACCEPT = [".json", "application/json"] as const;

/**
 * The first firmware whose log lines wait for a reply to finish instead of landing inside it. Before
 * it, verbose logging could garble a DUMP_* reply or an ack; from it, verbose is only extra output.
 */
export const FW_LOGS_WAIT_FOR_REPLIES = "2.1.1";

/** The connected firmware's version when verbose is on and it can still garble replies, else null. */
export const garblingFirmware = (verbose: boolean, fw: string | null): string | null =>
  verbose && fw && compareVersions(fw, FW_LOGS_WAIT_FOR_REPLIES) < 0 ? fw : null;

export interface TopBarProps {
  live: boolean;
  busy: boolean;
  /** Null when nothing is connected. */
  fw: string | null;
  supported: boolean;
  /** The browser shows its picker on every connect, so Choose Device would be a second Connect. */
  asksEveryTime: boolean;

  /** device:blasterName, edited in place. Limits come from its schema node. */
  blasterName: string;
  nameMaxLen?: number;
  nameCharset?: string;
  onBlasterName: (value: string) => void;
  /** Which preset the wiring came from, "(modified)" when it no longer matches. */
  wiringLabel: string;

  /** Opens Change board, from the board name. Absent where there is no board to change. */
  onChangeBoard?: () => void;

  onSearch?: () => void;
  /** `choose` shows the browser's picker even when one allowed blaster is plugged in. */
  onConnect: (choose: boolean) => void;
  onDisconnect: () => void;

  /**
   * What the blaster does on request, one reach from any page: re-read it, restart it, and the menu
   * beside them for the restarts that hand it to something else, and the flasher.
   * Absent while nothing is connected, except the flasher, which also serves a board in BOOTSEL.
   */
  actions?: {
    onRead: () => void;
    onRestart: () => void;
    onBootloader: () => void;
    onPassthrough: () => void;
  };
  onFlash: () => void;
}

/** The menu beside Read and Restart. */
function BlasterMenu({
  live,
  busy,
  actions,
  onFlash,
}: {
  live: boolean;
  busy: boolean;
  actions?: TopBarProps["actions"];
  onFlash: () => void;
}) {
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);
  const items: { label: string; detail: string; onClick: () => void; live?: boolean }[] = [
    ...(actions
      ? [
          // On a phone Read and Restart have no room of their own, so they lead the menu there.
          {
            label: "Read from Device",
            detail: "Read every setting again; unsaved edits are discarded",
            onClick: actions.onRead,
            live: true,
          },
          {
            label: "Restart",
            detail: "A normal restart; the console reconnects on its own",
            onClick: actions.onRestart,
            live: true,
          },
          {
            label: "Restart into bootloader",
            detail: "USB flashing mode; the serial port goes away",
            onClick: actions.onBootloader,
            live: true,
          },
          {
            label: "Start ESC passthrough",
            detail: "Lets an ESC configurator take the port",
            onClick: actions.onPassthrough,
            live: true,
          },
        ]
      : []),
    { label: "Flash firmware…", detail: "Write a release or a .uf2 over USB", onClick: onFlash },
  ];
  return (
    <>
      <Button
        size="small"
        variant="outlined"
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{ minWidth: 0, px: 1 }}
      >
        <Box component="span" sx={{ display: { xs: "inline", sm: "none" } }}>
          Blaster
        </Box>
        <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
          More
        </Box>
        &nbsp;&#x25BE;
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={close}>
        {items.map((item, i) => (
          <MenuItem
            key={item.label}
            disabled={busy || (item.live && !live)}
            onClick={() => {
              close();
              item.onClick();
            }}
            sx={{ py: 0.5, display: i < 2 && actions ? { xs: "flex", sm: "none" } : undefined }}
          >
            <ListItemText
              primary={<Typography variant="body2">{item.label}</Typography>}
              secondary={
                <Typography variant="caption" color="text.secondary">
                  {item.detail}
                </Typography>
              }
            />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

/** device:blasterName, shown as the heading until the pencil turns it into a field. */
function NameField({
  value,
  maxLen,
  charset,
  onChange,
}: {
  value: string;
  maxLen?: number;
  charset?: string;
  onChange: (v: string) => void;
}) {
  const [editing, setEditing] = React.useState(false);

  if (!editing) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.25, minWidth: 0 }}>
        <Typography
          sx={{ fontWeight: 650, fontSize: 15, lineHeight: 1.2, minWidth: 0 }}
          noWrap
          title={value}
        >
          {value || "Unnamed"}
        </Typography>
        <Tooltip title="Rename this blaster">
          <IconButton
            size="small"
            color="primary"
            sx={{ p: 0.25, fontSize: 13 }}
            onClick={() => setEditing(true)}
          >
            &#x270E;
          </IconButton>
        </Tooltip>
      </Box>
    );
  }

  return (
    <TextField
      size="small"
      autoFocus
      value={value}
      slotProps={{
        htmlInput: {
          maxLength: maxLen,
          "aria-label": "Blaster name",
          style: { padding: "2px 6px", fontSize: 14 },
        },
      }}
      onChange={(e) => {
        // Same filter the form field applies: drop anything the on-device text editor cannot
        // represent, rather than storing a name the user could never fix on the blaster itself.
        const filtered = charset
          ? [...e.target.value].filter((c) => charset.includes(c)).join("")
          : e.target.value;
        onChange(maxLen ? filtered.slice(0, maxLen) : filtered);
      }}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Escape") setEditing(false);
      }}
      sx={{ width: 170 }}
    />
  );
}

/** A small rounded label: the board, a state. */
export function Chip({
  children,
  tone,
  mono,
  title,
}: {
  children: React.ReactNode;
  tone?: "ok" | "warn" | "bad" | "accent";
  mono?: boolean;
  title?: string;
}) {
  const colour = {
    ok: "success.main",
    warn: "warning.main",
    bad: "error.main",
    accent: "primary.main",
  }[tone ?? "ok"];
  return (
    <Box
      component="span"
      title={title}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        fontSize: mono ? 11.5 : 12,
        fontFamily: mono ? "ui-monospace, Consolas, monospace" : undefined,
        px: 1,
        borderRadius: 999,
        border: 1,
        borderColor: tone ? colour : "divider",
        color: tone ? colour : "text.secondary",
        whiteSpace: "nowrap",
        lineHeight: 1.6,
      }}
    >
      {children}
    </Box>
  );
}

const Dot = ({ on, busy }: { on: boolean; busy?: boolean }) => (
  <Box
    component="span"
    aria-hidden
    sx={{
      width: 8,
      height: 8,
      borderRadius: "50%",
      flex: "none",
      bgcolor: busy ? "warning.main" : on ? "success.main" : "text.disabled",
    }}
  />
);

export function TopBar(props: TopBarProps) {
  const {
    live,
    busy,
    fw,
    supported,
    asksEveryTime,
    wiringLabel,
    onChangeBoard,
    actions,
    onFlash,
    onSearch,
    onConnect,
    onDisconnect,
  } = props;

  const connectHelp = !supported
    ? "Needs Chrome or Edge on a computer, or Chrome on Android"
    : asksEveryTime
      ? "Pick the blaster from the list. Android asks each time you connect."
      : "Opens the blaster this browser already allowed, when it is the only one plugged in. Otherwise asks which.";

  return (
    <Box
      component="header"
      sx={{
        display: "flex",
        alignItems: "center",
        gap: { xs: 1, sm: 1.5 },
        px: { xs: 1.5, sm: 1.75 },
        py: 1,
        borderBottom: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        minWidth: 0,
      }}
    >
      <Typography
        component="span"
        sx={{
          display: { xs: "none", sm: "inline" },
          flex: "none",
          fontWeight: 700,
          letterSpacing: ".06em",
          fontSize: 12,
        }}
      >
        TRIFOLIUM
      </Typography>
      <Box
        sx={{ width: "1px", height: 22, bgcolor: "divider", display: { xs: "none", sm: "block" } }}
      />

      <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
        <NameField
          value={props.blasterName}
          maxLen={props.nameMaxLen}
          charset={props.nameCharset}
          onChange={props.onBlasterName}
        />
        <Box sx={{ display: { xs: "none", md: "inline-flex" } }}>
          {onChangeBoard ? (
            <Box
              component="button"
              type="button"
              onClick={onChangeBoard}
              title="Change board"
              aria-label={`Board: ${wiringLabel}. Change board`}
              sx={{ border: 0, bgcolor: "transparent", p: 0, cursor: "pointer", font: "inherit" }}
            >
              <Chip>{wiringLabel}</Chip>
            </Box>
          ) : (
            <Chip title="The board preset this blaster's wiring came from">{wiringLabel}</Chip>
          )}
        </Box>
      </Box>

      <Box sx={{ flex: 1 }} />

      {onSearch && (
        <Box
          component="button"
          type="button"
          onClick={onSearch}
          aria-label="Search settings and commands"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            border: 1,
            borderColor: "divider",
            bgcolor: "background.default",
            color: "text.disabled",
            borderRadius: 1,
            py: 0.5,
            pl: 1.25,
            pr: 1,
            minWidth: { md: 220 },
            font: "inherit",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <Box component="span" sx={{ display: { xs: "none", md: "inline" } }}>
            Search settings and commands
          </Box>
          <Box
            component="span"
            sx={{
              ml: "auto",
              display: { xs: "none", md: "inline" },
              fontSize: 11,
              fontFamily: "ui-monospace, Consolas, monospace",
            }}
          >
            Ctrl K
          </Box>
        </Box>
      )}

      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: "none" }}>
        {busy && <CircularProgress size={14} aria-label="Working" />}
        <Dot on={live} />
        {live ? (
          <>
            <Typography component="span" sx={{ fontSize: 13, whiteSpace: "nowrap" }}>
              Connected · fw {fw}
            </Typography>
            {actions && (
              <Box sx={{ display: { xs: "none", sm: "flex" }, gap: 0.75 }}>
                <Tooltip title="Read every setting from the blaster again. Unsaved edits are discarded.">
                  <span>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={busy}
                      onClick={actions.onRead}
                    >
                      Read
                    </Button>
                  </span>
                </Tooltip>
                <Tooltip title="Restart the blaster. The console reconnects on its own.">
                  <span>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={busy}
                      onClick={actions.onRestart}
                    >
                      Restart
                    </Button>
                  </span>
                </Tooltip>
              </Box>
            )}
            <BlasterMenu live={live} busy={busy} actions={actions} onFlash={onFlash} />
            <Button
              size="small"
              color="inherit"
              onClick={onDisconnect}
              sx={{ color: "text.secondary" }}
            >
              Disconnect
            </Button>
          </>
        ) : (
          <>
            <Typography
              component="span"
              sx={{
                fontSize: 13,
                whiteSpace: "nowrap",
                color: "text.secondary",
                display: { xs: "none", sm: "inline" },
              }}
            >
              Not Connected
            </Typography>
            <Tooltip title={connectHelp}>
              <span>
                <Button
                  size="small"
                  variant="contained"
                  disabled={!supported}
                  onClick={() => onConnect(false)}
                >
                  Connect
                </Button>
              </span>
            </Tooltip>
            {!asksEveryTime && (
              <Tooltip title="Pick from the browser's list: a blaster this browser hasn't used yet, or one of several plugged in">
                <span>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={!supported}
                    onClick={() => onConnect(true)}
                  >
                    Choose Device
                  </Button>
                </span>
              </Tooltip>
            )}
            <BlasterMenu live={live} busy={busy} onFlash={onFlash} />
          </>
        )}
      </Box>
    </Box>
  );
}
