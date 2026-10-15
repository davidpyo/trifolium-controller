import React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { asBound, boundsToReal, snapReal, steppedReal, type Band } from "../schema/grid";
import { isEditable, needsReboot, type SchemaNode } from "../schema/types";
import { optionIndexFor, optionValueAt } from "../schema/enumValue";
import { helpFor, optionHelpFor } from "../help/settings";
import { splitUnit } from "./changes";
import { StagingContext, useIsDirty } from "./dirty";
import { HelpTip } from "./Help";

export interface FieldProps {
  node: SchemaNode;
  value: unknown;
  onChange: (value: unknown) => void;
  /** Shown inside a number field, after the value, where a row has taken it off the label. */
  unit?: string;
  /** A switch rather than a checkbox, for an on/off setting alone on its row. */
  asSwitch?: boolean;
}

/**
 * A field's bounds in both spaces. The schema publishes them scaled by 10^decimals while the value
 * is real, so both are given names here rather than converted at each use - which is where the two
 * got mixed.
 */
const bandOf = (node: SchemaNode) => {
  const band: Band = {
    lo: asBound(node.lo ?? 0),
    hi: asBound(node.hi ?? 0),
    step: asBound(node.step ?? 1),
    decimals: node.decimals,
  };
  return {
    ...band,
    realLo: boundsToReal(band.lo, band.decimals),
    realHi: boundsToReal(band.hi, band.decimals),
    realStep: boundsToReal(band.step, band.decimals),
  };
};

/** Compact range summary in the unit the row is displayed in: "5–50 · 5". */
function rangeHint(node: SchemaNode): string {
  // A pin's published range is 0..255, where 255 is the "unused" marker rather than a GPIO, and the
  // real ceiling is the chip's - which the schema does not carry. Printing "0-255" would name two
  // hundred values that are not pins, so PinField says what it accepts instead.
  if (node.display === "pin") return "";
  if (node.lo === undefined || node.hi === undefined) return "";
  const seconds = node.display === "seconds";
  const fmt = (n: number) =>
    seconds ? String(n / 1000) : String(boundsToReal(asBound(n), node.decimals));
  return `${fmt(node.lo)}–${fmt(node.hi)}${seconds ? "s" : ""} · ${fmt(node.step ?? 1)}`;
}

const denseInput = { padding: "4px 6px", fontSize: 13 } as const;

function NumericField({ node, value, onChange, unit }: FieldProps) {
  const band = bandOf(node);
  const seconds = node.display === "seconds";
  // toShown takes a real-unit value, never a bound: lo/hi/step arrive scaled by 10^decimals and
  // the value does not, so a bound is converted first. Every use of them below goes through the
  // shown* constants for that reason.
  const toShown = (stored: number) => (seconds ? stored / 1000 : stored);
  const toStored = (shown: number) =>
    seconds ? snapReal(shown * 1000, band) : snapReal(shown, band);

  const shownLo = toShown(band.realLo);
  const shownHi = toShown(band.realHi);
  const shownStep = toShown(band.realStep);

  const current = typeof value === "number" ? value : 0;
  const canonical = String(toShown(current));

  // Editing is held in a draft string and committed on blur or Enter.
  //
  // Snapping per keystroke is unusable: with bounds 5-50, typing "23" clamps the leading "2" to 5
  // and the next character lands on "53", which clamps to 50. Every partial entry en route to a
  // valid number is itself invalid, so the field tolerates transient invalid text and settles once.
  const [draft, setDraft] = React.useState(canonical);
  const [editing, setEditing] = React.useState(false);

  React.useEffect(() => {
    if (!editing) setDraft(canonical);
  }, [canonical, editing]);

  const parsed = Number(draft);
  const valid = draft.trim() !== "" && Number.isFinite(parsed);
  const inRange = valid && parsed >= shownLo && parsed <= shownHi;

  const commit = () => {
    setEditing(false);
    if (!valid) {
      setDraft(canonical);
      return;
    }
    const stored = toStored(parsed);
    onChange(stored);
    setDraft(String(toShown(stored)));
  };

  // The range shows while the field has focus, under it, out of flow so nothing moves.
  const hint = rangeHint(node);
  return (
    <TextField
      type="number"
      size="small"
      value={draft}
      disabled={!isEditable(node)}
      error={editing && !inRange}
      helperText={editing && hint ? hint : undefined}
      slotProps={{
        htmlInput: {
          min: shownLo,
          max: shownHi,
          step: shownStep,
          style: denseInput,
        },
        input: unit
          ? {
              endAdornment: (
                <InputAdornment position="end" sx={{ "& p": { fontSize: 12 } }}>
                  {unit}
                </InputAdornment>
              ),
            }
          : undefined,
        formHelperText: {
          sx: {
            position: "absolute",
            top: "100%",
            right: 0,
            m: 0,
            mt: 0.25,
            px: 0.75,
            zIndex: 2,
            fontSize: 11.5,
            whiteSpace: "nowrap",
            bgcolor: "background.paper",
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
          },
        },
      }}
      onFocus={() => setEditing(true)}
      onChange={(e) => {
        setEditing(true);
        setDraft(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit();
          return;
        }
        if (e.key === "Escape") {
          setEditing(false);
          setDraft(canonical);
          return;
        }
        // Arrows step on the device's grid rather than the raw input step, so holding an arrow walks
        // exactly the values the on-device menu would.
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const from = valid ? toStored(parsed) : current;
          const next = steppedReal(from, e.key === "ArrowUp" ? 1 : -1, band);
          onChange(next);
          setDraft(String(toShown(next)));
          setEditing(false);
        }
      }}
      sx={{ width: "100%" }}
    />
  );
}

