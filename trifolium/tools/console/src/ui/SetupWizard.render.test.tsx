// @vitest-environment jsdom

// `retired` is a promise about a list nothing else can see: the flag lived on the board and the
// filtered export existed, but the list mapped the unfiltered one, so a retired board was still
// offered. Only a mounted wizard can tell the two apart, which is why this renders it.

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Preset } from "../schema/presets";
import type { Schema } from "../schema/types";
import type { SetupWizardProps } from "./SetupWizard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const preset = (id: string, retired = false): Preset => ({
  id,
  name: id,
  schemaVersion: 3,
  notes: [],
  aliases: [],
  retired,
  wiring: {},
});

const live = preset("live_board");
const other = preset("other_board");
const gone = preset("gone_board", true);

// No board this console ships is retired, so the case only exists against a made-up set.
vi.mock("../schema/presets", async (importOriginal) => {
  const real = await importOriginal<typeof import("../schema/presets")>();
  return { ...real, PRESETS: [live, other, gone], OFFERED_PRESETS: [live, other] };
});

const { SetupWizard } = await import("./SetupWizard");

/** Mounts the wizard, hands its host to `look`, and unmounts it again. */
async function mounted<T>(
  props: Partial<SetupWizardProps>,
  look: (host: HTMLElement) => T | Promise<T>,
) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <SetupWizard
        busy={false}
        schema={{} as Schema}
        onApply={() => {}}
        onCustom={() => {}}
        {...props}
      />,
    );
  });
  try {
    return await look(host);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
}

const radios = (host: HTMLElement, group: string) =>
  [
    ...host.querySelectorAll(`[role="radiogroup"][aria-label="${group}"] [role="radio"]`),
  ] as HTMLElement[];
const names = (els: HTMLElement[]) => els.map((el) => el.getAttribute("aria-label"));
const steps = (host: HTMLElement) =>
  [...host.querySelectorAll('ol[aria-label="Steps"] li')].map((li) =>
    li.textContent?.replace(/^\d/, ""),
  );
const button = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label) as HTMLButtonElement;
const click = (el: HTMLElement) => act(async () => el.click());

describe("which boards the wizard offers", () => {
  it("leaves a retired board out", async () => {
    const offered = await mounted({}, (host) => names(radios(host, "Board")));
    expect(offered).toEqual(["live_board", "other_board"]);
  });

  it("offers one anyway when the device reported it, and selects it", async () => {
    // The upgrade path is the whole reason a retired board is still recognised - a wizard that
    // suggested it and then could not show it would select nothing.
    await mounted({ suggested: gone, storedBoardId: gone.id }, (host) => {
      const cards = radios(host, "Board");
      expect(names(cards)).toEqual(["gone_board", "live_board", "other_board"]);
      expect(cards[0].getAttribute("aria-checked")).toBe("true");
    });
  });

  it("goes no further until a board is picked", async () => {
    await mounted({}, async (host) => {
      expect(button(host, "Next").disabled).toBe(true);
      await click(radios(host, "Board")[1]);
      expect(button(host, "Next").disabled).toBe(false);
    });
  });

  it("moves the choice with the arrow keys", async () => {
    await mounted({ suggested: live }, async (host) => {
      const group = host.querySelector('[role="radiogroup"]')!;
      await act(async () => {
        group.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      });
      expect(radios(host, "Board").map((r) => r.getAttribute("aria-checked"))).toEqual([
        "false",
        "true",
      ]);
    });
  });
});

describe("the blaster config step", () => {
  it("is offered on a device with no wiring", async () => {
    expect(await mounted({ onApplyBlaster: () => {} }, steps)).toEqual([
      "Board",
      "Blaster config",
      "Review",
    ]);
  });

  it("is not offered when changing a wiring", async () => {
    // A config replaces every setting and profile, which is not what "change board" promises.
    expect(await mounted({ replacing: "live_board" }, steps)).toEqual(["Board", "Review"]);
  });
});

describe("the review step", () => {
  it("applies the board picked", async () => {
    const onApply = vi.fn();
    await mounted({ onApply }, async (host) => {
      await click(radios(host, "Board")[1]);
      await click(button(host, "Next"));
      await click(button(host, "Set up blaster"));
    });
    expect(onApply).toHaveBeenCalledWith(other);
  });

  it("confirms a change of board before it is loaded", async () => {
    const onApply = vi.fn();
    await mounted({ onApply, suggested: live, replacing: "live_board" }, async (host) => {
      await click(radios(host, "Board")[1]);
      await click(button(host, "Next"));
      expect(host.textContent).toContain("other_board in place of live_board");
      expect(onApply).not.toHaveBeenCalled();
      await click(button(host, "Load wiring"));
    });
    expect(onApply).toHaveBeenCalledWith(other);
  });
});
