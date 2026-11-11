/**
 * Season setup (spec Phase 3): what one crop year's records should be, worked
 * out from a read FSA-578, a read Summary of Coverage and the fields on the
 * farm map. Pure: plain data in, a proposal out. Nothing here saves anything.
 *
 * - The Summary of Coverage gives the policy and its units. Rows with the
 *   same unit number are one unit with several fields. A row names a field by
 *   FSA farm, tract and field; a row with a farm and tract but no field
 *   number covers every FSA-578 line in that tract.
 * - The FSA-578 gives each field's planted acres, planting date and practice.
 * - Lines and rows are matched to mapped fields by FSA numbers, never by name
 *   or by the order of the rows.
 * - A unit's guarantee is approved yield × coverage level × its fields'
 *   planted acres (from the FSA-578, added up) × the insured's share.
 * - A field on the FSA-578 that no row covers is kept, as not insured: it has
 *   a season and planted acres, but no unit and no guarantee.
 *
 * What stops a season from being set up comes back as plain sentences
 * (`problems`). What the farmer should look at but doesn't stop it comes back
 * as flags.
 *
 * Nothing here rounds a guarantee: round only when displaying.
 */
import { CROPS, type Crop } from "./crops";
import { listOf } from "./document-checks";
import { guaranteeBushels } from "./unit";

// ---------------------------------------------------------------------------
// What goes in
// ---------------------------------------------------------------------------

/** The FSA-578 values season setup uses. Null means the value wasn't read. */
export interface SeasonFsa578 {
  program_year: number | null;
  farm_number: string | null;
  fields: readonly {
    tract: string | null;
    field: string | null;
    crop: string | null;
    /** The form's code: I irrigated, N non-irrigated, O other. */
    practice: string | null;
    reported_acres: number | null;
    planting_date: string | null;
  }[];
}

/** The Summary of Coverage values season setup uses. Null means the value wasn't read or isn't printed. */
export interface SeasonCoverage {
  policy_number: string | null;
  crop_year: number | null;
  crop: string | null;
  state: string | null;
  county: string | null;
  plan: string | null;
  coverage_level: number | null;
  price_election: number | null;
  unit_structure: string | null;
  projected_price: number | null;
  /** One row per field or tract. Several rows can belong to one unit. */
  units: readonly {
    unit_number: string | null;
    unit_type: string | null;
    practice: string | null;
    fsa_farm: string | null;
    fsa_tract: string | null;
    /** Null on a row that covers a whole tract. */
    fsa_field: string | null;
    acres: number | null;
    insured_share: number | null;
    approved_yield: number | null;
  }[];
}

/** A field on the farm map. */
export interface MappedField {
  id: string;
  name: string;
  fsa_farm: string | null;
  fsa_tract: string | null;
  fsa_field: string | null;
  /** Acres the database measured from the outline. */
  mapped_acres: number | null;
}

// ---------------------------------------------------------------------------
// What comes out
// ---------------------------------------------------------------------------

export type UnitKind = "basic" | "optional" | "enterprise";
export type InsurancePlan = "RP" | "RP-HPE" | "YP";
/** A 100% share reads the same whether the land is owned or cash-rented; season setup saves it as owned. */
export type ShareArrangement = "owned" | "crop_share";

export interface ProposedPolicy {
  crop: Crop;
  state: string;
  county: string;
  crop_year: number;
  policy_number: string | null;
  plan: InsurancePlan;
  coverage_level: number;
  price_election: number;
  unit_structure: UnitKind;
  /** Bushels per acre. One for the policy: every row on the summary must show the same. */
  approved_yield: number;
  projected_price: number | null;
}

export interface ProposedFieldSeason {
  fieldId: string;
  fieldName: string;
  crop: Crop;
  /** From the FSA-578. */
  plantedAcres: number;
  plantingDate: string | null;
  practice: string;
  /** From the map, for comparing. */
  mappedAcres: number | null;
  /**
   * The acres on the Summary of Coverage row that covers this field. Null
   * when the row prints none, or the field is in no unit.
   */
  coverageAcres: number | null;
  /**
   * Set when that row covers a whole tract and this field shares it with
   * others: the tract's number. `coverageAcres` is then the tract's, not the
   * field's own.
   */
  coverageTract: string | null;
}

export interface ProposedUnit {
  unitNumber: string;
  unitType: UnitKind;
  practice: string;
  shareArrangement: ShareArrangement;
  /** The insured's share as a fraction, to four decimals as the database holds it. */
  insuredShare: number;
  /** The acres the Summary of Coverage shows for the unit: its rows added up. Null when a row prints none. */
  coverageAcres: number | null;
  /** Its fields' planted acres from the FSA-578, added up. */
  plantedAcres: number;
  /** Approved yield × coverage level × planted acres × share. Not rounded. */
  guaranteeBu: number;
  fields: ProposedFieldSeason[];
}

