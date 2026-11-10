/**
 * Checks on the values read from one crop insurance Summary of Coverage.
 * A read value's confidence comes from checks we can explain, not from the
 * model rating itself: a misread acre or yield breaks "approved yield ×
 * coverage level × acres × share = guarantee".
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
import { RuleInputError } from "./errors";
import { guaranteeBushels } from "./unit";

/** The read values the checks use. Null means the value wasn't read. Coverage level, price election and share are fractions. */
export interface SummaryOfCoverageCheckInput {
  issued_date: string | null;
  crop_year: number | null;
  coverage_level: number | null;
  price_election: number | null;
  projected_price: number | null;
  units: readonly {
    unit_number: string | null;
    acres: number | null;
    insured_share: number | null;
    approved_yield: number | null;
    guarantee_bu_per_acre: number | null;
    guarantee_bu: number | null;
    liability: number | null;
  }[];
  total_acres: number | null;
  total_guarantee_bu: number | null;
  total_liability: number | null;
}

type Unit = SummaryOfCoverageCheckInput["units"][number];

/** Each unit's name, by its unit number: "unit 2". */
export function coverageUnitLabels(units: readonly { unit_number: string | null }[]): string[] {
  return uniqueRowLabels(units.map((unit) => `unit ${keyPart(unit.unit_number)}`));
}

/** The names of the values that weren't read, from [name, value] pairs. */
const unread = (values: readonly (readonly [string, number | null])[]) =>
  values.filter(([, value]) => !usable(value)).map(([name]) => name);

/** Approved yield × coverage level = the guarantee per acre, at whatever precision the document prints it. */
function checkGuaranteePerAcre(policy: SummaryOfCoverageCheckInput, unit: Unit, label: string): DocumentCheck {
  const id = "guarantee_per_acre";
  const values = [
    [valueLabel(label, "approved_yield"), unit.approved_yield],
    ["coverage_level", policy.coverage_level],
    [valueLabel(label, "guarantee_bu_per_acre"), unit.guarantee_bu_per_acre],
  ] as const;
  const fields = values.map(([name]) => name);
  const missing = unread(values);
  if (missing.length > 0) return notChecked(id, fields, missing, `${label}'s guarantee per acre`);

  const expected = unit.approved_yield! * policy.coverage_level!;
  const read = unit.guarantee_bu_per_acre!;
  if ([0, 1, 2].some((places) => same(round(expected, places), read))) {
    return {
      id,
      status: "pass",
      fields,
      message: `${capitalize(label)}: ${fmt(unit.approved_yield!)} bu × ${fmt(policy.coverage_level! * 100)}% = ${fmt(read)} bu per acre.`,
    };
  }
  return {
    id,
    status: "fail",
    fields,
    message: `${capitalize(label)}'s guarantee per acre reads ${fmt(read)}, but approved yield × coverage level is ${fmt(round(expected, 2))}.`,
  };
}

/** The values the guarantee is worked out from, with their names. */
function guaranteeInputs(policy: SummaryOfCoverageCheckInput, unit: Unit, label: string) {
  return [
    [valueLabel(label, "approved_yield"), unit.approved_yield],
    ["coverage_level", policy.coverage_level],
    [valueLabel(label, "acres"), unit.acres],
    [valueLabel(label, "insured_share"), unit.insured_share],
  ] as const;
}

/** The unit's guarantee from lib/rules, or the sentence saying why its values can't describe one. */
function guaranteeOf(policy: SummaryOfCoverageCheckInput, unit: Unit): number | string {
  try {
    return guaranteeBushels({
      approvedYield: unit.approved_yield!,
      coverageLevel: policy.coverage_level!,
      acres: unit.acres!,
      share: unit.insured_share!,
    });
  } catch (error) {
    if (error instanceof RuleInputError) return error.message;
    throw error;
  }
}

/** Approved yield × coverage level × acres × share = the guarantee in whole bushels. */
function checkGuarantee(policy: SummaryOfCoverageCheckInput, unit: Unit, label: string): DocumentCheck {
  const id = "guarantee";
  const values = [...guaranteeInputs(policy, unit, label), [valueLabel(label, "guarantee_bu"), unit.guarantee_bu]] as const;
  const fields = values.map(([name]) => name);
  const missing = unread(values);
  if (missing.length > 0) return notChecked(id, fields, missing, `${label}'s guarantee`);

  const guarantee = guaranteeOf(policy, unit);
  if (typeof guarantee === "string") {
    return { id, status: "fail", fields, message: `${capitalize(label)}'s guarantee can't be worked out: ${guarantee}` };
  }
  const expected = Math.round(guarantee);
  if (same(expected, unit.guarantee_bu!)) {
    return {
      id,
      status: "pass",
      fields,
      message: `${capitalize(label)}: approved yield × coverage level × acres × share = ${fmt(expected)} bu.`,
    };
  }
  return {
    id,
    status: "fail",
    fields,
    message: `${capitalize(label)}'s guarantee reads ${fmt(unit.guarantee_bu!)} bu, but approved yield × coverage level × acres × share is ${fmt(expected)}.`,
  };
}

