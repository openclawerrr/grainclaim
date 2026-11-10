/**
 * The three bushel figures for one ticket, calculated from its raw read
 * values with the formulas in ticket.ts (spec Part 3):
 *
 * - wet bushels: (gross − tare) ÷ the crop's standard weight
 * - elevator dry bushels: what the buyer pays on, using the buyer's shrink
 * - insurance production to count: using the insurance moisture rule
 *
 * Net comes from gross − tare, not from the net written on the ticket; the
 * "gross − tare = net" check compares the two. A figure that can't be
 * calculated is null, with one sentence saying why. Nothing here rounds.
 */
import { CROPS, type Crop } from "./crops";
import { RuleInputError } from "./errors";
import { elevatorDryBushels, insuranceProductionToCount, netWeightLb, wetBushels } from "./ticket";

/** Saved with each ticket's figures, so a later change to a formula can be told apart. */
export const CALC_VERSION = "1";

/** The raw values the figures need. Null means the value wasn't read. */
export interface TicketBushelsInput {
  /** The crop read from the ticket, or the field season's crop when the ticket doesn't say. */
  crop: string | null;
  gross_lbs: number | null;
  tare_lbs: number | null;
  moisture_pct: number | null;
  base_moisture_pct: number | null;
  shrink_pct_per_point: number | null;
}

export interface TicketBushels {
  wet_bu: number | null;
  elevator_dry_bu: number | null;
  production_to_count_bu: number | null;
  /** One plain sentence for each figure that couldn't be calculated. */
  problems: string[];
}

const isCrop = (value: string | null): value is Crop => CROPS.includes(value as Crop);

function listOf(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function missing(values: Record<string, unknown>): string[] {
  return Object.entries(values)
    .filter(([, value]) => value === null)
    .map(([label]) => label);
}

function cantCalculate(what: string, labels: string[]): string {
  return `${what} can't be calculated because ${listOf(labels)} ${labels.length === 1 ? "wasn't" : "weren't"} read.`;
}

/** Runs one formula. Input a rule refuses (tare above gross, moisture over 100) becomes a sentence, not a number. */
function attempt(calculate: () => number, problems: string[]): number | null {
  try {
    return calculate();
  } catch (error) {
    if (error instanceof RuleInputError) {
      problems.push(error.message);
      return null;
    }
    throw error;
  }
}

export function ticketBushels(t: TicketBushelsInput): TicketBushels {
  const problems: string[] = [];
  const none: TicketBushels = { wet_bu: null, elevator_dry_bu: null, production_to_count_bu: null, problems };

  const crop = isCrop(t.crop) ? t.crop : null;
  const wetMissing = missing({ "gross weight": t.gross_lbs, "tare weight": t.tare_lbs, "the crop": crop });
  if (wetMissing.length > 0) {
    problems.push(cantCalculate("Bushels", wetMissing));
    return none;
  }
  const wet = attempt(() => wetBushels(netWeightLb(t.gross_lbs!, t.tare_lbs!), crop!), problems);
  if (wet === null) return none;

  if (t.moisture_pct === null) {
    problems.push(cantCalculate("Dry bushels and production to count", ["moisture"]));
    return { ...none, wet_bu: wet };
  }
  const moisture = t.moisture_pct;

  let dry: number | null = null;
  const shrinkMissing = missing({
    "the buyer's base moisture": t.base_moisture_pct,
    "the buyer's shrink rate": t.shrink_pct_per_point,
  });
  if (shrinkMissing.length > 0) {
    problems.push(cantCalculate("Elevator dry bushels", shrinkMissing));
  } else {
    dry = attempt(
      () =>
        elevatorDryBushels(wet, moisture, {
          baseMoisturePct: t.base_moisture_pct!,
          shrinkPctPerPoint: t.shrink_pct_per_point!,
        }),
      problems,
    );
  }

  const toCount = attempt(() => insuranceProductionToCount(wet, crop!, moisture), problems);
  return { wet_bu: wet, elevator_dry_bu: dry, production_to_count_bu: toCount, problems };
}
