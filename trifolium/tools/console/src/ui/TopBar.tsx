import React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { compareVersions } from "../firmware/releases";
import type { LogLine } from "../serial/transport";
import { dropOutlineSx, useFileDrop } from "./FileDrop";
import { LogView } from "./LogView";
import { MenuButton } from "./MenuButton";

// Header: who this blaster is on the left, the device conversation in the middle, actions right.
//
// Identity lives here rather than in the config form because it is what you check before doing
// anything else - which blaster, which board, is it even connected. The name and the board are both
// editable in place for the same reason: they are the two fields you change once and then never
// look at again, so a form row apiece was space spent on nothing.
//
// Every destructive or store-scoped action is a MenuButton. See there for why one-click Save is a
// trap: device settings, a profile slot and the whole device are three different things.

/** What kind of file the user says they are loading, so a mismatch is an error rather than a guess. */
export type LoadIntent = "bundle" | "device" | "profile";

/** Shared by the hidden picker in App and the header's drop target. */
export const CONFIG_ACCEPT = [".json", "application/json"] as const;

/**
 * The first firmware whose log lines wait for a reply to finish instead of landing inside it. Before
 * it, verbose logging could garble a DUMP_* reply or an ack; from it, verbose is only extra output.
 */
const FW_LOGS_WAIT_FOR_REPLIES = "2.1.1";

export interface TopBarProps {
  lines: LogLine[];
  onClearLog: () => void;
  onSaveLog: () => void;
  live: boolean;
  busy: boolean;
  /** Null when nothing is connected. */
  identity: { wiring: string; fw: string } | null;
  supported: boolean;
  /** The browser shows its picker on every connect, so Choose Device would be a second Connect. */
  asksEveryTime: boolean;

  /** device:blasterName, edited in place. Limits come from its schema node. */
  blasterName: string;
  nameMaxLen?: number;
  nameCharset?: string;
  onBlasterName: (value: string) => void;

  /**
   * Which preset the device's wiring came from, as a label. Read-only: a preset is loaded from the
   * picker, not chosen from a dropdown here, because loading one replaces every pin and that wants
   * a confirmation rather than a select. The button below opens the picker.
   */
  wiringLabel: string;
  onOpenPresets: () => void;

  deviceDirty: number;
  profileDirty: number;
  /** Every staged edit, the other profiles' included. */
  totalDirty: number;
  profileName: string;
  profileReboots: boolean;

  verbose: boolean;
  onToggleVerbose: () => void;

  /** `choose` shows the browser's picker even when one allowed blaster is plugged in. */
  onConnect: (choose: boolean) => void;
  onDisconnect: () => void;
  onReadAll: () => void;
  onReboot: (mode: "normal" | "bootloader" | "passthrough") => void;
  onReset: (kind: "profile" | "device" | "wiring" | "everything") => void;
  onWriteDevice: () => void;
  onWriteProfile: () => void;
  onWriteEverything: () => void;
  /** Opens the PICOBOOT flasher. Offline too: a board left in BOOTSEL is reachable from there. */
  onFlashFirmware: () => void;
  onSaveDeviceFile: () => void;
  onSaveProfileFile: () => void;
  onSaveBundleFile: () => void;
  onLoadFile: (intent: LoadIntent) => void;
  /** A backup dropped on the header. The kind is asked for afterwards, as the menu asks first. */
  onDropFile: (file: File) => void;
  onDropReject: (message: string) => void;
}

const actionSx = {
  py: 0.25,
  minHeight: 0,
  fontSize: 12,
  textTransform: "none",
  // Two of these share a row in a 300px column, so the longest label - "Write to Device (12)" -
  // has to fit half of it on one line.
  whiteSpace: "nowrap",
  px: 0.5,
} as const;

/** device:blasterName, shown as a heading until the pencil turns it into a field. */
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
      <Stack direction="row" spacing={0.25} sx={{ alignItems: "center", minWidth: 0 }}>
        <Typography
          sx={{ fontWeight: 700, fontSize: 15, lineHeight: 1.2, minWidth: 0 }}
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
      </Stack>
    );
  }

  return (
    <TextField
      size="small"
      autoFocus
      value={value}
      slotProps={{ htmlInput: { maxLength: maxLen, style: { padding: "2px 6px", fontSize: 14 } } }}
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
      sx={{ width: "100%" }}
    />
  );
}

