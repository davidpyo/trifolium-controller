import React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import { getByKey } from "../../schema/keyPath";
import type { BootStatus, Schema } from "../../schema/types";
import { BootFaults } from "../BootFaults";
import { CONFIG_ACCEPT, Chip, type LoadIntent } from "../TopBar";
import { dropOutlineSx, useFileDrop } from "../FileDrop";
import { MenuButton } from "../MenuButton";
import { PinConflicts } from "../PinConflicts";
import { Page, PageHead, Panel } from "../shell/Shell";
import type { ViewId } from "../shell/Nav";

// The first page: which blaster this is, what each profile is set to, whether its last boot was
// healthy, and the backups. Everything here is read from what the console already holds; nothing on
// this page writes.

interface Mode {
  name?: string;
  burstMode?: string;
}

const cells = (batteryType: unknown): number =>
  Number(String(batteryType ?? "").replace(/\D/g, "")) || 0;

const volts = (mv: number) => `${(mv / 1000).toFixed(1)} V`;

function Stat({ k, v, s }: { k: string; v: React.ReactNode; s?: React.ReactNode }) {
  return (
    <Box
      sx={{
        bgcolor: "background.paper",
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        px: 1.75,
        py: 1.5,
        display: "grid",
        gap: 0.5,
        alignContent: "start",
        minWidth: 0,
      }}
    >
      <Box
        sx={{
          fontSize: 11.5,
          color: "text.disabled",
          textTransform: "uppercase",
          letterSpacing: ".06em",
          fontWeight: 650,
        }}
      >
        {k}
      </Box>
      <Box sx={{ fontSize: 17, fontWeight: 650, overflowWrap: "anywhere" }}>{v}</Box>
      {s && <Box sx={{ fontSize: 12.5, color: "text.secondary" }}>{s}</Box>}
    </Box>
  );
}

function HealthRow({ ok, title, detail }: { ok: boolean; title: string; detail: React.ReactNode }) {
  return (
    <Box
      sx={{
        display: "flex",
        gap: 1.5,
        alignItems: "flex-start",
        px: 2,
        py: 1.35,
        borderTop: 1,
        borderColor: "divider",
        "&:first-of-type": { borderTop: 0 },
      }}
    >
      <Box
        component="span"
        aria-hidden
        sx={{ color: ok ? "success.main" : "warning.main", fontWeight: 700, mt: "1px" }}
      >
        {ok ? "✓" : "!"}
      </Box>
      <Box>
        <Box sx={{ fontWeight: 550 }}>{title}</Box>
        <Box sx={{ color: "text.secondary", fontSize: 12.5 }}>{detail}</Box>
      </Box>
    </Box>
  );
}

export interface OverviewProps {
  live: boolean;
  schema: Schema;
  boot: BootStatus | null;
  device: unknown;
  profiles: unknown[];
  profileName: (slot: number) => string;
  wiringLabel: string;
  /** The slot the Profiles page is showing, which Back up and Restore offer for one profile. */
  slot: number;
  onGo: (view: ViewId, slot?: number) => void;
  onSaveBundle: () => void;
  onSaveDevice: () => void;
  onSaveProfile: () => void;
  onLoad: (intent: LoadIntent) => void;
  onDropFile: (file: File) => void;
  onDropReject: (message: string) => void;
}

