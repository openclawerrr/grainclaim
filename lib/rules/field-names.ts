/**
 * What a field is called. FSA documents print a field's numbers but no name,
 * and farmers know their fields by name, so each new field is offered one the
 * way farmers name them: where it lies and about how big it is. The northern
 * field of about 80 acres is "North 80". The farmer can type over it.
 *
 * Pure: plain data in, names out. Safe in client components.
 */

/** The longest name that still fits on a map label. */
export const MAX_FIELD_NAME_LENGTH = 40;

/** A field to be named. */
export interface NameableField {
  /** The middle of its outline, as [longitude, latitude]. */
  center: readonly [number, number];
  /** Its acres, as the farmer knows them: the figure the FSA map prints. */
  acres: number;
  fsaTract: string;
  fsaField: string;
}

/** A name as the farmer typed it, with the spaces tidied. */
export function tidyFieldName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** True if two names would be the same field to the farmer: "North 80" and "north  80". */
export function sameFieldName(a: string, b: string): boolean {
  return tidyFieldName(a).toLowerCase() === tidyFieldName(b).toLowerCase();
}

/**
 * What is wrong with a name the farmer gave a new field, in one plain
 * sentence, or null if it is fine. `taken` are the names of the farm's other
 * fields, old and new.
 */
export function fieldNameProblem(name: string, taken: readonly string[]): string | null {
  const tidy = tidyFieldName(name);
  if (tidy === "") return "Give each field a name, such as North 80.";
  if (tidy.length > MAX_FIELD_NAME_LENGTH) {
    return `"${tidy}" is too long. Keep a field's name to ${MAX_FIELD_NAME_LENGTH} letters or fewer.`;
  }
  const same = taken.find((other) => sameFieldName(other, tidy));
  if (same !== undefined) return `You already have a field called ${same}. Give this one a different name.`;
  return null;
}

/**
 * A field's size as farmers say it: 80.2 acres is an "80", 156 a "160".
 * Rounded to the nearest 10 from 30 acres up, the nearest 5 below that, and
 * the nearest whole acre for a small patch.
 */
export function sizeWord(acres: number): string {
  if (!Number.isFinite(acres) || acres <= 0) return "";
  const step = acres >= 30 ? 10 : acres >= 5 ? 5 : 1;
  return String(Math.max(1, Math.round(acres / step) * step));
}

const METERS_PER_DEGREE = 111_320;
/** Closer to the middle of the fields than this, a field isn't north or south of anything. */
const NO_DIRECTION_METERS = 50;

interface Directions {
  /** North, South, East or West: the way the field lies from the middle of the fields. */
  main: string;
  /** The same, or Northeast and the like when the field lies well off to one side too. */
  fine: string;
}

function directionsOf(center: readonly [number, number], middle: readonly [number, number]): Directions | null {
  const east = (center[0] - middle[0]) * METERS_PER_DEGREE * Math.cos((middle[1] * Math.PI) / 180);
  const north = (center[1] - middle[1]) * METERS_PER_DEGREE;
  if (Math.hypot(east, north) < NO_DIRECTION_METERS) return null;
  const northSouth = north >= 0 ? "North" : "South";
  const eastWest = east >= 0 ? "East" : "West";
  const mostlyNorthSouth = Math.abs(north) >= Math.abs(east);
  const main = mostlyNorthSouth ? northSouth : eastWest;
  // Off the main line by more than half as far again: a corner field.
  const corner = Math.min(Math.abs(north), Math.abs(east)) * 2 > Math.max(Math.abs(north), Math.abs(east));
  return { main, fine: corner ? `${northSouth}${eastWest.toLowerCase()}` : main };
}

/**
 * A name for each field, in the order given: where it lies among the fields
 * being named, and its size. Two fields that would get the same name are told
 * apart by a finer direction ("Northeast 80"), and failing that by their FSA
 * numbers. A field with no others to lie north or south of is named by its
 * FSA field number. `taken` are names the farm already uses.
 */
export function defaultFieldNames(fields: readonly NameableField[], taken: readonly string[] = []): string[] {
  const middle: [number, number] = [
    fields.reduce((total, f) => total + f.center[0], 0) / Math.max(1, fields.length),
    fields.reduce((total, f) => total + f.center[1], 0) / Math.max(1, fields.length),
  ];
  const choices = fields.map((field) => {
    const directions = fields.length > 1 ? directionsOf(field.center, middle) : null;
    const size = sizeWord(field.acres);
    const byNumber = `Field ${field.fsaField}`;
    return [
      ...(directions && size ? [`${directions.main} ${size}`, `${directions.fine} ${size}`] : []),
      byNumber,
      `Tract ${field.fsaTract} field ${field.fsaField}`,
    ];
  });

  // Each field starts with its first choice. Fields whose name is shared, or already used on the farm, move to
  // their next choice, until every name is its own or the choices run out.
  const picked = choices.map(() => 0);
  const nameOf = (i: number) => choices[i][picked[i]];
  for (let round = 0; round < 4; round++) {
    const names = choices.map((_, i) => nameOf(i));
    const clashes = names.map(
      (name, i) => names.some((other, j) => j !== i && sameFieldName(other, name)) || taken.some((used) => sameFieldName(used, name)),
    );
    if (!clashes.some(Boolean)) break;
    clashes.forEach((clash, i) => {
      if (clash && picked[i] < choices[i].length - 1) picked[i] += 1;
    });
  }
  return choices.map((_, i) => nameOf(i));
}
