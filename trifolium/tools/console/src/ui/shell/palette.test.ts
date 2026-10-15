import { describe, expect, it } from "vitest";
import { search, type PaletteItem } from "./Palette";

const noop = () => {};
const items: PaletteItem[] = [
  { group: "Commands", label: "Review and write changes", where: "Ctrl S", run: noop },
  {
    group: "Commands",
    label: "Restart the blaster",
    sub: "Also the bootloader",
    where: "Maintenance",
    run: noop,
  },
  {
    group: "Settings",
    label: "Retract Time",
    sub: "How long the pusher takes to retract",
    where: "Blaster settings · Solenoid / Pusher",
    run: noop,
  },
  {
    group: "Settings",
    label: "Spindown Speed",
    sub: "How quickly the flywheels may slow down",
    where: "Profiles · RPM & Timing",
    run: noop,
  },
  {
    group: "Settings",
    label: "Dwell Time",
    sub: "How long the flywheels stay at speed after a shot",
    where: "Profiles · RPM & Timing",
    run: noop,
  },
];

describe("search", () => {
  it("offers the commands before anything is typed", () => {
    expect(search(items, "").map((i) => i.group)).toEqual(["Commands", "Commands"]);
  });

  it("finds a setting by what it does, not only its name", () => {
    expect(search(items, "pusher").map((i) => i.label)).toEqual(["Retract Time"]);
  });

  it("needs every word typed, in any of the name, the help or where it lives", () => {
    expect(
      search(items, "flywheels profiles")
        .map((i) => i.label)
        .sort(),
    ).toEqual(["Dwell Time", "Spindown Speed"]);
    expect(search(items, "flywheels blaster")).toEqual([]);
  });

  it("ranks a hit on the name above a hit in the help", () => {
    const names = search(items, "speed").map((i) => i.label);
    expect(names[0]).toBe("Spindown Speed");
  });

  it("finds a command by a word in its description", () => {
    expect(search(items, "bootloader").map((i) => i.label)).toEqual(["Restart the blaster"]);
  });
});
