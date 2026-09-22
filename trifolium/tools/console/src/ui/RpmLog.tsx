import React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import {
  extractRpmCsv,
  findTrailingFlatStart,
  MS_PER_SAMPLE,
  parseRpmCsv,
  targetCrossings,
} from "../rpm/parse";
import { getByKey } from "../schema/keyPath";
import { walk, type Schema, type SchemaNode } from "../schema/types";
import { DropLabel, dropOutlineSx, useFileDrop } from "./FileDrop";
import { Field } from "./Field";
import { Fieldset } from "./Section";
import { RpmChart, type Series } from "./RpmChart";

// Charting an RPM capture.
//
// Not a live feature: the firmware records a fixed-length capture into RAM during a rev and dumps the
// whole thing as CSV afterwards, then reboots. So this reads the CSV out of whatever text is to hand -
// the device log, a pasted block, or a dropped file - rather than streaming.
//
// `useRpmLogging` is the only switch a capture needs. RpmLogger::dumpIfReady writes the CSV to
// Serial directly rather than through the logger, precisely so that the capture a user asked for
// cannot be silenced by a logging preference - only the "dump complete" line after it is gated.
//
// `printTelemetry` is therefore not part of a capture at all, which is why its switch lives in the
// header's button cluster rather than here: it is the device's warn/info switch, armed and cleared
// rather than persisted, because those calls sit in the 1 kHz control loop.

/** Shared by the picker and the drop zone. A capture is plain text under any of these names. */
const CSV_ACCEPT = [".csv", ".txt", ".log", "text/plain"] as const;

const COLOURS = ["#4f9dff", "#ff9f40", "#4ad991", "#e57bd8"];

/** Trim ends when a capture's tail is flat for this many samples, within this fractional jitter. */
const MIN_FLAT_RUN = 200;
const FLAT_JITTER = 0.02;

/** The two capture settings, in the order you use them: arm it, then say how long for. */
const CAPTURE_KEYS = ["device:useRpmLogging", "device:rpmLogLength"];

export interface RpmLogProps {
  schema: Schema;
  device: unknown;
  onEdit: (key: string, value: unknown) => void;
  logText: string;
  /** device:useRpmLogging - whether the next rev records a capture at all. */
  capturing: boolean;
}

