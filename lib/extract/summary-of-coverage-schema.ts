/**
 * What a read of one crop insurance Summary of Coverage returns. Names match
 * the database columns and the answer key in sample-data/documents-2026.json.
 *
 * There are two schemas, as for a ticket (see ticket-schema.ts):
 * - `summaryOfCoverageReadSchema` is what the app uses. Every value can be
 *   null: a value the insurer doesn't print is null, never a guess.
 * - `summaryOfCoverageWireSchema` is what Claude fills in. Structured outputs
 *   allow at most 16 values that are "this or null", so only the numbers and
 *   the date are nullable there. Missing text is "" and a choice that isn't
 *   there is "other". `fromSummaryOfCoverageWire` turns those into nulls.
 *
 * Percents are copied as printed (75 for 75%) and turned into the fractions
 * the app stores (0.75) in code, so the model does no arithmetic.
 */
import { z } from "zod";
import { CROPS } from "../rules/crops";
import { valueLabel } from "../rules/document-checks";
import { coverageUnitLabels } from "../rules/summary-of-coverage-checks";
import type { NamedValue } from "./score-document";
import { percentToFraction, shareAsFraction, textOrNull } from "./wire";

/** The insurance plans the policy table takes. */
export const INSURANCE_PLANS = ["RP", "RP-HPE", "YP"] as const;
/** Unit structures and unit types the policy and unit tables take. */
export const UNIT_KINDS = ["basic", "optional", "enterprise"] as const;
export const UNIT_PRACTICES = ["irrigated", "non-irrigated"] as const;

// ---------------------------------------------------------------------------
// What the app uses
// ---------------------------------------------------------------------------

const text = z.string().min(1).nullable();
const decimal = z.number().nullable();
const whole = z.number().int().nullable();

export const summaryOfCoverageReadSchema = z.object({
  insurer: text,
  agency: text,
  /** YYYY-MM-DD. */
  issued_date: z.iso.date().nullable(),
  insured_name: text,
  insured_address: text,
  policy_number: text,
  crop_year: whole,
  crop: z.enum(CROPS).nullable(),
  /** As printed, such as "Grain". */
  crop_type: text,
  /** Two-letter postal abbreviation. */
  state: z.string().regex(/^[A-Z]{2}$/).nullable(),
  county: text,
  plan: z.enum(INSURANCE_PLANS).nullable(),
  /** A fraction: 0.75 for 75%. The same for price election and a unit's share. */
  coverage_level: decimal,
  price_election: decimal,
  unit_structure: z.enum(UNIT_KINDS).nullable(),
  /** Dollars per bushel. */
  projected_price: decimal,
  units: z.array(
    z.object({
      unit_number: text,
      unit_type: z.enum(UNIT_KINDS).nullable(),
      practice: z.enum(UNIT_PRACTICES).nullable(),
      fsa_farm: text,
      fsa_tract: text,
      fsa_field: text,
      acres: decimal,
      insured_share: decimal,
      /** Bushels per acre. */
      approved_yield: decimal,
      guarantee_bu_per_acre: decimal,
      /** Whole bushels, as printed. */
      guarantee_bu: whole,
      /** Whole dollars, as printed. */
      liability: whole,
    }),
  ),
  total_acres: decimal,
  total_guarantee_bu: whole,
  total_liability: whole,
});

export type SummaryOfCoverageRead = z.infer<typeof summaryOfCoverageReadSchema>;

// ---------------------------------------------------------------------------
// What Claude fills in
// ---------------------------------------------------------------------------
// The descriptions are sent to the model with the schema. They say where a
// value sits on the document and how to write it, never what it should be.

const wireText = (description: string) => z.string().describe(`${description} "" if there is none.`);
const wireDecimal = (description: string) => z.number().nullable().describe(description);
const wireWhole = (description: string) => z.number().int().nullable().describe(description);

