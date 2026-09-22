// @vitest-environment jsdom

// The diagram colours its pads by writing to the marker sheet's own elements, which is a thing no
// pure test can see. This mounts the component to check the colours are there on first render -
// they were not, and the pads stayed the sheet's authored colour until an edit re-ran the effect.

import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Schema } from "../schema/types";
import type { WiringDiagram as Diagram } from "../schema/wiringDiagrams";
import { WiringDiagram } from "./WiringDiagram";
import schemaJson from "../fixtures/schema.json";
import deviceJson from "../fixtures/device.json";

// Tells React this is an act() environment, so effects flush inside act rather than warning.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const schema = schemaJson as unknown as Schema;

// GP21 is the fixture's trigger; nothing is on GP8.
const diagram: Diagram = {
  boardId: "test_board",
  artMarkup: '<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="#101010" /></svg>',
  svgMarkup:
    '<svg viewBox="0 0 10 10"><g fill="#00e5ff" stroke="#00e5ff">' +
    '<circle data-gpio="21" cx="1" cy="1" r="1" /><circle data-gpio="8" cx="5" cy="5" r="1" />' +
    '<circle data-pin="GND" cx="8" cy="8" r="1" />' +
    '<circle data-pin="VCC" cx="9" cy="9" r="1" data-label="Battery in +" />' +
    '<g data-connector="Test plug"><circle data-gpio="18" cx="3" cy="3" r="1" />' +
    '<circle data-pin="GND" cx="4" cy="4" r="1" /></g>' +
    "</g></svg>",
  markers: [{ gpio: 21 }, { gpio: 8 }],
  available: new Set([21, 8]),
};

const mount = () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(
      <WiringDiagram schema={schema} device={deviceJson} diagram={diagram} />,
    );
  });
  return container;
};

const fillOf = (container: HTMLElement, gpio: number) =>
  container.querySelector<SVGElement>(`[data-gpio="${gpio}"]`)?.style.fill ?? "";

describe("WiringDiagram", () => {
  it("draws the board art", () => {
    // It was an <img> at a data: URI until the encoding swallowed it at the first "#" in a fill
    // colour and the board rendered as alt text.
    expect(mount().querySelector('rect[fill="#101010"]')).not.toBeNull();
  });

  it("colours a pad in use on first render", () => {
    expect(fillOf(mount(), 21)).not.toBe("");
  });

  it("colours a free pad on first render", () => {
    expect(fillOf(mount(), 8)).not.toBe("");
  });

  it("tells the two apart", () => {
    const container = mount();
    expect(fillOf(container, 21)).not.toBe(fillOf(container, 8));
  });

  it("colours a power pad as neither", () => {
    const container = mount();
    const power = container.querySelector<SVGElement>('[data-pin="GND"]')?.style.fill ?? "";
    expect(power).not.toBe("");
    expect(power).not.toBe(fillOf(container, 21));
    expect(power).not.toBe(fillOf(container, 8));
  });

  it("labels a power pad its sheet named", () => {
    // Nothing is ever assigned to a supply pad, so the sheet's own label is the only way one can
    // say what belongs on it. Read off the injected markup, which is the path the real sheets take.
    expect(mount().textContent).toContain("Battery in +");
  });

  it("colours a pad inside a connector group like any other", () => {
    // The group is a wrapper, not a pad: a sheet that names its plugs must not lose the colouring
    // that says which pins are in use.
    expect(fillOf(mount(), 18)).not.toBe("");
  });

  it("leaves an unlabelled power pad to its colour and its hover", () => {
    // The reason labels are opt-in: the same two names recur on every connector, and a diagram
    // that drew them all would bury the labels worth reading.
    expect(mount().textContent).not.toContain("GND");
  });
});
