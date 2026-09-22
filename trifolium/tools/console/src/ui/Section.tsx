import React from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
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
import { isConfigField, isVisible, needsReboot, type SchemaNode } from "../schema/types";
import { Field, FieldControl } from "./Field";
import {
  countFields,
  matrixRows,
  nonMatrixChildren,
  repeatedGroups,
  storeOfKey,
  type Store,
} from "./sections";

export type Payloads = Record<Store, unknown>;

export interface SectionProps {
  node: SchemaNode;
  payloads: Payloads;
  onEdit: (key: string, value: unknown) => void;
  /** Keys already rendered elsewhere. The tree reaches some fields by more than one path. */
  seen?: Set<string>;
}

/** Fields flow into as many columns as the width allows, rather than one per row. */
const FIELD_GRID = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
  columnGap: 1.5,
  rowGap: 1,
  alignItems: "start",
} as const;

/** A bordered group with its name set into the border, as tight as the content allows. */
export function Fieldset({
  label,
  chip,
  children,
}: {
  label: string;
  chip?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Box
      component="fieldset"
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        m: 0,
        px: 1.25,
        pt: 0.25,
        pb: 1.25,
        minWidth: 0,
      }}
    >
      <Box component="legend" sx={{ px: 0.5 }}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
            {label}
          </Typography>
          {chip}
        </Stack>
      </Box>
      {children}
    </Box>
  );
}

/**
 * Repeated sibling groups as a matrix: one column per instance, one row per field.
 *
 * The four motors are the case this exists for. Four stacked panels of identical fields is the
 * layout an OLED is forced into and a browser is not - side by side, the asymmetry between motors is
 * the thing you can actually see.
 */
function Matrix({
  groups,
  payloads,
  onEdit,
}: {
  groups: SchemaNode[];
  payloads: Payloads;
  onEdit: (key: string, value: unknown) => void;
}) {
  const rows = matrixRows(groups);
  const cellSx = { py: 0.35, px: 0.75, borderBottom: "none" } as const;

  return (
    <TableContainer sx={{ overflowX: "auto" }}>
      <Table size="small" sx={{ width: "auto" }}>
        <TableHead>
          <TableRow>
            <TableCell sx={cellSx} />
            {groups.map((g) => (
              <TableCell key={g.label} sx={cellSx}>
                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                  {g.label}
                </Typography>
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.label}>
              <TableCell sx={{ ...cellSx, whiteSpace: "nowrap" }}>
                <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                  <Typography variant="caption" color="text.secondary">
                    {row.label}
                  </Typography>
                  {needsReboot(row) && (
                    <Tooltip title="Takes effect after a reboot">
                      <Box component="span" sx={{ color: "warning.main", fontSize: 12 }}>
                        &#x27F3;
                      </Box>
                    </Tooltip>
                  )}
                </Stack>
              </TableCell>
              {groups.map((g) => {
                const cell = (g.children ?? [])
                  .filter(isVisible)
                  .filter(isConfigField)
                  .find((c) => c.label === row.label);
                if (!cell?.key) return <TableCell key={g.label} sx={cellSx} />;
                const control = (
                  // Wide enough for the longest value any column carries: at 104 the stage
                  // selects wrapped "Stage 1" onto two lines, which made every motor row in the
                  // matrix taller than the numbers beside it.
                  <Box sx={{ width: 132 }}>
                    <FieldControl
                      node={cell}
                      value={getByKey(payloads[storeOfKey(cell.key)], cell.key)}
                      onChange={(next) => onEdit(cell.key!, next)}
                    />
                  </Box>
                );
                return (
                  <TableCell key={g.label} sx={cellSx}>
                    {cell.editable === false ? (
                      <Tooltip title={cell.locked ?? ""}>
                        <span>{control}</span>
                      </Tooltip>
                    ) : (
                      control
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/**
 * A section's contents: its own fields in a grid, repeated groups as a matrix, and subgroups as
 * nested fieldsets.
 *
 * `seen` suppresses a field that has already appeared. The on-device tree reaches some settings by
 * two paths, and showing one setting twice invites editing it twice.
 */
export function Section({ node, payloads, onEdit, seen = new Set() }: SectionProps) {
  const matrix = repeatedGroups(node);
  const rest = nonMatrixChildren(node, matrix);

  const fields: SchemaNode[] = [];
  const groups: SchemaNode[] = [];
  for (const child of rest) {
    if (child.kind === "group") {
      // Nothing renderable underneath - Per Stage RPM and Idle RPM (Stage) hit this, since their
      // rows are `derived` views over per-motor fields that appear in their own right elsewhere.
      if (countFields(child) > 0) groups.push(child);
      continue;
    }
    if (!isConfigField(child) || !child.key) continue;
    if (seen.has(child.key)) continue;
    seen.add(child.key);
    fields.push(child);
  }

  return (
    <Stack spacing={1}>
      {matrix && <Matrix groups={matrix} payloads={payloads} onEdit={onEdit} />}

      {fields.length > 0 && (
        <Box sx={FIELD_GRID}>
          {fields.map((child) => (
            <Field
              key={child.key}
              node={child}
              value={getByKey(payloads[storeOfKey(child.key!)], child.key!)}
              onChange={(next) => onEdit(child.key!, next)}
            />
          ))}
        </Box>
      )}

      {groups.map((child, i) => (
        <Fieldset
          key={`${child.label}-${i}`}
          label={child.label}
          chip={
            // The device hides this group because another view of the same storage is selected, or
            // the feature is off. The fields are still what the control loop reads, so they are shown
            // and labelled rather than dropped.
            child.visible === false ? (
              <Tooltip title="Not in use with the current settings, but these values are stored and still drive the hardware when this mode is selected.">
                <Chip
                  label="inactive"
                  size="small"
                  variant="outlined"
                  sx={{ height: 16, fontSize: 10 }}
                />
              </Tooltip>
            ) : undefined
          }
        >
          <Section node={child} payloads={payloads} onEdit={onEdit} seen={seen} />
        </Fieldset>
      ))}
    </Stack>
  );
}
