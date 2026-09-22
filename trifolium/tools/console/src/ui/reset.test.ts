// The confirmation is the safety, so what it asks for is worth a test.
//
// The failure this guards is not a crash - it is the dialog quietly becoming uniform. Give all four
// resets the same word and the typing stops being a decision within a day; grade them all the same
// and people learn to click through the one that matters. Neither shows up as a broken render,
// which is why it is asserted rather than left to review.

import { describe, expect, it } from "vitest";
import { resetCopy, type ResetKind, type ResetPlan } from "./ResetDialog";

const PROFILE: ResetPlan = { kind: "profile", slot: 1, profileName: "Fencer" };
const DEVICE: ResetPlan = { kind: "device" };
const WIRING: ResetPlan = { kind: "wiring" };
const EVERYTHING: ResetPlan = { kind: "everything" };

/** Least destructive first - the order the menu offers them, and the order severity follows. */
const ALL = [PROFILE, DEVICE, WIRING, EVERYTHING];

describe("reset confirmations", () => {
  it("asks for a different word for each reset", () => {
    const words = ALL.map((p) => resetCopy(p).word);
    expect(new Set(words).size).toBe(words.length);
  });

  it("names what is being reset rather than a constant", () => {
    expect(resetCopy(WIRING).word).toBe("WIRING");
    expect(resetCopy(DEVICE).word).toBe("DEVICE");
    expect(resetCopy(EVERYTHING).word).toBe("EVERYTHING");
    // The slot's own name, so the word matches the thing on screen.
    expect(resetCopy(PROFILE).word).toBe("FENCER");
  });

  it("falls back to the slot number when a profile has no name", () => {
    expect(resetCopy({ kind: "profile", slot: 2 }).word).toBe("SLOT3");
    expect(resetCopy({ kind: "profile", slot: 0, profileName: "   " }).word).toBe("SLOT1");
  });

  it("grades the warning, rather than alarming equally at everything", () => {
    // One slot of tuning against the other three, which each take settings or pins away for good.
    expect(resetCopy(PROFILE).severity).toBe("warning");
    expect(resetCopy(DEVICE).severity).toBe("error");
    expect(resetCopy(WIRING).severity).toBe("error");
    expect(resetCopy(EVERYTHING).severity).toBe("error");
  });

  it("never softens as the list gets more destructive", () => {
    // The menu is ordered least to most, so severity may only hold or climb down that list. A
    // reorder that put a mild one last would read as an escalation it is not.
    const rank = { warning: 0, error: 1 } as const;
    const grades = ALL.map((p) => rank[resetCopy(p).severity]);
    expect(grades).toEqual([...grades].sort((a, b) => a - b));
  });

  it("says what survives, not only what goes", () => {
    // The device reset preserves wiring by the firmware's own no-OLED-row rule, and a user who
    // does not know that will not risk the reset at all.
    expect(resetCopy(DEVICE).kept).toMatch(/wiring/i);
    expect(resetCopy(DEVICE).kept).toMatch(/profile/i);
    expect(resetCopy(WIRING).kept).toMatch(/profile/i);
    expect(resetCopy(PROFILE).kept).toMatch(/other profile/i);
  });

  it("admits that Everything does not include the wiring", () => {
    // FACTORY_RESET_ALL routes through factoryResetSettings(), which preserves the pins exactly as
    // a device reset does. The label promises more than the command delivers, so the copy has to
    // say so - otherwise somebody resets everything and then wonders why their wiring is still odd.
    expect(resetCopy(EVERYTHING).kept).toMatch(/wiring/i);
    expect(resetCopy(EVERYTHING).kept).toMatch(/survive/i);
  });

  it("gives each one its own title and button", () => {
    const titles = ALL.map((p) => resetCopy(p).title);
    expect(new Set(titles).size).toBe(titles.length);
    const actions = ALL.map((p) => resetCopy(p).action);
    expect(new Set(actions).size).toBe(actions.length);
    expect(resetCopy(PROFILE).title).toContain("Fencer");
  });

  it("covers every kind the type allows", () => {
    // A fifth kind added without copy would fall through to the profile branch and confirm with a
    // profile's word, which is the quiet failure rather than a crash.
    const kinds: ResetKind[] = ["profile", "device", "wiring", "everything"];
    expect(ALL.map((p) => p.kind).sort()).toEqual([...kinds].sort());
    for (const plan of ALL) {
      expect(resetCopy(plan).word.length).toBeGreaterThan(0);
      expect(resetCopy(plan).title.length).toBeGreaterThan(0);
    }
  });
});
