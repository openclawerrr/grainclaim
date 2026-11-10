/**
 * The Claude models that read documents, and what a read costs.
 * Prices are Anthropic's list prices in US dollars per million tokens, as of
 * November 2026. Haiku's are for prompts up to 100K tokens; a ticket photo is
 * a few thousand. Thinking is billed as output tokens.
 */
export const READ_MODELS = {
  sonnet: { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", inputUsdPerMTok: 2, outputUsdPerMTok: 10 },
  haiku: { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.5 },
} as const;

export type ReadModelKey = keyof typeof READ_MODELS;
export const READ_MODEL_KEYS = Object.keys(READ_MODELS) as ReadModelKey[];

/** The model that reads tickets unless another is asked for. Why: docs/decisions/document-reading-model.md. */
export const DEFAULT_READ_MODEL: ReadModelKey = "sonnet";

/**
 * The model that reads the FSA-578 and Summary of Coverage unless another is
 * asked for. It matched Sonnet on every value of both at about one eighteenth
 * of the cost. Why: docs/decisions/document-reading-model.md.
 */
export const DEFAULT_FORM_READ_MODEL: ReadModelKey = "haiku";

export interface ReadUsage {
  input_tokens: number;
  output_tokens: number;
}

/** What one read cost, in US dollars. */
export function readCostUsd(model: ReadModelKey, usage: ReadUsage): number {
  const price = READ_MODELS[model];
  return (usage.input_tokens * price.inputUsdPerMTok + usage.output_tokens * price.outputUsdPerMTok) / 1_000_000;
}
