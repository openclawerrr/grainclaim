/**
 * Checks on the values read from one FSA-578 (Report of Acreage). A read
 * value's confidence comes from checks we can explain, not from the model
 * rating itself: a misread share breaks "a field's shares add up to 1".
 *
 * Each check uses only the values it names, so a failure points at them.
 * A check whose values weren't all read is "not_checked", never a pass.
 */
import {
  capitalize,
  fmt,
  keyPart,
  notChecked,
  round,
  same,
  sum,
  uniqueRowLabels,
  usable,
  valueLabel,
  yearOf,
  type DocumentCheck,
} from "./document-checks";

/** The read values the checks use. Null means the value wasn't read. */
export interface Fsa578CheckInput {
  program_year: number | null;
  farm_number: string | null;
  farmland_acres: number | null;
  cropland_acres: number | null;
  operator: { key: string | null };
  other_producers: readonly { key: string | null }[];
  fields: readonly {
    tract: string | null;
    field: string | null;
    crop_status: string | null;
    reported_acres: number | null;
    planting_date: string | null;
    shares: readonly { key: string | null; share: number | null }[];
  }[];
  total_operator_report: number | null;
  certification_date: string | null;
}

/** Each field line's name, by its farm, tract and field number: "field 1234/5678/3". */
export function fsaFieldLabels(form: Pick<Fsa578CheckInput, "farm_number" | "fields">): string[] {
  return uniqueRowLabels(
    form.fields.map((line) => `field ${keyPart(form.farm_number)}/${keyPart(line.tract)}/${keyPart(line.field)}`),
  );
}

/** Each share's name on one field line, by its producer key: "field 1234/6012/1 share 2". */
export function fsaShareLabels(fieldLabel: string, shares: readonly { key: string | null }[]): string[] {
  return uniqueRowLabels(shares.map((s) => `${fieldLabel} share ${keyPart(s.key)}`));
}

/** Each other producer's name, by key: "producer 2". */
export function fsaProducerLabels(producers: readonly { key: string | null }[]): string[] {
  return uniqueRowLabels(producers.map((p) => `producer ${keyPart(p.key)}`));
}

export const OPERATOR_ROW = "operator";

/**
 * Crop statuses for the first crop on the ground that season: initial,
 * prevented, failed, and their combinations. A double, subsequent or repeat
 * crop is reported on acres that are already counted once.
 */
const FIRST_CROP_STATUSES: ReadonlySet<string> = new Set(["I", "P", "F", "IF", "IP"]);

type FieldLine = Fsa578CheckInput["fields"][number];

/** One field's shares add up to 1. Each share is printed to four decimals, so thirds add up to 0.9999. */
function checkShares(line: FieldLine, fieldLabel: string): DocumentCheck {
  const id = "shares";
  const shareLabels = fsaShareLabels(fieldLabel, line.shares);
  const fields = shareLabels.map((label) => valueLabel(label, "share"));
  if (line.shares.length === 0) {
    return { id, status: "not_checked", fields, message: `${capitalize(fieldLabel)}'s shares can't be checked because none were read.` };
  }
  const missing = fields.filter((_, i) => !usable(line.shares[i].share));
  if (missing.length > 0) return notChecked(id, fields, missing, `${fieldLabel}'s shares`);

  const total = sum(line.shares.map((s) => s.share!));
  const rounding = 0.00005 * line.shares.length;
  if (Math.abs(total - 1) <= rounding + 1e-9) {
    return { id, status: "pass", fields, message: `${capitalize(fieldLabel)}'s shares add up to 1.` };
  }
  return { id, status: "fail", fields, message: `${capitalize(fieldLabel)}'s shares add up to ${fmt(round(total, 4))}, not 1.` };
}

