import { describe, expect, it } from "vitest";
import type { Schema, SchemaNode } from "./types";
import { isVisible } from "./types";
import { resolveNodes, resolveVisibility, ruleHolds, termHolds } from "./visibility";
import fixtureSchema from "../fixtures/schema.json";
import fixtureDevice from "../fixtures/device.json";
import fixtureProfile0 from "../fixtures/profile0.json";

const payloads = (device: unknown, profile: unknown = {}) => ({ device, profile });

describe("termHolds", () => {
  it("compares an enum against its stored id", () => {
    const p = payloads({ selectFireType: "switch" });
    expect(termHolds({ key: "device:selectFireType", op: "eq", value: "switch" }, p)).toBe(true);
    expect(termHolds({ key: "device:selectFireType", op: "eq", value: "button" }, p)).toBe(false);
  });

  it("normalises a JSON boolean to the spelling the rule uses", () => {
    const p = payloads({ useRpmBaseShotCounter: true });
    expect(termHolds({ key: "device:useRpmBaseShotCounter", op: "eq", value: "true" }, p)).toBe(
      true,
    );
    expect(termHolds({ key: "device:useRpmBaseShotCounter", op: "eq", value: "false" }, p)).toBe(
      false,
    );
  });

  it("inverts for ne", () => {
    const p = payloads({ selectFireType: "off" });
    expect(termHolds({ key: "device:selectFireType", op: "ne", value: "off" }, p)).toBe(false);
    expect(termHolds({ key: "device:selectFireType", op: "ne", value: "switch" }, p)).toBe(true);
  });

  it("reads a profile term out of the profile payload", () => {
    const p = payloads({ rpmMode: "custom" }, { rpmMode: "stage" });
    expect(termHolds({ key: "profile:rpmMode", op: "eq", value: "stage" }, p)).toBe(true);
  });

  it("is null when the key names nothing, rather than guessing false", () => {
    expect(termHolds({ key: "device:notAField", op: "eq", value: "x" }, payloads({}))).toBeNull();
  });
});

describe("ruleHolds", () => {
  const p = payloads({ variableFPS: true, selectFireType: "switch" });

  it("ANDs its terms", () => {
    expect(
      ruleHolds(
        [
          { key: "device:variableFPS", op: "eq", value: "true" },
          { key: "device:selectFireType", op: "eq", value: "switch" },
        ],
        p,
      ),
    ).toBe(true);
    expect(
      ruleHolds(
        [
          { key: "device:variableFPS", op: "eq", value: "true" },
          { key: "device:selectFireType", op: "eq", value: "button" },
        ],
        p,
      ),
    ).toBe(false);
  });

  it("is null when any one term is unreadable, even if another already decided it", () => {
    expect(
      ruleHolds(
        [
          { key: "device:selectFireType", op: "eq", value: "button" },
          { key: "device:notAField", op: "eq", value: "true" },
        ],
        p,
      ),
    ).toBeNull();
  });

  it("is null for a node with no rule", () => {
    expect(ruleHolds(undefined, p)).toBeNull();
    expect(ruleHolds([], p)).toBeNull();
  });
});

describe("resolveNodes", () => {
  const ruled = (visible?: false): SchemaNode => ({
    label: "Throttle Cap",
    kind: "int",
    key: "device:throttleCap",
    visible,
    visibleWhen: [{ key: "device:flywheelControl", op: "eq", value: "tbh" }],
  });

  it("reveals a row whose rule now holds", () => {
    const [node] = resolveNodes([ruled(false)], payloads({ flywheelControl: "tbh" }));
    expect(isVisible(node)).toBe(true);
    // Absent rather than `true`: everything downstream reads the wire encoding.
    expect("visible" in node).toBe(false);
  });

  it("hides a row whose rule no longer holds", () => {
    const [node] = resolveNodes([ruled()], payloads({ flywheelControl: "pid" }));
    expect(node.visible).toBe(false);
  });

  /** The interface the firmware states by omission: no rule means do not re-derive. */
  it("leaves a row with no rule exactly as the device sent it", () => {
    const bootAction: SchemaNode = {
      label: "Menu Button",
      kind: "enum",
      key: "device:bootAction[0]",
      visible: false,
    };
    const [node] = resolveNodes([bootAction], payloads({ menuButtonPin: 19 }));
    expect(node).toBe(bootAction);
    expect(node.visible).toBe(false);
  });

  it("keeps the device's answer when the rule cannot be read", () => {
    const [node] = resolveNodes([ruled(false)], payloads({}));
    expect(node.visible).toBe(false);
  });

  it("descends into children", () => {
    const group: SchemaNode = { label: "PID", kind: "group", children: [ruled(false)] };
    const [node] = resolveNodes([group], payloads({ flywheelControl: "tbh" }));
    expect(isVisible(node.children![0])).toBe(true);
  });

  it("returns the same array when no rule moved anything", () => {
    const nodes = [ruled(false)];
    expect(resolveNodes(nodes, payloads({ flywheelControl: "pid" }))).toBe(nodes);
  });
});

