// The wiring half of MOH-10: the pins and five polarity flags belong to a Wiring section, and
// a resolved pin conflict has to be sayable in words the form uses for the same fields.
//
// Which pins there are is read out of the schema rather than listed here, and that is the property
// under test as much as the layout is. The console has gained no code per pin across three changes
// now - MOH-17's pusher gate and LED, then MOH-16's four ESC channels, the I2C pair, the battery
// ADC and the ESC-enable gate - because WiringTable matches on `display: "pin"`. A count written
// as a number would have to be edited each time, which is exactly the coupling this avoids.

import { describe, expect, it } from "vitest";
import { walk, type PinConflict, type Schema, type SchemaNode } from "../schema/types";
import { applyLayout } from "./applyLayout";
import { DEVICE_LAYOUT, FALLTHROUGH_LABEL, RENDERED_ELSEWHERE } from "./layout";
import { describeConflict, labelsByField } from "./PinConflicts";
import { collectWiring } from "./WiringTable";
import { WIRING_RULES, ruleFor } from "./wiringRules";
import { countFields, deriveSections, pruneToStore } from "./sections";
import schemaJson from "../fixtures/schema.json";

const schema = schemaJson as unknown as Schema;

const deviceSections = (): SchemaNode[] => {
  const pruned = deriveSections(schema.tree)
    .map((s) => pruneToStore(s, "device"))
    .filter((s): s is SchemaNode => s !== null && countFields(s) > 0);
  return applyLayout(pruned, DEVICE_LAYOUT);
};

const keysIn = (section: SchemaNode): string[] => {
  const out: string[] = [];
  const visit = (node: SchemaNode) => {
    if (node.key) out.push(node.key);
    for (const child of node.children ?? []) visit(child);
  };
  visit(section);
  return out;
};

/**
 * Every device pin this firmware publishes, in the order DEVICE_LAYOUT claims them.
 *
 * Derived, not listed. A pin is a row because it carries `display: "pin"`, so a firmware that adds
 * one needs no change here - and a test carrying its own list would pass while the layout dropped
 * the new pin into "Other settings", which is the bug these tests exist to catch.
 */
const PINS = (() => {
  const inSchema: string[] = [];
  walk(schema.tree, (node) => {
    if (node.display === "pin" && node.key?.startsWith("device:") && !inSchema.includes(node.key)) {
      inSchema.push(node.key);
    }
  });
  const wiringSpec = DEVICE_LAYOUT.find((s) => s.label === "Wiring")!;
  return wiringSpec.keys.filter((k) => inSchema.includes(k));
})();

const POLARITIES = [
  "device:triggerSwitchNormallyClosed",
  "device:revSwitchNormallyClosed",
  "device:menuButtonNormallyClosed",
  "device:cycleSwitchNormallyClosed",
  "device:idleSwitchNormallyClosed",
];

