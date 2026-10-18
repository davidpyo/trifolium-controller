// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import fixtureSchema from "../fixtures/schema.json";
import type { Schema } from "../schema/types";
import { FireModes } from "./FireModes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = fixtureSchema as unknown as Schema;

/** The fixture as a dual-stage blaster describes itself: Half Press offered except on SAFE and PLASMA. */
function dualStage(schema: Schema): Schema {
  const visibleFor = (burstMode: string) => burstMode !== "safe" && burstMode !== "plasma";
  const walk = (nodes: Schema["tree"]): Schema["tree"] =>
    nodes.map((node) => {
      const next = { ...node };
      if (next.key?.endsWith(".revStageMode")) delete next.visible;
      if (next.children) next.children = walk(next.children);
      return next;
    });
  return {
    ...schema,
    tree: walk(schema.tree),
    fireModeCaps: schema.fireModeCaps!.map((cap) => ({
      ...cap,
      fields: cap.fields.map((f) =>
        f.key.endsWith(".revStageMode") ? { ...f, visible: visibleFor(cap.burstMode) } : f,
      ),
    })),
  };
}

const MODES = [
  { name: "", burstMode: "auto", burstLength: 100, revStageMode: 2 },
  { name: "", burstMode: "safe", revStageMode: -1 },
  { name: "Tap", burstMode: "semi", revStageMode: -1 },
];

function profile(modes = MODES) {
  return { activeModeCount: modes.length, defaultFiringMode: 0, fireModes: modes };
}

async function render(schema: Schema, onReplaceModes: (modes: unknown[]) => void = () => {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <FireModes schema={schema} profile={profile()} onEdit={() => {}} onReplaceModes={onReplaceModes} />,
    ),
  );
  const headers = [...host.querySelectorAll("thead th")].map((th) => th.textContent?.trim() ?? "");
  const rows = [...host.querySelectorAll("tbody tr")].map((tr) =>
    [...tr.querySelectorAll("td")].map((cell) => (cell.textContent ?? "").replace(/​/g, "").trim()),
  );
  return {
    headers,
    rows,
    host,
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("FireModes Half Press column", () => {
  it("is left out when no mode can take a half press", async () => {
    const view = await render(fixture);
    expect(view.headers).not.toContain("Half Press");
    await view.unmount();
  });

  it("names the paired mode from the list as edited, and is a dash where it does not apply", async () => {
    const view = await render(dualStage(fixture));
    const column = view.headers.indexOf("Half Press");
    expect(column).toBeGreaterThan(-1);
    expect(view.rows[0][column]).toBe("Tap");
    expect(view.rows[1][column]).toBe("—");
    expect(view.rows[2][column]).toBe("Rev Only");
    await view.unmount();
  });

  it("repoints every pairing when a mode is deleted", async () => {
    let replaced: { revStageMode?: number }[] = [];
    const view = await render(dualStage(fixture), (modes) => {
      replaced = modes as typeof replaced;
    });
    const deleteSafe = view.host.querySelectorAll("tbody tr")[1].querySelectorAll("button")[1];
    await act(async () => (deleteSafe as HTMLButtonElement).click());
    expect(replaced.map((m) => m.revStageMode)).toEqual([1, -1]);
    await view.unmount();
  });
});
