import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getByKey } from "../schema/keyPath";
import type { Schema } from "../schema/types";
import type { DiagramMarker, WiringDiagram } from "../schema/wiringDiagrams";
import { labelsByField } from "./PinConflicts";
import { matchDiagramPins, type DiagramMatch } from "./WiringDiagram";
import { collectWiring } from "./WiringTable";

// Where the wiring and the board's own drawing disagree.
//
// A different question from the one PinConflicts answers. That panel reports what the firmware took
// away at boot: two claims on one pin, an ADC channel that does not exist. The firmware knows the
// chip, so it can answer those. It does not know the *board* - the board table left the firmware,
// and a pin a board never brings out is electrically ordinary as far as the chip is concerned. The
// marker sheet is the only thing that knows, so this is the only side that can ask.
//
// Warnings, never blocks, and that is the whole design rather than caution. Every pin on the chip
// is reachable with a soldering iron, and a board's fixed function can be fed from somewhere else
// entirely. Someone who has done either is not making a mistake - they are doing the thing the
// drawing cannot see. Saying so and changing nothing is the job.

/** PIN_NOT_USED. A control parked here is switched off, which is a choice rather than a mistake. */
const PIN_UNUSED = 255;

export interface MovedPin {
  /** The device field the board wires a pin to. */
  field: string;
  /** The pin the board wires it to. */
  wired: number;
  /** The pin it is set to instead. */
  actual: number;
}

/** Controls sitting on a GPIO the board's drawing does not mark at all. */
export function unavailablePins(matches: DiagramMatch[], available: Set<number>): DiagramMatch[] {
  return matches.filter((m) => !available.has(m.gpio));
}

/** Board-wired functions that have been pointed somewhere other than the pin they are wired to. */
export function movedInternalPins(markers: DiagramMarker[], device: unknown): MovedPin[] {
  const out: MovedPin[] = [];
  for (const { gpio, wiredTo } of markers) {
    if (!wiredTo) continue;
    const actual = getByKey(device, `device:${wiredTo}`);
    if (typeof actual !== "number" || actual === PIN_UNUSED || actual === gpio) continue;
    out.push({ field: wiredTo, wired: gpio, actual });
  }
  return out;
}

export interface WiringWarningsProps {
  schema: Schema;
  device: unknown;
  diagram: WiringDiagram;
}

export function WiringWarnings({ schema, device, diagram }: WiringWarningsProps) {
  const missing = unavailablePins(
    matchDiagramPins(collectWiring(schema), device),
    diagram.available,
  );
  const moved = movedInternalPins(diagram.markers, device);
  if (!missing.length && !moved.length) return null;

  const labels = labelsByField(schema);
  const count = missing.length + moved.length;

  return (
    <Alert severity="warning" sx={{ py: 0.5, mb: 1.25 }}>
      <AlertTitle sx={{ mb: 0.25, fontSize: 13 }}>
        {count === 1
          ? "This wiring disagrees with the board's diagram"
          : `This wiring disagrees with the board's diagram in ${count} places`}
      </AlertTitle>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {missing.map(({ gpio, rows }) => (
          <Typography key={`missing-${gpio}`} component="li" variant="caption" sx={{ display: "block" }}>
            {rows.map((r) => r.label).join(" / ")} is on GP{gpio}, which this board does not bring
            out.
          </Typography>
        ))}
        {moved.map(({ field, wired, actual }) => (
          <Typography key={`moved-${field}`} component="li" variant="caption" sx={{ display: "block" }}>
            {labels.get(field) ?? field} is GP{actual}, but this board wires it to GP{wired}.
          </Typography>
        ))}
      </Box>
      <Typography variant="caption" sx={{ display: "block", mt: 0.5 }}>
        Nothing has been changed. If you have run your own wire this is correct and the warning can
        be ignored — otherwise the pin is probably a typo.
      </Typography>
    </Alert>
  );
}
