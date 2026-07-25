/** Max decimal places when no nice fraction matches. */
const MAX_DECIMALS = 3;

/** Float cleanup near whole numbers (e.g. 0.999999 → 1). */
const FLOAT_EPS = 1e-6;

/** Tolerance for matching float quantities to cooking fractions. */
const FRAC_EPS = 0.01;

/** Common cooking fractions (value → display). Ordered for stable matching. */
const FRACTIONS: readonly [number, string][] = [
  [1 / 8, "1/8"],
  [1 / 4, "1/4"],
  [1 / 3, "1/3"],
  [3 / 8, "3/8"],
  [1 / 2, "1/2"],
  [5 / 8, "5/8"],
  [2 / 3, "2/3"],
  [3 / 4, "3/4"],
  [7 / 8, "7/8"],
];

/**
 * Format an ingredient quantity for display.
 * Prefers common cooking fractions (1/3, 1 1/2, …); falls back to ≤3 decimals.
 */
export function formatQuantity(quantity: number): string {
  if (!Number.isFinite(quantity)) return String(quantity);

  const sign = quantity < 0 ? "-" : "";
  const abs = Math.abs(quantity);
  let whole = Math.floor(abs + FLOAT_EPS);
  let frac = abs - whole;

  // Float noise just below the next integer
  if (1 - frac < FLOAT_EPS) {
    whole += 1;
    frac = 0;
  }

  if (frac < FLOAT_EPS) {
    return sign + String(whole);
  }

  for (const [value, label] of FRACTIONS) {
    if (Math.abs(frac - value) < FRAC_EPS) {
      return whole === 0 ? sign + label : `${sign}${whole} ${label}`;
    }
  }

  return sign + String(Number(abs.toFixed(MAX_DECIMALS)));
}
