import { RuleInputError } from "./errors";

/**
 * Crops GrainClaim knows. Names must match exactly; turning ticket wording
 * such as "YELLOW CORN #2" into one of these is the job of lib/extract.
 */
export const CROPS = ["corn", "soybeans", "wheat"] as const;
export type Crop = (typeof CROPS)[number];

/** Standard weight in pounds per bushel (spec Part 3). */
export const STANDARD_WEIGHT_LB: Readonly<Record<Crop, number>> = {
  corn: 56,
  soybeans: 60,
  wheat: 60,
};

/**
 * Throws unless the value is a known crop. Rules call this even though their
 * parameters are typed `Crop`, because crop values reach them as strings from
 * the database and from ticket reads.
 */
export function assertCrop(value: unknown): asserts value is Crop {
  if (typeof value !== "string" || !(CROPS as readonly string[]).includes(value)) {
    throw new RuleInputError(
      `Unknown crop "${String(value)}". Expected one of: ${CROPS.join(", ")}.`,
    );
  }
}
