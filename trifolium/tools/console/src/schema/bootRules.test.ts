import { describe, expect, it } from "vitest";
import {
  bootRuleKeys,
  parseBootRuleKey,
  readBootRules,
  shadowedBy,
  moveEdits,
  type BootRule,
} from "./bootRules";

const rule = (action: string, ...on: string[]): BootRule => ({ action, on });

describe("readBootRules", () => {
  it("reads each slot's action and the switches it names", () => {
    const device = {
      bootRules: [
        { action: "bootloader", menu: true, trigger: false },
        { action: "profile_1", trigger: true, rev: true },
      ],
    };
    expect(readBootRules(device, 3)).toEqual([
      rule("bootloader", "menu"),
      rule("profile_1", "trigger", "rev"),
      rule("none"),
    ]);
  });
});

describe("shadowedBy", () => {
  it("flags a rule an earlier subset always beats", () => {
    expect(shadowedBy([rule("bootloader", "menu"), rule("idle_hold", "menu", "trigger")])).toEqual([
      null,
      0,
    ]);
  });

  it("leaves the narrower rule alone when it comes first", () => {
    expect(shadowedBy([rule("idle_hold", "menu", "trigger"), rule("bootloader", "menu")])).toEqual([
      null,
      null,
    ]);
  });

  it("ignores empty slots and rules that name no switch", () => {
    expect(
      shadowedBy([rule("none", "menu"), rule("bootloader"), rule("idle_hold", "menu", "rev")]),
    ).toEqual([null, null, null]);
  });

  it("flags an exact duplicate", () => {
    expect(shadowedBy([rule("bootloader", "rev"), rule("profile_0", "rev")])).toEqual([null, 0]);
  });
});

describe("moveEdits", () => {
  it("writes every leaf of both slots, so a switch one rule named is cleared on the other", () => {
    const edits = new Map(moveEdits([rule("bootloader", "menu"), rule("idle_hold", "trigger")], 0, 1));
    expect(edits.get("device:bootRules[0].action")).toBe("idle_hold");
    expect(edits.get("device:bootRules[0].trigger")).toBe(true);
    expect(edits.get("device:bootRules[0].menu")).toBe(false);
    expect(edits.get("device:bootRules[1].action")).toBe("bootloader");
    expect(edits.get("device:bootRules[1].menu")).toBe(true);
    expect(edits.get("device:bootRules[1].trigger")).toBe(false);
  });

  it("shifts the rules between the two places, and leaves the rest alone", () => {
    const rules = [
      rule("bootloader", "menu"),
      rule("esc_passthrough", "trigger"),
      rule("idle_hold", "rev"),
      rule("profile_0", "idle"),
    ];
    const edits = new Map(moveEdits(rules, 2, 0));
    expect(edits.get("device:bootRules[0].action")).toBe("idle_hold");
    expect(edits.get("device:bootRules[1].action")).toBe("bootloader");
    expect(edits.get("device:bootRules[2].action")).toBe("esc_passthrough");
    expect([...edits.keys()].some((k) => k.startsWith("device:bootRules[3]"))).toBe(false);
  });

  it("is nothing for a rule dropped where it already is, or off the list", () => {
    const rules = [rule("bootloader", "menu"), rule("idle_hold", "trigger")];
    expect(moveEdits(rules, 1, 1)).toEqual([]);
    expect(moveEdits(rules, 0, 5)).toEqual([]);
  });
});

describe("keys", () => {
  it("parses only boot-rule keys", () => {
    expect(parseBootRuleKey("device:bootRules[3].select0")).toEqual({ rule: 3, leaf: "select0" });
    expect(parseBootRuleKey("device:bootAction[3]")).toBeNull();
  });

  it("claims an action and seven switches per rule", () => {
    expect(bootRuleKeys(2)).toHaveLength(16);
    expect(bootRuleKeys()).toContain("device:bootRules[7].select2");
  });
});