export type SeasonFlagType = "acre_mismatch" | "unreported_field" | "uninsured_field" | "field_not_on_map";

export interface ProposedFlag {
  type: SeasonFlagType;
  /** One plain sentence saying what is wrong, and what to do about it. */
  message: string;
  /** The record the flag is about. */
  about: { record: "unit"; unitNumber: string } | { record: "field"; fieldId: string } | { record: "fsa_578" };
  /** Fields the flag also concerns. */
  fieldIds: string[];
}

export interface SeasonProposal {
  policy: ProposedPolicy;
  units: ProposedUnit[];
  /** Fields on the FSA-578 that no unit covers. They get a season, marked not insured, and no guarantee. */
  uninsuredFields: ProposedFieldSeason[];
  flags: ProposedFlag[];
}

export type SeasonSetup = { ok: true; proposal: SeasonProposal } | { ok: false; problems: string[] };

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

/** Two documents print acres to the hundredth, so any difference they show is a difference. */
const PRINTED_ACRES_DIFFER = 0.005;
/**
 * An outline almost never measures exactly what was reported, so the map is
 * only called different when it is more than this share of the FSA-578's
 * acres away: 1%, most of an acre on an 80.
 */
export const MAP_ACRE_TOLERANCE = 0.01;

const UNIT_KINDS: readonly string[] = ["basic", "optional", "enterprise"];
const PLANS: readonly string[] = ["RP", "RP-HPE", "YP"];
const FSA_PRACTICES: Record<string, string> = { I: "irrigated", N: "non-irrigated", O: "other" };
const DEFAULT_PRACTICE = "non-irrigated";

const acres = (value: number) => value.toFixed(2);
const sum = (values: readonly number[]) => values.reduce((total, v) => total + v, 0);
const isCrop = (value: string | null): value is Crop => value !== null && (CROPS as readonly string[]).includes(value);
const usable = (value: number | null): value is number => typeof value === "number" && Number.isFinite(value);
const tractKey = (farm: string | null, tract: string | null) =>
  farm === null || tract === null ? null : `${farm.trim()}/${tract.trim()}`;
const fsaKey = (farm: string | null, tract: string | null, field: string | null) =>
  farm === null || tract === null || field === null ? null : `${farm.trim()}/${tract.trim()}/${field.trim()}`;
const fsaWords = (farm: string | null, tract: string | null, field: string | null) =>
  `FSA farm ${farm ?? "?"}, tract ${tract ?? "?"}${field === null ? "" : `, field ${field}`}`;

/** The map differs from the FSA-578 by more than the tolerance. */
export function mapDiffers(mappedAcres: number | null, reportedAcres: number): boolean {
  if (!usable(mappedAcres)) return false;
  return Math.abs(mappedAcres - reportedAcres) > reportedAcres * MAP_ACRE_TOLERANCE;
}

/** The policy from the Summary of Coverage, or what about it can't be used. */
function proposePolicy(coverage: SeasonCoverage, problems: string[]): ProposedPolicy | null {
  const missing = (
    [
      ["crop", coverage.crop],
      ["state", coverage.state],
      ["county", coverage.county],
      ["crop year", coverage.crop_year],
      ["plan", coverage.plan],
      ["coverage level", coverage.coverage_level],
      ["unit structure", coverage.unit_structure],
    ] as const
  )
    .filter(([, value]) => value === null)
    .map(([name]) => name);
  if (missing.length > 0) {
    problems.push(`The Summary of Coverage's ${listOf(missing)} couldn't be read, so the season can't be set up from it.`);
    return null;
  }

  const before = problems.length;
  if (!isCrop(coverage.crop)) problems.push(`The Summary of Coverage is for ${coverage.crop}, a crop GrainClaim doesn't handle yet.`);
  if (!PLANS.includes(coverage.plan!)) problems.push(`The Summary of Coverage's plan reads "${coverage.plan}", which GrainClaim doesn't know.`);
  if (!UNIT_KINDS.includes(coverage.unit_structure!)) {
    problems.push(`The Summary of Coverage's unit structure reads "${coverage.unit_structure}", which GrainClaim doesn't know.`);
  }
  const level = coverage.coverage_level!;
  if (!(level > 0 && level <= 0.95)) {
    problems.push(`The Summary of Coverage's coverage level reads ${Math.round(level * 100)}%, which can't be right.`);
  }

  const yields = [...new Set(coverage.units.map((row) => row.approved_yield))];
  if (yields.some((y) => !usable(y) || y <= 0)) {
    problems.push("A unit's approved yield couldn't be read from the Summary of Coverage.");
  } else if (yields.length > 1) {
    problems.push(
      `The units on the Summary of Coverage have different approved yields (${listOf(yields.map(String))}). GrainClaim keeps one approved yield per policy, so it can't set this season up yet.`,
    );
  }
  if (problems.length > before) return null;

  return {
    crop: coverage.crop as Crop,
    state: coverage.state!,
    county: coverage.county!,
    crop_year: coverage.crop_year!,
    policy_number: coverage.policy_number,
    plan: coverage.plan as InsurancePlan,
    coverage_level: level,
    // A summary that prints no price election insures at the full price.
    price_election: usable(coverage.price_election) ? coverage.price_election : 1,
    unit_structure: coverage.unit_structure as UnitKind,
    approved_yield: yields[0] as number,
    projected_price: coverage.projected_price,
  };
}