export function Overview(props: OverviewProps) {
  const { live, schema, boot, device, profiles, profileName, wiringLabel, slot, onGo } = props;

  const motors =
    (getByKey(device as never, "device:motorConfig") as { enabled?: boolean }[] | undefined) ?? [];
  const enabled = motors.map((m, i) => (m?.enabled ? i : -1)).filter((i) => i >= 0);
  const n = cells(getByKey(device as never, "device:batteryType"));
  const cutoff = Number(getByKey(device as never, "device:lowVoltageCutoffPerCell_mv") ?? 0);
  const warning = Number(getByKey(device as never, "device:lowVoltageWarningPerCell_mv") ?? 0);
  const batteryPin = getByKey(device as never, "device:batteryAdcPin");
  const reads = batteryPin !== undefined && batteryPin !== 255;
  const arming = boot?.escArming;
  const faults = boot?.configFaults ?? [];
  const conflicts = schema.pinConflicts ?? [];

  const { over, dropProps } = useFileDrop({
    accept: CONFIG_ACCEPT,
    what: "a .json config file",
    onFile: props.onDropFile,
    onReject: props.onDropReject,
  });

  return (
    <Page>
      <PageHead
        title="Overview"
        lede="Which blaster this is, what it is set to, and whether its last boot was healthy."
      />

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 1.5,
          mb: 2.25,
        }}
      >
        <Stat
          k="Blaster"
          v={String(getByKey(device as never, "device:blasterName") || "Unnamed")}
          s={
            enabled.length
              ? `Motors ${enabled.map((i) => i + 1).join(", ")} in use`
              : "No motors enabled"
          }
        />
        <Stat
          k="Board"
          v={wiringLabel.replace(/ \(modified\)$/, "")}
          s={
            wiringLabel.endsWith("(modified)")
              ? "Wiring changed from the preset"
              : "Wiring matches the preset"
          }
        />
        <Stat
          k="Firmware"
          v={live ? schema.fw : "Not connected"}
          s={live ? undefined : "Showing the sample config"}
        />
        <Stat
          k="Battery"
          v={n ? `${n}S pack` : "Not set"}
          s={
            !reads
              ? "No battery reading wired: 3.5 V a cell is assumed, so there is no cutoff"
              : n
                ? `Cutoff ${volts(cutoff * n)}, warning ${volts(warning * n)}`
                : undefined
          }
        />
      </Box>

      <Panel
        title="Profiles"
        lede="The selector picks one at power-on"
        actions={
          <Button
            size="small"
            color="inherit"
            onClick={() => onGo("profiles")}
            sx={{ color: "text.secondary" }}
          >
            Edit profiles
          </Button>
        }
      >
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(3, minmax(0, 1fr))" },
            gap: 1.5,
            p: 2,
          }}
        >
          {profiles.map((p, i) => {
            const rev = (getByKey(p as never, "profile:revRPM") as number[] | undefined) ?? [];
            const rpm = Math.max(0, ...enabled.map((m) => rev[m] ?? 0));
            const count = Number(getByKey(p as never, "profile:activeModeCount") ?? 0);
            const modes = (
              (getByKey(p as never, "profile:fireModes") as Mode[] | undefined) ?? []
            ).slice(0, count || undefined);
            return (
              <Box
                key={i}
                component="button"
                type="button"
                onClick={() => onGo("profiles", i)}
                aria-label={`Edit profile ${profileName(i)}`}
                sx={{
                  border: 1,
                  borderColor: "divider",
                  borderRadius: 2,
                  p: 1.5,
                  bgcolor: "background.default",
                  textAlign: "left",
                  display: "grid",
                  gap: 0.75,
                  cursor: "pointer",
                  font: "inherit",
                  color: "inherit",
                  "&:hover": { borderColor: "primary.main" },
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                  <Box component="b" sx={{ fontSize: 14.5 }}>
                    {profileName(i)}
                  </Box>
                  {i === schema.activeProfileIndex && live && <Chip tone="accent">Active</Chip>}
                </Box>
                <Box
                  sx={{
                    fontFamily: "ui-monospace, Consolas, monospace",
                    fontSize: 13,
                    color: "text.secondary",
                  }}
                >
                  {rpm ? `${rpm.toLocaleString()} RPM` : "RPM not set"}
                </Box>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                  {modes.map((m, j) => (
                    <Box
                      key={j}
                      component="span"
                      sx={{
                        fontFamily: "ui-monospace, Consolas, monospace",
                        fontSize: 11.5,
                        fontWeight: 700,
                        px: 0.85,
                        borderRadius: 1,
                        border: 1,
                        borderColor: "divider",
                      }}
                    >
                      {m.name?.trim() || String(m.burstMode ?? "").toUpperCase()}
                    </Box>
                  ))}
                </Box>
              </Box>
            );
          })}
        </Box>
      </Panel>

      <Panel
        title="Health"
        lede={
          live
            ? "From the last boot and the schema header"
            : "Connect a blaster to read its last boot"
        }
      >
        {faults.length > 0 && (
          <Box sx={{ p: 1.5 }}>
            <BootFaults boot={boot} />
          </Box>
        )}
        {conflicts.length > 0 && (
          <Box sx={{ p: 1.5, pt: faults.length ? 0 : 1.5 }}>
            <PinConflicts schema={schema} />
          </Box>
        )}
        <Box>
          {live && !faults.length && (
            <HealthRow
              ok
              title="No boot faults"
              detail="Everything stored was loaded on the last boot."
            />
          )}
          {live && !conflicts.length && (
            <HealthRow
              ok
              title="No pin conflicts"
              detail="Each pin in use belongs to one control."
            />
          )}
          {live && arming?.ran && (
            <HealthRow
              ok={!arming.timedOut}
              title={arming.timedOut ? "ESC arming timed out" : "ESCs armed"}
              detail={
                arming.answeredAt_ms
                  .map((ms, i) => (ms ? `Motor ${i + 1} at ${ms} ms` : null))
                  .filter(Boolean)
                  .join(", ") || `Arming took ${arming.duration_ms} ms`
              }
            />
          )}
          {!live && (
            <HealthRow
              ok
              title="Nothing connected"
              detail="Boot faults, pin conflicts and ESC arming show here once a blaster is connected."
            />
          )}
        </Box>
      </Panel>

      <Panel title="Backups and firmware">
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
            gap: 1.25,
            p: 2,
            alignItems: "stretch",
          }}
        >
          <Box sx={{ display: "grid", gap: 0.75, alignContent: "start" }}>
            <Box sx={{ fontSize: 12.5, color: "text.secondary" }}>
              Save the settings to a file on this computer.
            </Box>
            <MenuButton
              label="Back up"
              actions={[
                {
                  label: "Full Backup",
                  detail: "Blaster settings and every profile, in one file",
                  onClick: props.onSaveBundle,
                },
                {
                  label: "Device Config",
                  detail: "Blaster settings only, without the profiles",
                  onClick: props.onSaveDevice,
                },
                {
                  label: `Profile: ${profileName(slot)}`,
                  detail: "Just the slot the Profiles page shows",
                  onClick: props.onSaveProfile,
                },
              ]}
            />
          </Box>
          <Box
            {...dropProps}
            sx={{
              display: "grid",
              gap: 0.75,
              alignContent: "start",
              ...dropOutlineSx(over),
              outlineOffset: 4,
              borderRadius: 1,
            }}
          >
            <Box sx={{ fontSize: 12.5, color: "text.secondary" }}>
              Or drop a .json here. Its values are staged for review, not written.
            </Box>
            <MenuButton
              label="Restore"
              actions={[
                {
                  label: "Full Backup",
                  detail: "Replaces blaster settings and all profiles",
                  onClick: () => props.onLoad("bundle"),
                },
                {
                  label: "Device Config",
                  detail: "Replaces blaster settings only",
                  onClick: () => props.onLoad("device"),
                },
                {
                  label: `Profile into ${profileName(slot)}`,
                  detail: "Replaces the slot the Profiles page shows",
                  onClick: () => props.onLoad("profile"),
                },
              ]}
            />
          </Box>
          <Box sx={{ display: "grid", gap: 0.75, alignContent: "start" }}>
            <Box sx={{ fontSize: 12.5, color: "text.secondary" }}>
              Flash a release over USB, no RPI-RP2 drive needed.
            </Box>
            <Button variant="outlined" size="small" onClick={() => onGo("firmware")}>
              Update firmware
            </Button>
          </Box>
        </Box>
      </Panel>
    </Page>
  );
}
