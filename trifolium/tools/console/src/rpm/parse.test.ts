import { describe, expect, it } from "vitest";
import { extractRpmCsv, findTrailingFlatStart, niceStep, parseRpmCsv, LOG_LINE_CAP, targetCrossings } from "./parse";

// A capture as it actually arrives: buried in device chatter, prefixed by the console's "(device) ",
// and followed by more chatter.
const noise = [
  "(device) Rev switch pressed",
  "(device) activeProfileIndex: 0",
  "(device) Voltage_mv,Motor 2,TargetRPM 2,Throttle 2,value 2,Motor 4,TargetRPM 4,Throttle 4,value 4,",
  "(device) 16210,1000,32000,120,0,1010,32000,118,0",
  "(device) 16180,5200,32000,900,3,5300,32000,890,4",
  "(device) 16150,31900,32000,640,7,31950,32000,631,8",
  "(device) Battery low, shutting down! 15990mv",
  "(device) Select button pressed, firingMode 1",
].join("\n");

describe("extractRpmCsv", () => {
  it("finds the block inside surrounding chatter and strips the prefix", () => {
    const csv = extractRpmCsv(noise);
    expect(csv).not.toBeNull();
    const lines = csv!.split("\n");
    expect(lines[0]).toMatch(/^Voltage_mv,Motor 2,/);
    expect(lines).toHaveLength(4); // header + 3 rows, chatter excluded
  });

  it("accepts a capture with no voltage column, as older firmware emitted", () => {
    const old = ["Motor 1,TargetRPM 1,Throttle 1,value 1,", "100,200,300,1", "110,200,305,2"].join(
      "\n",
    );
    expect(extractRpmCsv(old)).not.toBeNull();
  });

  it("returns null for a header with no rows, which is not a capture", () => {
    expect(extractRpmCsv("Motor 1,TargetRPM 1,Throttle 1,value 1,")).toBeNull();
  });

  it("returns null when there is no header at all", () => {
    expect(extractRpmCsv("(device) Rev switch pressed\n(device) 1,2,3,4")).toBeNull();
  });
});

describe("parseRpmCsv", () => {
  it("splits columns in strides of four, per motor", () => {
    const log = parseRpmCsv(extractRpmCsv(noise)!);
    expect(log.motors.map((m) => m.index)).toEqual([2, 4]);
    expect(log.motors[0].rpm).toEqual([1000, 5200, 31900]);
    expect(log.motors[0].targetRpm).toEqual([32000, 32000, 32000]);
    expect(log.motors[0].throttle).toEqual([120, 900, 640]);
    expect(log.motors[1].rpm).toEqual([1010, 5300, 31950]);
    expect(log.voltage).toEqual([16210, 16180, 16150]);
  });

  it("leaves voltage empty when the column is absent", () => {
    const log = parseRpmCsv("Motor 1,TargetRPM 1,Throttle 1,value 1,\n100,200,300,1");
    expect(log.voltage).toEqual([]);
    expect(log.motors[0].rpm).toEqual([100]);
  });

  it("returns nothing for an unrecognisable header", () => {
    expect(parseRpmCsv("a,b,c\n1,2,3").motors).toEqual([]);
  });
});

describe("findTrailingFlatStart", () => {
  it("finds a long flat tail", () => {
    const values = [...Array(50).keys()].map((i) => i * 100).concat(Array(300).fill(5000));
    const cut = findTrailingFlatStart(values, 200, 0.02);
    expect(cut).toBe(50);
  });

  it("leaves a capture alone when the tail is too short to matter", () => {
    const values = [...Array(50).keys()].map((i) => i * 100).concat(Array(30).fill(5000));
    expect(findTrailingFlatStart(values, 200, 0.02)).toBe(values.length);
  });

  // The reason the scan runs backward. A forward scan would stop at the first flat stretch and throw
  // away everything after it, shots included.
  it("does not cut at a flat stretch in the middle of a capture", () => {
    const values = [
      ...Array(50).fill(30000), // a full-speed hold, as flat as any idle tail
      ...[...Array(50).keys()].map((i) => 30000 - i * 100), // then activity
      ...Array(250).fill(1000), // then the real idle tail
    ];
    expect(findTrailingFlatStart(values, 200, 0.02)).toBe(100);
  });

  it("is a no-op on a series shorter than the minimum run", () => {
    expect(findTrailingFlatStart([1, 2, 3], 200, 0.02)).toBe(3);
  });
});

describe("niceStep", () => {
  it("lands on 1/2/5 times a power of ten", () => {
    expect(niceStep(100, 5)).toBe(20);
    expect(niceStep(47360, 5)).toBe(10000);
    expect(niceStep(9, 5)).toBe(2);
    expect(niceStep(0, 5)).toBe(1);
  });
});

