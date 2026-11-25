import { describe, expect, it } from "vitest";
import schemaJson from "../../fixtures/schema.json";
import deviceJson from "../../fixtures/device.json";
import type { Schema } from "../../schema/types";
import { diagramForBoardId } from "../../schema/wiringDiagrams";
import { buildHookup, gpiosOf, type Hookup, type Lead, type Part } from "./model";
import { readPads } from "./pads";

const schema = schemaJson as unknown as Schema;
const v12 = diagramForBoardId("trifolium_v1_2")!;
const sheet = readPads(v12.svgMarkup)!;

const build = (overrides: Record<string, unknown> = {}, board: string | null = "trifolium_v1_2") => {
  const diagram = board ? diagramForBoardId(board)! : undefined;
  return buildHookup(
    schema,
    { ...deviceJson, ...overrides },
    diagram ? readPads(diagram.svgMarkup) : undefined,
    diagram?.markers,
  );
};

const part = (hookup: Hookup, id: string): Part => {
  const found = hookup.parts.find((p) => p.id === id);
  if (!found) throw new Error(`no part ${id} in ${hookup.parts.map((p) => p.id).join(", ")}`);
  return found;
};
const lead = (p: Part, id: string): Lead => p.leads.find((l) => l.id === id)!;
/** Where a lead goes, said the way a person would check it: GP21, or the pad's own name. */
const to = (l: Lead) =>
  l.target?.kind === "pad"
    ? l.target.pad.gpio !== null
      ? `GP${l.target.pad.gpio}`
      : `${l.target.pad.label ?? l.target.pad.power} @ ${l.target.pad.connector}`
    : l.target?.kind === "part"
      ? `${l.target.part} ${l.target.lead}`
      : l.target?.kind === "missing"
        ? `missing: ${l.target.text}`
        : null;

describe("buildHookup on a Trifolium v1.2", () => {
  const hookup = build();

  it("draws a part for each control in use, and the motors that are enabled", () => {
    // The fixture: trigger, rev, menu, a selector on select0 and select2, a display, motors 2 and 4,
    // a solenoid on the board's own FET, and the pack.
    expect(hookup.parts.map((p) => p.id).sort()).toEqual(
      ["battery", "esc1", "esc3", "menu", "oled", "pusher", "rev", "selector", "trigger"].sort(),
    );
    expect(hookup.generic).toBe(false);
  });

  it("wires a normally open switch's NO leg to its pin and C to the ground in its own plug", () => {
    const trigger = part(hookup, "trigger");
    expect(trigger.kind).toBe("microswitch");
    expect(to(lead(trigger, "NO"))).toBe("GP21");
    expect(to(lead(trigger, "C"))).toBe("GND @ GP21 connector");
    expect(lead(trigger, "NC").target).toBeNull();
  });

  it("moves the signal to the NC leg when the switch is normally closed", () => {
    const trigger = part(build({ triggerSwitchNormallyClosed: true }), "trigger");
    expect(to(lead(trigger, "NC"))).toBe("GP21");
    expect(lead(trigger, "NO").target).toBeNull();
    expect(trigger.note).toBe("normally closed");
  });

  it("powers the display from its own I2C plug", () => {
    const oled = part(hookup, "oled");
    expect(to(lead(oled, "SDA"))).toBe("GP14");
    expect(to(lead(oled, "SCL"))).toBe("GP15");
    expect(to(lead(oled, "VCC"))).toBe("VCC to I2C @ I2C connector");
    expect(to(lead(oled, "GND"))).toBe("GND to I2C @ I2C connector");
    expect(lead(oled, "VCC").net).toBe("vcc");
    expect(lead(oled, "GND").net).toBe("gnd");
  });

  it("leaves the display off when there is none", () => {
    expect(build({ hasDisplay: false }).parts.some((p) => p.id === "oled")).toBe(false);
  });

  it("wires the selector's positions, and its common to ground", () => {
    const selector = part(hookup, "selector");
    expect(selector.label).toBe("Select-fire switch");
    expect(selector.leads.map((l) => [l.leg, to(l)])).toEqual([
      ["C", "GND @ Select connector"],
      ["1", "GP9"],
      ["3", "GP10"],
    ]);
  });

  it("labels an encoder's lines as the bits they are", () => {
    const encoder = part(build({ selectFireType: "encoder" }), "selector");
    expect(encoder.leads.map((l) => l.leg)).toEqual(["C", "1", "2"]);
  });

  it("draws no selector when nothing reads the select pins", () => {
    expect(build({ selectFireType: "screen" }).parts.some((p) => p.id === "selector")).toBe(false);
  });

  it("gives each ESC its signal and ground on the ribbon, and its power from the battery", () => {
    const esc = part(hookup, "esc1");
    expect(to(lead(esc, "S"))).toBe("GP1");
    expect(to(lead(esc, "G"))).toBe("GND from ESC @ ESC connector");
    expect(to(lead(esc, "+"))).toBe("battery +");
    expect(to(lead(esc, "-"))).toBe("battery -");
    expect(lead(esc, "+").edge).toBe("under");
  });

  it("puts the battery on the board's battery pads and the solenoid on its output pads", () => {
    const battery = part(hookup, "battery");
    expect(battery.note).toBe("4S LiPo");
    expect(to(lead(battery, "+"))).toBe("+ From Battery @ XT30 IN");
    expect(to(lead(battery, "-"))).toBe("- From Battery @ XT30 IN");
    const solenoid = part(hookup, "pusher");
    expect(solenoid.kind).toBe("solenoid");
    expect(to(lead(solenoid, "+"))).toBe("+ To Solenoid @ XT30 OUT");
    expect(to(lead(solenoid, "-"))).toBe("- To Solenoid @ XT30 OUT");
  });

  it("puts a pusher on ESC drive on that channel's plug, through a driver", () => {
    const hookup = build({ pusherDrive: "esc", pusherEscChannel: "esc4" });
    const pusher = part(hookup, "pusher");
    expect(pusher.kind).toBe("driver");
    expect(pusher.note).toBe("on ESC 4 plug");
    expect(to(lead(pusher, "S"))).toBe("GP3");
    // Channel 4 is the pusher now, not a flywheel.
    expect(hookup.parts.some((p) => p.id === "esc3")).toBe(false);
  });

  it("draws no pusher when there is none", () => {
    expect(build({ pusherType: "none" }).parts.some((p) => p.id === "pusher")).toBe(false);
  });

  it("says so when a pin is not on this board", () => {
    // GP5 is not brought out on a v1.2.
    const rev = part(build({ revSwitchPin: 5 }), "rev");
    expect(to(lead(rev, "NO"))).toBe("missing: GP5 — not on board");
    // Nor is its ground guessed from wherever the first ground on the board happens to be.
    expect(to(lead(rev, "C"))).toBe("missing: GND");
  });

  it("still draws a pin setting it has no picture for, as a plug", () => {
    const enable = part(build({ escEnablePin: 26 }), "device:escEnablePin");
    expect(enable.kind).toBe("plug");
    expect(enable.label).toBe("ESC Enable");
    expect(to(lead(enable, "S"))).toBe("GP26");
  });

  it("only ever gives a speed pot 3.3 V", () => {
    // A v1.2 marks no pad 3.3 V - its supply pads are VCC - so the pot is told to find one.
    const pot = part(build({ speedPotPin: 26 }), "pot");
    expect(to(lead(pot, "W"))).toBe("GP26");
    expect(to(lead(pot, "+"))).toBe("missing: 3V3");
    // A board that does mark one gets it.
    const zero = part(build({ speedPotPin: 26 }, "rp2040_zero"), "pot");
    expect(to(lead(zero, "+"))).toMatch(/^3V3 @/);
  });

  it("names the GPIOs a part carries, for lighting it from the table", () => {
    expect(gpiosOf(part(hookup, "selector"))).toEqual([9, 10]);
    expect(gpiosOf(part(hookup, "battery"))).toEqual([]);
  });

  it("never puts a switch's ground on a pad that carries pack current", () => {
    for (const p of hookup.parts) {
      for (const l of p.leads) {
        if (l.net !== "gnd" || l.target?.kind !== "pad" || p.kind === "battery" || p.kind === "solenoid") continue;
        expect(l.target.pad.connector).not.toMatch(/xt30/i);
      }
    }
  });
});

