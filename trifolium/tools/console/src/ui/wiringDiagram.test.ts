// Joining a board's marker sheet to the live wiring, and what it means when the two disagree.
//
// All of this is pure: which control sits on which GPIO, and which of those the board never brings
// out. Where a marker lands on the render is geometry the browser does, and is not tested here.

import { describe, expect, it } from "vitest";
import type { Schema } from "../schema/types";
import { diagramForBoardId, markersIn } from "../schema/wiringDiagrams";
import {
  connectorKind,
  matchDiagramPins,
  padTitle,
  runs,
  shortPlugName,
  stack,
  type Placement,
} from "./WiringDiagram";
import { movedInternalPins, unavailablePins } from "./WiringWarnings";
import { collectWiring } from "./WiringTable";
import schemaJson from "../fixtures/schema.json";
import deviceJson from "../fixtures/device.json";

const schema = schemaJson as unknown as Schema;
const rows = collectWiring(schema);
const gpiosOf = (device: unknown) => matchDiagramPins(rows, device).map((m) => m.gpio).sort((a, b) => a - b);

describe("markersIn", () => {
  it("collects every marked pin", () => {
    expect(markersIn('<circle data-gpio="14" /><circle data-gpio="21" />')).toEqual([
      { gpio: 14, wiredTo: undefined },
      { gpio: 21, wiredTo: undefined },
    ]);
  });

  it("reads what an internally wired pin is wired to", () => {
    expect(markersIn('<circle data-gpio="24" data-internal="pusherFetPin" />')).toEqual([
      { gpio: 24, wiredTo: "pusherFetPin" },
    ]);
  });

  it("keeps a pin with its own function whatever order the attributes are in", () => {
    // Matching the two attributes independently across the markup would pair this pin with the
    // next marker's function instead.
    expect(
      markersIn('<circle data-internal="batteryAdcPin" data-gpio="28" /><circle data-gpio="9" />'),
    ).toEqual([{ gpio: 28, wiredTo: "batteryAdcPin" }, { gpio: 9, wiredTo: undefined }]);
  });

  it("reads a pin declared with no position at all", () => {
    // An internally wired pin has no pad to draw, so a sheet declares it in metadata instead.
    expect(markersIn('<metadata><pin data-gpio="24" data-internal="pusherFetPin" /></metadata>'))
      .toEqual([{ gpio: 24, wiredTo: "pusherFetPin" }]);
  });

  it("tolerates the whitespace a formatter may leave", () => {
    expect(markersIn('<circle data-gpio = "9" />')).toEqual([{ gpio: 9, wiredTo: undefined }]);
  });

  it("finds nothing in a sheet that marks nothing", () => {
    expect(markersIn('<circle cx="1" cy="2" r="9" />')).toEqual([]);
  });

  it("leaves power pads out", () => {
    // A board does not "offer" its ground pad: counting one would make GND a pin the warnings
    // think a control could legitimately sit on.
    expect(markersIn('<circle data-pin="GND" /><circle data-pin="VCC" />')).toEqual([]);
  });
});

describe("runs", () => {
  const at = (label: string, pinX: number, pinY: number, connector?: string): Placement =>
    ({ gpio: 0, key: label, label, authored: false, connector, pinX, pinY, side: "left", labelY: pinY });
  const labels = (groups: Placement[][]) => groups.map((g) => g.map((p) => p.label));

  it("keeps a connector's column together when another connector shares its height", () => {
    // The real case: SDA and SCL sit either side of the select row, and used to be labelled three
    // rows apart with all of 10/9/8 between them.
    const got = runs([
      at("SDA", 106, 428),
      at("SCL", 106, 449),
      at("Select 2", 190, 436),
      at("Select 0", 211, 436),
    ]);
    expect(labels(got)).toContainEqual(["SDA", "SCL"]);
  });

  it("keeps a header's pads apart, so they still order across", () => {
    const got = runs([at("a", 404, 125), at("b", 425, 125), at("c", 446, 125)]);
    expect(got).toHaveLength(3);
  });

  it("does not join pads at opposite ends of one column", () => {
    expect(runs([at("top", 106, 120), at("bottom", 106, 900)])).toHaveLength(2);
  });

  it("believes a sheet that names the plug, whatever the geometry says", () => {
    // A header's pads are in different columns, so the geometry splits them - correctly, as a
    // guess. Once the sheet says they are one plug there is nothing left to infer.
    const got = runs([
      at("26", 404, 125, "Ribbon header"),
      at("4", 425, 125, "Ribbon header"),
      at("0", 509, 125, "Ribbon header"),
    ]);
    expect(labels(got)).toEqual([["26", "4", "0"]]);
  });

  it("keeps two named plugs apart even where they overlap", () => {
    // The XT30 pair shares a column with nothing else, but the two terminals are separate plugs
    // and a run that joined them would label four pads as one connector.
    const got = runs([
      at("in-", 131, 935, "XT30 IN"),
      at("in+", 131, 1039, "XT30 IN"),
      at("out-", 495, 935, "XT30 OUT"),
    ]);
    expect(got).toHaveLength(2);
  });

  it("still guesses for the pads a sheet has not named", () => {
    // Mixed sheets are the ordinary case while one is being filled in.
    const got = runs([
      at("SDA", 106, 428, "I2C connector"),
      at("SCL", 106, 449, "I2C connector"),
      at("loose", 190, 436),
    ]);
    expect(labels(got)).toContainEqual(["SDA", "SCL"]);
    expect(labels(got)).toContainEqual(["loose"]);
  });
});