describe("a full-length capture survives the console's log buffer", () => {
  /** One header plus `rows` data lines, the shape RpmLogger::dumpIfReady() writes. */
  const capture = (rows: number): string[] => {
    const lines = ["Voltage_mv,Motor 0,TargetRPM 0,Throttle 0,value 0,"];
    for (let i = 0; i < rows; i++) lines.push(`7400,${30000 + i},30000,500,1.00,`);
    return lines;
  };

  // MAX_RPM_LOG_LENGTH, and the default rpmLogLength - so this is the ordinary case, not the edge.
  const FULL = 2000;

  it("parses once the cap keeps the whole thing", () => {
    const kept = capture(FULL).slice(-LOG_LINE_CAP);
    const csv = extractRpmCsv(kept.join("\n"));
    expect(csv).not.toBeNull();
    expect(parseRpmCsv(csv!).motors[0].rpm).toHaveLength(FULL);
  });

  /**
   * The bug this cap exists for. extractRpmCsv() finds the block by its header, so a buffer that
   * holds only the tail of a capture yields nothing at all - "Take from device log" reported no
   * capture on a device that had just dumped one perfectly.
   */
  it("finds nothing when the header has been evicted", () => {
    expect(extractRpmCsv(capture(FULL).slice(-500).join("\n"))).toBeNull();
  });

  it("is sized above the firmware's ceiling, with room for surrounding chatter", () => {
    expect(LOG_LINE_CAP).toBeGreaterThan(FULL + 1);
  });
});

describe("when each motor first reached its target", () => {
  const log = (rpm: number[], targetRpm: number[]) => ({
    motors: [{ index: 0, rpm, targetRpm, throttle: rpm.map(() => 0) }],
    voltage: [],
  });

  it("finds the first sample at or above target", () => {
    const [hit] = targetCrossings(log([0, 100, 200, 300], [300, 300, 300, 300]));
    expect(hit.sample).toBe(3);
    expect(hit.target).toBe(300);
  });

  it("counts reaching it exactly, not only overshooting", () => {
    expect(targetCrossings(log([299, 300], [300, 300]))[0].sample).toBe(1);
  });

  /** A capture starts with the rev, so the opening samples can be asking for nothing yet. */
  it("ignores samples taken before a target was set", () => {
    const [hit] = targetCrossings(log([0, 0, 50, 300], [0, 0, 300, 300]));
    expect(hit.sample).toBe(3);
  });

  it("reports null rather than a number when it never got there", () => {
    const [miss] = targetCrossings(log([0, 100, 200], [300, 300, 300]));
    expect(miss.sample).toBeNull();
    expect(miss.target).toBe(300);
  });

  it("handles a motor that was never asked for anything", () => {
    const [idle] = targetCrossings(log([0, 0], [0, 0]));
    expect(idle.sample).toBeNull();
    expect(idle.target).toBeNull();
    expect(idle.peak).toBeNull();
    expect(idle.overshoot).toBeNull();
  });

  it("keeps looking for the peak past the crossing", () => {
    const [hit] = targetCrossings(log([0, 300, 340, 310], [300, 300, 300, 300]));
    expect(hit.sample).toBe(1);
    expect(hit.peak).toBe(340);
    expect(hit.overshoot).toBe(40);
  });

  /** Samples taken before a target was set are not part of the rev the overshoot describes. */
  it("measures the peak only while the motor was being driven", () => {
    const [hit] = targetCrossings(log([900, 0, 100, 300], [0, 300, 300, 300]));
    expect(hit.peak).toBe(300);
    expect(hit.overshoot).toBe(0);
  });

  it("reports a negative overshoot when it never got up to target", () => {
    const [miss] = targetCrossings(log([0, 100, 200], [300, 300, 300]));
    expect(miss.peak).toBe(200);
    expect(miss.overshoot).toBe(-100);
  });

  it("reports one row per motor, keyed by the motor's own index", () => {
    const parsed = parseRpmCsv(
      ["Voltage_mv,Motor 1,TargetRPM 1,Throttle 1,value 1,Motor 3,TargetRPM 3,Throttle 3,value 3,",
       "7400,100,300,10,0.0,100,300,10,0.0,",
       "7400,300,300,10,0.0,200,300,10,0.0,"].join("\n"),
    );
    const crossings = targetCrossings(parsed);
    expect(crossings.map((c) => c.motor)).toEqual([1, 3]);
    expect(crossings[0].sample).toBe(1);
    expect(crossings[1].sample).toBeNull();
  });
});
