import Box from "@mui/material/Box";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import { withSlotNames } from "../schema/enumValue";
import { getByKey } from "../schema/keyPath";
import { isVisible, walk, type Schema, type SchemaNode } from "../schema/types";
import { WIRING_CONFIGURED_KEY } from "../schema/presets";
import { ruleFor } from "./wiringRules";
import { FieldControl } from "./Field";

// One row per physical control, rather than three lists that happen to be the same length.
//
// A switch's pin, its resting state and what it does when held at power-on are three facts about
// one piece of hardware. As a flat grid of tiles they read as thirteen unrelated settings, and
// nothing says that "Trigger Pin" and "Trigger Normally Closed" are the same switch. Boot Actions
// are not wiring, but they are indexed by the same eight controls, so they earn their column.
//
// Rows are discovered, not listed. A board with no cycle switch, or a firmware that adds a ninth
// control, needs no change here.

/**
 * A control's identity, reduced so the three rows describing it agree.
 *
 * Pins and polarities are matched on their stored key, which is stable. Boot actions have only an
 * index (`bootAction[3]`), and the index order is the firmware's `bootButton_t` - not something this
 * file should hold a second copy of - so those are matched on the label instead: "Rev Switch" and
 * "Rev Pin" both reduce to "rev". A boot action that fails to match still gets its own row, so a
 * renamed label costs the grouping rather than the field.
 */
const identify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/(pin|switch|button)$/g, "")
    .replace(/(pin|switch|button)$/g, "");

/**
 * device:triggerSwitchPin -> device:triggerSwitchNormallyClosed, for the switches that have one.
 *
 * Returns null where the name does not end in "Pin", which is not a curiosity: `escPins[0]` does
 * not, so the naive replace returned the key unchanged and the row rendered its own pin editor a
 * second time, in the polarity column.
 */
const polarityKeyFor = (pinKey: string): string | null =>
  pinKey.endsWith("Pin") ? pinKey.replace(/Pin$/, "NormallyClosed") : null;

export interface Row {
  id: string;
  label: string;
  pin?: SchemaNode;
  polarity?: SchemaNode;
  bootAction?: SchemaNode;
}

export function collectWiring(schema: Schema): Row[] {
  const pins: SchemaNode[] = [];
  const byKey = new Map<string, SchemaNode>();
  const bootActions: SchemaNode[] = [];

  walk(schema.tree, (node) => {
    if (!node.key) return;
    if (!byKey.has(node.key)) byKey.set(node.key, node);
    if (node.display === "pin") pins.push(node);
    else if (node.key.startsWith("device:bootAction[")) bootActions.push(node);
  });

  const claimed = new Set<SchemaNode>();
  const rows: Row[] = pins.map((pin) => {
    const label = pin.label.replace(/\s*Pin$/i, "");
    const id = identify(pin.label);
    const bootAction = bootActions.find((b) => identify(b.label) === id);
    if (bootAction) claimed.add(bootAction);
    const polarityKey = polarityKeyFor(pin.key!);
    return {
      id: pin.key!,
      label,
      pin,
      polarity: polarityKey ? byKey.get(polarityKey) : undefined,
      bootAction,
    };
  });

  // Anything the matcher could not place still gets a row: losing a field to a rename would be a
  // worse outcome than an ungrouped row.
  for (const orphan of bootActions) {
    if (!claimed.has(orphan)) rows.push({ id: orphan.key!, label: orphan.label, bootAction: orphan });
  }
  return rows;
}

export interface WiringTableProps {
  schema: Schema;
  device: unknown;
  onEdit: (key: string, value: unknown) => void;
  /** Each slot's profile name as staged, so a boot action that loads a slot says which profile. */
  profileNames: readonly (string | undefined)[];
}

