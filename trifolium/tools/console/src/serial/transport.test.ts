import { describe, expect, it } from "vitest";
import { configFrom, isReply, rebootAnnouncement, repliesTo } from "./transport";
import deviceJson from "../fixtures/device.json";
import profile0 from "../fixtures/profile0.json";

// The fixtures are captures of the config the firmware serialises; the framing the dumps put in
// front of it is added here, the way serialCommands.cpp does.
const deviceDump = JSON.stringify({ cmd: "DUMP_DEVICE", ...deviceJson });
const profileDump = (index: number) =>
  JSON.stringify({ cmd: "DUMP_PROFILE", index, ...profile0 });

describe("isReply", () => {
  it("accepts a JSON line and rejects volunteered events", () => {
    expect(isReply(deviceDump)).toBe(true);
    expect(isReply('{"evt":"unconfigured"}')).toBe(false);
    expect(isReply("Trifolium 2.1.0")).toBe(false);
  });
});

describe("repliesTo", () => {
  it("matches a reply on its cmd field, with or without whitespace", () => {
    expect(repliesTo("DUMP_BOOT")('{"cmd":"DUMP_BOOT","ok":true}')).toBe(true);
    expect(repliesTo("DUMP_SCHEMA")('{"cmd": "DUMP_SCHEMA","tree":[]}')).toBe(true);
    expect(repliesTo("DUMP_DEVICE")(deviceDump)).toBe(true);
  });

  it("does not take one command's reply for another's", () => {
    expect(repliesTo("DUMP_SCHEMA")('{"cmd":"DUMP_BOOT","ok":true}')).toBe(false);
    expect(repliesTo("DUMP_DEVICE")(profileDump(0))).toBe(false);
    expect(repliesTo("DUMP_PROFILE")(deviceDump)).toBe(false);
  });

  it("matches the slot a command names, not just the command", () => {
    expect(repliesTo("DUMP_PROFILE 1")(profileDump(1))).toBe(true);
    // The crosstalk the index exists for: slot 0's body, arriving late, is not slot 1's reply.
    expect(repliesTo("DUMP_PROFILE 1")(profileDump(0))).toBe(false);
    expect(repliesTo("FACTORY_RESET_PROFILE 2")('{"cmd":"FACTORY_RESET_PROFILE","ok":true,"index":2}'))
      .toBe(true);
    expect(repliesTo("FACTORY_RESET_PROFILE 2")('{"cmd":"FACTORY_RESET_PROFILE","ok":true,"index":1}'))
      .toBe(false);
  });

  it("does not match a slot on a leading digit of a longer index", () => {
    expect(repliesTo("DUMP_PROFILE 1")('{"cmd":"DUMP_PROFILE","index":12}')).toBe(false);
  });

  it("takes any slot when the command names none", () => {
    // Bare DUMP_PROFILE dumps whichever slot is active, which the caller does not know up front.
    expect(repliesTo("DUMP_PROFILE")(profileDump(2))).toBe(true);
    expect(repliesTo("  DUMP_BOOT  ")('{"cmd":"DUMP_BOOT","ok":true}')).toBe(true);
  });
});

describe("rebootAnnouncement", () => {
  it("names the reason a device gives for rebooting by itself", () => {
    expect(rebootAnnouncement('{"evt":"rebooting","reason":"rpmLog"}')).toBe("rpmLog");
    expect(rebootAnnouncement('{"evt":"rebooting"}')).toBe("");
  });

  it("ignores every other line, a rebooting ack included", () => {
    expect(rebootAnnouncement('{"cmd":"REBOOT","ok":true,"rebooting":true}')).toBe(null);
    expect(rebootAnnouncement('{"evt":"unconfigured"}')).toBe(null);
    expect(rebootAnnouncement("16390,0,30000,7143,0.00,")).toBe(null);
    expect(rebootAnnouncement('{"evt":"rebooting"')).toBe(null);
  });
});

describe("configFrom", () => {
  it("drops the framing and keeps the config", () => {
    const config = configFrom(JSON.parse(profileDump(1))) as Record<string, unknown>;
    expect(config).not.toHaveProperty("cmd");
    expect(config).not.toHaveProperty("index");
    expect(config).toEqual(profile0);
  });

  it("leaves a dump that carries no framing alone", () => {
    expect(configFrom({ ...deviceJson })).toEqual(deviceJson);
  });

  it("does not mutate the reply it was given", () => {
    const reply = { cmd: "DUMP_DEVICE", blasterName: "Diana" };
    configFrom(reply);
    expect(reply.cmd).toBe("DUMP_DEVICE");
  });

  it("passes a non-object through rather than throwing", () => {
    expect(configFrom(null)).toBe(null);
    expect(configFrom(undefined)).toBe(undefined);
  });
});
