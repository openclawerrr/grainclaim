/**
 * Season setup (spec Phase 3): what one crop year's records should be, worked
 * out from a read FSA-578, a read Summary of Coverage and the fields on the
 * farm map. Pure: plain data in, a proposal out. Nothing here saves anything.
 *
 * - The Summary of Coverage gives the policy and its units.
 * - The FSA-578 gives each field's planted acres, planting date and practice.
 * - Lines and units are matched to mapped fields by FSA farm, tract and field
 *   number, never by name or by the order of the rows. The summary names one
 *   field for each unit, so a unit here has one field (or none, when that
 *   field isn't on the FSA-578).
 * - A unit's guarantee is approved yield × coverage level × its fields'
 *   planted acres (from the FSA-578) × the insured's share.
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

/** The Summary of Coverage values season setup uses. Null means the value wasn't read. */
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
  units: readonly {
    unit_number: string | null;
    unit_type: string | null;
    practice: string | null;
    fsa_farm: string | null;
    fsa_tract: string | null;
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
  /** Bushels per acre. One for the policy: every unit on the summary must show the same. */
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
}

export interface ProposedUnit {
  unitNumber: string;
  unitType: UnitKind;
  practice: string;
  shareArrangement: ShareArrangement;
  /** The insured's share as a fraction, to four decimals as the database holds it. */
  insuredShare: number;
  /** The acres the Summary of Coverage shows for the unit, for comparing. */
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
const fsaKey = (farm: string | null, tract: string | null, field: string | null) =>
  farm === null || tract === null || field === null ? null : `${farm.trim()}/${tract.trim()}/${field.trim()}`;
const fsaWords = (farm: string | null, tract: string | null, field: string | null) =>
  `FSA farm ${farm ?? "?"}, tract ${tract ?? "?"}, field ${field ?? "?"}`;

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

  const yields = [...new Set(coverage.units.map((unit) => unit.approved_yield))];
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

  // Each unit names the field it covers by FSA numbers.
  const unitOfField = new Map<string, string>();
  const unitNumbers = new Set<string>();
  for (const unit of coverage.units) {
    if (unit.unit_number === null) {
      problems.push("A unit's number couldn't be read from the Summary of Coverage.");
      continue;
    }
    const label = `Unit ${unit.unit_number}`;
    if (unitNumbers.has(unit.unit_number)) problems.push(`${label} is on the Summary of Coverage twice.`);
    unitNumbers.add(unit.unit_number);

    if (!usable(unit.insured_share) || unit.insured_share <= 0 || unit.insured_share > 1) {
      problems.push(`${label}'s share couldn't be read from the Summary of Coverage.`);
    }
    if (unit.unit_type !== null && !UNIT_KINDS.includes(unit.unit_type)) {
      problems.push(`${label}'s type reads "${unit.unit_type}", which GrainClaim doesn't know.`);
    }
    const key = fsaKey(unit.fsa_farm, unit.fsa_tract, unit.fsa_field);
    if (!key) {
      problems.push(`${label}'s FSA farm, tract and field numbers couldn't be read from the Summary of Coverage.`);
      continue;
    }
    const field = fieldByFsa.get(key);
    if (!field) {
      problems.push(
        `${label} covers ${fsaWords(unit.fsa_farm, unit.fsa_tract, unit.fsa_field)}, which isn't on your farm map. Add that field to the map first.`,
      );
    } else if (unitOfField.has(field.id)) {
      problems.push(`${field.name} is in both Unit ${unitOfField.get(field.id)} and ${label} on the Summary of Coverage.`);
    } else {
      unitOfField.set(field.id, unit.unit_number);
    }
  }

