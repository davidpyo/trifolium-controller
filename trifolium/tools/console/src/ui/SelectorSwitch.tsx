import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { getByKey } from "../schema/keyPath";
import { isVisible, walk, type Schema, type SchemaNode } from "../schema/types";
import { FieldControl } from "./Field";

// The selector switch, laid out around the thing that actually confuses people.
//
// Those three pins do two different jobs at once. With variableFPS on and SWITCH select-fire, the
// first grounded pin picks the *profile slot* at boot, and then the same pin position picks the
// *fire mode* within that profile for as long as it is held. Three dropdowns in a list do not say
// that; a row per position with a column for each job does.
//
// Which profile a *position* selects is positional in firmware (position i boots profile i, see
// selectShotProfileAtBoot) and not configurable, so showing it as a field would be a lie. The one
// exception is the none row: no position grounded is a real state, and what it boots into is
// device:defaultProfileIndex, editable here because this is the only place its effect is visible.
// Pin numbers are read straight from the device payload because they have no menu items and
// therefore no schema entry - read-only until the firmware exposes them.

const PIN_NOT_USED = 255;

export interface SelectorSwitchProps {
  schema: Schema;
  device: unknown;
  profile: unknown;
  profileNames: string[];
  onEdit: (key: string, value: unknown) => void;
}

/** One node by its stored key, or undefined if this firmware does not publish it. */
function nodeForKey(schema: Schema, key: string): SchemaNode | undefined {
  let found: SchemaNode | undefined;
  walk(schema.tree, (node) => {
    if (node.key === key) found = node;
  });
  return found;
}

/** The three switchPositionAssignment nodes, in position order. */
function positionNodes(schema: Schema): (SchemaNode | undefined)[] {
  const found: (SchemaNode | undefined)[] = [undefined, undefined, undefined];
  walk(schema.tree, (node) => {
    const m = /^profile:switchPositionAssignment\[(\d)\]$/.exec(node.key ?? "");
    if (m) found[Number(m[1])] ??= node;
  });
  return found;
}