type CoverageRow = SeasonCoverage["units"][number];

/** One row of the Summary of Coverage, with the unit it belongs to and the fields it turns out to cover. */
interface Cover {
  unitNumber: string;
  row: CoverageRow;
  /** True for a row with no field number, which covers its whole tract. */
  wholeTract: boolean;
  fields: ProposedFieldSeason[];
}

/**
 * The units on the Summary of Coverage: its rows grouped by unit number, in
 * the order each unit first appears. A unit's rows must agree on what makes
 * it one unit: its type, practice and share.
 */
function groupUnits(coverage: SeasonCoverage, problems: string[]): Map<string, CoverageRow[]> {
  const units = new Map<string, CoverageRow[]>();
  for (const row of coverage.units) {
    if (row.unit_number === null) {
      problems.push("A unit's number couldn't be read from the Summary of Coverage.");
      continue;
    }
    units.set(row.unit_number, [...(units.get(row.unit_number) ?? []), row]);
  }
  for (const [unitNumber, rows] of units) {
    const label = `Unit ${unitNumber}`;
    if (rows.some((row) => !usable(row.insured_share) || row.insured_share <= 0 || row.insured_share > 1)) {
      problems.push(`${label}'s share couldn't be read from the Summary of Coverage.`);
    }
    for (const type of new Set(rows.map((row) => row.unit_type))) {
      if (type !== null && !UNIT_KINDS.includes(type)) problems.push(`${label}'s type reads "${type}", which GrainClaim doesn't know.`);
    }
    const disagree = (
      [
        ["type", rows.map((row) => row.unit_type)],
        ["practice", rows.map((row) => row.practice)],
        ["share", rows.map((row) => row.insured_share)],
      ] as const
    )
      .filter(([, values]) => new Set<string | number | null>(values).size > 1)
      .map(([name]) => name);
    if (disagree.length > 0) {
      problems.push(
        `${label} has rows on the Summary of Coverage that disagree on its ${listOf(disagree)}, so it can't be set up. Ask your agent which is right.`,
      );
    }
  }
  return units;
}

/**
 * The season the two documents describe for the fields on the map, with what
 * the farmer should look at, or the reasons it can't be set up.
 */