export function TopBar(props: TopBarProps) {
  const {
    lines,
    onClearLog,
    onSaveLog,
    live,
    busy,
    identity,
    supported,
    asksEveryTime,
    blasterName,
    nameMaxLen,
    nameCharset,
    onBlasterName,
    wiringLabel,
    onOpenPresets,
    deviceDirty,
    profileDirty,
    totalDirty,
    profileName,
    profileReboots,
    verbose,
    onToggleVerbose,
    onConnect,
    onDisconnect,
    onReadAll,
    onReboot,
    onReset,
    onWriteDevice,
    onWriteProfile,
    onWriteEverything,
    onFlashFirmware,
    onSaveDeviceFile,
    onSaveProfileFile,
    onSaveBundleFile,
    onLoadFile,
    onDropFile,
    onDropReject,
  } = props;

  // The connected firmware's version when verbose is on and can still garble replies, else null.
  const garblingFw =
    verbose && identity && compareVersions(identity.fw, FW_LOGS_WAIT_FOR_REPLIES) < 0
      ? identity.fw
      : null;

  const { over, dropProps } = useFileDrop({
    accept: CONFIG_ACCEPT,
    what: "a .json config file",
    onFile: onDropFile,
    onReject: onDropReject,
  });

  return (
    <Paper variant="outlined" sx={{ p: 1 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "stretch" }}>
        <Stack
          spacing={0.25}
          sx={{
            width: 190,
            flexShrink: 0,
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            px: 1,
            py: 0.5,
            justifyContent: "center",
            minWidth: 0,
          }}
        >
          <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: 1 }}>
            TRIFOLIUM
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1 }}>
            Config Console
          </Typography>
          {/*
            The name is the one thing in this panel a person looks for first, and at spacing 0.25 it
            sat hard against the rule above it and the board picker below. Its own margins rather
            than a wider Stack spacing, so only this row loosens and the rest of the panel stays as
            dense as it was.
          */}
          <Divider sx={{ mt: 0.75, mb: 0 }} />

          <Box sx={{ py: 0.75 }}>
            <NameField
              value={blasterName}
              maxLen={nameMaxLen}
              charset={nameCharset}
              onChange={onBlasterName}
            />
          </Box>

          <Divider sx={{ mt: 0, mb: 0.75 }} />

          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Typography variant="caption" color="text.disabled" noWrap>
              {identity ? identity.wiring : wiringLabel}
            </Typography>
            {live && (
              <Button
                size="small"
                disabled={busy}
                onClick={onOpenPresets}
                sx={{ minWidth: 0, p: 0, fontSize: 11, textTransform: "none" }}
              >
                change
              </Button>
            )}
          </Box>

          <Typography variant="caption" color={live ? "success.main" : "text.disabled"} noWrap>
            {identity ? `Connected · fw ${identity.fw}` : "Not Connected"}
          </Typography>
        </Stack>

        <LogView lines={lines} onClear={onClearLog} onSave={onSaveLog} />

        <Stack spacing={0.25} sx={{ width: 300, flexShrink: 0 }}>
          {live ? (
            <Button
              size="small"
              color="error"
              variant="outlined"
              sx={actionSx}
              onClick={onDisconnect}
            >
              Disconnect
            </Button>
          ) : (
            <Stack direction="row" spacing={0.5}>
              <Tooltip
                title={
                  !supported
                    ? "Needs Chrome or Edge on a computer, or Chrome on Android"
                    : asksEveryTime
                      ? "Pick the blaster from the list. Android asks each time you connect."
                      : "Opens the blaster this browser already allowed, when it is the only one plugged in. Otherwise asks which."
                }
              >
                <span style={{ display: "flex", flex: 1 }}>
                  <Button
                    size="small"
                    variant="contained"
                    fullWidth
                    sx={actionSx}
                    disabled={!supported}
                    onClick={() => onConnect(false)}
                  >
                    Connect
                  </Button>
                </span>
              </Tooltip>
              {!asksEveryTime && (
                <Tooltip title="Pick from the browser's list: a blaster this browser hasn't used yet, or one of several plugged in">
                  <span style={{ display: "flex", flex: 1 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      fullWidth
                      sx={actionSx}
                      disabled={!supported}
                      onClick={() => onConnect(true)}
                    >
                      Choose Device
                    </Button>
                  </span>
                </Tooltip>
              )}
            </Stack>
          )}

          {/*
            Read and Write share a row. They are opposites and read as a pair, and the column was
            four rows deep against a left panel that had room to spare - this buys the name above
            its own breathing room without making the header taller.

            The Tooltip needs the span: a disabled MUI Button fires no pointer events, so a tooltip
            bound straight to it never opens, which is the whole point of saying why it is disabled.
          */}
          <Stack direction="row" spacing={0.25} sx={{ alignItems: "stretch" }}>
            <Tooltip title="Discards unsaved edits">
              <span style={{ flex: 1, display: "flex" }}>
                <Button
                  size="small"
                  variant="outlined"
                  fullWidth
                  sx={actionSx}
                  disabled={!live || busy}
                  onClick={onReadAll}
                >
                  Read from Device
                </Button>
              </span>
            </Tooltip>
            <MenuButton
              label={busy ? "..." : `Write to Device${totalDirty ? ` (${totalDirty})` : ""}`}
              variant="contained"
              color="warning"
              disabled={!live || busy || totalDirty === 0}
              tooltip={totalDirty ? "" : "No unsaved changes"}
              sx={actionSx}
              actions={[
                {
                  label: `Everything${totalDirty ? ` (${totalDirty})` : ""}`,
                  detail: "The device settings and every profile with changes, in turn",
                  disabled: totalDirty === 0,
                  onClick: onWriteEverything,
                },
                {
                  label: `Device Config${deviceDirty ? ` (${deviceDirty})` : ""}`,
                  detail: deviceDirty
                    ? "LOAD_DEVICE — reboots the blaster"
                    : "No device changes",
                  disabled: deviceDirty === 0,
                  onClick: onWriteDevice,
                },
                {
                  label: `Profile: ${profileName}${profileDirty ? ` (${profileDirty})` : ""}`,
                  detail: !profileDirty
                    ? "No changes to this profile"
                    : profileReboots
                      ? "LOAD_PROFILE — active slot, so it reboots"
                      : "LOAD_PROFILE — not the active slot, no reboot",
                  disabled: profileDirty === 0,
                  onClick: onWriteProfile,
                },
              ]}
            />
          </Stack>

          <Stack direction="row" spacing={0.25}>
            <MenuButton
              label="Backup"
              sx={actionSx}
              tooltip="Write a file to this computer"
              actions={[
                {
                  label: "Full Backup",
                  detail: "Device settings and every profile, in one file",
                  onClick: onSaveBundleFile,
                },
                {
                  label: "Device Config",
                  detail: "Device settings only, without the profiles",
                  onClick: onSaveDeviceFile,
                },
                {
                  label: `Profile: ${profileName}`,
                  detail: "Just the slot shown on the Profile tab",
                  onClick: onSaveProfileFile,
                },
              ]}
            />
            {/*
              The button is its own drop target. The picker behind it lives in a menu, so a drag
              has nothing else to aim at, and a strip of its own cost header space this column does
              not have. Which store the file is for is asked after the drop - the one place the
              declare-first rule has to bend, since a dragged file never passed through the menu.
            */}
            <Box
              {...dropProps}
              sx={{ display: "flex", flex: 1, ...dropOutlineSx(over), outlineOffset: 2 }}
            >
              <MenuButton
                label="Load Backup"
                sx={actionSx}
                tooltip="Read a file from this computer into the form, or drop one on this button"
                actions={[
                  {
                    label: "Full Backup",
                    detail: "Replaces device settings and all profiles",
                    onClick: () => onLoadFile("bundle"),
                  },
                  {
                    label: "Device Config",
                    detail: "Replaces device settings only",
                    onClick: () => onLoadFile("device"),
                  },
                  {
                    label: `Profile into ${profileName}`,
                    detail: "Replaces the slot shown on the Profile tab",
                    onClick: () => onLoadFile("profile"),
                  },
                ]}
              />
            </Box>
          </Stack>

          <Stack direction="row" spacing={0.25}>
            {/*
              The same three the OLED's Reboot menu offers, because a device with no screen - or
              one whose menu button the conflict engine just detached - has no other way to reach
              them. Bootloader in particular is the route to reflashing without the BOOTSEL button.
            */}
            <MenuButton
              label="Reboot"
              sx={actionSx}
              disabled={!live || busy}
              tooltip={live ? "Restart the blaster" : "Connect first"}
              actions={[
                {
                  label: "Reboot",
                  detail: "Restart normally",
                  onClick: () => onReboot("normal"),
                },
                {
                  label: "Bootloader",
                  detail: "USB drive mode, for flashing a .uf2",
                  onClick: () => onReboot("bootloader"),
                },
                {
                  label: "ESC Passthrough",
                  detail: "Hand the ESC pins to a host configurator",
                  onClick: () => onReboot("passthrough"),
                },
              ]}
            />
            {/*
              Three resets rather than one, because they lose different things and the device keeps
              them apart: a device reset preserves the wiring by the firmware's own no-OLED-row
              rule, so "reset everything" would be a lie about what it does. Each confirms with its
              own typed word - see ResetDialog.
            */}
            <MenuButton
              label="Reset"
              color="error"
              sx={actionSx}
              disabled={!live || busy}
              tooltip={live ? "Put something back to defaults" : "Connect first"}
              // Least destructive first, so the pointer travels further the more it costs and the
              // bottom of the list is the one nobody reaches by accident.
              actions={[
                {
                  label: `Profile: ${profileName}`,
                  detail: "Just the slot shown on the Profile tab",
                  onClick: () => onReset("profile"),
                },
                {
                  label: "Device Settings",
                  detail: "Factory defaults; wiring and profiles kept",
                  onClick: () => onReset("device"),
                },
                {
                  label: "Wiring",
                  detail: "Pins back to this board's defaults",
                  onClick: () => onReset("wiring"),
                },
                { label: "-" },
                {
                  label: "Everything",
                  detail: "All profiles and all device settings",
                  onClick: () => onReset("everything"),
                },
              ]}
            />
          </Stack>

          {/*
            Not a shortcut for the RPI-RP2 drive but a replacement for it: a host with a BitLocker
            removable-drive policy cannot write to that drive at all, and PICOBOOT is a USB
            interface rather than a volume. Enabled offline as well, because a board left in its
            bootloader has no serial port and is exactly the one that needs this. The dialog it
            opens is also where a .uf2 is downloaded from.
          */}
          <Tooltip title="Write a .uf2 to the blaster over USB, without the RPI-RP2 drive">
            <span>
              <Button
                size="small"
                variant="outlined"
                fullWidth
                sx={actionSx}
                disabled={busy}
                onClick={onFlashFirmware}
              >
                Flash Firmware
              </Button>
            </span>
          </Tooltip>

          <Divider sx={{ my: 0.25 }} />

          <Tooltip
            title={
              verbose
                ? "Turn the device's warn/info log back off. Reboots the blaster."
                : "Turn on the device's warn/info log: switch presses, state changes, shots and overrunning loops. Not needed for an RPM capture; reboots the blaster."
            }
          >
            <span>
              <Button
                size="small"
                fullWidth
                variant={verbose ? "contained" : "outlined"}
                color={verbose ? "warning" : "inherit"}
                sx={actionSx}
                disabled={!live || busy}
                onClick={onToggleVerbose}
              >
                {verbose ? "Verbose Logging: On" : "Verbose Logging"}
              </Button>
            </span>
          </Tooltip>
        </Stack>
      </Stack>

      {garblingFw && (
        <Box sx={{ mt: 0.5 }}>
          <Typography variant="caption" color="warning.main">
            With verbose logging on, firmware {garblingFw} can garble its replies, so a read or write
            may fail or show stale values. Update to {FW_LOGS_WAIT_FOR_REPLIES} or later to fix it for
            good, or turn verbose off first.
          </Typography>
        </Box>
      )}
    </Paper>
  );
}
