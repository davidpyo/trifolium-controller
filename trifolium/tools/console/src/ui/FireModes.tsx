import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Radio from "@mui/material/Radio";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { getByKey } from "../schema/keyPath";
import {
  fireModeLeafOf,
  isFireModeRow,
  isVisible,
  walk,
  type FireModeCap,
  type Schema,
  type SchemaNode,
} from "../schema/types";
import { FieldControl } from "./Field";

// The Select-Fire mode editor, as a table: one row per mode, one column per property.
//
// On the device, one set of rows is shared between all ten Mode slots, indexed by a global the menu
// sets when a row is opened. The firmware walks that set once per mode with the index already
// pointed at it, so the schema carries a concrete row per mode - `fireModes[2].burstLength`. This
// table transposes them back: a column is a property, identified by its leaf name, and a cell is
// that property on one mode.
//
// Which properties apply, and what bounds they carry, depend on the mode's burstMode: AUTO reads
// Burst Length as "rounds while held" and allows 1-500, BURST caps at 10, SAFE has no burst length
// at all. Rather than reimplement those rules, the firmware probes its own menu items once per
// burstMode and reports the answers as `fireModeCaps`. A cell that does not apply to a row's mode is
// left as a dash rather than shown disabled, because the property genuinely does not exist for it.

interface FireMode {
  name?: string;
  burstMode?: string;
  [k: string]: unknown;
}

/**
 * Properties the table shows regardless of what the firmware reports as applicable right now.
 *
 * includeInCycle only applies to BUTTON select-fire, so the device hides it otherwise - but it is
 * stored per mode and this table is where you would set it up before switching to a button. Same
 * argument as the "inactive" groups elsewhere: a value that still drives hardware is worth showing.
 */
const ALWAYS_SHOWN = ["includeInCycle"];

/** Column order: name first, since it is the one property every mode has. */
const COLUMN_ORDER = [
  "name",
  "burstMode",
  "burstLength",
  "targetDPS",
  "binaryTriggerTimeout_ms",
  "reversible",
  "includeInCycle",
];

/** The property a fire-mode row edits, with the mode index stripped off. */
const leafOf = fireModeLeafOf;

/** That property on a given mode, which is the key the device actually stores it under. */
const keyForMode = (col: SchemaNode, index: number) =>
  `profile:fireModes[${index}].${leafOf(col.key)}`;

const columnRank = (key: string) => {
  const i = COLUMN_ORDER.indexOf(leafOf(key));
  return i === -1 ? COLUMN_ORDER.length : i;
};

/**
 * One column per property, taken from whichever mode's row is met first.
 *
 * Deduplicated by leaf name rather than by key, because the tree now holds a separate row per mode
 * and they would otherwise become one column each. The bounds carried here are that first mode's;
 * applyCap() overlays the right ones per row.
 */
function editorColumns(schema: Schema): SchemaNode[] {
  const cols: SchemaNode[] = [];
  const seen = new Set<string>();
  walk(schema.tree, (node) => {
    if (!isFireModeRow(node.key) || !node.key) return;
    const leaf = leafOf(node.key);
    if (seen.has(leaf)) return; // another mode's copy, or a root shortcut to the same row
    seen.add(leaf);
    cols.push(node);
  });
  return cols.sort((a, b) => columnRank(a.key!) - columnRank(b.key!));
}

/**
 * Overlays a mode's per-burstMode bounds and applicability onto a column definition.
 *
 * Where caps are unavailable the column's own schema values stand. That happens when the mode list
 * is full: the firmware will not borrow a live slot to probe with, so it reports
 * `fireModeCaps: null`.
 */
function applyCap(col: SchemaNode, cap: FireModeCap | undefined): SchemaNode {
  // Matched on the leaf: caps name the shared row (`[*]`) while a column names one mode.
  const field = cap?.fields.find((f) => leafOf(f.key) === leafOf(col.key));
  if (!field) return col;
  const always = ALWAYS_SHOWN.includes(leafOf(col.key));
  return {
    ...col,
    visible: field.visible || always ? undefined : false,
    lo: field.lo ?? col.lo,
    hi: field.hi ?? col.hi,
    step: field.step ?? col.step,
  };
}

export interface FireModesProps {
  schema: Schema;
  profile: unknown;
  onEdit: (key: string, value: unknown) => void;
  /** Replaces the whole fireModes array and activeModeCount together, for add/copy/delete. */
  onReplaceModes: (modes: FireMode[]) => void;
}

