/**
 * Unit calculations (spec Part 3). Grain is bushels. Coverage level and share
 * are fractions (0.75 for 75%, 2 / 3 for a two-thirds crop share).
 * Nothing here rounds: round only when displaying.
 */
import {
  requireFraction,
  requireNonNegative,
  requirePositive,
} from "./errors";

export interface UnitProductionInput {
  /** Sold or commercially stored, from tickets. Use insurance production to count, not elevator dry bushels. */
  soldOrCommerciallyStoredBu: number;
  /** Farm-stored grain, from a bin measurement. */
  farmStoredMeasuredBu: number;
  /** Fed on the farm (not recorded in the demo yet). */
  fedBu?: number;
  /** Appraised by the adjuster. */
  appraisedBu?: number;
}

/**
 * Unit production: 100% of the unit's production, including any landlord's
 * share. Sold and commercially stored + measured farm-stored + fed + appraised.
 */
export function unitProduction({
  soldOrCommerciallyStoredBu,
  farmStoredMeasuredBu,
  fedBu = 0,
  appraisedBu = 0,
}: UnitProductionInput): number {
  requireNonNegative("Sold or commercially stored bushels", soldOrCommerciallyStoredBu);
  requireNonNegative("Measured farm-stored bushels", farmStoredMeasuredBu);
  requireNonNegative("Fed bushels", fedBu);
  requireNonNegative("Appraised bushels", appraisedBu);
  return soldOrCommerciallyStoredBu + farmStoredMeasuredBu + fedBu + appraisedBu;
}

/**
 * Unit yield in bushels per acre. Uses 100% of production (including a
 * landlord's share), not the insured's share.
 */
export function unitYield(productionBu: number, plantedAcres: number): number {
  requireNonNegative("Unit production (bu)", productionBu);
  requirePositive("Planted acres", plantedAcres);
  return productionBu / plantedAcres;
}

export interface GuaranteeInput {
  /** Approved yield, bushels per acre. */
  approvedYield: number;
  /** Coverage level as a fraction: 0.75 for 75%. */
  coverageLevel: number;
  /** Planted acres in the unit. */
  acres: number;
  /** Insured's share as a fraction: 1 for owned, 2 / 3 for a two-thirds crop share. */
  share: number;
}

/** Guarantee in bushels: approved yield × coverage level × acres × share. */
export function guaranteeBushels({
  approvedYield,
  coverageLevel,
  acres,
  share,
}: GuaranteeInput): number {
  requireNonNegative("Approved yield (bu/acre)", approvedYield);
  requireFraction("Coverage level", coverageLevel);
  requirePositive("Coverage level", coverageLevel);
  requireNonNegative("Acres", acres);
  requireFraction("Share", share);
  return approvedYield * coverageLevel * acres * share;
}

/**
 * A unit's planted acres: its fields' planted acres for one crop year, added
 * up. These are the acres its guarantee is figured on.
 */
export function unitPlantedAcres(
  fieldSeasons: readonly { unit_id: string; crop_year: number; planted_acres: number }[],
  unitId: string,
  cropYear: number,
): number {
  return fieldSeasons
    .filter((fieldSeason) => fieldSeason.unit_id === unitId && fieldSeason.crop_year === cropYear)
    .reduce((total, fieldSeason) => {
      requireNonNegative("Planted acres", fieldSeason.planted_acres);
      return total + fieldSeason.planted_acres;
    }, 0);
}

/** Insured's share of production: unit production to count × insured's share. */
export function insuredShareOfProduction(productionBu: number, share: number): number {
  requireNonNegative("Unit production (bu)", productionBu);
  requireFraction("Share", share);
  return productionBu * share;
}

/**
 * Shortfall in bushels: guarantee − insured's share of production to count,
 * never below zero. Dollars (price, revenue protection) are not calculated here.
 */
export function shortfallBushels(
  guaranteeBu: number,
  insuredProductionToCountBu: number,
): number {
  requireNonNegative("Guarantee (bu)", guaranteeBu);
  requireNonNegative("Insured's production to count (bu)", insuredProductionToCountBu);
  return Math.max(0, guaranteeBu - insuredProductionToCountBu);
}
