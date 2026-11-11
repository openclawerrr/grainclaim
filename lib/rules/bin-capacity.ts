/**
 * Adding a grain bin: how many bushels it holds, what size is believable, and
 * what a new one is called. Pure: plain data in, results out. (What is in a
 * bin, and whether it balances, is in bin.ts.)
 *
 * The database calculates a bin's capacity when it is saved
 * (`capacity_bu`, a generated column) and that is the figure of record. The
 * same formula is here so a screen can show the capacity while the farmer is
 * still typing the size; bin-capacity.test.ts holds the two to the same
 * answers.
 */
import { RuleInputError, requirePositive } from "./errors";

/**
 * Bushels in a cubic foot (0.8036) times π ÷ 4, for a round bin filled level
 * to the eave: bushels ≈ 0.6312 × diameter² × eave height, in feet. This is
 * the figure the database's `capacity_bu` column uses. The estimate of what
 * is in a bin (bin.ts) uses the same factor rounded to 0.63, as spec Part 3
 * writes it.
 */
export const BIN_CAPACITY_FACTOR = 0.6312;

/** Wider or taller than any grain bin on a farm. A larger number is a typing mistake. */
export const MAX_BIN_FEET = 200;

/** A size in hundredths of a foot, which is how the database stores it. */
function hundredths(label: string, feet: number): bigint {
  requirePositive(label, feet);
  const exact = feet * 100;
  if (Math.abs(exact - Math.round(exact)) > 1e-6) {
    throw new RuleInputError(`${label} can have at most two decimals, got ${feet}.`);
  }
  return BigInt(Math.round(exact));
}

/**
 * A round bin's capacity in whole bushels, filled level to the eave. Worked
 * in whole numbers, so it rounds exactly as the database does.
 */
export function binCapacityBushels(diameterFt: number, eaveHeightFt: number): number {
  const diameter = hundredths("Diameter", diameterFt);
  const height = hundredths("Eave height", eaveHeightFt);
  // 0.6312 × (d ÷ 100)² × (h ÷ 100), kept as a fraction over 10¹⁰ and rounded half up.
  const numerator = BigInt(6312) * diameter * diameter * height;
  const denominator = BigInt(10) ** BigInt(10);
  return Number((numerator * BigInt(2) + denominator) / (denominator * BigInt(2)));
}

export type BinSizeField = "diameter" | "eave_height";

const SIZE_WORDS: Record<BinSizeField, string> = { diameter: "diameter", eave_height: "eave height" };

/**
 * What is wrong with one size the farmer entered, in one plain sentence, or
 * null if it is fine. `feet` is null when the box was empty or wasn't a number.
 */
export function binSizeProblem(field: BinSizeField, feet: number | null): string | null {
  const what = SIZE_WORDS[field];
  if (feet === null || !Number.isFinite(feet)) return `Enter the ${what} in feet.`;
  if (feet <= 0) return `The ${what} has to be more than 0 feet.`;
  if (feet > MAX_BIN_FEET) return `${feet.toLocaleString("en-US")} feet is too large for a bin's ${what}. Check the number.`;
  if (Math.abs(feet * 100 - Math.round(feet * 100)) > 1e-6) return `Enter the ${what} with at most two decimals, such as 36.5.`;
  return null;
}

/** A bin name as people compare names: ignoring case and extra spaces. */
const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** True if two names would be the same bin to the farmer: "Bin 3" and "bin  3". */
export function sameBinName(a: string, b: string): boolean {
  return nameKey(a) === nameKey(b);
}

const NUMBERED = /^bin (\d+)$/;

/**
 * The name offered for a new bin: one number after the highest "Bin N" the
 * farm has, or "Bin 1". The farmer can type any other name.
 */
export function nextBinName(existingNames: readonly string[]): string {
  const numbers = existingNames.flatMap((name) => {
    const match = NUMBERED.exec(nameKey(name));
    return match ? [Number(match[1])] : [];
  });
  return `Bin ${numbers.length === 0 ? 1 : Math.max(...numbers) + 1}`;
}