/**
 * PIN_NOT_USED, for a row that somehow published no band.
 *
 * Normally read off the node instead: a pin row's `hi` *is* the unused marker, since bounds() gives
 * it {0, PIN_NOT_USED, 1, 0}. Taking it from there rather than from here keeps the one rule this
 * codebase has about bounds - the schema owns them, and nothing holds a second copy.
 */
const PIN_UNUSED_FALLBACK = 255;

/**
 * A GPIO number, or "unused".
 *
 * Two controls rather than one number box, because 255 is not a two-hundred-and-fifty-fifth pin -
 * it is a different answer, and the one a user reaches for most often after "which pin is this".
 * Spelling it as a number would also make "unused" unreachable by typing on any board: the chip's
 * real ceiling is around 29, and the schema publishes no bound that says so.
 *
 * The last real pin is remembered so toggling unused and back is not destructive - the common case
 * is checking what a control was wired to, not clearing it.
 */
function PinField({ node, value, onChange }: FieldProps) {
  const unusedValue = node.hi ?? PIN_UNUSED_FALLBACK;
  const current = typeof value === "number" ? value : unusedValue;
  const unused = current === unusedValue;

  const lastPin = React.useRef(unused ? 0 : current);
  if (!unused) lastPin.current = current;

  const [draft, setDraft] = React.useState(unused ? "" : String(current));
  const [editing, setEditing] = React.useState(false);

  React.useEffect(() => {
    if (!editing) setDraft(unused ? "" : String(current));
  }, [current, unused, editing]);

  const commit = () => {
    setEditing(false);
    const parsed = Number(draft);
    if (draft.trim() === "" || !Number.isInteger(parsed) || parsed < 0 || parsed >= unusedValue) {
      setDraft(unused ? "" : String(current));
      return;
    }
    onChange(parsed);
  };

  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
      <TextField
        type="number"
        size="small"
        value={draft}
        placeholder="unused"
        disabled={!isEditable(node) || unused}
        slotProps={{
          // Named for the pin: with no label, a screen reader falls back to the placeholder.
          htmlInput: {
            min: node.lo ?? 0,
            max: unusedValue - 1,
            step: 1,
            style: denseInput,
            "aria-label": node.label,
          },
        }}
        onFocus={() => setEditing(true)}
        onChange={(e) => {
          setEditing(true);
          setDraft(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setEditing(false);
            setDraft(unused ? "" : String(current));
          }
        }}
        sx={{ flex: 1, minWidth: 0 }}
      />
      <ToggleButton
        value="unused"
        size="small"
        selected={unused}
        disabled={!isEditable(node)}
        onChange={() => onChange(unused ? lastPin.current : unusedValue)}
        sx={{ py: 0.15, px: 0.75, fontSize: 11, textTransform: "none", whiteSpace: "nowrap" }}
      >
        unused
      </ToggleButton>
    </Stack>
  );
}

