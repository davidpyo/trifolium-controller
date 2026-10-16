import React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Typography from "@mui/material/Typography";
import { alpha, type Theme } from "@mui/material/styles";
import { BLASTERS, blasterLoads, savedOn, type Blaster } from "../config/blasters";
import { OFFERED_PRESETS, PRESETS, wiringLabel, type Preset } from "../schema/presets";
import type { Schema } from "../schema/types";

const NO_BLASTER = "none";

export interface SetupWizardProps {
  busy: boolean;
  /** Gives the number of writes on the review step. */
  schema: Schema;
  /** The board id the device already stored, if any - see the upgrade note below. */
  storedBoardId?: string;
  /** The preset that id names, resolved through the alias table by the caller. */
  suggested?: Preset;
  /**
   * What the device is wired as now, for changing a wiring that is already set. Absent on a device
   * with no wiring, where there is nothing to replace.
   */
  replacing?: string;
  onApply: (preset: Preset) => void;
  /**
   * Offers a blaster config to load with the board. Only for a device with no wiring: a config
   * replaces every setting and profile, which on a device already set up is a Full Backup's job.
   */
  onApplyBlaster?: (board: Preset, blaster: Blaster) => void;
  onCustom: () => void;
  onCancel?: () => void;
}

/**
 * Sets a device up as a board, and optionally as a published blaster on it, one question a step:
 * the board, then the blaster config, then what will be written.
 *
 * Three ways to reach it with no wiring, and the copy has to serve all of them: a device flashed
 * with the released .uf2, which ships with no wiring at all; a device whose wiring was cleared with
 * RESET_PINS; and a device upgraded across MOH-16, whose stored config named a board this firmware
 * has no pinout for. The last of those still carries the board id, which is what `suggested` is -
 * the console holds the presets, so it is the side that can turn that id back into pins.
 *
 * With `replacing`, it changes the board of a device already wired, and the review step is the
 * confirmation: a wrong board puts a wrong pinout on live hardware.
 */
