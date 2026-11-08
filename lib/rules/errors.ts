/**
 * Input that can't describe a real load, bin or unit: tare above gross, an
 * unknown crop, a negative weight. Rules throw this instead of returning a
 * number, so callers can show the message (or answer 400) rather than store
 * a wrong result.
 */
export class RuleInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleInputError";
  }
}

/** Rejects NaN, Infinity and anything that isn't a number. */
export function requireFinite(label: string, value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RuleInputError(`${label} must be a number, got ${String(value)}.`);
  }
}

export function requireNonNegative(label: string, value: number): void {
  requireFinite(label, value);
  if (value < 0) {
    throw new RuleInputError(`${label} cannot be negative, got ${value}.`);
  }
}

export function requirePositive(label: string, value: number): void {
  requireFinite(label, value);
  if (value <= 0) {
    throw new RuleInputError(`${label} must be greater than zero, got ${value}.`);
  }
}

/** A ratio such as coverage level or share, written as a fraction: 0.75, not 75. */
export function requireFraction(label: string, value: number): void {
  requireFinite(label, value);
  if (value < 0 || value > 1) {
    throw new RuleInputError(
      `${label} must be a fraction from 0 to 1 (0.75 for 75%), got ${value}.`,
    );
  }
}

/** A percentage such as moisture, written as printed on a ticket: 17.5, not 0.175. */
export function requirePercent(label: string, value: number): void {
  requireFinite(label, value);
  if (value < 0 || value > 100) {
    throw new RuleInputError(
      `${label} must be a percentage from 0 to 100 (17.5 for 17.5%), got ${value}.`,
    );
  }
}