/**
 * Guarantee × projected price × price election = liability in whole dollars.
 * Insurers differ on whether they start from the guarantee as printed (whole
 * bushels) or unrounded, so either one may match.
 */
function checkLiability(policy: SummaryOfCoverageCheckInput, unit: Unit, label: string): DocumentCheck {
  const id = "liability";
  const values = [
    ...guaranteeInputs(policy, unit, label),
    [valueLabel(label, "guarantee_bu"), unit.guarantee_bu],
    ["projected_price", policy.projected_price],
    ["price_election", policy.price_election],
    [valueLabel(label, "liability"), unit.liability],
  ] as const;
  const fields = values.map(([name]) => name);
  const missing = unread(values);
  if (missing.length > 0) return notChecked(id, fields, missing, `${label}'s liability`);

  const perBushel = policy.projected_price! * policy.price_election!;
  const fromPrinted = Math.round(unit.guarantee_bu! * perBushel);
  const candidates = [fromPrinted];
  const guarantee = guaranteeOf(policy, unit);
  if (typeof guarantee === "number") candidates.push(Math.round(guarantee * perBushel));
  if (candidates.some((expected) => same(expected, unit.liability!))) {
    return {
      id,
      status: "pass",
      fields,
      message: `${capitalize(label)}: guarantee × $${fmt(policy.projected_price!)} × ${fmt(policy.price_election! * 100)}% price election = $${fmt(unit.liability!)}.`,
    };
  }
  return {
    id,
    status: "fail",
    fields,
    message: `${capitalize(label)}'s liability reads $${fmt(unit.liability!)}, but guarantee × projected price × price election is $${fmt(fromPrinted)}.`,
  };
}

/** The units' values add up to the total printed under them. */
function checkTotal(
  id: string,
  what: string,
  unitName: "acres" | "guarantee_bu" | "liability",
  totalName: "total_acres" | "total_guarantee_bu" | "total_liability",
  policy: SummaryOfCoverageCheckInput,
  labels: readonly string[],
  show: (n: number) => string,
): DocumentCheck {
  const values = [
    ...policy.units.map((unit, i) => [valueLabel(labels[i], unitName), unit[unitName]] as const),
    [totalName, policy[totalName]] as const,
  ];
  const fields = values.map(([name]) => name);
  if (policy.units.length === 0) {
    return { id, status: "not_checked", fields, message: `${capitalize(what)} can't be checked because no units were read.` };
  }
  const missing = unread(values);
  if (missing.length > 0) return notChecked(id, fields, missing, what);

  const expected = round(sum(policy.units.map((unit) => unit[unitName]!)), 2);
  const total = policy[totalName]!;
  if (same(expected, total)) {
    return { id, status: "pass", fields, message: `The units add up to ${what} (${show(total)}).` };
  }
  return { id, status: "fail", fields, message: `${capitalize(what)} reads ${show(total)}, but the units add up to ${show(expected)}.` };
}

/** The summary was issued in the crop year or the year before it (fall-planted crops). */
function checkIssuedDate(policy: SummaryOfCoverageCheckInput): DocumentCheck {
  const id = "issued_date";
  const fields = ["issued_date", "crop_year"];
  const missing = fields.filter((_, i) => [policy.issued_date, policy.crop_year][i] === null);
  if (missing.length > 0) return notChecked(id, fields, missing, "the issue date");

  const [date, cropYear] = [policy.issued_date!, policy.crop_year!];
  const year = yearOf(date);
  if (year === null) {
    return { id, status: "fail", fields, message: `The issue date reads "${date}", which isn't a calendar date.` };
  }
  if (year === cropYear || year === cropYear - 1) {
    return { id, status: "pass", fields, message: `The issue date (${date}) fits the ${cropYear} crop year.` };
  }
  return { id, status: "fail", fields, message: `The issue date reads ${date}, which doesn't fit the ${cropYear} crop year.` };
}

/** Runs every check on one Summary of Coverage's read values. */
export function checkSummaryOfCoverage(policy: SummaryOfCoverageCheckInput): DocumentCheck[] {
  const labels = coverageUnitLabels(policy.units);
  return [
    ...policy.units.flatMap((unit, i) => [
      checkGuaranteePerAcre(policy, unit, labels[i]),
      checkGuarantee(policy, unit, labels[i]),
      checkLiability(policy, unit, labels[i]),
    ]),
    checkTotal("total_acres", "the total acres", "acres", "total_acres", policy, labels, (n) => `${fmt(n)} acres`),
    checkTotal("total_guarantee", "the total guarantee", "guarantee_bu", "total_guarantee_bu", policy, labels, (n) => `${fmt(n)} bu`),
    checkTotal("total_liability", "the total liability", "liability", "total_liability", policy, labels, (n) => `$${fmt(n)}`),
    checkIssuedDate(policy),
  ];
}
