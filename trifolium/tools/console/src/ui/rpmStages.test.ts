// The stage view over per-motor RPM storage, which has to agree with StageRpmItem in
// src/menuFlywheel.cpp: a stage shows the first enabled motor in it and writes all of them.

import { describe, expect, it } from "vitest";
import { readMotors, stageRows, type Motor } from "./RpmStages";
import type { Schema, SchemaNode } from "../schema/types";
import { applyLayout } from "./applyLayout";
import { PROFILE_LAYOUT } from "./layout";
import { countFields, deriveSections, pruneToStore } from "./sections";
import schemaJson from "../fixtures/schema.json";

const motor = (index: number, stage: string, enabled = true): Motor => ({ index, stage, enabled });

describe("reading the motors out of device settings", () => {
  it("takes stage and enabled from motorConfig", () => {
    const device = {
      motorConfig: [
        { enabled: true, stage: "stage1" },
        { enabled: false, stage: "stage2" },
      ],
    };
    expect(readMotors(device)).toEqual([
      { index: 0, enabled: true, stage: "stage1" },
      { index: 1, enabled: false, stage: "stage2" },
    ]);
  });

  it("returns nothing rather than four blanks when there is no config yet", () => {
    expect(readMotors({})).toEqual([]);
  });
});

describe("grouping motors into stage rows", () => {
  it("puts every enabled motor of a stage in one row", () => {
    const rows = stageRows([
      motor(0, "stage1"),
      motor(1, "stage1"),
      motor(2, "stage2"),
      motor(3, "stage2"),
    ]);
    expect(rows.map((r) => r.members)).toEqual([[0, 1], [2, 3]]);
    expect(rows.map((r) => r.which)).toEqual([1, 2]);
  });

  /** The device neither shows nor writes a disabled motor through a stage row. */
  it("leaves disabled motors out of the row", () => {
    const rows = stageRows([motor(0, "stage1"), motor(1, "stage1", false)]);
    expect(rows[0].members).toEqual([0]);
  });

  it("drops a stage with no enabled motors rather than rendering it empty", () => {
    const rows = stageRows([motor(0, "stage1"), motor(1, "stage2", false)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].stage).toBe("stage1");
  });

  it("shows the first enabled motor of the stage, which is what the device reads", () => {
    const rows = stageRows([motor(0, "stage1", false), motor(1, "stage1"), motor(2, "stage1")]);
    expect(rows[0].members[0]).toBe(1);
  });

  it("yields no rows at all when nothing is enabled", () => {
    expect(stageRows([motor(0, "stage1", false), motor(1, "stage2", false)])).toEqual([]);
  });

  it("keeps stage order regardless of motor order", () => {
    const rows = stageRows([motor(0, "stage2"), motor(1, "stage1")]);
    expect(rows.map((r) => r.stage)).toEqual(["stage1", "stage2"]);
  });
});

describe("the RPM & Timing section", () => {
  const sections = (() => {
    const schema = schemaJson as unknown as Schema;
    const pruned = deriveSections(schema.tree)
      .map((x) => pruneToStore(x, "profile"))
      .filter((x): x is SchemaNode => x !== null && countFields(x) > 0);
    return applyLayout(pruned, PROFILE_LAYOUT);
  })();

  const keysIn = (node: SchemaNode): string[] => {
    const out: string[] = [];
    const visit = (n: SchemaNode) => {
      if (n.key) out.push(n.key);
      for (const c of n.children ?? []) visit(c);
    };
    visit(node);
    return out;
  };

  /**
   * The five settings that hold whichever RPM Mode is selected, in the order they are declared.
   * The per-motor arrays are not among them: RpmStages renders those, in both modes, which is why
   * they are claimed as rendered elsewhere.
   */
  it("leads with the settings that survive switching mode", () => {
    const section = sections.find((x) => x.label === "RPM & Timing");
    expect(section).toBeDefined();
    expect(keysIn(section!)).toEqual([
      "profile:rpmMode",
      "profile:dwellTime_ms",
      "profile:idleTime_ms",
      "profile:spindownSpeed",
      "profile:revSafetyTimeout_ms",
    ]);
  });

  it("does not leave the per-motor arrays loose in any section", () => {
    const everything = sections.flatMap((x) => keysIn(x));
    for (const key of ["profile:revRPM[0]", "profile:idleRPM[3]"]) {
      expect(everything).not.toContain(key);
    }
  });
});