export const summaryOfCoverageWireSchema = z.object({
  insurer: wireText("The insurance company that issued the summary, as printed in its heading."),
  agency: wireText("The insurance agency or agent named on the summary, as printed."),
  issued_date: z.iso
    .date()
    .nullable()
    .describe("The date the summary was issued or printed, as YYYY-MM-DD. US documents write month-day-year."),
  insured_name: wireText("The insured's name, as printed."),
  insured_address: wireText(
    "The insured's address: the lines under the name, on one line with its parts separated by commas.",
  ),
  policy_number: wireText("The policy number, exactly as printed."),
  crop_year: wireWhole("The crop year the coverage is for."),
  crop: z
    .enum([...CROPS, "other"])
    .describe('The insured crop. "other" if it is none of these or isn\'t written.'),
  crop_type: wireText("The crop's type as printed beside the crop, such as Grain or Silage."),
  state: wireText("The state the crop is insured in, as its two-letter postal abbreviation: Iowa is IA."),
  county: wireText("The county the crop is insured in, without the word County."),
  plan: z
    .enum([...INSURANCE_PLANS, "other"])
    .describe(
      'The insurance plan: RP is Revenue Protection, RP-HPE is Revenue Protection with Harvest Price Exclusion, YP is Yield Protection. "other" if it is none of these or isn\'t written.',
    ),
  coverage_level_pct: wireDecimal("The coverage level, in percent as printed: 75 for 75%."),
  price_election_pct: wireDecimal("The price election, in percent as printed: 100 for 100%."),
  unit_structure: z
    .enum([...UNIT_KINDS, "other"])
    .describe('The policy\'s unit structure. "other" if it is none of these or isn\'t written.'),
  projected_price: wireDecimal("The projected price, in dollars per bushel, without the dollar sign."),
  units: z
    .array(
      z.object({
        unit_number: wireText("The unit number on this row, exactly as printed."),
        unit_type: z
          .enum([...UNIT_KINDS, "other"])
          .describe('The unit type on this row. "other" if it is none of these or isn\'t written.'),
        practice: z
          .enum([...UNIT_PRACTICES, "other"])
          .describe('The practice on this row. "other" if it is neither or isn\'t written.'),
        fsa_farm: wireText("The FSA farm number on this row."),
        fsa_tract: wireText("The FSA tract number on this row."),
        fsa_field: wireText("The FSA field number on this row."),
        acres: wireDecimal("The acres on this row, as printed."),
        insured_share: wireDecimal("The insured's share on this row, as printed: 0.6667, or 66.67 if the document prints percents."),
        approved_yield: wireDecimal("The approved yield on this row, in bushels per acre."),
        guarantee_bu_per_acre: wireDecimal("The guarantee per acre on this row, in bushels."),
        guarantee_bu: wireWhole("The guarantee on this row, in bushels, as printed. No thousands separator."),
        liability: wireWhole("The liability on this row, in dollars, as printed. No dollar sign or thousands separator."),
      }),
    )
    .describe("One entry for each row of the table of units. The total row is not a unit."),
  total_acres: wireDecimal("The acres on the total row, as printed."),
  total_guarantee_bu: wireWhole("The guarantee on the total row, in bushels, as printed."),
  total_liability: wireWhole("The liability on the total row, in dollars, as printed."),
});

export type SummaryOfCoverageWire = z.infer<typeof summaryOfCoverageWireSchema>;

const choiceOrNull = <T extends string>(value: T | "other") => (value === "other" ? null : value);

/** Claude's answer as the app's values: "" and "other" become null, percents become fractions. Not yet validated. */
export function fromSummaryOfCoverageWire(wire: SummaryOfCoverageWire) {
  const { coverage_level_pct, price_election_pct, ...rest } = wire;
  return {
    ...rest,
    insurer: textOrNull(wire.insurer),
    agency: textOrNull(wire.agency),
    insured_name: textOrNull(wire.insured_name),
    insured_address: textOrNull(wire.insured_address),
    policy_number: textOrNull(wire.policy_number),
    crop: choiceOrNull(wire.crop),
    crop_type: textOrNull(wire.crop_type),
    state: textOrNull(wire.state)?.toUpperCase() ?? null,
    county: textOrNull(wire.county),
    plan: choiceOrNull(wire.plan),
    coverage_level: percentToFraction(coverage_level_pct),
    price_election: percentToFraction(price_election_pct),
    unit_structure: choiceOrNull(wire.unit_structure),
    units: wire.units.map((unit) => ({
      ...unit,
      unit_number: textOrNull(unit.unit_number),
      unit_type: choiceOrNull(unit.unit_type),
      practice: choiceOrNull(unit.practice),
      fsa_farm: textOrNull(unit.fsa_farm),
      fsa_tract: textOrNull(unit.fsa_tract),
      fsa_field: textOrNull(unit.fsa_field),
      insured_share: shareAsFraction(unit.insured_share),
    })),
  };
}

// ---------------------------------------------------------------------------
// Every value, named
// ---------------------------------------------------------------------------

const POLICY_VALUES = [
  "insurer",
  "agency",
  "issued_date",
  "insured_name",
  "insured_address",
  "policy_number",
  "crop_year",
  "crop",
  "crop_type",
  "state",
  "county",
  "plan",
  "coverage_level",
  "price_election",
  "unit_structure",
  "projected_price",
] as const satisfies readonly (keyof SummaryOfCoverageRead)[];

const UNIT_VALUES = [
  "unit_number",
  "unit_type",
  "practice",
  "fsa_farm",
  "fsa_tract",
  "fsa_field",
  "acres",
  "insured_share",
  "approved_yield",
  "guarantee_bu_per_acre",
  "guarantee_bu",
  "liability",
] as const satisfies readonly (keyof SummaryOfCoverageRead["units"][number])[];

const TOTAL_VALUES = ["total_acres", "total_guarantee_bu", "total_liability"] as const;

/** Names and addresses: compared ignoring case, spacing and punctuation. */
const WORDING: ReadonlySet<string> = new Set(["insurer", "agency", "insured_name", "insured_address", "county"]);

/**
 * Every value on the summary with its name, in the order of the answer key.
 * A unit is named by its unit number, so the names don't depend on the order
 * of the rows.
 */
export function summaryOfCoverageValues(summary: SummaryOfCoverageRead): NamedValue[] {
  const unitLabels = coverageUnitLabels(summary.units);
  return [
    ...POLICY_VALUES.map((name) => ({ label: name, value: summary[name], wording: WORDING.has(name) })),
    ...summary.units.flatMap((unit, i) =>
      UNIT_VALUES.map((name) => ({ label: valueLabel(unitLabels[i], name), value: unit[name] })),
    ),
    ...TOTAL_VALUES.map((name) => ({ label: name, value: summary[name] })),
  ];
}
