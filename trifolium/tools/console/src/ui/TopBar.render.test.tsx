// @vitest-environment jsdom

// From 2.1.1 a device log line waits for the reply it would have split, so verbose logging is only
// extra output there. The warning to turn it off is for older firmware, where it is still true.

import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { TopBar, garblingFirmware, type TopBarProps } from "./TopBar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => {};

/** Mounts the top bar and returns its text. */
async function textWith(overrides: Partial<TopBarProps> = {}): Promise<string> {
  const props: TopBarProps = {
    live: true,
    busy: false,
    fw: "2.2.1",
    supported: true,
    asksEveryTime: false,
    blasterName: "Test",
    onBlasterName: noop,
    wiringLabel: "v1.2",
    onConnect: noop,
    onDisconnect: noop,
    onFlash: noop,
    ...overrides,
  };

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<TopBar {...props} />));
  const text = host.textContent ?? "";
  await act(async () => root.unmount());
  host.remove();
  return text;
}

describe("the verbose logging warning", () => {
  it("is not raised on firmware whose log lines wait for replies", () => {
    for (const fw of ["2.1.1", "2.2.0", "3.0.0"]) expect(garblingFirmware(true, fw)).toBeNull();
  });

  it("is raised on older firmware while verbose is on", () => {
    expect(garblingFirmware(true, "2.1.0")).toBe("2.1.0");
  });

  it("is not raised on older firmware while verbose is off, or with nothing connected", () => {
    expect(garblingFirmware(false, "2.1.0")).toBeNull();
    expect(garblingFirmware(true, null)).toBeNull();
  });
});

describe("the connection", () => {
  const offline = { live: false, fw: null };

  it("names the firmware once connected", async () => {
    expect(await textWith()).toContain("Connected · fw 2.2.1");
  });

  it("offers Choose Device beside Connect where the browser remembers a blaster", async () => {
    const text = await textWith(offline);
    expect(text).toContain("Connect");
    expect(text).toContain("Choose Device");
  });

  it("is Connect alone where the browser asks every time, as Android does", async () => {
    const text = await textWith({ ...offline, asksEveryTime: true });
    expect(text).toContain("Connect");
    expect(text).not.toContain("Choose Device");
  });
});
