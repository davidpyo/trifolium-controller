import * as React from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import {
  BOOT_SWITCHES,
  EMPTY_RULE,
  bootRuleKey,
  parseBootRuleKey,
  readBootRules,
  ruleEdits,
  moveEdits,
  shadowedBy,
} from "../schema/bootRules";
import { withSlotNames } from "../schema/enumValue";
import { getByKey } from "../schema/keyPath";
import { isVisible, walk, type Schema, type SchemaNode } from "../schema/types";
import { helpFor } from "../help/settings";
import { FieldControl } from "./Field";
import { HelpTip } from "./Help";

// The boot rules, as a table: one row per rule in the order the device checks them, one column per
// switch it can read at power-on, and the action. The first rule whose switches are all held wins,
// so dragging a row up by its handle is how one rule is made to beat another. The handle also takes
// the arrow keys, for a keyboard.
//
// A switch's column follows the device's own visibility for it, which already folds in the wiring,
// the dual-stage trigger and select-fire.

export interface BootRulesProps {
  schema: Schema;
  device: unknown;
  profileNames: readonly (string | undefined)[];
  onEdit: (key: string, value: unknown) => void;
}

export function BootRules({ schema, device, profileNames, onEdit }: BootRulesProps) {
  /** The row being dragged, and the one it would land on. */
  const [dragged, setDragged] = React.useState<number | null>(null);
  const [target, setTarget] = React.useState<number | null>(null);
  const handles = React.useRef<(HTMLElement | null)[]>([]);
  const theme = useTheme();

  const nodes = new Map<string, SchemaNode>();
  walk(schema.tree, (node) => {
    if (parseBootRuleKey(node.key) && !nodes.has(node.key!)) nodes.set(node.key!, node);
  });
  const count = Math.max(0, ...[...nodes.keys()].map((k) => parseBootRuleKey(k)!.rule + 1));
  if (!count) return null;

  const rules = readBootRules(device, count);
  const shadow = shadowedBy(rules);
  const columns = BOOT_SWITCHES.map((s) => nodes.get(bootRuleKey(0, s))).filter(
    (n): n is SchemaNode => !!n && isVisible(n),
  );
  const labelOf = (s: string) => nodes.get(bootRuleKey(0, s))?.label ?? s;

  const apply = (edits: [string, unknown][]) => edits.forEach(([k, v]) => onEdit(k, v));

  const endDrag = () => {
    setDragged(null);
    setTarget(null);
  };

  const move = (from: number, to: number) => {
    apply(moveEdits(rules, from, to));
    endDrag();
  };

  // A line on the side the dragged row would land: above a row it moves up to, below one it moves
  // down to.
  const dropLine = (r: number) =>
    dragged === null || target !== r || dragged === r
      ? {}
      : {
          "& > td": {
            boxShadow: `inset 0 ${r < dragged ? 2 : -2}px 0 ${theme.palette.primary.main}`,
          },
        };

  /** Why a rule with an action can never fire, or null. */
  const deadReason = (r: number): string | null => {
    const rule = rules[r];
    if (rule.action === "none") return null;
    if (!rule.on.length) return "Names no switch, so it never fires";
    const unread = rule.on.filter((s) => {
      const node = nodes.get(bootRuleKey(r, s));
      return !node || !isVisible(node);
    });
    if (unread.length)
      return `Never fires: ${unread.map(labelOf).join(", ")} is not read at power-on on this wiring`;
    if (shadow[r] !== null) return `Never fires: Rule ${shadow[r]! + 1} matches whenever it does`;
    return null;
  };

  const cellSx = {
    py: 0.35,
    px: 0.5,
    borderBottom: "none",
    verticalAlign: "middle",
  } as const;
  const head = (label: string, key?: string) => (
    <HelpTip help={helpFor(key)}>
      <Typography variant="caption" sx={{ fontWeight: 600 }} noWrap>
        {label}
      </Typography>
    </HelpTip>
  );

  return (
    <Stack spacing={0.5}>
      <Typography id="boot-rules-order" variant="caption" color="text.secondary">
        Checked top to bottom: the first rule whose switches are all held wins. Drag a rule by
        &nbsp;&#x2807;&#x2807;&nbsp; to change the order, or focus the handle and use the arrow
        keys.
      </Typography>
      <TableContainer sx={{ overflowX: "auto" }}>
        <Table size="small" sx={{ width: "auto" }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ ...cellSx, width: 26 }} />
              <TableCell sx={{ ...cellSx, width: 26 }} />
              {columns.map((col) => (
                <TableCell key={col.key} sx={cellSx} align="center">
                  {head(col.label, col.key)}
                </TableCell>
              ))}
              <TableCell sx={cellSx}>{head("Action", bootRuleKey(0, "action"))}</TableCell>
              <TableCell sx={cellSx} />
              <TableCell sx={cellSx} />
            </TableRow>
          </TableHead>
          <TableBody>
            {rules.map((rule, r) => {
              const actionNode = nodes.get(bootRuleKey(r, "action"));
              const dead = deadReason(r);
              const empty = rule.action === "none";
              return (
                <TableRow
                  key={r}
                  aria-label={`Rule ${r + 1}`}
                  sx={{
                    opacity: dragged === r ? 0.4 : empty ? 0.6 : 1,
                    "&:hover > td": dragged === null ? { bgcolor: "action.hover" } : {},
                    ...dropLine(r),
                  }}
                  onDragOver={(e) => {
                    if (dragged === null) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (target !== r) setTarget(r);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragged !== null) move(dragged, r);
                  }}
                >
                  <TableCell sx={cellSx}>
                    <Box
                      component="span"
                      ref={(el: HTMLElement | null) => {
                        handles.current[r] = el;
                      }}
                      role="button"
                      tabIndex={0}
                      draggable
                      aria-label={`Drag rule ${r + 1}`}
                      aria-describedby="boot-rules-order"
                      onDragStart={(e: React.DragEvent) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", String(r));
                        // The whole row follows the pointer, not just the grip.
                        const row = (e.currentTarget as HTMLElement).closest("tr");
                        if (row) e.dataTransfer.setDragImage(row, 12, row.clientHeight / 2);
                        setDragged(r);
                      }}
                      onDragEnd={endDrag}
                      onKeyDown={(e: React.KeyboardEvent) => {
                        const to =
                          e.key === "ArrowUp" ? r - 1 : e.key === "ArrowDown" ? r + 1 : null;
                        if (to === null || to < 0 || to >= count) return;
                        e.preventDefault();
                        move(r, to);
                        // The rule moved; follow it rather than stay on the slot it left.
                        requestAnimationFrame(() => handles.current[to]?.focus());
                      }}
                      sx={{
                        display: "inline-block",
                        cursor: dragged === null ? "grab" : "grabbing",
                        color: "text.secondary",
                        fontSize: 16,
                        lineHeight: 1,
                        userSelect: "none",
                        px: 0.5,
                        py: 0.25,
                        borderRadius: 0.5,
                        "&:hover, &:focus-visible": {
                          color: "text.primary",
                          bgcolor: "action.selected",
                        },
                      }}
                    >
                      &#x2807;&#x2807;
                    </Box>
                  </TableCell>
                  <TableCell sx={cellSx}>
                    <Typography variant="caption" color="text.disabled">
                      {r + 1}
                    </Typography>
                  </TableCell>
                  {columns.map((col) => {
                    const leaf = parseBootRuleKey(col.key)!.leaf;
                    const node = nodes.get(bootRuleKey(r, leaf));
                    const key = bootRuleKey(r, leaf);
                    return (
                      <TableCell key={col.key} sx={cellSx} align="center">
                        {node && (
                          <FieldControl
                            node={{
                              ...node,
                              label: `Rule ${r + 1} ${col.label}`,
                            }}
                            value={getByKey(device as never, key)}
                            onChange={(next) => onEdit(key, next)}
                          />
                        )}
                      </TableCell>
                    );
                  })}
                  <TableCell sx={cellSx}>
                    {actionNode && (
                      <Box sx={{ width: 170 }}>
                        <FieldControl
                          node={withSlotNames(actionNode, profileNames)}
                          value={getByKey(device as never, actionNode.key!)}
                          onChange={(next) => onEdit(actionNode.key!, next)}
                        />
                      </Box>
                    )}
                  </TableCell>
                  <TableCell sx={cellSx}>
                    <Stack direction="row" spacing={0.25}>
                      <Tooltip title="Clear this rule">
                        <span>
                          <IconButton
                            size="small"
                            color="error"
                            aria-label={`Clear rule ${r + 1}`}
                            sx={{ p: 0.25, fontSize: 13 }}
                            disabled={empty && !rule.on.length}
                            onClick={() => apply(ruleEdits(r, EMPTY_RULE))}
                          >
                            &#x2715;
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                  <TableCell sx={cellSx}>
                    {dead && (
                      <Typography variant="caption" color="warning.main">
                        {dead}
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );
}
