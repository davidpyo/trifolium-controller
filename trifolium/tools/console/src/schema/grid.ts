// Value stepping that agrees with the device.
//
// steppedToGrid() is a line-for-line port of the same function in src/menu.h. It is the difference
// between the console and the on-device menu offering the same reachable values: the firmware does
// not add `step` to the current value, it moves to the next *multiple* of step, and it rounds the
// min and max onto that grid too. So with lo=5 step=5 the reachable set is 5, 10, ... 50, and a
// stored 23 becomes 25 on the first increment rather than 28.
//
// Keep this identical to the C++. If one changes, both change.

const floorDiv = (a: number, b: number): number => {
  const q = Math.trunc(a / b);
  return a % b !== 0 && a < 0 !== b < 0 ? q - 1 : q;
};

export function steppedToGrid(
  value: Bound,
  direction: -1 | 0 | 1,
  step: Bound,
  lo: Bound,
  hi: Bound,
  wrap = false,
): Bound {
  if (step <= 0 || direction === 0) return value;

  const gridLo = -floorDiv(-lo, step) * step; // ceil(lo / step) * step
  const gridHi = floorDiv(hi, step) * step; // floor(hi / step) * step

  let next =
    direction > 0 ? (floorDiv(value, step) + 1) * step : floorDiv(value - 1, step) * step;

  if (next > gridHi) next = wrap ? gridLo : gridHi;
  if (next < gridLo) next = wrap ? gridHi : gridLo;
  return next as Bound;
}

/**
 * Snaps a directly-entered value onto the same grid, nearest-first, then clamps.
 *
 * Console-only: the device has no typed entry, it only ever steps. Needed because a text field lets
 * someone enter a value between grid points, and leaving it there would show a number the on-device
 * menu can never display or return to.
 */
export function snapToGrid(value: Bound, step: Bound, lo: Bound, hi: Bound): Bound {
  const gridLo = -floorDiv(-lo, step) * step;
  const gridHi = floorDiv(hi, step) * step;
  if (step <= 0) return Math.min(Math.max(value, lo), hi) as Bound;

  const snapped = Math.round((value - gridLo) / step) * step + gridLo;
  return Math.min(Math.max(snapped, gridLo), gridHi) as Bound;
}

/** Range clamp with no grid snapping - matches what the firmware's clampToBounds() does on load. */
export const clamp = (value: number, lo: number, hi: number): number =>
  Math.min(Math.max(value, lo), hi);

// --- Float scaling ------------------------------------------------------------------------------
//
// A float-backed field reports its bounds as integers scaled by 10^decimals: KP 0.0-2.0 step 0.1
// arrives as lo=0 hi=200 step=10 decimals=2. The value in the JSON payload is the real float.
//
// The two spaces are different types, because mixing them is silent and expensive - stepping a real
// 0.2 against scaled bounds wrote a KP of 10, five times the field's own ceiling.

export const scaleOf = (decimals = 0): number => 10 ** decimals;

/** A number in the schema's scaled space. `asBound` is the only way to make one from a raw value. */
export type Bound = number & { readonly __bound: unique symbol };

/** For the schema reader, whose lo/hi/step arrive already scaled. */
export const asBound = (n: number): Bound => n as Bound;

/** Bound (200) to real value (2.0). */
export const boundsToReal = (bound: Bound, decimals = 0): number => bound / scaleOf(decimals);

/** Real value (0.2) to bounds space (20), for snapping and clamping. */
export const realToBounds = (real: number, decimals = 0): Bound =>
  Math.round(real * scaleOf(decimals)) as Bound;

/** A field's bounds, as the schema publishes them. */
export interface Band {
  lo: Bound;
  hi: Bound;
  step: Bound;
  decimals?: number;
}

/**
 * Snaps and clamps a real-unit value against scaled bounds, returning real units.
 *
 * The one function a numeric input should call, whatever the field's kind - it collapses the
 * int/float distinction so callers never handle the scaling themselves.
 */
export function snapReal(
  real: number,
  { lo, hi, step, decimals }: Band,
): number {
  const snapped = snapToGrid(realToBounds(real, decimals), step, lo, hi);
  const value = boundsToReal(snapped, decimals);
  // Re-round in real units: 20 / 100 is exact, but a scale of 1000 can leave float dust.
  return decimals ? Number(value.toFixed(decimals)) : value;
}

/**
 * Steps a real-unit value onto the grid against scaled bounds, returning real units.
 *
 * snapReal()'s twin, for the arrow keys. Stepping in real units instead would divide by a real
 * step and land on float dust; this keeps the arithmetic in the integer space the bounds are
 * already in.
 */
export function steppedReal(
  real: number,
  direction: -1 | 0 | 1,
  { lo, hi, step, decimals }: Band,
  wrap = false,
): number {
  const next = steppedToGrid(realToBounds(real, decimals), direction, step, lo, hi, wrap);
  const value = boundsToReal(next, decimals);
  return decimals ? Number(value.toFixed(decimals)) : value;
}