  // Each FSA-578 line is one field's crop. Lines for another crop belong to another policy.
  const reported = new Set<string>();
  const seasonsByUnit = new Map<string, ProposedFieldSeason[]>();
  for (const line of fsa578.fields) {
    const key = fsaKey(fsa578.farm_number, line.tract, line.field);
    if (!key) {
      if (fsa578.farm_number !== null) problems.push("A line on the FSA-578 has a tract or field number that couldn't be read.");
      continue;
    }
    const where = fsaWords(fsa578.farm_number, line.tract, line.field);
    const field = fieldByFsa.get(key);
    if (!field) {
      flags.push({
        type: "field_not_on_map",
        message: `${where} is on your FSA-578 but not on your farm map, so nothing was set up for it. Add the field to the map if you farm it.`,
        about: { record: "fsa_578" },
        fieldIds: [],
      });
      continue;
    }
    reported.add(field.id);
    if (!policy || (line.crop !== null && line.crop !== policy.crop)) continue;

    const unitNumber = unitOfField.get(field.id);
    if (!unitNumber) {
      flags.push({
        type: "uninsured_field",
        message: `${field.name} is on your FSA-578 but isn't in any unit on your Summary of Coverage, so it may be uninsured. Ask your agent.`,
        about: { record: "field", fieldId: field.id },
        fieldIds: [field.id],
      });
      continue;
    }
    if (!usable(line.reported_acres) || line.reported_acres < 0) {
      problems.push(`${field.name}'s acres couldn't be read from the FSA-578.`);
      continue;
    }
    const seasons = seasonsByUnit.get(unitNumber) ?? [];
    if ([...seasonsByUnit.values()].flat().some((season) => season.fieldId === field.id)) {
      problems.push(`${field.name} is on the FSA-578 more than once for ${policy.crop}. GrainClaim keeps one crop per field each year.`);
      continue;
    }
    seasons.push({
      fieldId: field.id,
      fieldName: field.name,
      crop: policy.crop,
      plantedAcres: line.reported_acres,
      plantingDate: line.planting_date,
      practice: (line.practice && FSA_PRACTICES[line.practice]) ?? DEFAULT_PRACTICE,
      mappedAcres: field.mapped_acres,
    });
    seasonsByUnit.set(unitNumber, seasons);
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

  if (problems.length > 0 || !policy) return { ok: false, problems };

  const units: ProposedUnit[] = coverage.units.map((unit) => {
    const unitNumber = unit.unit_number!;
    const seasons = seasonsByUnit.get(unitNumber) ?? [];
    const plantedAcres = sum(seasons.map((season) => season.plantedAcres));
    const insuredShare = Math.round(unit.insured_share! * 10_000) / 10_000;
    return {
      unitNumber,
      unitType: (unit.unit_type ?? policy.unit_structure) as UnitKind,
      practice: unit.practice ?? DEFAULT_PRACTICE,
      shareArrangement: insuredShare < 1 ? "crop_share" : "owned",
      insuredShare,
      coverageAcres: unit.acres,
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

  for (const unit of units) flags.push(...acreFlags(unit));

  return { ok: true, proposal: { policy, units, flags } };
}

/**
 * Acres that differ between the FSA-578, the Summary of Coverage and the map,
 * for one unit. The summary names one field per unit, so a unit's three
 * figures are all about the same ground and one flag says all of it: either
 * the two documents disagree, or the outline is well off what the FSA-578
 * reports.
 */
function acreFlags(unit: ProposedUnit): ProposedFlag[] {
  const [field] = unit.fields;
  if (!field) return [];

  if (usable(unit.coverageAcres) && Math.abs(unit.plantedAcres - unit.coverageAcres) > PRINTED_ACRES_DIFFER) {
    const map = usable(field.mappedAcres) ? ` Your map measures ${acres(field.mappedAcres)}.` : "";
    return [
      {
        type: "acre_mismatch",
        message:
          `${field.fieldName}: your FSA-578 shows ${acres(unit.plantedAcres)} acres, but your Summary of Coverage shows ` +
          `${acres(unit.coverageAcres)}.${map} Tell your agent before harvest.`,
        about: { record: "unit", unitNumber: unit.unitNumber },
        fieldIds: [field.fieldId],
      },
    ];
  }
  if (mapDiffers(field.mappedAcres, field.plantedAcres)) {
    return [
      {
        type: "acre_mismatch",
        message:
          `${field.fieldName}: your map measures ${acres(field.mappedAcres!)} acres, but your FSA-578 shows ${acres(field.plantedAcres)}. ` +
          "Check the field's outline, or tell your agent if the FSA-578 is wrong.",
        about: { record: "field", fieldId: field.fieldId },
        fieldIds: [field.fieldId],
      },
    ];
  }
  return [];
}
