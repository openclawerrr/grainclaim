/**
 * Turning what Claude fills in into the app's values, for the FSA-578,
 * Summary of Coverage and FSA map readers. The model copies what is printed;
 * anything that takes arithmetic or a lookup happens here.
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

/** US states and the District of Columbia, by postal code. */
const STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};
const lettersOnly = (text: string) => text.toLowerCase().replace(/[^a-z]/g, "");
const CODE_BY_NAME = new Map(Object.entries(STATES).map(([code, name]) => [lettersOnly(name), code]));

/**
 * A state as its two-letter postal code. Documents print either the name
 * ("Iowa") or the code ("IA"); the app stores the code. Anything that is
 * neither is null: not read, never a guess.
 */
export function stateCode(printed: string): string | null {
  const text = printed.trim();
  const code = text.toUpperCase();
  if (Object.hasOwn(STATES, code)) return code;
  return CODE_BY_NAME.get(lettersOnly(text)) ?? null;
}
