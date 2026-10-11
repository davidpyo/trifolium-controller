// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import fixtureDevice from "../fixtures/device.json";
import fixtureProfile from "../fixtures/profile0.json";
import fixtureSchema from "../fixtures/schema.json";
import type { Schema } from "../schema/types";
import { RpmStages } from "./RpmStages";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function textWith(device: unknown): Promise<string> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <RpmStages
        schema={fixtureSchema as unknown as Schema}
        device={device}
        profile={fixtureProfile}
        onEdit={() => {}}
      />,
    ),
  );
  const text = host.textContent ?? "";
  await act(async () => root.unmount());
  host.remove();
  return text;
}

describe("the RPM editor with a speed pot", () => {
  it("leaves the rev RPM to the pot and still edits the idle RPM", async () => {
    const text = await textWith({ ...fixtureDevice, speedPotPin: 27 });
    expect(text).toContain("A speed pot is wired");
    expect(text).not.toMatch(/Rev RPM, (by stage|per motor)/);
    expect(text).toMatch(/Idle RPM, (by stage|per motor)/);
  });

  it("edits the rev RPM itself with no pot wired", async () => {
    const text = await textWith({ ...fixtureDevice, speedPotPin: 255 });
    expect(text).not.toContain("A speed pot is wired");
    expect(text).toMatch(/Rev RPM, (by stage|per motor)/);
  });
});