/** Every share belongs to the operator or another producer listed on the form. */
function checkShareKeys(form: Fsa578CheckInput, fieldLabels: readonly string[]): DocumentCheck {
  const id = "share_keys";
  const producerKeys = [form.operator.key, ...form.other_producers.map((p) => p.key)];
  const producerFields = [
    valueLabel(OPERATOR_ROW, "key"),
    ...fsaProducerLabels(form.other_producers).map((label) => valueLabel(label, "key")),
  ];
  const shares = form.fields.flatMap((line, i) =>
    fsaShareLabels(fieldLabels[i], line.shares).map((label, j) => ({
      field: fieldLabels[i],
      name: valueLabel(label, "key"),
      key: line.shares[j].key,
    })),
  );
  const fields = [...shares.map((s) => s.name), ...producerFields];
  if (shares.length === 0) {
    return { id, status: "not_checked", fields, message: "Share keys can't be checked because no shares were read." };
  }
  const missing = [
    ...shares.filter((s) => s.key === null).map((s) => s.name),
    ...producerFields.filter((_, i) => producerKeys[i] === null),
  ];
  if (missing.length > 0) return notChecked(id, fields, missing, "share keys");

  const known = new Set(producerKeys);
  const stranger = shares.find((s) => !known.has(s.key));
  if (!stranger) {
    return { id, status: "pass", fields, message: "Every share belongs to a producer listed on the form." };
  }
  return {
    id,
    status: "fail",
    fields,
    message: `${capitalize(stranger.field)} has a share for key ${stranger.key}, which isn't a producer listed on the form.`,
  };
}

/** The fields' reported acres add up to the operator total. */
function checkAcresTotal(form: Fsa578CheckInput, fieldLabels: readonly string[]): DocumentCheck {
  const id = "acres_total";
  const acreFields = fieldLabels.map((label) => valueLabel(label, "reported_acres"));
  const fields = [...acreFields, "total_operator_report"];
  if (form.fields.length === 0) {
    return { id, status: "not_checked", fields, message: "The operator total can't be checked because no fields were read." };
  }
  const missing = [
    ...acreFields.filter((_, i) => !usable(form.fields[i].reported_acres)),
    ...(usable(form.total_operator_report) ? [] : ["total_operator_report"]),
  ];
  if (missing.length > 0) return notChecked(id, fields, missing, "the operator total");

  const expected = round(sum(form.fields.map((line) => line.reported_acres!)), 2);
  if (same(expected, form.total_operator_report!)) {
    return { id, status: "pass", fields, message: `Reported acres add up to the operator total (${fmt(expected)} acres).` };
  }
  return {
    id,
    status: "fail",
    fields,
    message: `The operator total reads ${fmt(form.total_operator_report!)} acres, but the fields' reported acres add up to ${fmt(expected)}.`,
  };
}

/** Cropland is part of farmland, so it can't be larger. */
function checkCropland(form: Fsa578CheckInput): DocumentCheck {
  const id = "cropland";
  const fields = ["cropland_acres", "farmland_acres"];
  const missing = fields.filter((_, i) => !usable([form.cropland_acres, form.farmland_acres][i]));
  if (missing.length > 0) return notChecked(id, fields, missing, "cropland");

  const [cropland, farmland] = [form.cropland_acres!, form.farmland_acres!];
  if (cropland <= farmland + 1e-9) {
    return { id, status: "pass", fields, message: `Cropland (${fmt(cropland)} acres) fits inside farmland (${fmt(farmland)} acres).` };
  }
  return { id, status: "fail", fields, message: `Cropland reads ${fmt(cropland)} acres, more than the farm's ${fmt(farmland)} acres of farmland.` };
}

/**
 * First crops can't cover more ground than the farm has. Farmland, not
 * cropland, is the limit, because pasture and other land uses are reported
 * too. A second crop on the same ground is reported again, so the check only
 * runs when every line is a first crop.
 */
