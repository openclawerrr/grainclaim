/**
 * The running total for each unit of the current season, for the farmer's
 * home screen. Loads the records and hands them to lib/rules/unit-totals.ts,
 * which follows ticket → trip → field → field season → unit. Nothing is
 * stored as a counter. Fields that aren't insured are in no unit: they are
 * listed on their own and counted in no total or guarantee.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { guaranteeBushels, unitPlantedAcres } from "../rules/unit";
import { unitTotals, type ChainFieldSeason, type ChainTicket, type UnitTotal } from "../rules/unit-totals";

/** A unit's running total with what it is measured against. */
export interface SeasonUnit extends UnitTotal {
  /** Approved yield × coverage level × the unit's planted acres × the insured's share. Not rounded. */
  guaranteeBu: number;
}

export interface SeasonTotals {
  cropYear: number;
  crop: string;
  units: SeasonUnit[];
  /** Fields with a season this year that no unit covers. Their grain counts toward no unit's total. */
  uninsuredFields: { fieldName: string; plantedAcres: number }[];
}

interface UnitRow {
  id: string;
  unit_number: string;
  insured_share: number;
  policy: { crop: string; crop_year: number; coverage_level: number; approved_yield: number };
}

type FieldSeasonRow = ChainFieldSeason & { planted_acres: number; insured: boolean; field: { name: string } | null };

/** The newest crop year's units with their totals, or null when no season is set up yet. */
export async function loadSeasonTotals(db: SupabaseClient): Promise<SeasonTotals | null> {
  const [units, fieldSeasons, tickets] = await Promise.all([
    db.from("unit").select("id, unit_number, insured_share, policy!inner(crop, crop_year, coverage_level, approved_yield)"),
    db.from("field_season").select("field_id, crop_year, unit_id, planted_acres, insured, field(name)"),
    // Only tickets with a trip can count; the trip says which field the load left from.
    db
      .from("ticket")
      .select("production_to_count_bu, elevator_dry_bu, trip!inner(crop_year, origin_field_id)"),
  ]);
  if (units.error) throw new Error(`Reading units failed: ${units.error.message}`);
  if (fieldSeasons.error) throw new Error(`Reading field seasons failed: ${fieldSeasons.error.message}`);
  if (tickets.error) throw new Error(`Reading tickets failed: ${tickets.error.message}`);

  const allUnits = units.data as unknown as UnitRow[];
  if (allUnits.length === 0) return null;
  const cropYear = Math.max(...allUnits.map((unit) => unit.policy.crop_year));
  const current = allUnits
    .filter((unit) => unit.policy.crop_year === cropYear)
    .sort((a, b) => a.unit_number.localeCompare(b.unit_number, "en", { numeric: true }));

  // Numeric columns can arrive as text; the rules want numbers.
  const seasons = (fieldSeasons.data as unknown as FieldSeasonRow[]).map((row) => ({
    ...row,
    planted_acres: Number(row.planted_acres),
  }));
  const totals = unitTotals(current, seasons, tickets.data as unknown as ChainTicket[]);
  return {
    cropYear,
    crop: current[0].policy.crop,
    units: totals.map((total, i) => ({
      ...total,
      guaranteeBu: guaranteeBushels({
        approvedYield: Number(current[i].policy.approved_yield),
        coverageLevel: Number(current[i].policy.coverage_level),
        acres: unitPlantedAcres(seasons, current[i].id, cropYear),
        share: Number(current[i].insured_share),
      }),
    })),
    uninsuredFields: seasons
      .filter((season) => season.crop_year === cropYear && !season.insured)
      .map((season) => ({ fieldName: season.field?.name ?? "A field", plantedAcres: season.planted_acres }))
      .sort((a, b) => a.fieldName.localeCompare(b.fieldName, "en", { numeric: true })),
  };
}
