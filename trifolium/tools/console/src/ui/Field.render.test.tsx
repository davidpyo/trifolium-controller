// @vitest-environment jsdom

// The arrow keys are the one path that moves a value without a text commit, so they are the one
// path that can skip the float conversion. ArrowUp on a KP of 0.2 wrote 10 - five times the
// field's own ceiling, on a PID gain - because the value was real and the grid was scaled.

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { SchemaNode } from "../schema/types";
import { FieldControl } from "./Field";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// KP as the device publishes it: real range 0.0-2.0 step 0.1, bounds scaled by 10^2.
const kp: SchemaNode = {
  label: "KP",
  kind: "float",
  key: "device:motorConfig[0].kp",
  lo: 0,
  hi: 200,
  step: 10,
  decimals: 2,
};

const dwell: SchemaNode = {
  label: "Dwell Time",
  kind: "int",
  key: "profile:dwellTime_ms",
  lo: 0,
  hi: 5000,
  step: 100,
};

/** Mounts one field, presses a key on its input, and returns what onChange was given. */
async function press(node: SchemaNode, value: number, key: string): Promise<unknown> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onChange = vi.fn();

  await act(async () => {
    root.render(<FieldControl node={node} value={value} onChange={onChange} />);
  });

  const input = host.querySelector("input");
  expect(input).not.toBeNull();
  await act(async () => {
    input!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });

  await act(async () => root.unmount());
  host.remove();
  const calls = onChange.mock.calls;
  return calls.length ? calls[calls.length - 1][0] : undefined;
}

describe("stepping a field with the arrow keys", () => {
  it("moves a float by its real step", async () => {
    expect(await press(kp, 0.2, "ArrowUp")).toBeCloseTo(0.3, 5);
    expect(await press(kp, 0.2, "ArrowDown")).toBeCloseTo(0.1, 5);
  });

  it("never leaves the range the field advertises", async () => {
    expect(await press(kp, 2, "ArrowUp")).toBeCloseTo(2, 5);
    expect(await press(kp, 0, "ArrowDown")).toBeCloseTo(0, 5);
  });

  it("steps an int field on its own grid", async () => {
    expect(await press(dwell, 1000, "ArrowUp")).toBe(1100);
    expect(await press(dwell, 1000, "ArrowDown")).toBe(900);
  });
});

describe("what a float field says its range is", () => {
  it("advertises the range in real units, not bounds units", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<FieldControl node={kp} value={0.2} onChange={() => {}} />);
    });

    const input = host.querySelector("input");
    expect(input?.getAttribute("min")).toBe("0");
    expect(input?.getAttribute("max")).toBe("2");
    expect(input?.getAttribute("step")).toBe("0.1");

    await act(async () => root.unmount());
    host.remove();
  });
});
