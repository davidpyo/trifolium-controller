import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import * as React from "react";
import type { SchemaNode } from "../schema/types";
import type { MatrixExtra } from "./Section";

// The Motors menu's two actions, as rows of the motor table: spin one motor to see it turn, and set
// its ESC's direction then spin it to check. The direction is written to the ESC, not read from it -
// AM32 has no way to report it - so the spin is the answer to which way it turns, and Normal and
// Reversed are two buttons rather than a toggle that would have to know the current state.

/** A command's ack, or null when none came. */
export type Ack = { ok: boolean; err?: string } | null;

/** About as long as the blaster takes: a 2 s spin, plus the ESC write for a direction. */
const SPIN_MS = 2500;

/** One action at a time across every motor: the blaster refuses a second while one runs. */
export function useMotorActions(
  run: (command: string) => Promise<Ack>,
  onResult: (ok: boolean, text: string) => void,
) {
  const [busy, setBusy] = React.useState(false);
  const act = async (command: string, what: string) => {
    setBusy(true);
    const ack = await run(command);
    if (ack?.ok) onResult(true, `${what}.`);
    else onResult(false, `${what} refused: ${ack?.err ?? "no reply"}.`);
    // The ack comes as the spin starts; another press before it ends would be refused anyway.
    if (ack?.ok) await new Promise((r) => setTimeout(r, SPIN_MS));
    setBusy(false);
  };
  return { busy, act };
}

/** The motor a matrix column stands for, read off its fields' keys. */
export function motorIndexOf(group: SchemaNode): number | null {
  for (const child of group.children ?? []) {
    const m = /motorConfig\[(\d+)\]/.exec(child.key ?? "");
    if (m) return Number(m[1]);
  }
  return null;
}

export interface MotorActionRowsOptions {
  /** Indices of the motors the wiring enables. */
  motors: number[];
  /** Connected, to firmware that has the commands. */
  available: boolean;
  busy: boolean;
  act: (command: string, what: string) => Promise<void>;
}

const NEEDS = "Needs a connected blaster on firmware 2.3.0 or later, at rest with its menu closed.";

export function motorActionRows({ motors, available, busy, act }: MotorActionRowsOptions): MatrixExtra[] {
  const motorOf = (g: SchemaNode) => {
    const i = motorIndexOf(g);
    return i !== null && motors.includes(i) ? i : null;
  };
  const sx = { minWidth: 0, px: 1, fontSize: 12 } as const;
  return [
    {
      label: "Test",
      help: `Spins this motor alone for about 2 s. ${NEEDS}`,
      cell: (g) => {
        const i = motorOf(g);
        if (i === null) return null;
        return (
          <Button
            size="small"
            variant="outlined"
            sx={sx}
            disabled={!available || busy}
            aria-label={`Test motor ${i + 1}`}
            onClick={() => void act(`MOTOR_TEST ${i}`, `Motor ${i + 1} spun`)}
          >
            Test
          </Button>
        );
      },
    },
    {
      label: "Direction",
      help: `Writes that direction to this motor's ESC, then spins it to check. ${NEEDS}`,
      cell: (g) => {
        const i = motorOf(g);
        if (i === null) return null;
        return (
          <Stack direction="row" spacing={0.5}>
            <Button
              size="small"
              variant="outlined"
              sx={sx}
              disabled={!available || busy}
              aria-label={`Set motor ${i + 1} to Normal`}
              onClick={() => void act(`MOTOR_NORMAL ${i}`, `Motor ${i + 1} set to Normal`)}
            >
              Normal
            </Button>
            <Button
              size="small"
              variant="outlined"
              sx={sx}
              disabled={!available || busy}
              aria-label={`Set motor ${i + 1} to Reversed`}
              onClick={() => void act(`MOTOR_REVERSED ${i}`, `Motor ${i + 1} set to Reversed`)}
            >
              Reversed
            </Button>
          </Stack>
        );
      },
    },
  ];
}
