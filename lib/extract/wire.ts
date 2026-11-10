/**
 * Turning what Claude fills in into the app's values, for the FSA-578 and
 * Summary of Coverage readers. The model copies what is printed; anything
 * that takes arithmetic happens here.
 */

/** "" (nothing there) becomes null. */
export const textOrNull = (value: string) => value.trim() || null;

/** A percent as printed (75 for 75%) as a fraction (0.75). */
export function percentToFraction(percent: number | null): number | null {
  if (percent === null) return null;
  return Math.round(percent * 10_000) / 1_000_000;
}

/**
 * A share as a fraction. Forms print a share either as a fraction (0.6667)
 * or as a percent (66.67), so anything above 1 is taken as a percent.
 */
export function shareAsFraction(share: number | null): number | null {
  if (share === null) return null;
  return share > 1 ? percentToFraction(share) : share;
}
