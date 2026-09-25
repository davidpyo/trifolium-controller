import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getByKey } from "../schema/keyPath";
import { isVisible, walk, type Schema, type SchemaNode } from "../schema/types";
import { Field } from "./Field";

// Motor RPM, in whichever shape the profile's RPM Mode asks for.
//
// The firmware offers two editors over one piece of storage: four per-motor rows, or one row per
// stage that writes every enabled motor in it. Only one is visible at a time, and the stage editor's
// rows are `derived` - they carry no key, because they are a view rather than a field.
//
// That is why this component exists rather than the generic form handling it. The generic form
// renders keyed fields, so in stage mode it had nothing to render: the keyed rows were in the
// hidden half and the visible half was keyless. This works off the real keys in both modes and only
// changes how they are grouped, so switching mode never makes a value unreachable.
//
// The stage arithmetic mirrors StageRpmItem in menuFlywheel.cpp exactly: a stage shows the first
// *enabled* motor in it and writes all of them, so a stage whose motors had diverged is levelled by
// the first edit. Disabled motors are left alone by both.

/** Stage ids as they are stored - see kMotorStageIds in the firmware's enumIds.h. */
const STAGE_IDS = ["stage1", "stage2"];

export interface Motor {
  index: number;
  enabled: boolean;
  stage: string;
}

export interface StageRow {
  stage: string;
  /** 1-based, for the label. */
  which: number;
  /** Motor indices this row writes, in order. The first is the one whose value it shows. */
  members: number[];
}

/**
 * One row per stage that has an enabled motor in it.
 *
 * Enabled-only, matching StageRpmItem: the device neither reads nor writes a disabled motor through
 * a stage row, so a stage made up entirely of disabled motors is not a row at all. A stage with no
 * members is skipped rather than rendered empty, which is what makes a two-motor blaster show one
 * row instead of two.
 */
export function stageRows(motors: Motor[]): StageRow[] {
  return STAGE_IDS.map((stage, i) => ({
    stage,
    which: i + 1,
    members: motors.filter((m) => m.enabled && m.stage === stage).map((m) => m.index),
  })).filter((row) => row.members.length > 0);
}

/** The four motors' stage assignment and whether they are driven, read from device settings. */
export function readMotors(device: unknown): Motor[] {
  const out: Motor[] = [];
  for (let i = 0; i < 4; i++) {
    const enabled = getByKey(device, `device:motorConfig[${i}].enabled`);
    const stage = getByKey(device, `device:motorConfig[${i}].stage`);
    if (enabled === undefined && stage === undefined) continue;
    out.push({ index: i, enabled: enabled === true, stage: String(stage ?? "") });
  }
  return out;
}

const nodeByKey = (schema: Schema, key: string): SchemaNode | undefined => {
  let found: SchemaNode | undefined;
  walk(schema.tree, (n) => {
    if (n.key === key && !found) found = n;
  });
  return found;
};

/**
 * The band a stage row may use: the tightest of its motors' own bands.
 *
 * The firmware derives a stage's bounds from the highest-Kv enabled motor in it. Intersecting every
 * member's published band instead needs no Kv arithmetic here and can only ever be tighter, so a
 * value this accepts is one every motor in the stage accepts. The device clamps on write regardless.
 */
function intersectBands(nodes: SchemaNode[]): Pick<SchemaNode, "lo" | "hi" | "step"> {
  const los = nodes.map((n) => n.lo).filter((v): v is number => v !== undefined);
  const his = nodes.map((n) => n.hi).filter((v): v is number => v !== undefined);
  const steps = nodes.map((n) => n.step).filter((v): v is number => v !== undefined);
  return {
    lo: los.length ? Math.max(...los) : undefined,
    hi: his.length ? Math.min(...his) : undefined,
    step: steps.length ? Math.max(...steps) : undefined,
  };
}

interface BankProps {
  schema: Schema;
  device: unknown;
  profile: unknown;
  stageMode: boolean;
  /** "revRPM" or "idleRPM" - the per-motor array this bank edits. */
  array: string;
  label: string;
  onEdit: (key: string, value: unknown) => void;
}

function Bank({ schema, device, profile, stageMode, array, label, onEdit }: BankProps) {
  const motors = readMotors(device);
  const keyFor = (i: number) => `profile:${array}[${i}]`;
  const nodes = new Map<number, SchemaNode>();
  for (const m of motors) {
    const node = nodeByKey(schema, keyFor(m.index));
    if (node) nodes.set(m.index, node);
  }
  if (!nodes.size) return null;

  const rows: React.ReactNode[] = [];

  if (!stageMode) {
    for (const m of motors) {
      const node = nodes.get(m.index);
      if (!node || !isVisible(node)) continue;
      rows.push(
        <Field
          key={keyFor(m.index)}
          node={{ ...node, label: `Motor ${m.index + 1}${m.enabled ? "" : " (off)"}` }}
          value={getByKey(profile, keyFor(m.index))}
          onChange={(v) => onEdit(keyFor(m.index), v)}
        />,
      );
    }
  } else {
    for (const { stage, which, members } of stageRows(motors)) {
      const memberNodes = members
        .map((i) => nodes.get(i))
        .filter((n): n is SchemaNode => n !== undefined);
      if (!memberNodes.length) continue;

      const band = intersectBands(memberNodes);
      rows.push(
        <Field
          key={`${array}-${stage}`}
          node={{
            ...memberNodes[0],
            ...band,
            label: `Stage ${which} (M${members.map((i) => i + 1).join(", M")})`,
          }}
          value={getByKey(profile, keyFor(members[0]))}
          onChange={(v) => {
            for (const i of members) onEdit(keyFor(i), v);
          }}
        />,
      );
    }
  }

  if (!rows.length) return null;

  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
        {label}
      </Typography>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          columnGap: 1.5,
          rowGap: 1,
          alignItems: "start",
          mt: 0.5,
        }}
      >
        {rows}
      </Box>
    </Box>
  );
}

export interface RpmStagesProps {
  schema: Schema;
  device: unknown;
  profile: unknown;
  onEdit: (key: string, value: unknown) => void;
}

export function RpmStages({ schema, device, profile, onEdit }: RpmStagesProps) {
  const stageMode = getByKey(profile, "profile:rpmMode") === "stage";

  return (
    <Stack spacing={1.25}>
      <Bank
        schema={schema}
        device={device}
        profile={profile}
        stageMode={stageMode}
        array="revRPM"
        label={stageMode ? "Rev RPM, by stage" : "Rev RPM, per motor"}
        onEdit={onEdit}
      />
      <Bank
        schema={schema}
        device={device}
        profile={profile}
        stageMode={stageMode}
        array="idleRPM"
        label={stageMode ? "Idle RPM, by stage" : "Idle RPM, per motor"}
        onEdit={onEdit}
      />
      {stageMode && (
        <Typography variant="caption" color="text.disabled">
          A stage writes every enabled motor assigned to it, and shows the first. Motors in one stage
          whose values had diverged are levelled by the next edit — switch RPM Mode to Custom to set
          them apart.
        </Typography>
      )}
    </Stack>
  );
}