describe("buildHookup on a Diana v1.1", () => {
  it("puts the solenoid on the pads named for it, not the ESC pads in the same plug", () => {
    const solenoid = part(build({ pusherFetPin: 0 }, "diana_v1_1"), "pusher");
    expect(to(lead(solenoid, "+"))).toBe("ESC + and Solenoid 2 @ Power and Solenoid");
    expect(to(lead(solenoid, "-"))).toBe("Solenoid 1 @ Power and Solenoid");
  });
});

describe("buildHookup on a board with no drawing", () => {
  const hookup = build({}, null);

  it("makes up a board with a pad for every wire", () => {
    expect(hookup.generic).toBe(true);
    for (const p of hookup.parts) {
      for (const l of p.leads) {
        if (p.kind === "battery") continue;
        expect(l.target?.kind, `${p.id} ${l.id}`).not.toBe("missing");
      }
    }
  });

  it("never mistakes a plug named for a part for a power plug", () => {
    // The made-up plugs are named for their parts; a "Solenoid driver" plug's ground is a ground.
    const driver = part(build({ pusherDrive: "esc", pusherEscChannel: "esc4" }, null), "pusher");
    expect(to(lead(driver, "G"))).toBe("GND @ Solenoid driver");
  });

  it("puts each part's ground beside its signal", () => {
    const trigger = part(hookup, "trigger");
    const signal = lead(trigger, "NO").target;
    const ground = lead(trigger, "C").target;
    expect(signal?.kind === "pad" && ground?.kind === "pad").toBe(true);
    if (signal?.kind === "pad" && ground?.kind === "pad") {
      expect(ground.pad.connector).toBe(signal.pad.connector);
    }
  });
});

describe("buildHookup on every board with a drawing", () => {
  const boards = ["trifolium_v1_1", "trifolium_v1_2", "diana_v1_0", "diana_v1_1", "rp2040_zero", "seeed_xiao_rp2040"];
  it.each(boards)("finds a pad for everything %s brings out", (id) => {
    const diagram = diagramForBoardId(id)!;
    const pads = readPads(diagram.svgMarkup)!;
    const hookup = buildHookup(schema, deviceJson, pads, diagram.markers);
    for (const p of hookup.parts) {
      for (const l of p.leads) {
        if (l.gpio !== undefined && l.target?.kind === "pad") expect(l.target.pad.gpio).toBe(l.gpio);
      }
    }
  });
});

it("reads the v1.2 sheet the tests above rely on", () => {
  expect(sheet.pads.some((p) => p.label === "+ From Battery")).toBe(true);
});
