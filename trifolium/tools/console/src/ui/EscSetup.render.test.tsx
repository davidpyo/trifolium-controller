// @vitest-environment jsdom

// The panel is folded away, so the numbers it names are only ever seen after a click - and they are
// derived rather than typed, which is exactly the pair a unit test on the arithmetic cannot cover.

import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { EscSetup } from "./EscSetup";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const device = {
  motorConfig: [
    { enabled: true, motorPolesDiv2: 7, motorKv: 3200 },
    { enabled: true, motorPolesDiv2: 7, motorKv: 3200 },
  ],
};

interface Mounted {
  /** The summary line, triangle included. */
  summary: string;
  /** Whether the body is folded away. Collapse hides its children rather than unmounting them. */
  folded: boolean;
  text: string;
  links: string[];
}

const read = (host: HTMLElement): Mounted => ({
  summary: host.querySelector("button")?.textContent ?? "",
  folded: !!host.querySelector(".MuiCollapse-hidden"),
  text: host.textContent ?? "",
  links: [...host.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? ""),
});

/** Mounts the panel and returns what it shows before and after the summary is clicked. */
async function openPanel(): Promise<{ closed: Mounted; open: Mounted }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  await act(async () => root.render(<EscSetup device={device} />));
  const closed = read(host);

  const summary = host.querySelector("button");
  expect(summary).not.toBeNull();
  await act(async () => {
    summary!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  const open = read(host);

  await act(async () => root.unmount());
  host.remove();
  return { closed, open };
}

describe("the AM32 panel", () => {
  it("starts folded, on a summary that says what it is", async () => {
    const { closed, open } = await openPanel();
    expect(closed.folded).toBe(true);
    expect(closed.summary).toContain("Setting up the ESCs in AM32");
    expect(open.folded).toBe(false);
  });

  it("names the two settings and links am32.ca", async () => {
    const { open } = await openPanel();
    expect(open.text).toContain("Stuck rotor protection");
    expect(open.text).toContain("Stall protection");
    expect(open.text).toContain("Motor poles");
    expect(open.text).toContain("Motor KV");
    expect(open.links).toContain("https://am32.ca/");
  });

  it("carries the device's own numbers, poles already doubled", async () => {
    const { open } = await openPanel();
    expect(open.text).toContain("14 poles, 3200 Kv");
  });
});
