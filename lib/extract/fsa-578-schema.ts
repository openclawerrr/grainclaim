/**
 * What a read of one FSA-578 (Report of Acreage) returns. Names match the
 * answer key in sample-data/documents-2026.json.
 *
 * There are two schemas, as for a ticket (see ticket-schema.ts):
 * - `fsa578ReadSchema` is what the app uses. Every value can be null: a blank
 *   box or writing that can't be read is null, never a guess.
 * - `fsa578WireSchema` is what Claude fills in. Structured outputs allow at
 *   most 16 values that are "this or null", so only the numbers and dates are
 *   nullable there. Missing text is "" and a code that isn't there is its own
 *   choice. `fromFsa578Wire` turns those into nulls.
 */
import { z } from "zod";
import { CROPS } from "../rules/crops";
import { valueLabel } from "../rules/document-checks";
import { fsaFieldLabels, fsaProducerLabels, fsaShareLabels, OPERATOR_ROW } from "../rules/fsa-578-checks";
import type { NamedValue } from "./score-document";
import { shareAsFraction, textOrNull } from "./wire";

/** Practice codes from the form's footnote 1: irrigated, non-irrigated, other. */
export const FSA_PRACTICES = ["I", "N", "O"] as const;
/** Crop status codes from the form's footnote 2. */
export const FSA_CROP_STATUSES = ["I", "P", "F", "S", "D", "R", "V", "E", "IF", "IP", "SF", "DF", "DP"] as const;

// ---------------------------------------------------------------------------
// What the app uses
// ---------------------------------------------------------------------------

const text = z.string().min(1).nullable();
const decimal = z.number().nullable();
const date = z.iso.date().nullable();

export const fsa578ReadSchema = z.object({
  program_year: z.number().int().nullable(),
  farm_number: text,
  farmland_acres: decimal,
  cropland_acres: decimal,
  /** The operator, whose key is printed beside the name. */
  operator: z.object({ key: text, name: text, address: text }),
  /** Everyone else with a share in a crop on this farm, such as a landlord. */
  other_producers: z.array(z.object({ key: text, name: text })),
  /** One line per field and crop. */
  fields: z.array(
    z.object({
      tract: text,
      field: text,
      crop: z.enum(CROPS).nullable(),
      /** As printed, such as "YEL". */
      crop_type: text,
      /** As printed, such as "GR" for grain. */
      intended_use: text,
      practice: z.enum(FSA_PRACTICES).nullable(),
      crop_status: z.enum(FSA_CROP_STATUSES).nullable(),
      reported_acres: decimal,
      /** YYYY-MM-DD. */
      planting_date: date,
      /** Who shares in this field's crop. A share is a fraction: 0.6667 for two thirds. */
      shares: z.array(z.object({ key: text, share: decimal })),
    }),
  ),
  total_operator_report: decimal,
  certified_by: text,
  /** YYYY-MM-DD. */
  certification_date: date,
});

export type Fsa578Read = z.infer<typeof fsa578ReadSchema>;

// ---------------------------------------------------------------------------
// What Claude fills in
// ---------------------------------------------------------------------------
// The descriptions are sent to the model with the schema. They say where a
// value sits on the form and how to write it, never what it should be.

const wireText = (description: string) => z.string().describe(`${description} "" if there is none.`);
const wireDecimal = (description: string) => z.number().nullable().describe(description);
const wireDate = (description: string) =>
  z.iso.date().nullable().describe(`${description} As YYYY-MM-DD. US forms write month-day-year.`);

export const fsa578WireSchema = z.object({
  program_year: z.number().int().nullable().describe("The program year, from the PROGRAM YR. box."),
  farm_number: wireText("The farm number, from the FARM NO. box, digits exactly as printed."),
  farmland_acres: wireDecimal("Farmland acres, from the FARMLAND box."),
  cropland_acres: wireDecimal("Cropland acres, from the CROPLAND box."),
  operator: z
    .object({
      key: wireText("The key number printed beside the operator's name and address."),
      name: wireText("The operator's name: the first line of the OPERATOR NAME AND ADDRESS box."),
      address: wireText(
        "The operator's address: the lines under the name, on one line with its parts separated by commas.",
      ),
    })
    .describe("The farm's operator."),
  other_producers: z
    .array(
      z.object({
        key: wireText("The key number on this producer's row."),
        name: wireText("The producer's name, as printed."),
      }),
    )
    .describe("One entry for each filled-in row under NAMES OF OTHER PRODUCERS. Empty if there are none."),
  fields: z
    .array(
      z.object({
        tract: wireText("The tract number on this line, digits exactly as printed."),
        field: wireText("The field number on this line, exactly as printed."),
        crop: z
          .enum([...CROPS, "other"])
          .describe('The crop or land use named on this line. "other" if it is none of these or isn\'t written.'),
        crop_type: wireText(
          "The crop's variety or type abbreviation, such as YEL for yellow corn. It is printed with the crop or in its own column.",
        ),
        intended_use: wireText(
          "The intended use abbreviation, such as GR for grain. It is printed after the variety or type, or in its own column.",
        ),
        practice: z
          .enum([...FSA_PRACTICES, "unmarked"])
          .describe("The code in the PRACTICE column on this line. The form's footnote says what each code means."),
        crop_status: z
          .enum([...FSA_CROP_STATUSES, "unmarked"])
          .describe("The code in the CROP STATUS column on this line. The form's footnote says what each code means."),
        reported_acres: wireDecimal(
          "The acres reported on this line, from the crop's column of the CROP OR LAND USE SUMMARY.",
        ),
        planting_date: wireDate("The planting date written on this line."),
        shares: z
          .array(
            z.object({
              key: wireText("A producer's key number, from the KEY column beside this line."),
              share: wireDecimal("That producer's share, from the SHARE column, as printed: 0.6667, or 66.67 if the form prints percents."),
            }),
          )
          .describe(
            "One entry for each key and share printed beside this line. A line shared by two producers has two.",
          ),
      }),
    )
    .describe("One entry for each filled-in line of the table of tracts and fields."),
  total_operator_report: wireDecimal("The acres on the TOTAL OPERATOR REPORT line, as written."),
  certified_by: wireText("The name signed in the first CERTIFIER'S SIGNATURE box, as written."),
  certification_date: wireDate("The date beside the first certifier's signature."),
});