describe("the Wiring section", () => {
  const sections = deviceSections();
  const wiring = sections.find((s) => s.label === "Wiring");

  it("exists and claims every pin and polarity flag, in the order it declares them", () => {
    expect(wiring).toBeDefined();
    expect(PINS.length).toBeGreaterThanOrEqual(8);
    const claimed = keysIn(wiring!);
    expect(claimed.slice(0, PINS.length + POLARITIES.length)).toEqual([...PINS, ...POLARITIES]);
  });

  /**
   * The layout has to claim every pin the firmware publishes, not merely the ones it was written
   * against. An unclaimed pin still renders - the trailing section sees to that - but it renders
   * as a loose tile in "Other settings", detached from the control it belongs to.
   */
  it("claims every pin the schema publishes, so none lands in Other settings", () => {
    const published: string[] = [];
    walk(schema.tree, (node) => {
      if (node.display === "pin" && node.key?.startsWith("device:")) published.push(node.key);
    });
    const unclaimed = [...new Set(published)].filter((k) => !PINS.includes(k));
    expect(unclaimed).toEqual([]);
  });

  /**
   * Boot actions are claimed here so they cannot also fall through into "Other settings". Only the
   * visible ones arrive: the firmware hides a boot action whose switch is not wired, and this board
   * has no cycle or idle switch and only two select lines.
   */
  it("claims the boot actions this board can actually use", () => {
    const bootActions = keysIn(wiring!).filter((k) => k.startsWith("device:bootAction["));
    expect(bootActions.length).toBeGreaterThan(0);
    expect(bootActions.length).toBeLessThanOrEqual(8);
    const leftovers = sections.find((s) => s.label === FALLTHROUGH_LABEL);
    expect(keysIn(leftovers ?? { label: "", kind: "group" }).filter((k) =>
      k.startsWith("device:bootAction["))).toEqual([]);
  });

  /** The bug this replaces: thirteen deliberately grouped fields in the "Other settings" bucket. */
  it("leaves none of them in the fallthrough", () => {
    const leftovers = sections.find((s) => s.label === FALLTHROUGH_LABEL);
    const stray = keysIn(leftovers ?? { label: "", kind: "group" }).filter((k) =>
      [...PINS, ...POLARITIES].includes(k),
    );
    expect(stray).toEqual([]);
  });

  /**
   * The two capture settings moved to the RPM Log tab, next to the buttons that read the result.
   *
   * Moving a field out of the form is two steps, and doing only the first is the bug: drop it from
   * its section and it reappears in "Other settings", because the trailing section exists so
   * nothing added in firmware can silently vanish. Claiming it in RENDERED_ELSEWHERE is what keeps
   * both properties - it renders once, somewhere better, and the place it went is written down.
   */
  it("moves the capture settings off the device form without dropping them into the fallthrough", () => {
    const capture = ["device:useRpmLogging", "device:rpmLogLength"];

    for (const key of capture) {
      expect(RENDERED_ELSEWHERE[key]).toBeDefined();
    }

    // Nowhere in the device form at all - not in a section of their own, not in the fallthrough.
    const everywhere = sections.flatMap((section) => keysIn(section));
    expect(everywhere.filter((k) => capture.includes(k))).toEqual([]);

    const leftovers = sections.find((s) => s.label === FALLTHROUGH_LABEL);
    expect(keysIn(leftovers ?? { label: "", kind: "group" }).filter((k) => capture.includes(k)))
      .toEqual([]);

    // And they are still real nodes in the schema, or the RPM tab would render nothing at all -
    // which is the failure this would otherwise look exactly like.
    const inSchema: string[] = [];
    walk(schema.tree, (node) => {
      if (node.key && capture.includes(node.key)) inSchema.push(node.key);
    });
    expect(inSchema.sort()).toEqual([...capture].sort());
  });

  it("renders every pin through the pin display hint, not as a bare number", () => {
    const pins: SchemaNode[] = [];
    const visit = (node: SchemaNode) => {
      if (node.key && PINS.includes(node.key)) pins.push(node);
      for (const child of node.children ?? []) visit(child);
    };
    visit(wiring!);
    expect(pins).toHaveLength(PINS.length);
    expect(pins.every((p) => p.display === "pin")).toBe(true);
  });
});

/**
 * The rules block is prose about firmware behaviour, so nothing ties it to the schema at compile
 * time. A rule pinned to a key that no longer exists would simply stop appearing, silently, which
 * is how documentation rots.
 */
describe("the wiring rules", () => {
  const pinKeys = (() => {
    const out = new Set<string>();
    walk(schema.tree, (node) => {
      if (node.display === "pin" && node.key) out.add(node.key);
    });
    return out;
  })();

  it("pins every keyed rule to a pin row that exists", () => {
    const keyed = WIRING_RULES.filter((r) => r.field).map((r) => r.field!);
    expect(keyed.length).toBeGreaterThan(0);

    // `select0Pin` predates MOH-16, so it is in every fixture and can be checked outright.
    expect(pinKeys).toContain("device:select0Pin");

    // The rest arrived with MOH-16 and the fixture is a capture, so it only carries them once it
    // has been re-dumped. Asserted in full when it has been; the presence of `batteryAdcPin` is
    // what says so. A rule pointing at a row a current fixture lacks would never render.
    if (pinKeys.has("device:batteryAdcPin")) {
      expect(keyed.filter((k) => !pinKeys.has(k))).toEqual([]);
    }
  });

  it("finds the rule for a row that has one, and nothing for a row that does not", () => {
    expect(ruleFor("device:select0Pin")).toMatch(/mode button/i);
    expect(ruleFor("device:triggerSwitchPin")).toBeUndefined();
    expect(ruleFor(undefined)).toBeUndefined();
  });

  it("says that select 0 doubles as the mode button, and that sharing the menu pin is allowed", () => {
    const rule = ruleFor("device:select0Pin")!;
    expect(rule).toMatch(/Button/);
    expect(rule).toMatch(/same GPIO as the Menu Button/i);
    expect(rule).toMatch(/not a conflict/i);
  });
});

