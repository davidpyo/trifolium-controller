import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OPEN_OPTIONS,
  SerialTransport,
  askUntilWhole,
  blasterPorts,
  configFrom,
  isReply,
  rebootAnnouncement,
  repliesTo,
  serialApi,
} from "./transport";
import { serial as usbSerial } from "../vendor/web-serial-polyfill/dist/serial.js";
import deviceJson from "../fixtures/device.json";
import profile0 from "../fixtures/profile0.json";

// The fixtures are captures of the config the firmware serialises; the framing the dumps put in
// front of it is added here, the way serialCommands.cpp does.
const deviceDump = JSON.stringify({ cmd: "DUMP_DEVICE", ...deviceJson });
const profileDump = (index: number) =>
  JSON.stringify({ cmd: "DUMP_PROFILE", index, ...profile0 });

describe("OPEN_OPTIONS", () => {
  it("buffers the largest RPM capture: 2000 rows of up to 241 bytes", () => {
    expect(OPEN_OPTIONS.bufferSize).toBeGreaterThanOrEqual(2000 * 241);
  });
});

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

describe("askUntilWhole", () => {
  /** Answers with each line in turn, counting how often it was asked. */
  const answers = (...lines: (string | null)[]) => {
    const asked = { count: 0 };
    return { asked, ask: async () => lines[Math.min(asked.count++, lines.length - 1)] };
  };

  it("asks again when a reply arrives garbled, and takes the whole one", async () => {
    // What a verbose boot did to a reply: another core's log line spliced into it.
    const { asked, ask } = answers('{"cmd":"DUMP_SCHEMA","tr1006 [INFO] Booting', '{"cmd":"DUMP_SCHEMA"}');
    const garbled: boolean[] = [];
    const reply = await askUntilWhole<{ cmd: string }>(ask, (_, last) => garbled.push(last));
    expect(reply?.cmd).toBe("DUMP_SCHEMA");
    expect(asked.count).toBe(2);
    expect(garbled).toEqual([false]);
  });

  it("gives up after three garbled replies", async () => {
    const { asked, ask } = answers("{broken");
    const garbled: boolean[] = [];
    expect(await askUntilWhole(ask, (_, last) => garbled.push(last))).toBeNull();
    expect(asked.count).toBe(3);
    expect(garbled).toEqual([false, false, true]);
  });

  it("takes silence as final rather than waiting again", async () => {
    const { asked, ask } = answers(null);
    expect(await askUntilWhole(ask, () => {})).toBeNull();
    expect(asked.count).toBe(1);
  });
});

describe("blasterPorts", () => {
  const port = (info: SerialPortInfo) => ({ getInfo: () => info }) as unknown as SerialPort;

  it("keeps a blaster and drops what else the browser has allowed", () => {
    // The bench's allowed list: a Bluetooth serial link, which reports no USB ids, and a Pico debug
    // probe beside the blaster.
    const blaster = port({ usbVendorId: 0x2e8a, usbProductId: 0x000a });
    const bluetooth = port({});
    const probe = port({ usbVendorId: 0x2e8a, usbProductId: 0x000c });
    expect(blasterPorts([bluetooth, blaster, probe])).toEqual([blaster]);
  });

  it("keeps every blaster, which connect() then asks between", () => {
    const a = port({ usbVendorId: 0x2e8a, usbProductId: 0x000a });
    const b = port({ usbVendorId: 0x2e8a, usbProductId: 0x000a });
    expect(blasterPorts([a, b])).toEqual([a, b]);
  });
});

describe("serialApi", () => {
  const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0";
  const ANDROID = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile";
  const native = { requestPort: async () => null, getPorts: async () => [] };
  const usb = {};

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("takes Web Serial on a desktop browser that also has WebUSB", () => {
    vi.stubGlobal("navigator", { userAgent: DESKTOP, serial: native, usb });
    expect(serialApi()).toBe(native);
    expect(SerialTransport.supported).toBe(true);
  });

  it("takes the WebUSB polyfill where there is no Web Serial", () => {
    vi.stubGlobal("navigator", { userAgent: DESKTOP, usb });
    expect(serialApi()).toBe(usbSerial);
  });

  it("takes the WebUSB polyfill on Android even when Web Serial exists", () => {
    vi.stubGlobal("navigator", { userAgent: ANDROID, serial: native, usb });
    expect(serialApi()).toBe(usbSerial);
  });

  it("takes the WebUSB polyfill on Android in Desktop site mode, which hides Android", () => {
    const desktopSite = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0";
    vi.stubGlobal("navigator", { userAgent: desktopSite, serial: native, usb, contacts: {} });
    expect(serialApi()).toBe(usbSerial);
    expect(SerialTransport.asksEveryTime).toBe(true);
  });

  it("remembers a blaster everywhere but Android over WebUSB", () => {
    vi.stubGlobal("navigator", { userAgent: ANDROID, serial: native, usb });
    expect(SerialTransport.asksEveryTime).toBe(true);
    vi.stubGlobal("navigator", { userAgent: DESKTOP, serial: native, usb });
    expect(SerialTransport.asksEveryTime).toBe(false);
    vi.stubGlobal("navigator", { userAgent: DESKTOP, usb }); // WebUSB, but a desktop keeps permission
    expect(SerialTransport.asksEveryTime).toBe(false);
  });

  it("falls back to Android's Web Serial when there is no WebUSB", () => {
    vi.stubGlobal("navigator", { userAgent: ANDROID, serial: native });
    expect(serialApi()).toBe(native);
  });

  it("reports unsupported with neither", () => {
    vi.stubGlobal("navigator", { userAgent: DESKTOP });
    expect(serialApi()).toBeNull();
    expect(SerialTransport.supported).toBe(false);
  });
});
