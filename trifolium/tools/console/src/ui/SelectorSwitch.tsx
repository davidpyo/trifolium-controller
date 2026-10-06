import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { withIndexOptions } from "../schema/enumValue";
import { getByKey } from "../schema/keyPath";
import { isVisible, walk, type Schema, type SchemaNode } from "../schema/types";
import { helpFor } from "../help/settings";
import { FieldControl } from "./Field";
import { HelpTip } from "./Help";

// The selector switch, laid out around the thing that actually confuses people.
//
// Those three pins do two different jobs at once. With variableFPS on and SWITCH select-fire, the
// first grounded pin picks the *profile slot* at boot, and then the same pin position picks the
// *fire mode* within that profile for as long as it is held. Three dropdowns in a list do not say
// that; a row per position with a column for each job does.
//
// The fire mode column is the profile's switchPositionAssignment, the profile column the device's
// switchPositionProfile - one entry per position in each, and both shared with the encoder. The
// none row is a real state rather than a filler: it uses the Default Mode and boots
// device:defaultProfileIndex. Pin numbers are read straight from the device payload because they
// have no menu items and therefore no schema entry - read-only until the firmware exposes them.

const PIN_NOT_USED = 255;

const cellSx = { py: 0.4, px: 0.75, borderBottom: "none" } as const;

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

type Modes = { name?: string; burstMode?: string }[];

function fireModes(profile: unknown): Modes {
  return (profile as { fireModes?: Modes })?.fireModes ?? [];
}

/** A mode's own name, else its firing mode's; "Default" for an unassigned position. */
function modeNameIn(schema: Schema, modes: Modes, index: number | undefined): string {
  if (typeof index !== "number" || index < 0) return "Default";
  const raw = modes[index]?.name?.trim();
  if (raw) return raw;
  const cap = schema.fireModeCaps?.find((c) => c.burstMode === modes[index]?.burstMode);
  return cap?.name ?? `Mode ${index + 1}`;
}

/** Every mode's name, in list order, from the list as edited. */
function modeNamesIn(schema: Schema, profile: unknown): string[] {
  const modes = fireModes(profile);
  const count = (profile as { activeModeCount?: number })?.activeModeCount ?? modes.length;
  return Array.from({ length: count }, (_, i) => modeNameIn(schema, modes, i));
}

/** One per-position table's nodes, in position order: index 0 is position 1. */
function positionNodes(schema: Schema, key: string): (SchemaNode | undefined)[] {
  const found: (SchemaNode | undefined)[] = [];
  walk(schema.tree, (node) => {
    const m = /^(.*)\[(\d+)\]$/.exec(node.key ?? "");
    if (m && m[1] === key) found[Number(m[2])] ??= node;
  });
  return found;
}

const MODE_KEY = "profile:switchPositionAssignment";
const PROFILE_KEY = "device:switchPositionProfile";

interface IndexPickerProps {
  node: SchemaNode | undefined;
  /** The list the stored index points into, as edited here. */
  names: string[];
  payload: unknown;
  onEdit: (key: string, value: unknown) => void;
}

function IndexPicker({ node, names, payload, onEdit }: IndexPickerProps) {
  if (!node) {
    return (
      <Typography variant="caption" color="text.disabled">
        &mdash;
      </Typography>
    );
  }
  return (
    <Box sx={{ width: 168 }}>
      <FieldControl
        node={withIndexOptions(node, names)}
        value={getByKey(payload, node.key!)}
        onChange={(next) => onEdit(node.key!, next)}
      />
    </Box>
  );
}

function FixedProfile() {
  return (
    <Typography variant="caption" color="text.disabled">
      fixed profile
    </Typography>
  );
}

function HeaderCell({ label, helpKey }: { label: string; helpKey?: string }) {
  const text = (
    <Typography variant="caption" sx={{ fontWeight: 600 }}>
      {label}
    </Typography>
  );
  return (
    <TableCell sx={cellSx}>
      {helpKey ? <HelpTip help={helpFor(helpKey)}>{text}</HelpTip> : text}
    </TableCell>
  );
}

