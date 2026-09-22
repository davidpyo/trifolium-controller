// @vitest-environment jsdom

// `retired` is a promise about a list nothing else can see: the flag lived on the board and the
// filtered export existed, but the dropdown mapped the unfiltered one, so a retired board was
// still offered. Only a mounted picker can tell the two apart, which is why this renders it.

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Preset } from "../schema/presets";

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
const gone = preset("gone_board", true);

// No board this console ships is retired, so the case only exists against a made-up set.
vi.mock("../schema/presets", async (importOriginal) => {
  const real = await importOriginal<typeof import("../schema/presets")>();
  return { ...real, PRESETS: [live, gone], OFFERED_PRESETS: [live] };
});

const { PresetPicker } = await import("./PresetPicker");

/** Mounts the picker, opens its Board dropdown, and returns the option labels. */
async function optionsFor(suggested?: Preset): Promise<string[]> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  await act(async () => {
    root.render(
      <PresetPicker
        busy={false}
        suggested={suggested}
        storedBoardId={suggested?.id}
        onApply={() => {}}
        onCustom={() => {}}
      />,
    );
  });

  const trigger = host.querySelector('[role="combobox"]');
  expect(trigger).not.toBeNull();
  await act(async () => {
    trigger!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  });

  const labels = [...document.querySelectorAll('[role="option"]')].map(
    (el) => el.textContent ?? "",
  );

  await act(async () => root.unmount());
  host.remove();
  return labels;
}

describe("which boards the picker offers", () => {
  it("leaves a retired board out", async () => {
    const labels = await optionsFor();
    expect(labels).toContain("live_board");
    expect(labels).not.toContain("gone_board");
  });

  it("offers one anyway when the device reported it", async () => {
    // The upgrade path is the whole reason a retired board is still recognised - a picker that
    // suggested it and then could not show it would select nothing.
    const labels = await optionsFor(gone);
    expect(labels).toContain("gone_board");
    expect(labels).toContain("live_board");
  });
});