describe("describing a pin conflict", () => {
  const labels = labelsByField(schema);

  const entry = (over: Partial<PinConflict>): PinConflict => ({
    field: "triggerSwitchPin",
    pin: 15,
    against: "i2cScl",
    action: "pinCleared",
    ...over,
  });

  it("names the losing field the way the form labels it", () => {
    expect(labels.get("triggerSwitchPin")).toBe("Trigger Pin");
    expect(describeConflict(entry({}), labels)).toContain("Trigger Pin is GPIO 15");
  });

  it("names a board fixture by its own spelling, having no row to borrow from", () => {
    expect(describeConflict(entry({}), labels)).toContain("i2cScl");
  });

  it("labels both sides when one settings pin loses to another", () => {
    const text = describeConflict(entry({ against: "menuButtonPin" }), labels);
    expect(text).toContain("Trigger Pin");
    expect(text).toContain("Menu Button Pin");
  });

  /** PIN_NOT_USED is "there was no pin", not pin 255 - a motor whose ESC channel is unwired. */
  it("does not invent a GPIO 255", () => {
    const text = describeConflict(
      entry({ field: "motor3", pin: 255, against: "unwired", action: "motorDisabled" }),
      labels,
    );
    expect(text).not.toContain("255");
    expect(text).toContain("no ESC pin");
  });

  /**
   * The two capability verdicts read differently from a collision, and have to: a collision names
   * two things the user chose, and a capability names one thing the silicon does not offer. Saying
   * "i2cPair already claims it" would send somebody looking for a second setting that does not
   * exist.
   */
  it("explains a capability verdict rather than naming it as a rival claim", () => {
    const adc = describeConflict(
      entry({ field: "batteryAdcPin", pin: 5, against: "notAnAdcPin" }),
      labels,
    );
    expect(adc).toContain("GPIO 26-29");
    expect(adc).not.toContain("already claims");

    const i2c = describeConflict(
      entry({ field: "i2cSdaPin", pin: 14, against: "i2cPair", action: "displayOff" }),
      labels,
    );
    expect(i2c).toContain("pin % 4");
    expect(i2c).toContain("setSDA");
  });

  /**
   * An advisory took nothing away, so it must not read as though something was lost. Nothing in the
   * firmware records one, so this exercises the fallback wording - the case that has to hold when
   * an advisory arrives before this console knows its name.
   */
  it("says a warning changed nothing", () => {
    const text = describeConflict(
      entry({ field: "cycleSwitchPin", pin: 24, against: "advisoryX", action: "pinWarning" }),
      labels,
    );
    expect(text).toContain("Nothing was changed");
    expect(text).toContain("advisoryX");
    expect(text).not.toContain("detached");
  });

  it("says something rather than nothing for an action it has no wording for", () => {
    const text = describeConflict(
      entry({ action: "somethingNew" as PinConflict["action"] }),
      labels,
    );
    expect(text).toContain("Trigger Pin");
    expect(text).toContain("somethingNew");
  });
});

describe("grouping wiring into one row per control", () => {
  const rows = collectWiring(schema);

  it("gives every pin a row, named without the word Pin", () => {
    expect(rows.filter((r) => r.pin)).toHaveLength(PINS.length);
    expect(rows.map((r) => r.label)).toContain("Trigger");
    expect(rows.map((r) => r.label)).not.toContain("Trigger Pin");
  });

  it("pairs a pin with its own polarity flag, by stored key", () => {
    const trigger = rows.find((r) => r.pin?.key === "device:triggerSwitchPin");
    expect(trigger?.polarity?.key).toBe("device:triggerSwitchNormallyClosed");
  });

  /** The select lines encode a position rather than being pressed, so they have no polarity. */
  it("leaves the select lines without one, rather than inventing a match", () => {
    const select0 = rows.find((r) => r.pin?.key === "device:select0Pin");
    expect(select0).toBeDefined();
    expect(select0!.polarity).toBeUndefined();
  });

  /**
   * Boot actions carry only an index, and the index order is the firmware's bootButton_t - not
   * something this console should hold a second copy of - so they are matched on the label.
   */
  it("pairs a boot action with its control despite the labels differing", () => {
    const rev = rows.find((r) => r.pin?.key === "device:revSwitchPin");
    expect(rev?.bootAction?.label).toBe("Rev Switch");
    const menu = rows.find((r) => r.pin?.key === "device:menuButtonPin");
    expect(menu?.bootAction?.label).toBe("Menu Button");
  });

  it("never hands one boot action to two controls", () => {
    const used = rows.map((r) => r.bootAction?.key).filter(Boolean);
    expect(new Set(used).size).toBe(used.length);
  });

  it("puts every pin row before any unmatched leftover", () => {
    const lastPin = rows.map((r) => Boolean(r.pin)).lastIndexOf(true);
    expect(rows.slice(0, lastPin + 1).every((r) => r.pin)).toBe(true);
  });
});
