import { describe, expect, it } from "vitest";
import { asBound, steppedToGrid } from "./grid";
import table from "../../../../tests/suite/fixtures/stepped_to_grid.json";

// The firmware's own answers, generated from src/menu.h and checked against it by
// tests/suite/test_grid.py - so this port and the device step to the same values.
describe("steppedToGrid agrees with the firmware", () => {
  type Row = [number, -1 | 1, number, number, number, boolean, number];
  const cases = table.cases as Row[];

  it("has the firmware's table", () => {
    expect(cases.length).toBeGreaterThan(500);
  });

  it("gives every answer the firmware gives", () => {
    const wrong = cases.filter(
      ([value, direction, step, lo, hi, wrap, expected]) =>
        steppedToGrid(asBound(value), direction, asBound(step), asBound(lo), asBound(hi), wrap) !==
        expected,
    );
    expect(wrong).toEqual([]);
  });
});
