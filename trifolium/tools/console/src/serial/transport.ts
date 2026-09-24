// Web Serial transport for the firmware's line protocol.
//
// Ported from the plumbing in tools/serial-config.html, which is proven against the device: one
// reader for the life of the connection, callers register a predicate rather than reading directly,
// so there is never more than one consumer pulling from the stream.
//
// One deliberate change from the original: reply framing no longer guesses. The old client treated
// "any line starting with {" as the payload, which could not tell a config dump from an error.
// Every reply carries a `cmd` naming the command it answers, and a slot where there is one, so
// replies are matched on that rather than on shape - see repliesTo().

export type LogKind = "out" | "in" | "ok" | "err";

export interface LogLine {
  kind: LogKind;
  text: string;
  at: number;
}

/** Acknowledgement shape shared by LOAD_DEVICE / LOAD_PROFILE. */
export interface CommandAck {
  cmd: string;
  ok: boolean;
  err?: string;
  index?: number;
  /** False for a non-active profile slot: the device defers clamping to the boot that activates it. */
  clamped?: boolean;
  rebooting?: boolean;
  /** Present and false when a schemaVersion mismatch was refused without touching anything. */
  applied?: boolean;
}

const BAUD = 115200;

/** Small replies land in well under a second; DUMP_SCHEMA is ~27KB on one line. */
export const TIMEOUT_SHORT_MS = 3000;
export const TIMEOUT_SCHEMA_MS = 15000;

interface Listener {
  predicate: (line: string) => boolean;
  resolve: (line: string | null) => void;
}

/**
 * A line that answers a command, as opposed to one the device volunteered.
 *
 * `evt` marks the volunteered kind - the display probe's failures and the unconfigured
 * announcement. They are worth showing in the log, but they are never somebody's reply.
 */
export const isReply = (line: string): boolean =>
  line.startsWith("{") && !line.includes('"evt"');

/**
 * A line that answers *this* command, matched on the `cmd` field every reply carries - the config
 * dumps included, which is what lets them be told apart from an ack rather than guessed at by shape.
 *
 * Shape alone is not enough: a timed-out command's reply still arrives, and the next request would
 * take it as its own - a late DUMP_BOOT ack read as the schema reply, reported as "no schema from
 * this firmware" on a healthy board. Whitespace is tolerated because DUMP_SCHEMA emits
 * `"cmd": "..."` while the acks emit `"cmd":"..."`.
 *
 * A command naming a profile slot is matched on the slot too, since every slot answers with the same
 * `cmd`: reading the three slots in a row, a late `DUMP_PROFILE 0` would otherwise be taken for
 * slot 1's and show one slot's settings under another's name.
 */
export const repliesTo = (command: string): ((line: string) => boolean) => {
  const [name, arg] = command.trim().split(/\s+/);
  const pattern = new RegExp(`"cmd"\\s*:\\s*"${name}"`);
  // \b so that slot 1 does not match the 1 leading "index":12 - there is no such slot today, but the
  // matcher should not be the reason for that.
  const slot = /^\d+$/.test(arg ?? "") ? new RegExp(`"index"\\s*:\\s*${arg}\\b`) : null;
  return (line) => isReply(line) && pattern.test(line) && (slot === null || slot.test(line));
};

/**
 * Why the device says it is about to reboot by itself, or null for any other line.
 *
 * A reboot a command asked for is acked with `rebooting`; one nobody asked for over serial - the RPM
 * log's, after its dump - is announced as `{"evt":"rebooting","reason":...}` instead.
 */
export const rebootAnnouncement = (line: string): string | null => {
  if (!line.startsWith("{") || !line.includes('"rebooting"')) return null;
  try {
    const parsed = JSON.parse(line) as { evt?: unknown; reason?: unknown };
    return parsed.evt === "rebooting" ? String(parsed.reason ?? "") : null;
  } catch {
    return null;
  }
};

/** The reply framing, which every dump carries and no store holds. */
const FRAMING_KEYS = ["cmd", "index"] as const;

/**
 * A config dump with the reply framing peeled off.
 *
 * What comes back on the wire is framing plus config; what the console edits, bundles and sends back
 * is config alone. Dropping the framing here, where a reply becomes state, is what keeps `cmd` out
 * of a saved backup and out of the payload a profile copy pushes to the device.
 */