function VariableFpsNote({ on, selector }: { on: boolean; selector: string }) {
  return (
    <Typography variant="caption" color="text.secondary">
      {on
        ? `Variable FPS is on, so the ${selector}'s position at power-on also chooses the ` +
          "profile - the profile column above. It is read at boot only, and it is a device " +
          "setting rather than a profile one, so it is written by Write › Device."
        : `Variable FPS is off, so the ${selector} selects fire mode only and the profile ` +
          "stays put."}
    </Typography>
  );
}

export function SelectorSwitch({
  schema,
  device,
  profile,
  profileNames,
  onEdit,
}: SelectorSwitchProps) {
  const modeNodes = positionNodes(schema, MODE_KEY);
  const profileNodes = positionNodes(schema, PROFILE_KEY);
  const pins = [0, 1, 2].map((i) => getByKey(device, `device:select${i}Pin`));
  const variableFps = getByKey(device, "device:variableFPS") === true;
  const defaultProfileNode = nodeForKey(schema, "device:defaultProfileIndex");
  const defaultMode = getByKey(profile, "profile:defaultFiringMode");
  const defaultModeName = modeNameIn(
    schema,
    fireModes(profile),
    typeof defaultMode === "number" ? defaultMode : undefined,
  );
  const modeNames = modeNamesIn(schema, profile);

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
              <HeaderCell label="Position" />
              <HeaderCell label="Pin" helpKey="device:select1Pin" />
              <HeaderCell label="Fire mode (this profile)" helpKey={`${MODE_KEY}[0]`} />
              <HeaderCell label="Profile at boot" helpKey={`${PROFILE_KEY}[0]`} />
            </TableRow>
          </TableHead>
          <TableBody>
            {[0, 1, 2].map((pos) => {
              const pin = pins[pos];
              const wired = typeof pin === "number" && pin !== PIN_NOT_USED;
              const node = modeNodes[pos];
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
                    <IndexPicker
                      node={usable ? node : undefined}
                      names={modeNames}
                      payload={profile}
                      onEdit={onEdit}
                    />
                  </TableCell>
                  <TableCell sx={cellSx}>
                    {variableFps ? (
                      <IndexPicker
                        node={wired ? profileNodes[pos] : undefined}
                        names={profileNames}
                        payload={device}
                        onEdit={onEdit}
                      />
                    ) : (
                      <FixedProfile />
                    )}
                  </TableCell>
                </TableRow>
              );
            })}

            <TableRow>
              <TableCell sx={cellSx}>
                <Typography variant="caption" color="text.disabled">
                  none
                </Typography>
              </TableCell>
              <TableCell sx={cellSx} />
              <TableCell sx={cellSx}>
                <Typography variant="caption" color="text.secondary">
                  {defaultModeName}{" "}
                  <Box component="span" sx={{ color: "text.disabled" }}>
                    (Default Mode)
                  </Box>
                </Typography>
              </TableCell>
              <TableCell sx={cellSx}>
                {variableFps ? (
                  <IndexPicker
                    node={defaultProfileNode}
                    names={profileNames}
                    payload={device}
                    onEdit={onEdit}
                  />
                ) : (
                  <FixedProfile />
                )}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>

      <Stack spacing={0.25}>
        <Typography variant="caption" color="text.secondary">
          The lowest grounded position wins: 1 beats 2 beats 3. &ldquo;Default&rdquo; on a position
          means it uses this profile&rsquo;s Default Mode, or the Default Profile at boot.
        </Typography>
        <VariableFpsNote on={variableFps} selector="switch" />
        {modeNames.length === 0 && (
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

export interface EncoderSelectorProps {
  schema: Schema;
  device: unknown;
  profile: unknown;
  profileNames: string[];
  onEdit: (key: string, value: unknown) => void;
}

/** The wired select lines' GPIOs, lowest bit first. */
export function encoderLines(device: unknown): number[] {
  return [0, 1, 2]
    .map((i) => getByKey(device, `device:select${i}Pin`))
    .filter((pin): pin is number => typeof pin === "number" && pin !== PIN_NOT_USED);
}

// The encoder reads its wired select lines as the bits of a position number. Position 0, no line
// grounded, is the Default Mode and boots the Default Profile, as the switch's none row does; every
// other position picks its mode and its profile from the same tables the switch's positions use, so
// a two-line, three-position switch can leave more modes in the list for the screen. Every row
// listed is a position these lines reach, so no row asks the device's visibility, which was decided
// for whatever select type it booted with.
export function EncoderSelector({
  schema,
  device,
  profile,
  profileNames,
  onEdit,
}: EncoderSelectorProps) {
  const lines = encoderLines(device);
  const modeNodes = positionNodes(schema, MODE_KEY);
  const profileNodes = positionNodes(schema, PROFILE_KEY);
  const defaultModeNode = nodeForKey(schema, "profile:defaultFiringMode");
  const defaultProfileNode = nodeForKey(schema, "device:defaultProfileIndex");
  const variableFps = getByKey(device, "device:variableFPS") === true;
  const modeNames = modeNamesIn(schema, profile);
  const positions = Array.from({ length: 1 << lines.length }, (_, p) => p);

  return (
    <Stack spacing={1}>
      <TableContainer sx={{ overflowX: "auto" }}>
        <Table size="small" sx={{ width: "auto" }}>
          <TableHead>
            <TableRow>
              <HeaderCell label="Position" />
              <HeaderCell label="Lines grounded" />
              <HeaderCell label="Fire mode (this profile)" helpKey={`${MODE_KEY}[0]`} />
              <HeaderCell label="Profile at boot" helpKey={`${PROFILE_KEY}[0]`} />
            </TableRow>
          </TableHead>
          <TableBody>
            {positions.map((pos) => {
              const grounded = lines.filter((_, bit) => pos & (1 << bit));
              return (
                <TableRow key={pos}>
                  <TableCell sx={cellSx}>
                    <Typography variant="caption">{pos}</Typography>
                  </TableCell>
                  <TableCell sx={cellSx}>
                    <Typography variant="caption" sx={{ fontFamily: "ui-monospace, monospace" }}>
                      {grounded.length ? grounded.map((pin) => `GP${pin}`).join(" + ") : "none"}
                    </Typography>
                  </TableCell>
                  <TableCell sx={cellSx}>
                    {pos === 0 ? (
                      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                        <IndexPicker
                          node={defaultModeNode}
                          names={modeNames}
                          payload={profile}
                          onEdit={onEdit}
                        />
                        <Typography variant="caption" color="text.disabled">
                          (Default Mode)
                        </Typography>
                      </Stack>
                    ) : (
                      <IndexPicker
                        node={modeNodes[pos - 1]}
                        names={modeNames}
                        payload={profile}
                        onEdit={onEdit}
                      />
                    )}
                  </TableCell>
                  <TableCell sx={cellSx}>
                    {variableFps ? (
                      <IndexPicker
                        node={pos === 0 ? defaultProfileNode : profileNodes[pos - 1]}
                        names={profileNames}
                        payload={device}
                        onEdit={onEdit}
                      />
                    ) : (
                      <FixedProfile />
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Stack spacing={0.25}>
        <Typography variant="caption" color="text.secondary">
          Each wired select line is one bit of the position, the lowest-numbered line the lowest
          bit. &ldquo;Default&rdquo; on a position means it uses this profile&rsquo;s Default Mode,
          or the Default Profile at boot - what position 0 uses.
        </Typography>
        <VariableFpsNote on={variableFps} selector="encoder" />
        {lines.length === 0 && (
          <Typography variant="caption" color="warning.main">
            No select lines are wired, so the encoder always reads position 0.
          </Typography>
        )}
        {modeNames.length === 0 && (
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
