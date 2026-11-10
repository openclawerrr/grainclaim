/**
 * Checks on the values read from one FSA aerial map. A read value's
 * confidence comes from checks we can explain, not from the model rating
 * itself: a misread acre figure breaks "a tract's cropland fields add up to
 * its cropland total".
 *
 * Each check uses only the values it names, so a failure points at them.
 * A check whose values weren't all read is "not_checked", never a pass.
 */
import {
  capitalize,
  fmt,
  keyPart,
  listOf,
  notChecked,
  round,
  same,
  sum,
  uniqueRowLabels,
  usable,
  valueLabel,
  type DocumentCheck,
} from "./document-checks";

/** How a map marks a field that counts toward its tract's cropland total. */
export const CROPLAND = "cropland";

/** The read values the checks use. Null means the value wasn't read. */
export interface FsaMapCheckInput {
  farm_number: string | null;
  tracts: readonly {
    tract: string | null;
    cropland_acres: number | null;
    fields: readonly {
      field: string | null;
      acres: number | null;
      land_use: string | null;
    }[];
  }[];
}

type Tract = FsaMapCheckInput["tracts"][number];

/** Each tract's name, by its farm and tract number: "tract 1234/5678". */
export function fsaMapTractLabels(map: FsaMapCheckInput): string[] {
  return uniqueRowLabels(map.tracts.map((tract) => `tract ${keyPart(map.farm_number)}/${keyPart(tract.tract)}`));
}

/**
 * Each field's name, by its farm, tract and field number: "field 1234/5678/3",
 * the name the same field has on the FSA-578. One list per tract, in the
 * tracts' order.
 */
export function fsaMapFieldLabels(map: FsaMapCheckInput): string[][] {
  const labels = uniqueRowLabels(
    map.tracts.flatMap((tract) =>
      tract.fields.map((line) => `field ${keyPart(map.farm_number)}/${keyPart(tract.tract)}/${keyPart(line.field)}`),
    ),
  );
  let next = 0;
  return map.tracts.map((tract) => labels.slice(next, (next += tract.fields.length)));
}

/**
 * A tract's cropland fields add up to its cropland total. Fields the map
 * draws as non-cropland (a farmstead, a waterway, trees) aren't in that
 * total, so they aren't counted.
 */
function checkTractCropland(tract: Tract, tractLabel: string, fieldLabels: readonly string[]): DocumentCheck {
  const id = "tract_cropland";
  const total = valueLabel(tractLabel, "cropland_acres");
  const fields = [
    ...fieldLabels.flatMap((label) => [valueLabel(label, "acres"), valueLabel(label, "land_use")]),
    total,
  ];
  const what = `${tractLabel}'s cropland total`;
  if (tract.fields.length === 0) {
    return { id, status: "not_checked", fields, message: `${capitalize(what)} can't be checked because none of its fields were read.` };
  }
  const missing = [
    ...tract.fields.flatMap((line, i) => [
      // A field whose land use wasn't read might or might not count, so its acres are needed either way.
      ...(line.land_use !== "non_cropland" && !usable(line.acres) ? [valueLabel(fieldLabels[i], "acres")] : []),
      ...(line.land_use === null ? [valueLabel(fieldLabels[i], "land_use")] : []),
    ]),
    ...(usable(tract.cropland_acres) ? [] : [total]),
  ];
  if (missing.length > 0) return notChecked(id, fields, missing, what);

  const cropland = round(sum(tract.fields.filter((line) => line.land_use === CROPLAND).map((line) => line.acres!)), 2);
  if (same(cropland, tract.cropland_acres!)) {
    return {
      id,
      status: "pass",
      fields,
      message: `${capitalize(tractLabel)}'s cropland fields add up to its cropland total (${fmt(cropland)} acres).`,
    };
  }
  return {
    id,
    status: "fail",
    fields,
    message: `${capitalize(what)} reads ${fmt(tract.cropland_acres!)} acres, but its cropland fields add up to ${fmt(cropland)}.`,
  };
}

/** No field number appears twice in a tract. Two labels read with one number mean one of them was misread. */
function checkFieldNumbers(tract: Tract, tractLabel: string, fieldLabels: readonly string[]): DocumentCheck {
  const id = "field_numbers";
  const fields = fieldLabels.map((label) => valueLabel(label, "field"));
  const what = `${tractLabel}'s field numbers`;
  if (tract.fields.length === 0) {
    return { id, status: "not_checked", fields, message: `${capitalize(what)} can't be checked because none of its fields were read.` };
  }
  const missing = fields.filter((_, i) => tract.fields[i].field === null);
  if (missing.length > 0) return notChecked(id, fields, missing, what);

  const numbers = tract.fields.map((line) => line.field!);
  const repeated = [...new Set(numbers.filter((number, i) => numbers.indexOf(number) !== i))];
  if (repeated.length === 0) {
    return { id, status: "pass", fields, message: `${capitalize(what)} are all different.` };
  }
  return {
    id,
    status: "fail",
    fields,
    message: `${capitalize(tractLabel)} shows field ${listOf(repeated)} more than once.`,
  };
}

/** Runs every check on one FSA map's read values. */
export function checkFsaMap(map: FsaMapCheckInput): DocumentCheck[] {
  const tractLabels = fsaMapTractLabels(map);
  const fieldLabels = fsaMapFieldLabels(map);
  return [
    ...map.tracts.map((tract, i) => checkTractCropland(tract, tractLabels[i], fieldLabels[i])),
    ...map.tracts.map((tract, i) => checkFieldNumbers(tract, tractLabels[i], fieldLabels[i])),
  ];
}