describe("stack", () => {
  const at = (label: string, pinX: number, pinY: number, connector?: string): Placement =>
    ({ gpio: 0, key: label, label, authored: false, connector, pinX, pinY, side: "left", labelY: pinY });
  const gaps = (items: Placement[]) =>
    items.slice(1).map((item, i) => Math.round(item.labelY - items[i].labelY));

  it("clumps one plug's labels tighter than the gap to the next plug", () => {
    // The I2C connector as the render sees it: four pads about 11px apart once the sheet's 21px
    // pitch is scaled down. Evenly spread, the four read as four unrelated facts.
    const plug = [
      at("GND", 106, 200, "I2C"),
      at("VCC", 106, 211, "I2C"),
      at("SDA", 106, 222, "I2C"),
      at("SCL", 106, 233, "I2C"),
    ];
    const other = [at("S0", 106, 250, "Select"), at("S1", 106, 261, "Select")];
    const groups = stack([...plug, ...other], "left", 900);

    const within = gaps(groups[0]);
    const between = groups[1][0].labelY - groups[0][3].labelY;
    expect(new Set(within)).toEqual(new Set([16]));
    expect(between).toBeGreaterThan(Math.max(...within));
  });

  it("spaces plugs the same whether or not they are named", () => {
    // The chip rides on the label row itself, so a named plug asks the gutter for no extra room.
    const named = stack([at("a", 106, 100, "First"), at("b", 106, 104, "Second")], "left", 900);
    const bare = stack([at("c", 106, 100), at("d", 300, 104)], "left", 900);
    expect(named[1][0].labelY - named[0][0].labelY).toBe(26);
    expect(bare[1][0].labelY - bare[0][0].labelY).toBe(26);
  });

  it("keeps every label on the picture when they overflow", () => {
    const many = Array.from({ length: 40 }, (_, i) => at(`p${i}`, 106, 20 + i * 4, `plug${i}`));
    for (const group of stack(many, "left", 200)) {
      expect(group[0].labelY).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("connectorKind", () => {
  it("reads the kind off the name the sheet already gives", () => {
    // Not a second attribute to declare: a sheet that calls something "I2C connector" has said
    // which bus it is, and asking it to say so twice is how the two start disagreeing.
    expect(connectorKind("I2C connector")).toBe("i2c");
    expect(connectorKind("ESC connector")).toBe("esc");
    expect(connectorKind("XT30 IN")).toBe("power");
    expect(connectorKind("GP18 connector")).toBe("gpio");
  });

  it("falls back to a plain GPIO plug, which is the common case", () => {
    expect(connectorKind("Select connector")).toBe("gpio");
    expect(connectorKind("whatever this is")).toBe("gpio");
  });
});

describe("shortPlugName", () => {
  it("drops the word every plug shares", () => {
    expect(shortPlugName("GP18 connector")).toBe("GP18");
    expect(shortPlugName("I2C connector")).toBe("I2C");
  });

  it("leaves a name that does not end in it alone", () => {
    expect(shortPlugName("XT30 IN")).toBe("XT30 IN");
  });

  it("keeps a name that is nothing but the word", () => {
    // Shortening it to an empty chip would lose the only thing the sheet said.
    expect(shortPlugName("Connector")).toBe("Connector");
  });
});

describe("padTitle", () => {
  it("names the control on an assigned pin", () => {
    expect(padTitle({ gpio: 21 }, "Trigger")).toBe("Trigger — GP21");
  });

  it("says a free pin is free", () => {
    expect(padTitle({ gpio: 8 })).toBe("GP8 — no control assigned");
  });

  it("gives a power pad its name and says nothing can sit on it", () => {
    expect(padTitle({ gpio: null, power: "GND" })).toBe("GND — power, nothing to assign");
  });

  it("leads with the sheet's own label for a power pad", () => {
    // The whole point of data-label: a supply pad can otherwise only ever answer "GND".
    expect(padTitle({ gpio: null, power: "VCC", label: "Battery in +" })).toBe(
      "Battery in + — VCC, nothing to assign",
    );
  });

  it("keeps a free pin's label and the fact that it is free", () => {
    expect(padTitle({ gpio: 8, label: "Spare header" })).toBe(
      "Spare header — GP8, no control assigned",
    );
  });

  it("names the plug a pad is on", () => {
    // The thing a connector is for: on a power pad it is most of what there is to know.
    expect(padTitle({ gpio: null, power: "GND", connector: "I2C connector" })).toBe(
      "GND — power, nothing to assign · I2C connector",
    );
    expect(padTitle({ gpio: 21, connector: "Trigger switch (GP21)" }, "Trigger")).toBe(
      "Trigger — GP21 · Trigger switch (GP21)",
    );
  });

  it("says nothing extra when the sheet has not named the plug", () => {
    expect(padTitle({ gpio: 8 })).toBe("GP8 — no control assigned");
  });

  it("lets a live assignment win over the sheet's label", () => {
    // The label says what the pad is for; the assignment says what is on it now, which is the
    // answer to the question the diagram is being read to settle.
    expect(padTitle({ gpio: 21, label: "Spare header" }, "Trigger")).toBe("Trigger — GP21");
  });
});

describe("movedInternalPins", () => {
  const markers = [{ gpio: 24, wiredTo: "pusherFetPin" }, { gpio: 9 }];

  it("says nothing while a wired function is where the board wires it", () => {
    expect(movedInternalPins(markers, { pusherFetPin: 24 })).toEqual([]);
  });

  it("names a wired function that has been pointed elsewhere", () => {
    expect(movedInternalPins(markers, { pusherFetPin: 7 })).toEqual([
      { field: "pusherFetPin", wired: 24, actual: 7 },
    ]);
  });

  it("says nothing about a function switched off entirely", () => {
    // 255 is not a move to another pin, it is not using the thing at all.
    expect(movedInternalPins(markers, { pusherFetPin: 255 })).toEqual([]);
  });

  it("ignores header pins, which are wired to whatever gets plugged in", () => {
    expect(movedInternalPins([{ gpio: 9 }], { select0Pin: 21 })).toEqual([]);
  });
});

describe("matchDiagramPins", () => {
  it("puts each assigned control on its pin", () => {
    // The fixture's trigger is GP21 and its rev switch GP18.
    expect(gpiosOf(deviceJson)).toContain(21);
    expect(gpiosOf(deviceJson)).toContain(18);
  });

  it("leaves unused pins unmatched", () => {
    // 255 is the sentinel, and the fixture parks its cycle and idle switches on it. Matching it
    // would put every unwired control on one imaginary pin.
    expect(gpiosOf(deviceJson)).not.toContain(255);
  });

  it("keeps both controls where two share a pin", () => {
    // Legitimate today: select0Pin doubling as the menu button. The fixture has them apart, so the
    // case is made rather than waited for.
    const shared = { ...deviceJson, menuButtonPin: deviceJson.select0Pin };
    const match = matchDiagramPins(rows, shared).find((m) => m.gpio === deviceJson.select0Pin);
    expect(match?.rows).toHaveLength(2);
  });
});

describe("unavailablePins", () => {
  it("names a control the board does not bring out", () => {
    const matches = matchDiagramPins(rows, deviceJson);
    const withoutTrigger = new Set(gpiosOf(deviceJson).filter((g) => g !== 21));
    expect(unavailablePins(matches, withoutTrigger).map((m) => m.gpio)).toEqual([21]);
  });

  it("says nothing when the board marks every pin in use", () => {
    const matches = matchDiagramPins(rows, deviceJson);
    expect(unavailablePins(matches, new Set(gpiosOf(deviceJson)))).toEqual([]);
  });
});

describe("diagramForBoardId", () => {
  it("resolves the board the fixture reports, with pins marked", () => {
    const diagram = diagramForBoardId(deviceJson.boardId);
    expect(diagram?.boardId).toBe(deviceJson.boardId);
    expect(diagram?.available.size).toBeGreaterThan(0);
  });

  it("has nothing for a board with no sheet", () => {
    expect(diagramForBoardId("no_such_board")).toBeUndefined();
  });

  it("gives v1.3 and v1.4 the drawing of the board they are", () => {
    expect(diagramForBoardId("trifolium_v1_3")?.boardId).toBe("trifolium_v1_2");
    expect(diagramForBoardId("trifolium_v1_4")?.boardId).toBe("trifolium_v1_2");
  });

  it("gives v1.1 its own drawing, not the one it is not", () => {
    // A different board, so it gets its own pair rather than an alias onto v1.2's.
    expect(diagramForBoardId("trifolium_v1_1")?.boardId).toBe("trifolium_v1_1");
  });

  it("leaves every tag in the board art well formed", () => {
    // `<pathd="M..."` is what an edit that eats one space leaves behind, and it costs the whole
    // layer silently: the browser parses an element nobody styles and draws nothing. A board that
    // lost its silkscreen this way still renders, still labels, and still looks plausible.
    const art = diagramForBoardId(deviceJson.boardId)?.artMarkup ?? "";
    expect(art).not.toMatch(/<[a-zA-Z][\w-]*=/);
  });
});
