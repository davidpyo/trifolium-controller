// The numbers the AM32 panel tells somebody to type. They are the ones on screen, doubled for
// poles, so a wrong reading here is a wrong ESC setting somebody typed on this page's word.

import { describe, expect, it } from "vitest";
import { escSetups, groupSetups, setupLine } from "./EscSetup";
import deviceJson from "../fixtures/device.json";

const motor = (enabled: boolean, motorPolesDiv2: number, motorKv: number) => ({
  enabled,
  motorPolesDiv2,
  motorKv,
});

describe("reading AM32's numbers out of device settings", () => {
  it("doubles Poles/2 into AM32's whole pole count", () => {
    const device = { motorConfig: [motor(true, 7, 3200)] };
    expect(escSetups(device)).toEqual([{ which: 1, poles: 14, kv: 3200 }]);
  });

  it("numbers motors from 1, as the matrix above labels them", () => {
    const device = { motorConfig: [motor(false, 7, 3200), motor(true, 6, 2500)] };
    expect(escSetups(device)).toEqual([{ which: 2, poles: 12, kv: 2500 }]);
  });

  it("skips a motor missing either number rather than printing a guess", () => {
    const device = { motorConfig: [{ enabled: true, motorKv: 3200 }] };
    expect(escSetups(device)).toEqual([]);
  });

  it("reads the fixture device the form is built from", () => {
    // Two enabled motors, both 7/3200 - the case the grouping exists for.
    expect(escSetups(deviceJson)).toEqual([
      { which: 2, poles: 14, kv: 3200 },
      { which: 4, poles: 14, kv: 3200 },
    ]);
  });
});

describe("collapsing motors that agree", () => {
  it("makes one group of identical motors", () => {
    const setups = escSetups({ motorConfig: [motor(true, 7, 3200), motor(true, 7, 3200)] });
    expect(groupSetups(setups)).toEqual([{ which: [1, 2], poles: 14, kv: 3200 }]);
  });

  it("keeps a motor that differs apart, named", () => {
    const setups = escSetups({ motorConfig: [motor(true, 7, 3200), motor(true, 6, 3200)] });
    const groups = groupSetups(setups);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => setupLine(g, false))).toEqual([
      "Motor 1: 14 poles, 3200 Kv",
      "Motor 2: 12 poles, 3200 Kv",
    ]);
  });

  it("drops the motor names when there is only one group to name", () => {
    const setups = escSetups({ motorConfig: [motor(true, 7, 3200), motor(true, 7, 3200)] });
    expect(setupLine(groupSetups(setups)[0], true)).toBe("14 poles, 3200 Kv");
  });
});