export function SelectorSwitch({
  schema,
  device,
  profile,
  profileNames,
  onEdit,
}: SelectorSwitchProps) {
  const nodes = positionNodes(schema);
  const pins = [0, 1, 2].map((i) => getByKey(device, `device:select${i}Pin`));
  const variableFps = getByKey(device, "device:variableFPS") === true;
  const defaultProfileNode = nodeForKey(schema, "device:defaultProfileIndex");
  const defaultMode = getByKey(profile, "profile:defaultFiringMode");
  const modes = (profile as { fireModes?: { name?: string }[] })?.fireModes ?? [];
  const modeCount = (profile as { activeModeCount?: number })?.activeModeCount ?? modes.length;

  const cellSx = { py: 0.4, px: 0.75, borderBottom: "none" } as const;

  const modeName = (index: number | undefined) => {
    if (typeof index !== "number" || index < 0) return "Default";
    const raw = modes[index]?.name?.trim();
    if (raw) return raw;
    const cap = schema.fireModeCaps?.find(
      (c) => c.burstMode === (modes[index] as { burstMode?: string })?.burstMode,
    );
    return cap?.name ?? `Mode ${index + 1}`;
  };

  return (
    <Stack spacing={1}>
      {/*
        No "Select-Fire Type is not Switch" notice here. App.tsx renders this editor only when
        that type *is* Switch, so the notice could never be true - it was a second spelling of a
        condition this component already depends on, and it disagreed with the first: it compared
        the stored value against the ordinal 1, while selectFireType is a named enum stored as
        "switch". Always false, so the notice showed on every render of a correctly set switch.
        One condition, in the parent that owns the gate.
      */}
      <TableContainer sx={{ overflowX: "auto" }}>
        <Table size="small" sx={{ width: "auto" }}>
          <TableHead>
            <TableRow>
              <TableCell sx={cellSx}>
                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                  Position
                </Typography>
              </TableCell>
              <TableCell sx={cellSx}>
                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                  Pin
                </Typography>
              </TableCell>
              <TableCell sx={cellSx}>
                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                  Fire mode (this profile)
                </Typography>
              </TableCell>
              <TableCell sx={cellSx}>
                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                  Profile at boot
                </Typography>
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {[0, 1, 2].map((pos) => {
              const pin = pins[pos];
              const wired = typeof pin === "number" && pin !== PIN_NOT_USED;
              const node = nodes[pos];
              // The firmware hides a position whose pin is undefined; that is the same fact as the
              // pin being 255, so either signal is enough to grey the row.
              const usable = wired && node !== undefined && isVisible(node);

              return (
                <TableRow key={pos}>
                  <TableCell sx={cellSx}>
                    <Typography variant="caption">{pos + 1}</Typography>
                  </TableCell>
                  <TableCell sx={cellSx}>
                    <Typography
                      variant="caption"
                      color={wired ? "text.primary" : "text.disabled"}
                      sx={{ fontFamily: "ui-monospace, monospace" }}
                    >
                      {wired ? `GP${pin}` : "not wired"}
                    </Typography>
                  </TableCell>
                  <TableCell sx={cellSx}>
                    {usable && node ? (
                      <Box sx={{ width: 168 }}>
                        <FieldControl
                          node={node}
                          value={getByKey(profile, node.key!)}
                          onChange={(next) => onEdit(node.key!, next)}
                        />
                      </Box>
                    ) : (
                      <Typography variant="caption" color="text.disabled">
                        &mdash;
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={cellSx}>
                    <Typography
                      variant="caption"
                      color={variableFps && wired ? "text.secondary" : "text.disabled"}
                    >
                      {variableFps
                        ? wired
                          ? (profileNames[pos] ?? `Slot ${pos + 1}`)
                          : "—"
                        : "fixed profile"}
                    </Typography>
                  </TableCell>
                </TableRow>
              );
            })}

            {/* A real state with real behaviour, not a filler row: with no pin grounded the firmware
                falls back to defaultFiringMode, and at boot to defaultProfileIndex. */}
            <TableRow>
              <TableCell sx={cellSx}>
                <Typography variant="caption" color="text.disabled">
                  none
                </Typography>
              </TableCell>
              <TableCell sx={cellSx} />
              <TableCell sx={cellSx}>
                <Typography variant="caption" color="text.secondary">
                  {modeName(typeof defaultMode === "number" ? defaultMode : undefined)}{" "}
                  <Box component="span" sx={{ color: "text.disabled" }}>
                    (Default Mode)
                  </Box>
                </Typography>
              </TableCell>
              <TableCell sx={cellSx}>
                {variableFps && defaultProfileNode ? (
                  <Box sx={{ width: 168 }}>
                    <FieldControl
                      node={defaultProfileNode}
                      value={getByKey(device, defaultProfileNode.key!)}
                      onChange={(next) => onEdit(defaultProfileNode.key!, next)}
                    />
                  </Box>
                ) : (
                  <Typography variant="caption" color="text.disabled">
                    fixed profile
                  </Typography>
                )}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>

      <Stack spacing={0.25}>
        <Typography variant="caption" color="text.secondary">
          The lowest grounded position wins: 1 beats 2 beats 3. &ldquo;Default&rdquo; on a position
          means it uses this profile&rsquo;s Default Mode.
        </Typography>
        {variableFps ? (
          <Typography variant="caption" color="text.secondary">
            Variable FPS is on, so these same pins also choose the profile slot at power-on — the
            profile column above. Changing slots needs a reboot, so it is read at boot only. The
            none row is a device setting, not a profile one, so it is written by Write &rsaquo;
            Device.
          </Typography>
        ) : (
          <Typography variant="caption" color="text.secondary">
            Variable FPS is off, so the switch selects fire mode only and the profile stays put.
          </Typography>
        )}
        {modeCount === 0 && (
          <Typography variant="caption" color="warning.main">
            This profile has no fire modes to assign.
          </Typography>
        )}
        <Typography variant="caption" color="text.disabled">
          Pin numbers are shown as the device reports them; they are not editable here yet.
        </Typography>
      </Stack>
    </Stack>
  );
}
