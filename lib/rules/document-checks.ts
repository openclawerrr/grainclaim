/**
 * What the checks on a read FSA-578 and Summary of Coverage share: the shape
 * of a check, how a value on a document is named, and the arithmetic helpers.
 *
 * A value is named by where it sits: "farm_number" at the top of a document,
 * "unit 2: acres" in a table row. Rows are named by what identifies them on
 * the document (a field's farm, tract and field number; a unit's number), not
 * by their position, so the same row has the same name in every read.
 */

export interface DocumentCheck {
  /** Which check this is, such as "shares". Row checks repeat it once per row. */
  id: string;
  status: "pass" | "fail" | "not_checked";
  /** The names of the read values this check compares. A failure means at least one of them is wrong. */
  fields: string[];
  /** One plain sentence saying what was compared and what was found. */
  message: string;
}

/** The name of a value in a row: "unit 2: acres". */
export function valueLabel(row: string, name: string): string {
  return `${row}: ${name}`;
}

/** One part of a row's name. A part that wasn't read shows as "?". */
export const keyPart = (value: string | null) => value ?? "?";

/**
 * Makes row names unique. Two rows that read with the same identifying
 * numbers become "unit 2" and "unit 2 (2nd)", so neither is lost.
 */
export function uniqueRowLabels(labels: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return labels.map((label) => {
    const count = (seen.get(label) ?? 0) + 1;
    seen.set(label, count);
    return count === 1 ? label : `${label} (${ordinal(count)})`;
  });
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** Rounds to `places` decimals the way documents print (half up, for our positive values). */
export function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor * (1 + Number.EPSILON)) / factor;
}

export const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
export const sum = (values: readonly number[]) => values.reduce((total, v) => total + v, 0);
export const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });
export const usable = (value: number | null): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

export function capitalize(sentence: string): string {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The year of a YYYY-MM-DD calendar date, or null if it isn't one. */
export function yearOf(date: string): number | null {
  if (!ISO_DATE.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  // An impossible date such as February 30 rolls over to another day.
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  return Number(date.slice(0, 4));
}

/** The result for a check that can't run because some of its values weren't read. `missing` are value names. */
export function notChecked(id: string, fields: string[], missing: readonly string[], what: string): DocumentCheck {
  const wasnt = missing.length === 1 ? "wasn't" : "weren't";
  return {
    id,
    status: "not_checked",
    fields,
    message: `${capitalize(what)} can't be checked because ${listOf(missing)} ${wasnt} read.`,
  };
}

/** The read values at least one failed check points at. */
export function valuesInFailedChecks(checks: readonly DocumentCheck[]): Set<string> {
  return new Set(checks.filter((c) => c.status === "fail").flatMap((c) => c.fields));
}