function checkReportedAcres(form: Fsa578CheckInput, fieldLabels: readonly string[]): DocumentCheck {
  const id = "reported_acres";
  const statusFields = fieldLabels.map((label) => valueLabel(label, "crop_status"));
  const fields = ["total_operator_report", "farmland_acres", ...statusFields];
  const missing = [
    ...(usable(form.total_operator_report) ? [] : ["total_operator_report"]),
    ...(usable(form.farmland_acres) ? [] : ["farmland_acres"]),
    ...statusFields.filter((_, i) => form.fields[i].crop_status === null),
  ];
  if (missing.length > 0) return notChecked(id, fields, missing, "reported acres");

  if (form.fields.some((line) => !FIRST_CROP_STATUSES.has(line.crop_status!))) {
    return {
      id,
      status: "not_checked",
      fields,
      message: "Reported acres can't be checked against farmland because a second crop is reported on the same ground.",
    };
  }
  const [total, farmland] = [form.total_operator_report!, form.farmland_acres!];
  if (total <= farmland + 1e-9) {
    return { id, status: "pass", fields, message: `Reported acres (${fmt(total)}) fit inside farmland (${fmt(farmland)} acres).` };
  }
  return { id, status: "fail", fields, message: `The operator total reads ${fmt(total)} acres, more than the farm's ${fmt(farmland)} acres of farmland.` };
}

/**
 * A field was planted in the program year or the fall before it (winter
 * wheat), and no later than the day the form was certified.
 */
function checkPlantingDate(form: Fsa578CheckInput, line: FieldLine, fieldLabel: string): DocumentCheck {
  const id = "planting_date";
  const name = valueLabel(fieldLabel, "planting_date");
  const fields = [name, "program_year", "certification_date"];
  const missing = [...(line.planting_date === null ? [name] : []), ...(form.program_year === null ? ["program_year"] : [])];
  if (missing.length > 0) return notChecked(id, fields, missing, `${fieldLabel}'s planting date`);

  const [date, programYear] = [line.planting_date!, form.program_year!];
  const year = yearOf(date);
  if (year === null) {
    return { id, status: "fail", fields, message: `${capitalize(fieldLabel)}'s planting date reads "${date}", which isn't a calendar date.` };
  }
  if (year !== programYear && year !== programYear - 1) {
    return { id, status: "fail", fields, message: `${capitalize(fieldLabel)}'s planting date reads ${date}, outside the ${programYear} program year.` };
  }
  const certified = form.certification_date;
  // YYYY-MM-DD strings sort in date order.
  if (certified !== null && yearOf(certified) !== null && date > certified) {
    return { id, status: "fail", fields, message: `${capitalize(fieldLabel)}'s planting date reads ${date}, after the form was certified on ${certified}.` };
  }
  return { id, status: "pass", fields, message: `${capitalize(fieldLabel)} was planted ${date}, in time for the ${programYear} program year.` };
}

/** The form was certified in the program year, the fall before it, or the year after (a late-filed report). */
function checkCertificationDate(form: Fsa578CheckInput): DocumentCheck {
  const id = "certification_date";
  const fields = ["certification_date", "program_year"];
  const missing = fields.filter((_, i) => [form.certification_date, form.program_year][i] === null);
  if (missing.length > 0) return notChecked(id, fields, missing, "the certification date");

  const [date, programYear] = [form.certification_date!, form.program_year!];
  const year = yearOf(date);
  if (year === null) {
    return { id, status: "fail", fields, message: `The certification date reads "${date}", which isn't a calendar date.` };
  }
  if (Math.abs(year - programYear) <= 1) {
    return { id, status: "pass", fields, message: `The certification date (${date}) fits the ${programYear} program year.` };
  }
  return { id, status: "fail", fields, message: `The certification date reads ${date}, which doesn't fit the ${programYear} program year.` };
}

/** Runs every check on one FSA-578's read values. */
export function checkFsa578(form: Fsa578CheckInput): DocumentCheck[] {
  const fieldLabels = fsaFieldLabels(form);
  return [
    ...form.fields.map((line, i) => checkShares(line, fieldLabels[i])),
    checkShareKeys(form, fieldLabels),
    checkAcresTotal(form, fieldLabels),
    checkCropland(form),
    checkReportedAcres(form, fieldLabels),
    ...form.fields.map((line, i) => checkPlantingDate(form, line, fieldLabels[i])),
    checkCertificationDate(form),
  ];
}
