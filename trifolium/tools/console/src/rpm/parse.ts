// Parsing the CSV that RpmLogger::dumpIfReady() writes (src/rpmLogger.h).
//
// Ported from tools/serial-config.html, which is proven against real captures. The shape is an
// optional leading "Voltage_mv" column, then "Motor N,TargetRPM N,Throttle N,value N," repeated per
// enabled motor, then one row per captured control-loop tick in the same column order.
//
// The log arrives interleaved with ordinary device chatter, so it has to be found inside a larger
// blob of text rather than parsed from a clean file.

export interface MotorSeries {
  index: number;
  rpm: number[];
  targetRpm: number[];
  throttle: number[];
}

export interface RpmLog {
  motors: MotorSeries[];
  /** Empty for captures taken before the voltage column existed. */
  voltage: number[];
}

/**
 * How many device lines the console's log must keep for a capture to remain readable.
 *
 * Sized here rather than in the log view, because it is this parser that imposes it: a capture is
 * one header line plus one row per sample, extractRpmCsv() finds the block by its *header*, and the
 * firmware's ceiling is 2000 samples. A smaller buffer keeps only the tail of a default-length
 * capture, the header having been evicted, so "Take from device log" can never work - which is
 * exactly how it failed on the bench. Keep this above the largest rpmLogLength the firmware allows.
 */
export const LOG_LINE_CAP = 4000;

// The Voltage_mv prefix is optional so older logs still parse.
const HEADER_RE = /^(?:Voltage_mv,)?(?:Motor \d+,TargetRPM \d+,Throttle \d+,value \d+,?)+$/;
const DATA_ROW_RE = /^[\d.\-,]+$/;

/**
 * Pulls the CSV block out of arbitrary log text, stripping the console's "(device) " prefix.
 *
 * Returns null when there is no header, or a header with no rows - a header alone is not a capture.
 */
export function extractRpmCsv(rawText: string): string | null {
  const lines = rawText.split(/\r?\n/).map((l) => l.replace(/^\s*\(device\)\s*/, "").trim());

  const headerIdx = lines.findIndex((l) => HEADER_RE.test(l));
  if (headerIdx === -1) return null;

  const csv = [lines[headerIdx]];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (!DATA_ROW_RE.test(lines[i])) break;
    csv.push(lines[i]);
  }
  return csv.length > 1 ? csv.join("\n") : null;
}

/** The "value" column (the PID integral) is read past but not returned - nothing charts it. */
export function parseRpmCsv(text: string): RpmLog {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return { motors: [], voltage: [] };

  const headerCells = lines[0]
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const hasVoltage = /^Voltage/i.test(headerCells[0] ?? "");
  const base = hasVoltage ? 1 : 0;

  const motors: MotorSeries[] = [];
  for (let i = base; i < headerCells.length; i += 4) {
    const m = /Motor (\d+)/.exec(headerCells[i]);
    if (!m) continue;
    motors.push({ index: Number(m[1]), rpm: [], targetRpm: [], throttle: [] });
  }
  if (!motors.length) return { motors: [], voltage: [] };

  const voltage: number[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cells = lines[r].split(",");
    if (hasVoltage) {
      const v = Number(cells[0]);
      if (Number.isFinite(v)) voltage.push(v);
    }
    motors.forEach((motor, i) => {
      const col = base + i * 4;
      const rpm = Number(cells[col]);
      const target = Number(cells[col + 1]);
      const throttle = Number(cells[col + 2]);
      if (Number.isFinite(rpm)) motor.rpm.push(rpm);
      if (Number.isFinite(target)) motor.targetRpm.push(target);
      if (Number.isFinite(throttle)) motor.throttle.push(throttle);
    });
  }
  return { motors, voltage };
}

