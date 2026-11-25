// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import schemaJson from "../../fixtures/schema.json";
import deviceJson from "../../fixtures/device.json";
import type { Schema } from "../../schema/types";
import { diagramForBoardId } from "../../schema/wiringDiagrams";
import { buildTheme } from "../../theme";
import { HookupDiagram } from "./HookupDiagram";
import { GROUND_COLOUR, SUPPLY_COLOUR } from "./layout";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const schema = schemaJson as unknown as Schema;

const mount = (board: string | null, onHoverPin?: (gpio: number | null) => void) => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(
      <ThemeProvider theme={buildTheme("dark")}>
        <HookupDiagram
          schema={schema}
          device={deviceJson}
          diagram={board ? diagramForBoardId(board) : undefined}
          onHoverPin={onHoverPin}
        />
      </ThemeProvider>,
    );
  });
  return container;
};

describe("HookupDiagram", () => {
  it("draws the board's own picture, and tags each wire with the pad it goes on", () => {
    const container = mount("trifolium_v1_2");
    const art = container.querySelector('[data-board="art"] svg');
    expect(art).not.toBeNull();
    expect(Number(art!.getAttribute("width"))).toBeGreaterThan(0);
    expect(container.querySelector('[data-tag="trigger:NO"]')!.textContent).toBe("GP21");
    expect(container.querySelector('[data-tag="oled:VCC"]')!.textContent).toBe("VCC");
    // A tag is the colour of its wire.
    const wire = container.querySelector('[data-wire="trigger:NO"]')!.getAttribute("stroke");
    expect(container.querySelector('[data-tag="trigger:NO"] rect')!.getAttribute("fill")).toBe(wire);
    // No wire crosses a free pad, so none needs breaking round one.
    expect(container.querySelectorAll("[data-crossed]").length).toBe(0);
    // The pads themselves are named only for what is pointed at.
    expect(container.querySelector("[data-pad-labels]")!.childElementCount).toBe(0);
    act(() => {
      container.querySelector('[data-part="trigger"]')!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    const named = [...container.querySelectorAll("[data-pad-labels] text")].map((t) => t.textContent);
    expect(named.sort()).toEqual(["GND", "GP21"]);
  });

  it("draws every part, and red and black wires for power", () => {
    const container = mount("trifolium_v1_2");
    const parts = [...container.querySelectorAll("[data-part]")].map((g) => g.getAttribute("data-part"));
    expect(parts).toEqual(expect.arrayContaining(["trigger", "rev", "menu", "oled", "esc1", "esc3", "battery"]));
    const colourOf = (net: string) =>
      new Set([...container.querySelectorAll(`[data-net="${net}"]`)].map((p) => p.getAttribute("stroke")));
    expect(colourOf("gnd")).toEqual(new Set([GROUND_COLOUR]));
    expect(colourOf("vcc")).toEqual(new Set([SUPPLY_COLOUR]));
  });

  it("groups a board with no drawing's pins by the part each is for, and says so", () => {
    const container = mount(null);
    const names = [...container.querySelectorAll('[data-board="schematic"] text')].map((t) => t.textContent);
    expect(names).toEqual(expect.arrayContaining(["TRIGGER", "GP21", "GND"]));
    expect(container.textContent).toContain("has no drawing");
  });

  it("names, under the drawing, each part with a wire this board has no pin for", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      createRoot(container).render(
        <ThemeProvider theme={buildTheme("dark")}>
          <HookupDiagram schema={schema} device={{ ...deviceJson, revSwitchPin: 5 }} diagram={diagramForBoardId("trifolium_v1_2")} />
        </ThemeProvider>,
      );
    });
    expect(container.textContent).toContain("no pin for it on this board: Rev (GND, GP5)");
  });

  it("tells the table which pin a part is on as the pointer comes onto it", () => {
    const seen: (number | null)[] = [];
    const container = mount("trifolium_v1_2", (gpio) => seen.push(gpio));
    const trigger = container.querySelector('[data-part="trigger"]')!;
    act(() => {
      trigger.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    act(() => {
      trigger.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
    expect(seen).toEqual([21, null]);
  });
});