function EnumField({ node, value, onChange }: FieldProps) {
  const options = node.options ?? [];

  // An enum's stored value is either an id or a number depending on the node - see enumValue.ts.
  const index = optionIndexFor(node, value);
  const valueAt = (i: number) => optionValueAt(node, i);

  // Two options fit as a pair of buttons and save a click. Three or more would eat the tile width.
  if (options.length === 2) {
    return (
      <ToggleButtonGroup
        exclusive
        size="small"
        value={index}
        disabled={!isEditable(node)}
        onChange={(_, next) => next !== null && onChange(valueAt(next))}
        sx={{
          "& .MuiToggleButton-root": { py: 0.15, px: 1, fontSize: 12, textTransform: "none" },
        }}
      >
        {options.map((label, i) => (
          <ToggleButton key={label} value={i}>
            {label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    );
  }

  return (
    <TextField
      select
      size="small"
      value={index}
      disabled={!isEditable(node)}
      onChange={(e) => onChange(valueAt(Number(e.target.value)))}
      sx={{ width: "100%", "& .MuiSelect-select": { ...denseInput } }}
      // Just the name once chosen: an option's description belongs in the open list only.
      slotProps={{ select: { renderValue: (i) => options[i as number] } }}
    >
      {options.map((label, i) => {
        const about = optionHelpFor(node.key, valueAt(i));
        // Named for the option alone, with the line under it as its description.
        const aboutId = about ? `${(node.key ?? "").replace(/\W/g, "-")}-about-${i}` : undefined;
        return (
          <MenuItem
            key={label}
            value={i}
            aria-label={about ? label : undefined}
            aria-describedby={aboutId}
            sx={{ fontSize: 13, ...(about && { display: "block", whiteSpace: "normal", maxWidth: 320 }) }}
          >
            {label}
            {about && (
              <Typography id={aboutId} component="div" variant="caption" color="text.secondary">
                {about}
              </Typography>
            )}
          </MenuItem>
        );
      })}
    </TextField>
  );
}

function TextEditField({ node, value, onChange }: FieldProps) {
  const maxLen = node.maxLen ?? 14;
  const charset = node.charset ?? "";
  const current = typeof value === "string" ? value : "";

  return (
    <TextField
      size="small"
      value={current}
      disabled={!isEditable(node)}
      slotProps={{ htmlInput: { maxLength: maxLen, style: denseInput } }}
      onChange={(e) => {
        // Drop anything the on-device editor cannot represent, rather than storing a name the user
        // could never edit back on the blaster itself.
        const filtered = charset
          ? [...e.target.value].filter((c) => charset.includes(c)).join("")
          : e.target.value;
        onChange(filtered.slice(0, maxLen));
      }}
      sx={{ width: "100%" }}
    />
  );
}

/**
 * An amber outline on anything edited and not yet written, the colour every unsaved mark uses.
 *
 * `display: contents` so the wrapper adds no box of its own - these sit inside grid cells and table
 * cells whose layout the marker has no business changing. Styled by descendant selector rather than
 * by passing sx into each branch below, because the branches render four different MUI components
 * and the point is that every one of them gets marked.
 */
const dirtySx = {
  display: "contents",
  "& .MuiOutlinedInput-notchedOutline": { borderColor: "warning.main", borderWidth: 2 },
  "& .MuiCheckbox-root": { color: "warning.main" },
  "& .MuiSwitch-track": { outline: "2px solid", outlineColor: "warning.main" },
  "& .MuiToggleButtonGroup-root": { outline: "2px solid", outlineColor: "warning.main" },
} as const;

/** Just the control, unlabelled - the matrix layout labels its own rows and columns. */
export function FieldControl(props: FieldProps) {
  const { node } = props;
  const dirty = useIsDirty(node.key);
  const control = renderControl(props);
  return dirty ? <Box sx={dirtySx}>{control}</Box> : control;
}

function renderControl(props: FieldProps) {
  const { node } = props;
  switch (node.kind) {
    case "int":
    case "float":
      return node.display === "pin" ? <PinField {...props} /> : <NumericField {...props} />;
    case "bool":
      return props.asSwitch ? (
        <Switch
          size="small"
          checked={props.value === true}
          disabled={!isEditable(node)}
          onChange={(e) => props.onChange(e.target.checked)}
          slotProps={{ input: { "aria-label": splitUnit(node.label).name } }}
        />
      ) : (
        <Checkbox
          size="small"
          sx={{ p: 0.25 }}
          checked={props.value === true}
          disabled={!isEditable(node)}
          onChange={(e) => props.onChange(e.target.checked)}
        />
      );
    case "enum":
      return <EnumField {...props} />;
    case "text":
      return <TextEditField {...props} />;
    default:
      // Forward compatibility: firmware newer than this console can introduce a widget kind we have
      // never heard of. Show the raw value rather than dropping the row silently.
      return (
        <Alert severity="info" sx={{ py: 0, fontSize: 12 }}>
          {String(props.value)} — unknown field kind &ldquo;{node.kind}&rdquo;
        </Alert>
      );
  }
}

/** Marks a setting that only takes effect after a reboot, without spending a chip's worth of width. */
const RebootMark = () => (
  <Tooltip title="Takes effect after the blaster restarts">
    <Box
      component="span"
      sx={{ color: "warning.main", fontSize: 12, lineHeight: 1, cursor: "help" }}
    >
      &#x27F3;
    </Box>
  </Tooltip>
);

/**
 * Rows flow into as many columns as fit at 300 px, three at most, and one on a phone. Related pairs -
 * a threshold and its time - are ordered by the layout to share a line.
 */
export const ROWS_SX = {
  display: "grid",
  gridTemplateColumns:
    "repeat(auto-fill, minmax(max(min(100%, 300px), calc((100% - 48px) / 3)), 1fr))",
  columnGap: 3,
  alignItems: "stretch",
} as const;

/** How wide a row's control is, so the controls down a column line up. */
const CONTROL_WIDTH = 168;

/**
 * One setting as a row: its name, and anything said about it, on the left; its control on the right.
 *
 * An edited row is marked down its left edge and says what the device holds, with a revert beside
 * it - the edit is visible and undoable where it was made, not only in the review.
 */
export function Field(props: FieldProps) {
  const { node } = props;
  const dirty = useIsDirty(node.key);
  const staging = React.useContext(StagingContext);
  const split = splitUnit(node.label);
  const name = split.name;
  // A seconds row is stored in ms and shown in s, so it names its unit whatever its label says.
  const unit = node.display === "seconds" ? "s" : split.unit;
  const editable = isEditable(node);
  const help = helpFor(node.key);
  const was = dirty && node.key ? staging.was(node.key) : undefined;

  const row = (
    <Box
      className="setting-row"
      data-key={node.key}
      sx={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        columnGap: 1.75,
        alignItems: "center",
        minHeight: 40,
        py: 0.25,
        pl: 1.25,
        borderBottom: 1,
        borderColor: "divider",
        "&::before": dirty
          ? {
              content: '""',
              position: "absolute",
              left: 0,
              top: 7,
              bottom: 7,
              width: 3,
              borderRadius: "0 3px 3px 0",
              bgcolor: "warning.main",
            }
          : undefined,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: 1 }}>
          <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
            <HelpTip
              lead={editable && dirty ? `${name} (edited, not yet written)` : undefined}
              help={editable && !staging.describe ? help : undefined}
            >
              <Typography
                component="span"
                sx={{
                  fontWeight: 550,
                  fontSize: 13.5,
                  cursor: help && editable ? "help" : undefined,
                }}
              >
                {name}
              </Typography>
            </HelpTip>
            {needsReboot(node) && <RebootMark />}
          </Box>
          {dirty && (
            <Box
              component="span"
              sx={{ fontSize: 11.5, color: "warning.main", whiteSpace: "nowrap" }}
            >
              {was !== undefined && `was ${was} `}
              <Box
                component="button"
                type="button"
                onClick={() => node.key && staging.revert(node.key)}
                aria-label={`Revert ${name}`}
                sx={{
                  border: 0,
                  bgcolor: "transparent",
                  p: 0,
                  color: "primary.main",
                  font: "inherit",
                  textDecoration: "underline",
                  cursor: "pointer",
                }}
              >
                Revert
              </Box>
            </Box>
          )}
        </Box>
        {staging.describe && help && (
          <Box sx={{ color: "text.secondary", fontSize: 12, mt: 0.25, maxWidth: "62ch" }}>
            {help}
          </Box>
        )}
      </Box>
      <Box
        sx={{
          display: "flex",
          justifyContent: "flex-end",
          position: "relative",
          width:
            node.kind === "bool" || (node.kind === "enum" && (node.options?.length ?? 0) === 2)
              ? "auto"
              : CONTROL_WIDTH,
        }}
      >
        <FieldControl {...props} unit={unit} asSwitch />
      </Box>
    </Box>
  );

  // A locked field has one tooltip over all of it, saying why, and the help joins that one.
  return editable ? (
    row
  ) : (
    <HelpTip lead={node.locked} help={help}>
      {row}
    </HelpTip>
  );
}