export const configFrom = (reply: unknown): unknown => {
  if (reply === null || typeof reply !== "object" || Array.isArray(reply)) return reply;
  const rest = { ...(reply as Record<string, unknown>) };
  for (const key of FRAMING_KEYS) delete rest[key];
  return rest;
};

/** Splits the decoded byte stream into lines, holding the partial tail between chunks. */
class LineBreakTransformer implements Transformer<string, string> {
  private chunk = "";

  transform(chunk: string, controller: TransformStreamDefaultController<string>) {
    this.chunk += chunk;
    const lines = this.chunk.split("\n");
    this.chunk = lines.pop() ?? "";
    for (const line of lines) controller.enqueue(line);
  }

  flush(controller: TransformStreamDefaultController<string>) {
    if (this.chunk) controller.enqueue(this.chunk);
  }
}

export interface TransportEvents {
  onLog?: (line: LogLine) => void;
  onDisconnect?: (reason: string) => void;
  /** After an announced reboot has torn the connection down, keeping the port to reopen. */
  onRebooting?: (reason: string) => void;
}

export class SerialTransport {
  private port: SerialPort | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  /** Resolves once the pipe to the text decoder tears down and releases port.readable. */
  private readableClosed: Promise<void> | null = null;
  private listeners: Listener[] = [];
  private disconnecting = false;
  /** Kept across a reboot the device performed itself, so reopenAfterReboot() has a port to retry. */
  private rebootedPort: SerialPort | null = null;

  constructor(private events: TransportEvents = {}) {}

  static get supported(): boolean {
    return typeof navigator !== "undefined" && "serial" in navigator;
  }

  get connected(): boolean {
    return this.port !== null;
  }

  private log(kind: LogKind, text: string) {
    this.events.onLog?.({ kind, text, at: Date.now() });
  }

  async connect(): Promise<boolean> {
    if (!SerialTransport.supported) {
      this.log("err", "Web Serial is unavailable. Use Chrome or Edge on desktop.");
      return false;
    }
    try {
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: BAUD });

      this.attach(this.port);