export function WiringTable({ schema, device, onEdit, profileNames }: WiringTableProps) {
  const rows = collectWiring(schema);
  // The boot gate, rendered here rather than as a loose checkbox in the form: what it arms is the
  // table above it, and it is the last thing done on the custom-wiring path.
  let gate: SchemaNode | undefined;
  walk(schema.tree, (node) => {
    if (node.key === WIRING_CONFIGURED_KEY && !gate) gate = node;
  });
  const armed = getByKey(device, WIRING_CONFIGURED_KEY) === true;
  const anyPolarity = rows.some((r) => r.polarity);
  const anyBootAction = rows.some((r) => r.bootAction);
  const cellSx = { py: 0.35, px: 0.75, borderBottom: "none" } as const;

  const cell = (node: SchemaNode | undefined, width: number) => {
    if (!node) return <TableCell sx={cellSx} />;
    // A row the device hides is one this configuration cannot use - a boot action on a pin that is
    // not wired. Saying so beats an editor that writes a value nothing reads.
    if (!isVisible(node)) {
      return (
        <TableCell sx={cellSx}>
          <Typography variant="caption" color="text.disabled">
            n/a
          </Typography>
        </TableCell>
      );
    }
    return (
      <TableCell sx={{ ...cellSx, width }}>
        <FieldControl
          node={node}
          value={getByKey(device, node.key!)}
          onChange={(v) => onEdit(node.key!, v)}
        />
      </TableCell>
    );
  };

  return (
    <Box>
      <TableContainer sx={{ overflowX: "auto" }}>
        <Table size="small" sx={{ width: "auto" }}>
          <TableHead>
            <TableRow>
              {["Control", "Pin", ...(anyPolarity ? ["Normally Closed"] : []),
                ...(anyBootAction ? ["Held At Boot"] : [])].map((h) => (
                <TableCell key={h} sx={cellSx}>
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>
                    {h}
                  </Typography>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              // A row with a rule says so, rather than hiding it behind a hover nobody tries.
              const rule = ruleFor(row.pin?.key);
              return (
              <TableRow key={row.id}>
                <TableCell sx={{ ...cellSx, whiteSpace: "nowrap" }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.4 }}>
                    <Typography variant="caption" color="text.secondary">
                      {row.label}
                    </Typography>
                    {/* A visible mark, not a styled label: in a dense table nobody hovers a
                        label to find out whether it does anything, so an affordance that cannot be
                        seen is help that exists and is never found. */}
                    {rule && (
                      <Tooltip title={rule} enterTouchDelay={0} leaveTouchDelay={8000}>
                        <Box
                          component="span"
                          aria-label={rule}
                          sx={{
                            cursor: "help",
                            color: "primary.main",
                            fontSize: 12,
                            lineHeight: 1,
                            userSelect: "none",
                          }}
                        >
                          &#9432;
                        </Box>
                      </Tooltip>
                    )}
                  </Box>
                </TableCell>
                {cell(row.pin, 150)}
                {anyPolarity && cell(row.polarity, 60)}
                {anyBootAction &&
                  cell(row.bootAction && withSlotNames(row.bootAction, profileNames), 160)}
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {gate && (
        <Alert severity={armed ? "info" : "warning"} sx={{ mt: 1, py: 0 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <FieldControl
              node={gate}
              value={getByKey(device, WIRING_CONFIGURED_KEY)}
              onChange={(v) => onEdit(WIRING_CONFIGURED_KEY, v)}
            />
            <Typography variant="caption">
              {armed
                ? "This wiring is live: the blaster drives these pins on the next boot. Untick it and write to make the device inert again."
                : "The blaster drives no pins at all until this is ticked and written. Finish the table above first - a half-typed pinout is what this is for."}
            </Typography>
          </Box>
        </Alert>
      )}

      <Tooltip title="Pins are attached once, in setup(), so nothing here moves until the blaster restarts">
        <Typography
          variant="caption"
          color="text.disabled"
          sx={{ display: "block", mt: 0.5, cursor: "help" }}
        >
          &#x27F3; Every field here takes effect on the next boot.
        </Typography>
      </Tooltip>
    </Box>
  );
}
