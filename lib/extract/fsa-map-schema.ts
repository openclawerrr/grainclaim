/**
 * What a read of one FSA aerial map returns: the farm, its tracts, and each
 * outlined field's number, acres and status. Names match the answer key in
 * sample-data/documents-2026.json.
 *
 * There are no coordinates. A photo of a map doesn't say where on the earth
 * its fields are; placing them is the job of the step that pairs these values
 * with real field outlines.
 *
 * There are two schemas, as for a ticket (see ticket-schema.ts):
 * - `fsaMapReadSchema` is what the app uses. Every value can be null: a value
 *   that isn't on the map or can't be read is null, never a guess.
 * - `fsaMapWireSchema` is what Claude fills in. Structured outputs allow at
 *   most 16 values that are "this or null", so only the numbers and the date
 *   are nullable there. Missing text is "" and a status that isn't shown is
 *   its own choice. `fromFsaMapWire` turns those into nulls.
 */
import { z } from "zod";
import { valueLabel } from "../rules/document-checks";
import { fsaMapFieldLabels, fsaMapTractLabels } from "../rules/fsa-map-checks";
import type { NamedValue } from "./score-document";
import { stateCode, textOrNull } from "./wire";

/** Erodibility as a field's label prints it: highly erodible, not highly erodible, undetermined. */
export const FSA_HEL_STATUSES = ["HEL", "NHEL", "UHEL"] as const;
/** Whether a field counts toward its tract's cropland total. The map shows it by how the field is drawn. */
export const FSA_LAND_USES = ["cropland", "non_cropland"] as const;

// ---------------------------------------------------------------------------
// What the app uses
// ---------------------------------------------------------------------------

const text = z.string().min(1).nullable();
const decimal = z.number().nullable();

export const fsaMapReadSchema = z.object({
  program_year: z.number().int().nullable(),
  farm_number: text,
  /** The two-letter postal code. */
  state: z.string().length(2).nullable(),
  county: text,
  /** YYYY-MM-DD. */
  map_created_date: z.iso.date().nullable(),
  tracts: z.array(
    z.object({
      tract: text,
      /** The tract's cropland total, as printed. */
      cropland_acres: decimal,
      /** One entry per field outlined inside the tract's boundary. */
      fields: z.array(
        z.object({
          field: text,
          acres: decimal,
          hel: z.enum(FSA_HEL_STATUSES).nullable(),
          land_use: z.enum(FSA_LAND_USES).nullable(),
        }),
      ),
    }),
  ),
  /** The section, township and range printed on the photo, as printed. */
  plss_label: text,
  /** The imagery's year and program, such as "2021 NAIP imagery". */
  imagery_credit: text,
});

export type FsaMapRead = z.infer<typeof fsaMapReadSchema>;

// ---------------------------------------------------------------------------
// What Claude fills in
// ---------------------------------------------------------------------------
// The descriptions are sent to the model with the schema. They say where a
// value sits on the map and how to write it, never what it should be.

const wireText = (description: string) => z.string().describe(`${description} "" if there is none.`);
const wireDecimal = (description: string) => z.number().nullable().describe(description);

export const fsaMapWireSchema = z.object({
  program_year: z.number().int().nullable().describe("The program year, from the map's heading."),
  farm_number: wireText("The farm number, from the map's heading, digits exactly as printed."),
  state: wireText("The state named in the map's heading, as printed: its name or its two-letter abbreviation."),
  county: wireText('The county named in the map\'s heading, without the word "County".'),
  map_created_date: z.iso
    .date()
    .nullable()
    .describe("The date the map was created or printed, from its heading. As YYYY-MM-DD."),
  tracts: z
    .array(
      z.object({
        tract: wireText(
          "The tract number, digits exactly as printed. It is printed in the heading, inside the tract's boundary on the photo, or both.",
        ),
        cropland_acres: wireDecimal(
          "This tract's cropland total, as printed beside the tract number or under a heading such as Tract Cropland Total.",
        ),
        fields: z
          .array(
            z.object({
              field: wireText("The field number: the number that starts the label printed inside this field's outline."),
              acres: wireDecimal("The acres in this field's label, as printed."),
              hel: z
                .enum([...FSA_HEL_STATUSES, "unmarked"])
                .describe(
                  'The erodibility code in this field\'s label: HEL, NHEL or UHEL. "unmarked" if the label has none.',
                ),
              land_use: z
                .enum([...FSA_LAND_USES, "not_shown"])
                .describe(
                  "Whether this field is cropland, by how it is drawn. Compare its outline and fill with the legend's cropland and non-cropland samples. " +
                    '"not_shown" if the map has no such legend or the field matches neither sample.',
                ),
            }),
          )
          .describe(
            "One entry for each field outlined inside this tract's boundary. A field belongs to the tract whose boundary surrounds it.",
          ),
      }),
    )
    .describe("One entry for each tract on the map."),
  plss_label: wireText(
    "The section, township and range label printed on the photo, exactly as printed, with any words printed before it.",
  ),
  imagery_credit: wireText(
    'The year and program of the aerial imagery, in the words the map\'s imagery credit uses, such as "2021 NAIP imagery". ' +
      "Give only the year and the program: leave out the agency, any license note, and a heading before it.",
  ),
});

export type FsaMapWire = z.infer<typeof fsaMapWireSchema>;

/** Claude's answer as the app's values: "" and statuses that aren't shown become null. Not yet validated. */
export function fromFsaMapWire(wire: FsaMapWire) {
  return {
    ...wire,
    farm_number: textOrNull(wire.farm_number),
    state: stateCode(wire.state),
    county: textOrNull(wire.county),
    tracts: wire.tracts.map((tract) => ({
      ...tract,
      tract: textOrNull(tract.tract),
      fields: tract.fields.map((line) => ({
        ...line,
        field: textOrNull(line.field),
        hel: line.hel === "unmarked" ? null : line.hel,
        land_use: line.land_use === "not_shown" ? null : line.land_use,
      })),
    })),
    plss_label: textOrNull(wire.plss_label),
    imagery_credit: textOrNull(wire.imagery_credit),
  };
}

// ---------------------------------------------------------------------------
// Every value, named
// ---------------------------------------------------------------------------

/**
 * Every value on the map with its name, in the order of the answer key. A
 * tract is named by its farm and tract number and a field by its farm, tract
 * and field number, so the names don't depend on the order they were read in.
 */
export function fsaMapValues(map: FsaMapRead): NamedValue[] {
  const tractLabels = fsaMapTractLabels(map);
  const fieldLabels = fsaMapFieldLabels(map);
  return [
    { label: "program_year", value: map.program_year },
    { label: "farm_number", value: map.farm_number },
    { label: "state", value: map.state },
    { label: "county", value: map.county },
    { label: "map_created_date", value: map.map_created_date },
    ...map.tracts.flatMap((tract, i): NamedValue[] => [
      { label: valueLabel(tractLabels[i], "tract"), value: tract.tract },
      { label: valueLabel(tractLabels[i], "cropland_acres"), value: tract.cropland_acres },
      ...tract.fields.flatMap((line, j): NamedValue[] => {
        const row = fieldLabels[i][j];
        return [
          { label: valueLabel(row, "field"), value: line.field },
          { label: valueLabel(row, "acres"), value: line.acres },
          { label: valueLabel(row, "hel"), value: line.hel },
          { label: valueLabel(row, "land_use"), value: line.land_use },
        ];
      }),
    ]),
    { label: "plss_label", value: map.plss_label, wording: true },
    { label: "imagery_credit", value: map.imagery_credit, wording: true },
  ];
}
