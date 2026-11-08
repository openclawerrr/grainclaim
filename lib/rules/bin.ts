/**
 * Bin calculations (spec Part 3). Lengths are feet, grain is bushels.
 * Nothing here rounds: round only when displaying.
 */
import { requireNonNegative, requirePositive } from "./errors";

/**
 * A round bin holds π/4 × diameter² × depth cubic feet, at about 0.8036
 * bushels per cubic foot: 0.785 × 0.8036 ≈ 0.63. No pack factor; the
 * official number is the adjuster's or FSA's measurement.
 */
export const BIN_BUSHELS_FACTOR = 0.63;

/** A bin balance gap over this percentage of estimated bushels in is flagged. */
export const BIN_BALANCE_TOLERANCE_PCT = 3;

/** Bin estimate: about 0.63 × diameter² × grain depth. An estimate, not a measurement. */
export function binEstimateBushels(diameterFt: number, grainDepthFt: number): number {
  requirePositive("Bin diameter (ft)", diameterFt);
  requireNonNegative("Grain depth (ft)", grainDepthFt);
  return BIN_BUSHELS_FACTOR * diameterFt ** 2 * grainDepthFt;
}

export interface BinBalanceInput {
  /** Bushels put in, from trip estimates. */
  estimatedInBu: number;
  /** Bushels taken out, from tickets. */
  ticketedOutBu: number;
  /** Bushels still in the bin, from a measurement. */
  measuredRemainingBu: number;
}

export interface BinBalanceResult {
  /** Ticketed out + measured remaining. */
  accountedForBu: number;
  /** Estimated in − accounted for. Positive: grain unaccounted for. Negative: more came out than the estimates put in. */
  gapBu: number;
  /** Size of the gap as a percentage of estimated in (never negative). */
  gapPct: number;
  /** True when the gap is over 3% of estimated in, in either direction. */
  flagged: boolean;
}

/** Bin balance: estimated in ≈ ticketed out + measured remaining; flag a gap over 3%. */
export function binBalance({
  estimatedInBu,
  ticketedOutBu,
  measuredRemainingBu,
}: BinBalanceInput): BinBalanceResult {
  requirePositive("Estimated bushels in", estimatedInBu);
  requireNonNegative("Ticketed bushels out", ticketedOutBu);
  requireNonNegative("Measured bushels remaining", measuredRemainingBu);

  const accountedForBu = ticketedOutBu + measuredRemainingBu;
  const gapBu = estimatedInBu - accountedForBu;
  const gapPct = (Math.abs(gapBu) * 100) / estimatedInBu;
  return {
    accountedForBu,
    gapBu,
    gapPct,
    flagged: gapPct > BIN_BALANCE_TOLERANCE_PCT,
  };
}