export function proposeSeason(fsa578: SeasonFsa578, coverage: SeasonCoverage, fields: readonly MappedField[]): SeasonSetup {
  const problems: string[] = [];
  const flags: ProposedFlag[] = [];

  if (coverage.units.length === 0) problems.push("No units could be read from the Summary of Coverage.");
  const policy = coverage.units.length > 0 ? proposePolicy(coverage, problems) : null;

  if (fsa578.program_year === null) {
    problems.push("The FSA-578's program year couldn't be read.");
  } else if (coverage.crop_year !== null && fsa578.program_year !== coverage.crop_year) {
    problems.push(
      `The FSA-578 is for ${fsa578.program_year} but the Summary of Coverage is for ${coverage.crop_year}. Add the two for the same year.`,
    );
  }
  if (fsa578.farm_number === null) problems.push("The FSA-578's farm number couldn't be read.");
  if (fsa578.fields.length === 0) problems.push("No fields could be read from the FSA-578.");

  const fieldByFsa = new Map<string, MappedField>();
  for (const field of fields) {
    const key = fsaKey(field.fsa_farm, field.fsa_tract, field.fsa_field);
    if (key) fieldByFsa.set(key, field);
  }

  // What each row of the summary covers: one named field, or a whole tract.
  const units = groupUnits(coverage, problems);
  const covers: Cover[] = [];
  const coverOfField = new Map<string, Cover>();
  const coverOfTract = new Map<string, Cover>();
  for (const [unitNumber, rows] of units) {
    const label = `Unit ${unitNumber}`;
    for (const row of rows) {
      const tract = tractKey(row.fsa_farm, row.fsa_tract);
      if (!tract) {
        problems.push(`${label}'s FSA farm and tract numbers couldn't be read from the Summary of Coverage.`);
        continue;
      }
      const cover: Cover = { unitNumber, row, wholeTract: row.fsa_field === null, fields: [] };
      const where = fsaWords(row.fsa_farm, row.fsa_tract, row.fsa_field);
      if (cover.wholeTract) {
        const other = coverOfTract.get(tract);
        if (other) {
          problems.push(
            other.unitNumber === unitNumber
              ? `${where} is listed twice in ${label} on the Summary of Coverage.`
              : `${where} is in both Unit ${other.unitNumber} and ${label} on the Summary of Coverage.`,
          );
          continue;
        }
        coverOfTract.set(tract, cover);
      } else {
        const field = fieldByFsa.get(fsaKey(row.fsa_farm, row.fsa_tract, row.fsa_field)!);
        if (!field) {
          problems.push(`${label} covers ${where}, which isn't on your farm map. Add that field to the map first.`);
          continue;
        }
        const other = coverOfField.get(field.id);
        if (other) {
          problems.push(
            other.unitNumber === unitNumber
              ? `${field.name} is listed twice in ${label} on the Summary of Coverage.`
              : `${field.name} is in both Unit ${other.unitNumber} and ${label} on the Summary of Coverage.`,
          );
          continue;
        }
        coverOfField.set(field.id, cover);
      }
      covers.push(cover);
    }
  }

  // Each FSA-578 line is one field's crop. Lines for another crop belong to another policy.
  const reported = new Set<string>();
  const inSeason = new Set<string>();
  const uninsuredFields: ProposedFieldSeason[] = [];
  for (const line of fsa578.fields) {
    const key = fsaKey(fsa578.farm_number, line.tract, line.field);
    if (!key) {
      if (fsa578.farm_number !== null) problems.push("A line on the FSA-578 has a tract or field number that couldn't be read.");
      continue;
    }
    const field = fieldByFsa.get(key);
    if (!field) {
      flags.push({
        type: "field_not_on_map",
        message: `${fsaWords(fsa578.farm_number, line.tract, line.field)} is on your FSA-578 but not on your farm map, so nothing was set up for it. Add the field to the map if you farm it.`,
        about: { record: "fsa_578" },
        fieldIds: [],
      });
      continue;
    }
    reported.add(field.id);
    if (!policy || (line.crop !== null && line.crop !== policy.crop)) continue;

    if (!usable(line.reported_acres) || line.reported_acres < 0) {
      problems.push(`${field.name}'s acres couldn't be read from the FSA-578.`);
      continue;
    }
    if (inSeason.has(field.id)) {
      problems.push(`${field.name} is on the FSA-578 more than once for ${policy.crop}. GrainClaim keeps one crop per field each year.`);
      continue;
    }
    inSeason.add(field.id);

    // A row that names the field comes before one that covers its whole tract.
    const cover = coverOfField.get(field.id) ?? coverOfTract.get(tractKey(fsa578.farm_number, line.tract)!);
    const season: ProposedFieldSeason = {
      fieldId: field.id,
      fieldName: field.name,
      crop: policy.crop,
      plantedAcres: line.reported_acres,
      plantingDate: line.planting_date,
      practice: (line.practice && FSA_PRACTICES[line.practice]) ?? DEFAULT_PRACTICE,
      mappedAcres: field.mapped_acres,
      coverageAcres: cover?.row.acres ?? null,
      coverageTract: null,
    };
    if (cover) {
      cover.fields.push(season);
    } else {
      uninsuredFields.push(season);
      flags.push({
        type: "uninsured_field",
        message: `${field.name} is on your FSA-578 but isn't in any unit on your Summary of Coverage, so it may be uninsured. Ask your agent.`,
        about: { record: "field", fieldId: field.id },
        fieldIds: [field.id],
      });
    }
  }

  // A field on the map that the FSA-578 doesn't list at all.
  for (const field of fields) {
    if (reported.has(field.id)) continue;
    flags.push({
      type: "unreported_field",
      message: `${field.name} is on your farm map but not on your FSA-578. Its acres may be unreported or uninsured. Ask your FSA office or your agent.`,
      about: { record: "field", fieldId: field.id },
      fieldIds: [field.id],
    });
  }

  for (const cover of covers) {
    if (!cover.wholeTract) continue;
    if (cover.fields.length === 0 && policy) {
      problems.push(
        `Unit ${cover.unitNumber} covers ${fsaWords(cover.row.fsa_farm, cover.row.fsa_tract, null)}, but your FSA-578 has no ${policy.crop} in that tract.`,
      );
    }
    // Several fields under one tract row share its acres; one field alone has them to itself.
    if (cover.fields.length > 1) for (const season of cover.fields) season.coverageTract = cover.row.fsa_tract;
  }

  if (problems.length > 0 || !policy) return { ok: false, problems };

  const proposedUnits: ProposedUnit[] = [...units].map(([unitNumber, rows]) => {
    const [first] = rows;
    const seasons = covers.filter((cover) => cover.unitNumber === unitNumber).flatMap((cover) => cover.fields);
    const plantedAcres = sum(seasons.map((season) => season.plantedAcres));
    const insuredShare = Math.round(first.insured_share! * 10_000) / 10_000;
    return {
      unitNumber,
      unitType: (first.unit_type ?? policy.unit_structure) as UnitKind,
      practice: first.practice ?? DEFAULT_PRACTICE,
      shareArrangement: insuredShare < 1 ? "crop_share" : "owned",
      insuredShare,
      coverageAcres: rows.every((row) => usable(row.acres)) ? sum(rows.map((row) => row.acres!)) : null,
      plantedAcres,
      guaranteeBu: guaranteeBushels({
        approvedYield: policy.approved_yield,
        coverageLevel: policy.coverage_level,
        acres: plantedAcres,
        share: insuredShare,
      }),
      fields: seasons,
    };
  });

  for (const cover of covers) flags.push(...acreFlags(cover));
  for (const season of uninsuredFields) {
    if (mapDiffers(season.mappedAcres, season.plantedAcres)) flags.push(mapFlag(season));
  }

  return { ok: true, proposal: { policy, units: proposedUnits, uninsuredFields, flags } };
}

