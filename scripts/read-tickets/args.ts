/** Command-line options for `npm run read-ticket` and `npm run score-tickets`. Pure, so it is tested without the API. */
import { DEFAULT_READ_MODEL, READ_MODEL_KEYS, type ReadModelKey } from "../../lib/extract/models";

export type Command =
  | { kind: "help" }
  | { kind: "read"; photo: string; model: ReadModelKey }
  | { kind: "score"; models: ReadModelKey[]; runs: number; jsonPath: string | null };

const MAX_RUNS = 10;

export const USAGE = [
  "Usage:",
  "  npm run read-ticket -- <photo> [--model sonnet|haiku]",
  "      Read one ticket photo and print its values and checks.",
  "",
  "  npm run score-tickets [-- options]",
  "      Read every sample ticket photo and score each value against",
  "      sample-data/documents-2026.json.",
  "",
  "      --model sonnet|haiku   score one model (default: both)",
  `      --runs <n>             read each photo n times, 1 to ${MAX_RUNS} (default: 1)`,
  "      --json <file>          also save every read to a JSON file",
  "",
  "Both call the Claude API with ANTHROPIC_API_KEY from .env.local and cost money.",
].join("\n");

function modelFrom(value: string | undefined): ReadModelKey {
  if (!value) throw new Error("--model needs a name: sonnet or haiku.");
  if (!(READ_MODEL_KEYS as string[]).includes(value)) {
    throw new Error(`Unknown model "${value}". Use one of: ${READ_MODEL_KEYS.join(", ")}.`);
  }
  return value as ReadModelKey;
}

export function parseArgs(argv: readonly string[]): Command {
  const [mode, ...rest] = argv;
  if (!mode || mode === "--help" || mode === "-h" || rest.includes("--help") || rest.includes("-h")) {
    return { kind: "help" };
  }
  if (mode !== "read" && mode !== "score") {
    throw new Error(`Unknown command "${mode}".\n\n${USAGE}`);
  }

  let model: ReadModelKey | undefined;
  let runs = 1;
  let jsonPath: string | null = null;
  const positional: string[] = [];

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const valueOf = (flag: string) => (arg === flag ? rest[++i] : arg.slice(flag.length + 1));
    if (arg === "--model" || arg.startsWith("--model=")) {
      model = modelFrom(valueOf("--model"));
    } else if (mode === "score" && (arg === "--runs" || arg.startsWith("--runs="))) {
      const value = valueOf("--runs");
      runs = Number(value);
      if (!value || !Number.isInteger(runs) || runs < 1 || runs > MAX_RUNS) {
        throw new Error(`--runs needs a whole number from 1 to ${MAX_RUNS}.`);
      }
    } else if (mode === "score" && (arg === "--json" || arg.startsWith("--json="))) {
      const value = valueOf("--json");
      if (!value) throw new Error("--json needs a file name.");
      jsonPath = value;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option "${arg}".\n\n${USAGE}`);
    } else {
      positional.push(arg);
    }
  }

  if (mode === "read") {
    if (positional.length !== 1) {
      throw new Error("Give one photo to read, such as sample-data/photos/ticket-3.jpg.");
    }
    return { kind: "read", photo: positional[0], model: model ?? DEFAULT_READ_MODEL };
  }
  if (positional.length > 0) {
    throw new Error(`score-tickets reads every sample photo, so it takes no file names (got "${positional[0]}").`);
  }
  return { kind: "score", models: model ? [model] : [...READ_MODEL_KEYS], runs, jsonPath };
}
