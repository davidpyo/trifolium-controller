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
  it("draws the board as a block of its pins, each named, rather than a picture of it", () => {
    const container = mount("trifolium_v1_2");
    const block = container.querySelector('[data-board="schematic"]')!;
    expect(block).not.toBeNull();
    // No board art is injected; the names are the block's own.
    expect(container.querySelector("svg[aria-label^='Hookup'] svg")).toBeNull();
    const names = [...block.querySelectorAll("text")].map((t) => t.textContent);
    expect(names).toEqual(expect.arrayContaining(["GP21", "VCC to I2C", "+ From Battery", "XT30 IN"]));
    expect(container.textContent).toContain("Board pins shows where each one is");
    // Only the pins with wires are drawn; the free ones are listed underneath.
    expect(names).not.toContain("GP26");
    expect(container.textContent).toContain("GP26, GP4, GP2, GP0, VCC from ESC on the ESC plug");
    expect(container.textContent).toContain("the GP20 plug");
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