export function SetupWizard({
  busy,
  schema,
  storedBoardId,
  suggested,
  replacing,
  onApply,
  onApplyBlaster,
  onCustom,
  onCancel,
}: SetupWizardProps) {
  const [boardId, setBoardId] = React.useState(suggested?.id ?? "");
  // Resolved against every board, not just the offered ones: a retired board still has to apply.
  const board = PRESETS.find((p) => p.id === boardId);

  const offersBlasters = onApplyBlaster !== undefined && BLASTERS.length > 0;
  const [blasterId, setBlasterId] = React.useState(NO_BLASTER);
  const blaster = offersBlasters ? BLASTERS.find((b) => b.id === blasterId) : undefined;

  const steps = offersBlasters ? ["Board", "Blaster config", "Review"] : ["Board", "Review"];
  const [step, setStep] = React.useState(0);
  const reviewing = step === steps.length - 1;

  // A retired board is recognised but not listed - except when the device reported it, which is
  // the case `retired` exists for. Leaving it out there would suggest a board the list cannot show.
  const offered = suggested?.retired ? [suggested, ...OFFERED_PRESETS] : OFFERED_PRESETS;

  // The configs saved on the chosen board first: on it, they bring their own pins too.
  const blasters = React.useMemo(
    () =>
      board
        ? [...BLASTERS].sort(
            (a, b) => Number(savedOn(b.bundle, board)) - Number(savedOn(a.bundle, board)),
          )
        : BLASTERS,
    [board],
  );

  if (!offered.length) {
    return (
      <Alert severity="error">
        This device has no wiring, and this console was built with no presets to offer. Nothing here
        can configure it.
      </Alert>
    );
  }

  const writes = board && blaster ? blasterLoads(blaster.bundle, board, schema).length : 1;
  const apply = () => {
    if (!board) return;
    if (blaster) onApplyBlaster?.(board, blaster);
    else onApply(board);
  };

  let body: React.ReactNode;
  if (step === 0) {
    body = (
      <>
        <StepHead
          title={
            replacing
              ? "Which board is this blaster wired as now?"
              : "Which board is in this blaster?"
          }
          lede={
            replacing
              ? "Every pin moves to the board's. Profiles, tuning and fire modes are not part of a board and are not touched."
              : "This sets the pins. With no wiring the blaster drives nothing: no motors, no pusher, no screen."
          }
        />
        {suggested && storedBoardId && !replacing && (
          <Alert severity="info" sx={{ py: 0.25, mb: 1.5 }}>
            This device previously ran as <strong>{storedBoardId}</strong>. That firmware kept the
            pin assignments compiled in; this one stores them, so they need loading once.{" "}
            <strong>{suggested.name}</strong> is the matching board and is selected.
          </Alert>
        )}
        <Cards label="Board" value={boardId} onChange={setBoardId} disabled={busy}>
          {offered.map((p) => ({
            id: p.id,
            title: p.name,
            chip: p.id === suggested?.id ? (replacing ? "Current" : "Suggested") : undefined,
          }))}
        </Cards>
        <Notes notes={board?.notes ?? []} />
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
          Pick the controller board, not the blaster it is fitted to.
        </Typography>
      </>
    );
  } else if (!reviewing) {
    body = (
      <>
        <StepHead
          title="Start from a known blaster?"
          lede="A published build's config brings its settings and all its profiles. The pins are the board's, and a config saved on this board also brings any the board leaves unused."
        />
        <Cards label="Blaster config" value={blasterId} onChange={setBlasterId} disabled={busy}>
          {[
            { id: NO_BLASTER, title: "None", detail: "Firmware defaults" },
            ...blasters.map((b) => ({
              id: b.id,
              title: b.name,
              detail: `Built on ${wiringLabel(b.bundle.board)}`,
              chip: board && savedOn(b.bundle, board) ? "This board" : undefined,
            })),
          ]}
        </Cards>
        <Notes notes={blaster?.notes ?? []} />
      </>
    );
  } else {
    body = (
      <>
        <StepHead title="Review" />
        <Box
          component="dl"
          sx={{
            m: 0,
            display: "grid",
            gridTemplateColumns: "max-content 1fr",
            gap: "8px 18px",
            fontSize: 13.5,
            "& dt": { color: "text.secondary" },
            "& dd": { m: 0 },
          }}
        >
          <dt>Board</dt>
          <dd>
            <b>{board?.name}</b>
            {replacing && <> in place of {replacing}</>}. Every pin is set to the board&rsquo;s.
          </dd>
          {offersBlasters && (
            <>
              <dt>Config</dt>
              <dd>
                {blaster ? (
                  <>
                    <b>{blaster.name}</b>: its blaster settings and {writes - 1} profile
                    {writes - 1 === 1 ? "" : "s"}.
                  </>
                ) : (
                  <>
                    <b>None</b>. Every other setting stays as it is.
                  </>
                )}
              </dd>
            </>
          )}
          {replacing && (
            <>
              <dt>Kept</dt>
              <dd>Profiles, tuning and fire modes.</dd>
            </>
          )}
          <dt>Restarts</dt>
          <dd>
            {writes === 1
              ? "One write, then the blaster restarts."
              : `${writes} writes, and the blaster restarts after each.`}{" "}
            The console reconnects on its own.
          </dd>
        </Box>
        <Notes notes={[...(board?.notes ?? []), ...(blaster?.notes ?? [])]} />
        <Alert severity="warning" sx={{ py: 0, mt: 2 }}>
          Pick the board you actually have. A wrong choice drives the wrong pins on real hardware.
          {blaster
            ? " If your build wires anything differently, change it afterwards on the Wiring page."
            : ""}
        </Alert>
      </>
    );
  }

  return (
    <Box sx={{ maxWidth: 920 }}>
      <Steps steps={steps} at={step} />
      {body}
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1, mt: 2.5 }}>
        {step > 0 && (
          <Button disabled={busy} onClick={() => setStep(step - 1)}>
            Back
          </Button>
        )}
        {onCancel && (
          <Button disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        )}
        {/*
          The custom path. Not a preset called "generic", deliberately: a template for a bare Pico
          would be backed by no schematic, so every default in it would be a fabrication that then
          gets driven - and a wrong default is worse than an absent one. This leaves every pin
          unused and opens the wiring table so each one is answered rather than proposed.
        */}
        {step === 0 && (
          <Button
            disabled={busy}
            sx={{ color: "text.secondary" }}
            onClick={onCustom}
            title="Opens the wiring table with every pin unused. The blaster stays inert until you say the wiring is complete."
          >
            My board is not listed: wire it by hand
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        {reviewing ? (
          <Button
            variant="contained"
            color={replacing ? "warning" : "primary"}
            disabled={!board || busy}
            onClick={apply}
          >
            {busy ? "Setting up..." : replacing ? "Load wiring" : "Set up blaster"}
          </Button>
        ) : (
          <Button variant="contained" disabled={!board || busy} onClick={() => setStep(step + 1)}>
            Next
          </Button>
        )}
      </Box>
    </Box>
  );
}

function StepHead({ title, lede }: { title: string; lede?: string }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography component="h3" sx={{ fontSize: 15, fontWeight: 650 }}>
        {title}
      </Typography>
      {lede && (
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: "75ch" }}>
          {lede}
        </Typography>
      )}
    </Box>
  );
}