export function FireModes({ schema, profile, onEdit, onReplaceModes }: FireModesProps) {
  const columns = editorColumns(schema);
  const all = (profile as { fireModes?: FireMode[] })?.fireModes ?? [];
  const declared = (profile as { activeModeCount?: number })?.activeModeCount ?? all.length;
  const modes = all.slice(0, Math.min(declared, all.length));
  const bootMode = (profile as { defaultFiringMode?: number })?.defaultFiringMode;

  if (!columns.length) {
    return <Alert severity="info">This firmware reports no per-mode fields.</Alert>;
  }

  const cellSx = { py: 0.35, px: 0.5, borderBottom: "none", verticalAlign: "top" } as const;

  /**
   * Deleting a mode repairs every index that pointed past it, exactly as the firmware's
   * deleteFireMode() does: the boot mode and all three switch-position assignments shift down, and a
   * position pointing at the deleted mode falls back to Default (-1).
   *
   * Getting this wrong does not error - it silently repoints a switch position at a different mode.
   */
  const remove = (index: number) => {
    if (modes.length <= 1) return; // the firmware refuses to drop the last mode
    onReplaceModes(modes.filter((_, i) => i !== index));

    if (typeof bootMode === "number") {
      if (bootMode === index) onEdit("profile:defaultFiringMode", 0);
      else if (bootMode > index) onEdit("profile:defaultFiringMode", bootMode - 1);
    }
    const assigned = (profile as { switchPositionAssignment?: number[] })?.switchPositionAssignment;
    assigned?.forEach((a, pos) => {
      if (a === index) onEdit(`profile:switchPositionAssignment[${pos}]`, -1);
      else if (a > index) onEdit(`profile:switchPositionAssignment[${pos}]`, a - 1);
    });
  };

  const duplicate = (index: number) => {
    if (modes.length >= schema.maxFireModes) return;
    onReplaceModes([...modes, { ...modes[index] }]);
  };

  const add = () => {
    if (modes.length >= schema.maxFireModes) return;
    // Matches the firmware's addFireMode(): a fresh AUTO mode with burst length 1.
    onReplaceModes([...modes, { name: "", burstMode: "auto", burstLength: 1, targetDPS: 0 }]);
  };

  return (
    <Stack spacing={0.5}>
      {schema.fireModeCaps === null && (
        <Alert severity="info" sx={{ py: 0 }}>
          The mode list is full, so the firmware could not report per-mode limits. Ranges shown are
          the ones it last resolved and may not match every mode.
        </Alert>
      )}

      <TableContainer sx={{ overflowX: "auto" }}>
        <Table size="small" sx={{ width: "auto" }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ ...cellSx, width: 26 }} />
              <TableCell sx={cellSx}>
                <Tooltip title="The mode the blaster comes up in">
                  <Typography variant="caption" sx={{ fontWeight: 600 }} noWrap>
                    Default
                  </Typography>
                </Tooltip>
              </TableCell>
              {columns.map((col) => (
                <TableCell key={col.key} sx={cellSx}>
                  <Typography variant="caption" sx={{ fontWeight: 600 }} noWrap>
                    {col.label}
                  </Typography>
                </TableCell>
              ))}
              <TableCell sx={cellSx} />
            </TableRow>
          </TableHead>
          <TableBody>
            {modes.map((mode, index) => {
              const cap = schema.fireModeCaps?.find((c) => c.burstMode === mode.burstMode);
              const isBoot = index === bootMode;
              return (
                <TableRow key={index}>
                  <TableCell sx={cellSx}>
                    <Typography variant="caption" color="text.disabled">
                      {index + 1}
                    </Typography>
                  </TableCell>
                  <TableCell sx={cellSx}>
                    {/* Exclusive across rows: defaultFiringMode is one index, so selecting a row
                        deselects whatever held it before. */}
                    <Radio
                      size="small"
                      sx={{ p: 0.25 }}
                      checked={isBoot}
                      onChange={() => onEdit("profile:defaultFiringMode", index)}
                    />
                  </TableCell>

                  {columns.map((col) => {
                    const resolved = applyCap(col, cap);
                    const key = keyForMode(col, index);
                    if (!isVisible(resolved)) {
                      return (
                        <TableCell key={col.key} sx={cellSx}>
                          <Typography variant="caption" color="text.disabled">
                            &mdash;
                          </Typography>
                        </TableCell>
                      );
                    }
                    return (
                      <TableCell key={col.key} sx={cellSx}>
                        <Box sx={{ width: resolved.kind === "text" ? 130 : 96 }}>
                          <FieldControl
                            node={resolved}
                            value={getByKey(profile, key)}
                            onChange={(next) => onEdit(key, next)}
                          />
                        </Box>
                      </TableCell>
                    );
                  })}

                  <TableCell sx={cellSx}>
                    <Stack direction="row" spacing={0.25}>
                      <Tooltip
                        title={
                          modes.length >= schema.maxFireModes
                            ? `Mode list is full (${schema.maxFireModes})`
                            : "Duplicate this mode"
                        }
                      >
                        <span>
                          <IconButton
                            size="small"
                            sx={{ p: 0.25, fontSize: 13 }}
                            disabled={modes.length >= schema.maxFireModes}
                            onClick={() => duplicate(index)}
                          >
                            &#x29C9;
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip
                        title={
                          modes.length <= 1 ? "The last mode cannot be deleted" : "Delete this mode"
                        }
                      >
                        <span>
                          <IconButton
                            size="small"
                            color="error"
                            sx={{ p: 0.25, fontSize: 13 }}
                            disabled={modes.length <= 1}
                            onClick={() => remove(index)}
                          >
                            &#x2715;
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Button
          size="small"
          variant="outlined"
          disabled={modes.length >= schema.maxFireModes}
          onClick={add}
          sx={{ py: 0.1, minWidth: 34, fontSize: 15 }}
        >
          +
        </Button>
        <Typography variant="caption" color="text.secondary">
          {modes.length} of {schema.maxFireModes} modes. A blank name shows the mode&rsquo;s own
          default.
        </Typography>
      </Stack>
    </Stack>
  );
}