function mapFlag(field: ProposedFieldSeason): ProposedFlag {
  return {
    type: "acre_mismatch",
    message:
      `${field.fieldName}: your map measures ${acres(field.mappedAcres!)} acres, but your FSA-578 shows ${acres(field.plantedAcres)}. ` +
      "Check the field's outline, or tell your agent if the FSA-578 is wrong.",
    about: { record: "field", fieldId: field.fieldId },
    fieldIds: [field.fieldId],
  };
}

/**
 * Acres that differ between the FSA-578, the Summary of Coverage and the map,
 * for what one row of the summary covers. Checks are per field:
 *
 * - A row that covers one field compares that field's three figures, and one
 *   flag on the field says all of it.
 * - A row that covers several fields in a tract prints one figure for them
 *   together, so that figure is compared with their FSA-578 acres added up
 *   (a flag on the unit), and each field is still compared with the map.
 */
function acreFlags(cover: Cover): ProposedFlag[] {
  const covered = cover.row.acres;

  if (cover.fields.length === 1) {
    const [field] = cover.fields;
    if (usable(covered) && Math.abs(field.plantedAcres - covered) > PRINTED_ACRES_DIFFER) {
      const map = usable(field.mappedAcres) ? ` Your map measures ${acres(field.mappedAcres)}.` : "";
      return [
        {
          type: "acre_mismatch",
          message:
            `${field.fieldName}: your FSA-578 shows ${acres(field.plantedAcres)} acres, but your Summary of Coverage shows ` +
            `${acres(covered)}.${map} Tell your agent before harvest.`,
          about: { record: "field", fieldId: field.fieldId },
          fieldIds: [field.fieldId],
        },
      ];
    }
    return mapDiffers(field.mappedAcres, field.plantedAcres) ? [mapFlag(field)] : [];
  }

  const flags: ProposedFlag[] = [];
  const planted = sum(cover.fields.map((field) => field.plantedAcres));
  if (cover.fields.length > 1 && usable(covered) && Math.abs(planted - covered) > PRINTED_ACRES_DIFFER) {
    flags.push({
      type: "acre_mismatch",
      message:
        `Tract ${cover.row.fsa_tract} (${listOf(cover.fields.map((field) => field.fieldName))}): your FSA-578 shows ${acres(planted)} acres, ` +
        `but your Summary of Coverage shows ${acres(covered)} for the tract. Tell your agent before harvest.`,
      about: { record: "unit", unitNumber: cover.unitNumber },
      fieldIds: cover.fields.map((field) => field.fieldId),
    });
  }
  for (const field of cover.fields) {
    if (mapDiffers(field.mappedAcres, field.plantedAcres)) flags.push(mapFlag(field));
  }
  return flags;
}
