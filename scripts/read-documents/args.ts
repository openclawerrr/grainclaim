/** Command-line options for `npm run read-document` and `npm run score-documents`. Pure, so it is tested without the API. */
import path from "node:path";
import type { DocumentKindKey } from "../../lib/extract/document-kinds";
import { DEFAULT_FORM_READ_MODEL, READ_MODEL_KEYS, type ReadModelKey } from "../../lib/extract/models";

export type Command =
  | { kind: "help" }
  | { kind: "read"; file: string; document: DocumentKindKey; model: ReadModelKey }
  | { kind: "score"; models: ReadModelKey[]; runs: number; jsonPath: string | null };

const MAX_RUNS = 10;

/** What `--kind` takes, and the kind each one means. */
export const KIND_NAMES: Record<string, DocumentKindKey> = {
  "fsa-578": "fsa_578",
  "summary-of-coverage": "summary_of_coverage",
};

export const USAGE = [
  "Usage:",
  "  npm run read-document -- <file> [--kind fsa-578|summary-of-coverage] [--model sonnet|haiku]",
  "      Read one FSA-578 or Summary of Coverage (a photo or a PDF) and print",
  "      its values and checks. The kind comes from the file's name unless",
  "      --kind gives it. Haiku reads it unless --model says otherwise.",
  "",
  "  npm run score-documents [-- options]",
  "      Read the sample FSA-578 photo and Summary of Coverage PDF and score",
  "      each value against sample-data/documents-2026.json.",
  "",
  "      --model sonnet|haiku   score one model (default: both)",
  `      --runs <n>             read each document n times, 1 to ${MAX_RUNS} (default: 1)`,
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

function kindFrom(value: string | undefined): DocumentKindKey {
  const names = Object.keys(KIND_NAMES).join(" or ");
  if (!value) throw new Error(`--kind needs a name: ${names}.`);
  const kind = KIND_NAMES[value];
  if (!kind) throw new Error(`Unknown kind "${value}". Use ${names}.`);
  return kind;
}

/** The kind a file's name says it is: "fsa-578.jpg", "Summary of Coverage 2026.pdf". */
export function kindFromFileName(file: string): DocumentKindKey | null {
  const name = path.basename(file).toLowerCase();
  if (/fsa.?578/.test(name)) return "fsa_578";
  if (/summary.?of.?coverage/.test(name)) return "summary_of_coverage";
  return null;
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
  let document: DocumentKindKey | undefined;
  let runs = 1;
  let jsonPath: string | null = null;
  const positional: string[] = [];

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const valueOf = (flag: string) => (arg === flag ? rest[++i] : arg.slice(flag.length + 1));
    if (arg === "--model" || arg.startsWith("--model=")) {
      model = modelFrom(valueOf("--model"));
    } else if (mode === "read" && (arg === "--kind" || arg.startsWith("--kind="))) {
      document = kindFrom(valueOf("--kind"));
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
      throw new Error("Give one file to read, such as sample-data/photos/fsa-578.jpg.");
    }
    const [file] = positional;
    document ??= kindFromFileName(file) ?? undefined;
    if (!document) {
      throw new Error(
        `Can't tell from its name what kind of document "${path.basename(file)}" is. Add --kind fsa-578 or --kind summary-of-coverage.`,
      );
    }
    return { kind: "read", file, document, model: model ?? DEFAULT_FORM_READ_MODEL };
  }
  if (positional.length > 0) {
    throw new Error(`score-documents reads the sample documents, so it takes no file names (got "${positional[0]}").`);
  }
  return { kind: "score", models: model ? [model] : [...READ_MODEL_KEYS], runs, jsonPath };
}