/** Where the wizard is: a numbered dot per step, ticked once passed. */
function Steps({ steps, at }: { steps: string[]; at: number }) {
  return (
    <Box
      component="ol"
      aria-label="Steps"
      sx={{
        display: "flex",
        flexWrap: "wrap",
        rowGap: 1,
        listStyle: "none",
        m: 0,
        mb: 2,
        p: 0,
        "& > li + li": { ml: { xs: 0.75, sm: 1.25 } },
        "& > li + li::before": {
          content: '""',
          width: { xs: 12, sm: 28 },
          height: "1px",
          bgcolor: "divider",
          mr: 0.25,
        },
      }}
    >
      {steps.map((label, i) => (
        <Box
          component="li"
          key={label}
          aria-current={i === at ? "step" : undefined}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            fontSize: 13,
            color: i === at ? "text.primary" : "text.secondary",
            fontWeight: i === at ? 600 : 400,
          }}
        >
          <Box
            component="span"
            aria-hidden
            sx={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              display: "grid",
              placeItems: "center",
              fontSize: 12,
              fontWeight: 700,
              border: 1,
              borderColor: i === at ? "primary.main" : i < at ? "success.main" : "divider",
              bgcolor: i === at ? "primary.main" : "transparent",
              color: i === at ? "primary.contrastText" : i < at ? "success.main" : "inherit",
            }}
          >
            {i < at ? "✓" : i + 1}
          </Box>
          {label}
        </Box>
      ))}
    </Box>
  );
}

interface Card {
  id: string;
  title: string;
  detail?: string;
  chip?: string;
}

/**
 * One choice from a set of cards: a radio group, so the arrow keys move the choice and Tab leaves
 * the group, as with any set of radio buttons.
 */
function Cards({
  label,
  value,
  onChange,
  disabled,
  children,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
  children: Card[];
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const at = children.findIndex((c) => c.id === value);
  const move = (by: number) => {
    const next = (Math.max(at, 0) + by + children.length) % children.length;
    onChange(children[next].id);
    refs.current[next]?.focus();
  };
  return (
    <Box
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") move(1);
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") move(-1);
        else return;
        e.preventDefault();
      }}
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "repeat(auto-fill, minmax(140px, 1fr))",
          sm: "repeat(auto-fill, minmax(190px, 1fr))",
        },
        gap: 1.25,
      }}
    >
      {children.map((card, i) => {
        const on = card.id === value;
        return (
          <ButtonBase
            key={card.id}
            ref={(el: HTMLButtonElement | null) => {
              refs.current[i] = el;
            }}
            role="radio"
            aria-checked={on}
            aria-label={card.title}
            aria-description={[card.detail, card.chip].filter(Boolean).join(". ") || undefined}
            tabIndex={on || (at < 0 && i === 0) ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(card.id)}
            sx={{
              position: "relative",
              display: "grid",
              justifyContent: "stretch",
              justifyItems: "start",
              alignContent: "center",
              gap: 0.5,
              minHeight: card.detail ? 64 : 48,
              p: 1.5,
              pr: { xs: 1.5, sm: card.chip ? 10 : 1.5 },
              textAlign: "left",
              border: 1,
              borderRadius: 2,
              borderColor: on ? "primary.main" : "divider",
              bgcolor: on
                ? (t: Theme) =>
                    alpha(t.palette.primary.main, t.palette.mode === "dark" ? 0.12 : 0.06)
                : "background.paper",
              boxShadow: on
                ? (t: Theme) => `0 0 0 3px ${alpha(t.palette.primary.main, 0.25)}`
                : "none",
              "&:hover": { borderColor: on ? "primary.main" : "text.secondary" },
              "&.Mui-focusVisible": { outline: 2, outlineColor: "primary.main", outlineOffset: 2 },
            }}
          >
            <Box component="span" sx={{ fontSize: 14, fontWeight: 650 }}>
              {card.title}
            </Box>
            {card.detail && (
              <Box component="span" sx={{ fontSize: 12.5, color: "text.secondary" }}>
                {card.detail}
              </Box>
            )}
            {card.chip && (
              <Box
                component="span"
                aria-hidden
                sx={{
                  // Beside the title where the card has room for both, under it on a phone.
                  position: { xs: "static", sm: "absolute" },
                  top: 10,
                  right: 10,
                  fontSize: 11,
                  fontWeight: 600,
                  px: 0.75,
                  borderRadius: 1,
                  color: "primary.main",
                  border: 1,
                  borderColor: "primary.main",
                }}
              >
                {card.chip}
              </Box>
            )}
          </ButtonBase>
        );
      })}
    </Box>
  );
}

function Notes({ notes }: { notes: string[] }) {
  if (!notes.length) return null;
  return (
    <Box component="ul" sx={{ m: 0, mt: 1.5, pl: 2.5, maxWidth: "75ch" }}>
      {notes.map((note) => (
        <Typography component="li" key={note} variant="body2" color="text.secondary">
          {note}
        </Typography>
      ))}
    </Box>
  );
}