      this.log("ok", "Connected.");
      void this.readLoop(); // runs until the reader errors or is cancelled
      return true;
    } catch (e) {
      this.log("err", `Connect failed: ${(e as Error).message}`);
      this.port = null;
      return false;
    }
  }

  /** Wires reader/writer onto an opened port. Shared so the reopen path cannot drift from connect. */
  private attach(port: SerialPort): void {
    this.port = port;
    const decoder = new TextDecoderStream();
    // TextDecoderStream types its writable as WritableStream<BufferSource> while port.readable
    // is ReadableStream<Uint8Array>. The pipe is valid at runtime; the mismatch is variance only.
    this.readableClosed = port
      .readable!.pipeTo(decoder.writable as unknown as WritableStream<Uint8Array>)
      .catch(() => {});
    this.reader = decoder.readable
      .pipeThrough(new TransformStream(new LineBreakTransformer()))
      .getReader();
    this.writer = port.writable!.getWriter();
  }

  /** Same physical device, by USB identity. getInfo() is all Web Serial exposes to match on. */
  private static sameDevice(a: SerialPort, b: SerialPort): boolean {
    const x = a.getInfo();
    const y = b.getInfo();
    return (
      x.usbVendorId !== undefined &&
      x.usbVendorId === y.usbVendorId &&
      x.usbProductId === y.usbProductId
    );
  }

  /**
   * Every port that could be the device we just lost, the remembered handle first.
   *
   * The remembered handle is tried first because it usually is the right one. It is not always: a
   * USB re-enumeration can hand the page a *new* SerialPort object for the same physical device,
   * and the old one then never opens again however long it is retried. Permission is granted per
   * device rather than per handle, so the replacement needs no fresh user gesture - it just has to
   * be found, which is what getPorts() is for.
   */
  private async reconnectCandidates(remembered: SerialPort): Promise<SerialPort[]> {
    const out = [remembered];
    try {
      for (const port of await navigator.serial.getPorts()) {
        if (port !== remembered && SerialTransport.sameDevice(port, remembered)) out.push(port);
      }
    } catch {
      // getPorts() can reject in odd embedding contexts. The remembered handle is still worth a try.
    }
    return out;
  }

  /**
   * Reopens the device after it has rebooted itself.
   *
   * A successful LOAD_DEVICE, a LOAD_PROFILE targeting the active slot, or any of the reset and
   * reboot commands reboots immediately - so the USB device disappears and re-enumerates a moment
   * later. open() fails until
   * the endpoint is back, hence the retries; and the handle that comes back may not be the handle
   * that went away, hence reconnectCandidates().
   */
  async reopenAfterReboot(attempts = 20, delayMs = 400): Promise<boolean> {
    const remembered = this.rebootedPort;
    this.rebootedPort = null;
    if (!remembered) return false;

    this.log("out", "Waiting for the device to come back...");
    for (let i = 0; i < attempts; i++) {
      await new Promise((r) => setTimeout(r, delayMs));
      for (const port of await this.reconnectCandidates(remembered)) {
        try {
          await port.open({ baudRate: BAUD });
        } catch {
          continue; // not enumerated yet, still claimed by the OS, or already open
        }
        this.attach(port);
        this.log("ok", port === remembered ? "Reconnected." : "Reconnected (device re-enumerated).");
        void this.readLoop();
        return true;
      }
    }
    this.log(
      "err",
      `Device did not come back within ${Math.round((attempts * delayMs) / 1000)}s. Reconnect manually.`,
    );
    return false;
  }

  async disconnect(reason = "Disconnected.", expectReboot = false): Promise<void> {
    // readLoop()'s own teardown and a manual disconnect can race.
    if (this.disconnecting) return;
    this.disconnecting = true;
    if (expectReboot) this.rebootedPort = this.port;
    try {
      const waiting = this.listeners;
      this.listeners = [];
      for (const { resolve } of waiting) resolve(null); // never leave a caller hanging

      try {
        await this.reader?.cancel();
      } catch {
        /* already torn down */
      }
      try {
        await this.readableClosed; // wait for the pipe to unlock port.readable
      } catch {
        /* ignore */
      }
      try {
        await this.writer?.close();
      } catch {
        try {
          this.writer?.releaseLock();
        } catch {
          /* ignore */
        }
      }
      try {
        await this.port?.close();
      } catch {
        /* ignore */
      }

      this.reader = null;
      this.writer = null;
      this.port = null;
      this.readableClosed = null;
      this.log("err", reason);
      this.events.onDisconnect?.(reason);
    } finally {
      this.disconnecting = false;
    }
  }

  private async readLoop(): Promise<void> {
    try {
      for (;;) {
        const { value, done } = await this.reader!.read();
        if (done) break;
        const line = (value ?? "").trim();
        if (!line) continue;

        // Anything not claimed by a waiting caller is device chatter worth showing.
        const claimed = this.listeners.some((l) => l.predicate(line));
        if (!claimed) this.log("in", line);

        this.listeners = this.listeners.filter(({ predicate, resolve }) => {
          if (!predicate(line)) return true;
          resolve(line);
          return false;
        });

        const reason = rebootAnnouncement(line);
        if (reason !== null) {
          // The same teardown a rebooting ack gets, so reopenAfterReboot() has the port to retry.
          void this.disconnect("Device is rebooting.", true).then(() =>
            this.events.onRebooting?.(reason),
          );
          return;
        }
      }
    } catch {
      // Expected on disconnect() cancelling the reader, or the device rebooting mid-session.
    }
    if (this.port) {
      await this.disconnect("Connection lost (device rebooted or port closed).");
    }
  }

  /** Resolves with the next matching line, or null on timeout. */
  private waitForLine(predicate: (line: string) => boolean, timeoutMs: number) {
    return new Promise<string | null>((resolve) => {
      const entry: Listener = { predicate, resolve: () => {} };
      const timer = setTimeout(() => {
        this.listeners = this.listeners.filter((e) => e !== entry);
        resolve(null);
      }, timeoutMs);
      entry.resolve = (line) => {
        clearTimeout(timer);
        resolve(line);
      };
      this.listeners.push(entry);
    });
  }

  private async write(text: string): Promise<void> {
    if (!this.writer) throw new Error("not connected");
    await this.writer.write(new TextEncoder().encode(text));
  }

  async sendLine(text: string): Promise<void> {
    this.log("out", `> ${text}`);
    await this.write(`${text}\n`);
  }

  /**
   * Sends a command followed by raw bytes - the splash upload, which is the one binary path.
   *
   * The firmware blocks on a fixed-size read (`Serial.readBytes(buf, SPLASH_BYTES)`) and rejects any
   * other length, so the size is the caller's responsibility. There is no acknowledgement: the reply
   * goes through the printTelemetry-gated logger, so on a stock device nothing comes back at all.
   */
  async sendBinary(command: string, bytes: Uint8Array): Promise<boolean> {
    if (!this.writer) {
      this.log("err", "Not connected.");
      return false;
    }
    this.log("out", `> ${command}  (${bytes.length} bytes)`);
    try {
      await this.write(`${command}\n`);
      await this.writer.write(bytes);
      this.log("ok", "Sent. Takes effect on the next boot.");
      return true;
    } catch (e) {
      await this.disconnect(`Binary send failed: ${(e as Error).message}`);
      return false;
    }
  }

  /**
   * Sends a command and returns the parsed JSON object it replies with.
   *
   * The reply is picked out by repliesTo(). Anything carrying a `cmd` is checked by the caller.
   *
   * Unsolicited `evt` lines are stepped over. An unconfigured device announces itself every three
   * seconds until it sees a command, so on the first connection to a freshly flashed board that
   * line can arrive before the reply and would otherwise be parsed as one - reading as firmware too
   * old to answer, on exactly the devices the board picker exists for.
   */
  async request<T>(command: string, timeoutMs = TIMEOUT_SHORT_MS): Promise<T | null> {
    await this.sendLine(command);
    const line = await this.waitForLine(repliesTo(command), timeoutMs);
    if (line === null) {
      this.log("err", `No reply to ${command} within ${timeoutMs} ms.`);
      return null;
    }
    try {
      return JSON.parse(line) as T;
    } catch (e) {
      this.log("err", `Reply to ${command} is not valid JSON: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Sends a LOAD_* command followed by its JSON body, and waits for the acknowledgement.
   *
   * The body is written without a trailing newline: the device hands the stream straight to
   * ArduinoJson, which stops at the closing brace.
   *
   * A successful LOAD_DEVICE, or a LOAD_PROFILE targeting the active slot, reboots the device - so
   * the port drops immediately after the ack. That is reported through onDisconnect, not as failure.
   */
  async load(command: string, body: unknown): Promise<CommandAck | null> {
    const text = JSON.stringify(body);
    this.log("out", `> ${command}  (${text.length} bytes)`);
    await this.write(`${command}\n`);
    const pending = this.waitForLine(repliesTo(command), TIMEOUT_SHORT_MS);
    await this.write(text);

    return this.settleAck(command, await pending);
  }

  /**
   * Polls until the firmware is actually servicing commands again.
   *
   * Reopening the port is not the same as the device being ready: USB CDC enumerates early in
   * setup(), but nothing answers until loop1() runs - after the splash delay and the ESC arm loop -
   * and a command sent into that gap is swallowed rather than queued. DUMP_BOOT is the cheapest
   * command that proves loop1() is running and it touches nothing.
   */
  async waitReady(attempts = 10, timeoutMs = 1500): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
      await this.write("DUMP_BOOT\n");
      const line = await this.waitForLine(repliesTo("DUMP_BOOT"), timeoutMs);
      if (line !== null) return true;
    }
    // Not "reconnected": connect() calls this too, and on a USB-only board that is the common
    // case rather than the rare one.
    this.log(
      "err",
      "The port is open but the device is not answering. If it is powered by USB alone, it may "
        + "still be booting - try connecting again.",
    );
    return false;
  }

  /**
   * Sends a bare command that acknowledges and then reboots - REBOOT, RESET_PINS, the resets.
   *
   * request() returns the same JSON but not the deliberate teardown. Each of these drops the port
   * right after its ack, and only disconnect(expectReboot) keeps the port for reopenAfterReboot()
   * to retry; letting readLoop() discover the drop instead loses it.
   */
  async command(text: string): Promise<CommandAck | null> {
    this.log("out", `> ${text}`);
    const pending = this.waitForLine(repliesTo(text), TIMEOUT_SHORT_MS);
    await this.write(`${text}\n`);
    return this.settleAck(text, await pending);
  }

  private async settleAck(command: string, line: string | null): Promise<CommandAck | null> {
    if (line === null) {
      this.log("err", `${command} was not acknowledged. Firmware may predate acknowledgements.`);
      return null;
    }
    try {
      const ack = JSON.parse(line) as CommandAck;
      this.log(ack.ok ? "ok" : "err", line);
      if (ack.rebooting) {
        // The port is about to vanish. Tear down deliberately rather than letting readLoop() report
        // it as a lost connection, and keep the port so it can be reopened.
        await this.disconnect("Device is rebooting to apply the change.", true);
      }
      return ack;
    } catch {
      this.log("err", `Unparseable acknowledgement: ${line}`);
      return null;
    }
  }
}
