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
import { getByKey } from "../schema/keyPath";
import { isVisible, walk, type Schema, type SchemaNode } from "../schema/types";
import { WIRING_CONFIGURED_KEY } from "../schema/presets";
import { ruleFor } from "./wiringRules";
import { helpFor } from "../help/settings";
import { FieldControl } from "./Field";
import { HelpTip } from "./Help";

// One row per physical control, rather than three lists that happen to be the same length.
//
// A switch's pin and its resting state are two facts about one piece of hardware. As a flat grid of
// tiles they read as unrelated settings, and nothing says that "Trigger Pin" and "Trigger Normally
// Closed" are the same switch. What a switch does at power-on is a boot rule, on Blaster settings.
//
// Rows are discovered, not listed. A board with no cycle switch, or a firmware that adds a ninth
// control, needs no change here.

/**
 * device:triggerSwitchPin -> device:triggerSwitchNormallyClosed, for the switches that have one,
 * and device:speedPotPin -> device:speedPotReversed for an input that reads a position instead.
 *
 * Returns nothing where the name does not end in "Pin", which is not a curiosity: `escPins[0]` does
 * not, so the naive replace returned the key unchanged and the row rendered its own pin editor a
 * second time, in the polarity column.
 */
const polarityFor = (pinKey: string, byKey: Map<string, SchemaNode>): SchemaNode | undefined =>
  pinKey.endsWith("Pin")
    ? (byKey.get(pinKey.replace(/Pin$/, "NormallyClosed")) ??
      byKey.get(pinKey.replace(/Pin$/, "Reversed")))
    : undefined;

/** A reversed flag shares the Normally Closed column, so its cell says which it is. */
const isReversal = (node: SchemaNode | undefined): boolean => !!node?.key?.endsWith("Reversed");

export interface Row {
  id: string;
  label: string;
  pin?: SchemaNode;
  polarity?: SchemaNode;
}

export function collectWiring(schema: Schema): Row[] {
  const pins: SchemaNode[] = [];
  const byKey = new Map<string, SchemaNode>();

  walk(schema.tree, (node) => {
    if (!node.key) return;
    if (!byKey.has(node.key)) byKey.set(node.key, node);
    if (node.display === "pin") pins.push(node);
  });

  return pins.map((pin) => ({
    id: pin.key!,
    label: pin.label.replace(/\s*Pin$/i, ""),
    pin,
    polarity: polarityFor(pin.key!, byKey),
  }));
}

export interface WiringTableProps {
  schema: Schema;
  device: unknown;
  onEdit: (key: string, value: unknown) => void;
  /** A GPIO whose row to light, because its pad on the board drawing is under the pointer. */
  highlightPin?: number | null;
  /** The GPIO of the row under the pointer, or null as it leaves, for the drawing to light its pad. */
  onHoverPin?: (gpio: number | null) => void;
}

export function WiringTable({
  schema,
  device,
  onEdit,
  highlightPin = null,
  onHoverPin,
}: WiringTableProps) {
  const rows = collectWiring(schema);
  // The boot gate, rendered here rather than as a loose checkbox in the form: what it arms is the
  // table above it, and it is the last thing done on the custom-wiring path.
  let gate: SchemaNode | undefined;
  walk(schema.tree, (node) => {
    if (node.key === WIRING_CONFIGURED_KEY && !gate) gate = node;
  });
  const armed = getByKey(device, WIRING_CONFIGURED_KEY) === true;
  const anyPolarity = rows.some((r) => r.polarity);
  const cellSx = { py: 0.35, px: 0.75, borderBottom: "none" } as const;
  const columns: { label: string; help?: string }[] = [
    { label: "Control" },
    { label: "Pin" },
    ...(anyPolarity
      ? [{ label: "Normally Closed", help: helpFor("device:triggerSwitchNormallyClosed") }]
      : []),
  ];

  const cell = (node: SchemaNode | undefined, width: number, caption?: string) => {
    if (!node) return <TableCell sx={cellSx} />;
    // A row the device hides is one this configuration cannot use. Saying so beats an editor that
    // writes a value nothing reads.
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
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.4 }}>
          <FieldControl
            node={node}
            value={getByKey(device, node.key!)}
            onChange={(v) => onEdit(node.key!, v)}
          />
          {caption && (
            <HelpTip help={helpFor(node.key)}>
              <Typography variant="caption" color="text.secondary">
                {caption}
              </Typography>
            </HelpTip>
          )}
        </Box>
      </TableCell>
    );
  };

  return (
    <Box>
      <TableContainer sx={{ overflowX: "auto" }}>
        <Table size="small" sx={{ width: "auto" }}>
          <TableHead>
            <TableRow>
              {columns.map(({ label, help }) => (
                <TableCell key={label} sx={cellSx}>
                  <HelpTip help={help}>
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>
                      {label}
                    </Typography>
                  </HelpTip>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              // A row with a rule says so, rather than hiding it behind a hover nobody tries.
              const rule = ruleFor(row.pin?.key);
              const gpio = row.pin ? getByKey(device, row.pin.key!) : undefined;
              const pin = typeof gpio === "number" && gpio !== (row.pin?.hi ?? 255) ? gpio : null;
              return (
              <TableRow
                key={row.id}
                selected={pin !== null && pin === highlightPin}
                onMouseEnter={() => onHoverPin?.(pin)}
                onMouseLeave={() => onHoverPin?.(null)}
              >
                <TableCell sx={{ ...cellSx, whiteSpace: "nowrap" }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.4 }}>
                    <HelpTip help={helpFor(row.pin?.key)}>
                      <Typography variant="caption" color="text.secondary">
                        {row.label}
                      </Typography>
                    </HelpTip>
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
                {anyPolarity &&
                  cell(row.polarity, 60, isReversal(row.polarity) ? "Reversed" : undefined)}
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
          &#x27F3; Pins and switch polarities take effect on the next boot.
        </Typography>
      </Tooltip>
    </Box>
  );
}