/**
 * Index where a long flat tail begins, or values.length if there is not one worth trimming.
 *
 * RpmLogger captures a fixed number of samples, so a short rev leaves a long idle tail that squashes
 * the interesting transient into the left edge of the chart.
 *
 * Scanning backward is the whole point. A mid-capture hold - a dwell, or a steady full-speed stretch
 * between shots - is exactly as flat as the idle tail, so a forward scan stops at the first one it
 * meets and discards everything after it, shots included.
 */
export function findTrailingFlatStart(values: number[], minRun: number, jitterPct: number): number {
  if (values.length <= minRun) return values.length;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let i = values.length - 1;
  for (; i >= 0; i--) {
    const v = values[i];
    if (!Number.isFinite(v)) break;
    const nextMin = Math.min(min, v);
    const nextMax = Math.max(max, v);
    const nextSum = sum + v;
    const ref = Math.abs(nextSum / (values.length - i)) || 1;
    if ((nextMax - nextMin) / ref > jitterPct) break;
    min = nextMin;
    max = nextMax;
    sum = nextSum;
  }
  const start = i + 1;
  return values.length - start >= minRun ? start : values.length;
}

/** Round tick step for a range, so axis labels land on 1/2/5 x 10^n. */
export function niceStep(range: number, targetTicks: number): number {
  if (range <= 0) return 1;
  const raw = range / Math.max(1, targetTicks);
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) {
    if (raw <= m * mag) return m * mag;
  }
  return 10 * mag;
}

export interface Extent {
  min: number;
  max: number;
}

/** Extent over several series, padded out to round tick boundaries. */
export function extentOf(seriesValues: number[][]): Extent {
  let min = Infinity;
  let max = -Infinity;
  for (const values of seriesValues) {
    for (const v of values) {
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (min === Infinity) return { min: 0, max: 1 };
  if (min === max) return { min: min - 1, max: max + 1 };
  return { min, max };
}

/**
 * The control loop's tick, in milliseconds.
 *
 * `targetLoopTime_us` is 1000, and RpmLogger::record() is called once per tick, so one sample is
 * one millisecond. Used only to put a familiar unit next to a sample count - the sample index is
 * the measurement, this is the convenience.
 */
export const MS_PER_SAMPLE = 1;

export interface TargetCrossing {
  motor: number;
  /** First sample at or above target, or null if it never got there within the capture. */
  sample: number | null;
  /** The target it was chasing when it crossed, for the row to quote. */
  target: number | null;
  /** Highest RPM seen while the motor was being driven, or null if it never was. */
  peak: number | null;
  /** peak - target. Negative when the motor never got up to what it was asked for. */
  overshoot: number | null;
}

/**
 * When each motor first reached the RPM it was being asked for.
 *
 * The question a capture is usually taken to answer: how long the rev takes, and whether one motor
 * lags the others. Read off the data rather than eyeballed off the chart, because the interesting
 * differences are tens of milliseconds apart and the lines overlap there.
 *
 * A sample only counts once the motor has actually been given a target - a capture starts at the
 * beginning of the rev, so the first samples can carry a target of 0, and "already at zero" is not
 * reaching it.
 */
export function targetCrossings(log: RpmLog): TargetCrossing[] {
  return log.motors.map((m) => {
    let sample: number | null = null;
    let crossTarget: number | null = null;
    let firstTarget: number | null = null;
    let peak: number | null = null;

    // One pass, and it runs to the end of the capture rather than stopping at the crossing: the
    // peak is usually a little way past it.
    for (let i = 0; i < m.rpm.length; i++) {
      const target = m.targetRpm[i];
      if (!(target > 0)) continue;
      if (firstTarget === null) firstTarget = target;
      const rpm = m.rpm[i];
      if (!Number.isFinite(rpm)) continue;
      if (peak === null || rpm > peak) peak = rpm;
      if (sample === null && rpm >= target) {
        sample = i;
        crossTarget = target;
      }
    }

    const target = crossTarget ?? firstTarget;
    return {
      motor: m.index,
      sample,
      target,
      peak,
      overshoot: peak === null || target === null ? null : peak - target,
    };
  });
}