export function RpmLog({ schema, device, onEdit, logText, capturing }: RpmLogProps) {
  const [text, setText] = React.useState("");
  const [trim, setTrim] = React.useState(true);
  const [showThrottle, setShowThrottle] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  // Read out of the schema rather than rebuilt here, so `rpmLogLength` keeps the ceiling the
  // firmware publishes (MAX_RPM_LOG_LENGTH) and both rows keep their reboot marks and dirty
  // outlines. Absent on firmware predating them, in which case nothing renders.
  const captureNodes = React.useMemo(() => {
    const found = new Map<string, SchemaNode>();
    walk(schema.tree, (node) => {
      if (node.key && CAPTURE_KEYS.includes(node.key) && !found.has(node.key)) {
        found.set(node.key, node);
      }
    });
    return CAPTURE_KEYS.map((k) => found.get(k)).filter((n): n is SchemaNode => n !== undefined);
  }, [schema]);

  const parsed = React.useMemo(() => {
    if (!text.trim()) return null;
    const csv = extractRpmCsv(text);
    if (!csv) return null;
    return parseRpmCsv(csv);
  }, [text]);

  const series: Series[] = React.useMemo(() => {
    if (!parsed?.motors.length) return [];

    // Trim against the first motor's RPM: every column is sampled on the same tick, so one series
    // decides the cut for all of them and the x-axis stays aligned.
    const cut = trim
      ? findTrailingFlatStart(parsed.motors[0].rpm, MIN_FLAT_RUN, FLAT_JITTER)
      : parsed.motors[0].rpm.length;

    const out: Series[] = [];
    parsed.motors.forEach((m, i) => {
      const colour = COLOURS[i % COLOURS.length];
      out.push({ name: `M${m.index} rpm`, colour, values: m.rpm.slice(0, cut) });
      out.push({
        name: `M${m.index} target`,
        colour,
        values: m.targetRpm.slice(0, cut),
        dash: "4 3",
      });
      if (showThrottle) {
        out.push({
          name: `M${m.index} throttle`,
          colour,
          values: m.throttle.slice(0, cut),
          dash: "1 3",
          axis: "right",
        });
      }
    });
    if (parsed.voltage.length) {
      out.push({
        name: "pack mV",
        colour: "#9aa0a6",
        values: parsed.voltage.slice(0, cut),
        dash: "6 3",
        axis: "right",
      });
    }
    return out;
  }, [parsed, trim, showThrottle]);

  // Read off the samples rather than the picture: the differences worth seeing between motors are
  // tens of milliseconds, which is where the lines on the chart overlap.
  const crossings = React.useMemo(() => (parsed ? targetCrossings(parsed) : []), [parsed]);

  const takeFromLog = () => {
    setError(null);
    const csv = extractRpmCsv(logText);
    if (!csv) {
      setError(
        capturing
          ? "No CSV capture in the device log yet. RPM Logging is on, so rev the blaster and wait - the device dumps the whole capture at once and reboots straight after."
          : "No CSV capture found in the device log. RPM Logging is off: turn it on above, then rev the blaster.",
      );
      return;
    }
    // The extracted block, not the whole log. The parser finds the CSV either way, but the box is
    // also what you read, edit and save - and a capture buried in a few thousand lines of boot
    // chatter is not something you can check by eye or hand to anyone else.
    setText(csv);
  };

  /** Picked or dropped, a file lands in the box the same way. */
  const readFile = async (file: File) => {
    setError(null);
    setText(await file.text());
  };

  const { over, dropProps } = useFileDrop({
    accept: CSV_ACCEPT,
    what: "a .csv, .txt or .log capture",
    onFile: (file) => void readFile(file),
    onReject: setError,
  });

  // The chart, the table and the CSV are all derived from the box, so emptying it clears the tab.
  const clear = () => {
    setText("");
    setError(null);
  };

  /** The CSV as it would be saved: what was extracted, not the raw box contents. */
  const csvOut = React.useMemo(() => (text.trim() ? extractRpmCsv(text) : null), [text]);

  const saveCsv = () => {
    if (!csvOut) return;
    const blob = new Blob([`${csvOut}\n`], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rpm-capture-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Stack spacing={1} {...dropProps} sx={dropOutlineSx(over)}>
      <DropLabel over={over} label="Drop a .csv capture here" />
      {/*
        The two settings that decide whether there is anything to chart, on the tab that charts it.
        They used to sit under Device > RPM Capture, two tabs from the button that reads the result,
        which meant arming a capture and looking at one were different places. DEVICE_LAYOUT claims
        both keys as RENDERED_ELSEWHERE so they do not also fall through into "Other settings".
      */}
      {captureNodes.length > 0 && (
        <Fieldset label="Capture">
          <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start", flexWrap: "wrap" }}>
            {captureNodes.map((node) => (
              <Box key={node.key} sx={{ minWidth: 150 }}>
                <Field
                  node={node}
                  value={getByKey(device, node.key!)}
                  onChange={(next) => onEdit(node.key!, next)}
                />
              </Box>
            ))}
          </Stack>
        </Fieldset>
      )}

      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Button size="small" variant="outlined" onClick={takeFromLog}>
          Take from device log
        </Button>
        <Button size="small" variant="outlined" onClick={() => fileRef.current?.click()}>
          Open CSV file
        </Button>
        <Button size="small" variant="outlined" onClick={saveCsv} disabled={!csvOut}>
          Save CSV file
        </Button>
        <Button size="small" variant="outlined" onClick={clear} disabled={!text && !error}>
          Clear
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept={CSV_ACCEPT.join(",")}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void readFile(file);
          }}
        />
        <FormControlLabel
          control={
            <Checkbox size="small" checked={trim} onChange={(e) => setTrim(e.target.checked)} />
          }
          disableTypography
          label={<Typography variant="caption">Trim flat tail</Typography>}
          sx={{ m: 0, gap: 0.5 }}
        />
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={showThrottle}
              onChange={(e) => setShowThrottle(e.target.checked)}
            />
          }
          disableTypography
          label={<Typography variant="caption">Throttle</Typography>}
          sx={{ m: 0, gap: 0.5 }}
        />
        {parsed && (
          <Typography variant="caption" color="text.secondary">
            {parsed.motors.length} motor{parsed.motors.length === 1 ? "" : "s"},{" "}
            {parsed.motors[0]?.rpm.length ?? 0} samples
            {series.length && series[0].values.length !== parsed.motors[0]?.rpm.length
              ? ` (charting ${series[0].values.length})`
              : ""}
          </Typography>
        )}
      </Stack>

      {error && (
        <Alert severity="info" sx={{ py: 0 }}>
          {error}
        </Alert>
      )}

      {series.length > 0 ? (
        <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1 }}>
          <RpmChart series={series} />
          {crossings.length > 0 && (
            <Box sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: "divider" }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                First time at target
              </Typography>
              <Table size="small" sx={{ width: "auto" }}>
                <TableHead>
                  <TableRow>
                    {["Motor", "Target", "Time", "Overshoot"].map((h) => (
                      <TableCell key={h} sx={{ py: 0.25, px: 1, borderBottom: "none" }}>
                        <Typography variant="caption" sx={{ fontWeight: 600 }}>
                          {h}
                        </Typography>
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {crossings.map((c) => (
                    <TableRow key={c.motor}>
                      <TableCell sx={{ py: 0.25, px: 1, borderBottom: "none" }}>
                        <Typography variant="caption">M{c.motor}</Typography>
                      </TableCell>
                      <TableCell sx={{ py: 0.25, px: 1, borderBottom: "none" }}>
                        <Typography variant="caption" color="text.secondary">
                          {c.target === null ? "not driven" : `${c.target} rpm`}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ py: 0.25, px: 1, borderBottom: "none" }}>
                        <Typography
                          variant="caption"
                          color={c.sample === null ? "warning.main" : "text.primary"}
                        >
                          {c.sample === null
                            ? c.target === null
                              ? "\u2014"
                              : "never, in this capture"
                            : `${c.sample * MS_PER_SAMPLE} ms`}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ py: 0.25, px: 1, borderBottom: "none" }}>
                        <Typography variant="caption" color="text.secondary">
                          {c.overshoot === null
                            ? "\u2014"
                            : `${c.overshoot > 0 ? "+" : ""}${Math.round(c.overshoot)} rpm`}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 0.5 }}>
                Measured from the first sample of the capture, which begins when the rev does - one
                sample is one tick of the 1 kHz control loop, so one millisecond. Overshoot is the
                highest RPM reached while driven, less the target.
              </Typography>
            </Box>
          )}
        </Box>
      ) : (
        text.trim() && (
          <Alert severity="warning" sx={{ py: 0 }}>
            No CSV capture found in that text. The header looks like
            <code> Voltage_mv,Motor 1,TargetRPM 1,Throttle 1,value 1,</code>
          </Alert>
        )
      )}

      <TextField
        multiline
        minRows={4}
        maxRows={10}
        size="small"
        placeholder="Paste a capture here, drop a .csv file anywhere on this tab, or use the buttons above."
        value={text}
        onChange={(e) => setText(e.target.value)}
        slotProps={{ htmlInput: { style: { fontSize: 11, fontFamily: "ui-monospace, monospace" } } }}
      />
    </Stack>
  );
}