describe("against the checked-in capture", () => {
  const schema = fixtureSchema as unknown as Schema;
  const p = payloads(fixtureDevice, fixtureProfile0);

  /**
   * Every rule must reproduce the device's own `visible` flag. If it does not, the console would
   * show different rows between dumps and nothing on the device would ever notice.
   */
  it("reproduces every flag the device emitted", () => {
    const disagreements: string[] = [];
    const visit = (nodes: SchemaNode[]) => {
      for (const node of nodes) {
        if (node.visibleWhen) {
          const held = ruleHolds(node.visibleWhen, p);
          if (held !== null && held !== isVisible(node)) {
            disagreements.push(`${node.key ?? node.label}: rule ${held}, device ${isVisible(node)}`);
          }
        }
        if (node.children) visit(node.children);
      }
    };
    visit(schema.tree);
    expect(disagreements).toEqual([]);
  });

  it("hides the select-fire rows once the capture's switch type changes", () => {
    const off = resolveVisibility(schema, payloads({ ...fixtureDevice, selectFireType: "off" }, fixtureProfile0));
    const find = (nodes: SchemaNode[], key: string): SchemaNode | null => {
      for (const node of nodes) {
        if (node.key === key) return node;
        const hit = node.children ? find(node.children, key) : null;
        if (hit) return hit;
      }
      return null;
    };
    // Visible in the capture, and its rule is `selectFireType != off`.
    expect(isVisible(find(schema.tree, "device:variableFPS")!)).toBe(true);
    expect(isVisible(find(off.tree, "device:variableFPS")!)).toBe(false);
  });
});

/**
 * The Display group follows Display Attached.
 *
 * The rule is stated in firmware (`menuDevice.cpp`) rather than invented here, so this asserts the
 * console honours it the moment the box is unticked - not on the next dump, and not only on rows
 * the device happened to have hidden when it built the schema.
 */
describe("display rows follow the panel being fitted", () => {
  const rule = [{ key: "device:hasDisplay", op: "eq" as const, value: "true" }];
  const displayRows: SchemaNode[] = [
    { label: "Display Attached", kind: "bool", key: "device:hasDisplay" },
    { label: "Home Screen", kind: "enum", key: "device:homeScreenDisplayMode", visibleWhen: rule },
    { label: "Brightness", kind: "int", key: "device:displayBrightness", visibleWhen: rule },
    { label: "Rotate Display", kind: "bool", key: "device:rotateDisplay", visibleWhen: rule },
  ];

  it("shows them while a panel is fitted", () => {
    const out = resolveNodes(displayRows, payloads({ hasDisplay: true }));
    expect(out.filter(isVisible).map((n) => n.label)).toEqual([
      "Display Attached",
      "Home Screen",
      "Brightness",
      "Rotate Display",
    ]);
  });

  it("hides everything but the checkbox once it is unticked", () => {
    const out = resolveNodes(displayRows, payloads({ hasDisplay: false }));
    expect(out.filter(isVisible).map((n) => n.label)).toEqual(["Display Attached"]);
  });

  /** Unticking it must never hide the control that puts it back. */
  it("never hides the checkbox itself", () => {
    for (const fitted of [true, false]) {
      const out = resolveNodes(displayRows, payloads({ hasDisplay: fitted }));
      expect(isVisible(out[0])).toBe(true);
    }
  });
});