export type Fsa578Wire = z.infer<typeof fsa578WireSchema>;

/** Claude's answer as the app's values: "" and codes that aren't there become null. Not yet validated. */
export function fromFsa578Wire(wire: Fsa578Wire) {
  return {
    ...wire,
    farm_number: textOrNull(wire.farm_number),
    operator: {
      key: textOrNull(wire.operator.key),
      name: textOrNull(wire.operator.name),
      address: textOrNull(wire.operator.address),
    },
    other_producers: wire.other_producers.map((p) => ({ key: textOrNull(p.key), name: textOrNull(p.name) })),
    fields: wire.fields.map((line) => ({
      ...line,
      tract: textOrNull(line.tract),
      field: textOrNull(line.field),
      crop: line.crop === "other" ? null : line.crop,
      crop_type: textOrNull(line.crop_type),
      intended_use: textOrNull(line.intended_use),
      practice: line.practice === "unmarked" ? null : line.practice,
      crop_status: line.crop_status === "unmarked" ? null : line.crop_status,
      shares: line.shares.map((s) => ({ key: textOrNull(s.key), share: shareAsFraction(s.share) })),
    })),
    certified_by: textOrNull(wire.certified_by),
  };
}

// ---------------------------------------------------------------------------
// Every value, named
// ---------------------------------------------------------------------------

/**
 * Every value on the form with its name, in the order of the answer key.
 * A field line is named by its farm, tract and field number, a share by its
 * producer key, so the names don't depend on the order of the rows.
 */
export function fsa578Values(form: Fsa578Read): NamedValue[] {
  const fieldLabels = fsaFieldLabels(form);
  const producerLabels = fsaProducerLabels(form.other_producers);
  return [
    { label: "program_year", value: form.program_year },
    { label: "farm_number", value: form.farm_number },
    { label: "farmland_acres", value: form.farmland_acres },
    { label: "cropland_acres", value: form.cropland_acres },
    { label: valueLabel(OPERATOR_ROW, "key"), value: form.operator.key },
    { label: valueLabel(OPERATOR_ROW, "name"), value: form.operator.name, wording: true },
    { label: valueLabel(OPERATOR_ROW, "address"), value: form.operator.address, wording: true },
    ...form.other_producers.flatMap((producer, i): NamedValue[] => [
      { label: valueLabel(producerLabels[i], "key"), value: producer.key },
      { label: valueLabel(producerLabels[i], "name"), value: producer.name, wording: true },
    ]),
    ...form.fields.flatMap((line, i): NamedValue[] => {
      const row = fieldLabels[i];
      const shareLabels = fsaShareLabels(row, line.shares);
      return [
        { label: valueLabel(row, "tract"), value: line.tract },
        { label: valueLabel(row, "field"), value: line.field },
        { label: valueLabel(row, "crop"), value: line.crop },
        { label: valueLabel(row, "crop_type"), value: line.crop_type },
        { label: valueLabel(row, "intended_use"), value: line.intended_use },
        { label: valueLabel(row, "practice"), value: line.practice },
        { label: valueLabel(row, "crop_status"), value: line.crop_status },
        { label: valueLabel(row, "reported_acres"), value: line.reported_acres },
        { label: valueLabel(row, "planting_date"), value: line.planting_date },
        ...line.shares.flatMap((share, j): NamedValue[] => [
          { label: valueLabel(shareLabels[j], "key"), value: share.key },
          { label: valueLabel(shareLabels[j], "share"), value: share.share },
        ]),
      ];
    }),
    { label: "total_operator_report", value: form.total_operator_report },
    { label: "certified_by", value: form.certified_by, wording: true },
    { label: "certification_date", value: form.certification_date },
  ];
}
