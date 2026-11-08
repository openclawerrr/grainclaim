/**
 * Ticket calculations (spec Part 3). Weights are pounds. Moisture and shrink
 * are percentage points as printed on the ticket (17.5 means 17.5%).
 * Nothing here rounds: round only when displaying.
 */
import { assertCrop, STANDARD_WEIGHT_LB, type Crop } from "./crops";
import { RuleInputError, requireNonNegative, requirePercent } from "./errors";

/** Net weight: gross − tare. */
export function netWeightLb(grossLb: number, tareLb: number): number {
  requireNonNegative("Gross weight (lb)", grossLb);
  requireNonNegative("Tare weight (lb)", tareLb);
  if (tareLb > grossLb) {
    throw new RuleInputError(
      `Tare (${tareLb} lb) is greater than gross (${grossLb} lb). Check the ticket read.`,
    );
  }
  return grossLb - tareLb;
}

/** Wet bushels: net pounds ÷ the crop's standard weight. */
export function wetBushels(netLb: number, crop: Crop): number {
  requireNonNegative("Net weight (lb)", netLb);
  assertCrop(crop);
  return netLb / STANDARD_WEIGHT_LB[crop];
}

export interface BuyerShrink {
  /** Buyer's base moisture, e.g. 15 for 15%. */
  baseMoisturePct: number;
  /** Shrink per point of moisture above the base, e.g. 1.4 for 1.4%. */
  shrinkPctPerPoint: number;
}

/**
 * Elevator dry bushels: what the buyer pays on. Uses the buyer's own base and
 * shrink, which differ from the insurance rule, so keep both results.
 * At or below the buyer's base moisture there is no deduction.
 */
export function elevatorDryBushels(
  wetBu: number,
  moisturePct: number,
  buyer: BuyerShrink,
): number {
  requireNonNegative("Wet bushels", wetBu);
  requirePercent("Moisture", moisturePct);
  requirePercent("Buyer base moisture", buyer.baseMoisturePct);
  requireNonNegative("Buyer shrink per point (%)", buyer.shrinkPctPerPoint);

  const pointsOverBase = Math.max(0, moisturePct - buyer.baseMoisturePct);
  const shrinkPct = buyer.shrinkPctPerPoint * pointsOverBase;
  if (shrinkPct > 100) {
    throw new RuleInputError(
      `Buyer shrink of ${Number(shrinkPct.toFixed(2))}% at ${moisturePct}% moisture is more than the whole load. Check the moisture and shrink reads.`,
    );
  }
  return wetBu * (1 - shrinkPct / 100);
}

/**
 * Insurance moisture reduction, as a percentage of wet bushels.
 * - Corn: 1.2% per point from 15% to 30%, plus 2% per point only for the
 *   points above 30% (32% moisture → 15 × 1.2 + 2 × 2 = 22%).
 * - Soybeans: 1.2% per point above 13%.
 * - Wheat: no rule in the spec yet, so this throws rather than guess a rate.
 */
export function insuranceMoistureReductionPct(crop: Crop, moisturePct: number): number {
  assertCrop(crop);
  requirePercent("Moisture", moisturePct);

  switch (crop) {
    case "corn": {
      const pointsFrom15To30 = Math.min(Math.max(0, moisturePct - 15), 15);
      const pointsOver30 = Math.max(0, moisturePct - 30);
      return 1.2 * pointsFrom15To30 + 2 * pointsOver30;
    }
    case "soybeans":
      return 1.2 * Math.max(0, moisturePct - 13);
    case "wheat":
      throw new RuleInputError(
        "No insurance moisture rule for wheat yet, so its production to count can't be calculated. Wet and elevator dry bushels still work.",
      );
  }
}

/** Insurance production to count for one ticket: wet bushels × (1 − moisture reduction). */
export function insuranceProductionToCount(
  wetBu: number,
  crop: Crop,
  moisturePct: number,
): number {
  requireNonNegative("Wet bushels", wetBu);
  const reductionPct = insuranceMoistureReductionPct(crop, moisturePct);
  if (reductionPct > 100) {
    throw new RuleInputError(
      `Moisture of ${moisturePct}% would reduce ${crop} by ${Number(reductionPct.toFixed(2))}%, more than the whole load. Check the moisture read.`,
    );
  }
  return wetBu * (1 - reductionPct / 100);
}
