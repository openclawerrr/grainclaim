/** What the reading scripts share: loading the API key, pacing the reads, and reporting an API error. */
import Anthropic from "@anthropic-ai/sdk";

export const ENV_FILE = ".env.local";
/** Reads in flight at once. Low enough for a new API account's rate limits. */
const AT_ONCE = 4;

/** Loads ANTHROPIC_API_KEY from .env.local. Never prints it. */
export function loadEnvFile(): void {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`${ENV_FILE} not found. Create it from the template in SETUP.md.`);
    }
    throw err;
  }
}

/** Runs `work` on every item, a few at a time, and keeps the results in order. */
export async function mapAFewAtOnce<T, R>(items: readonly T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, items.length) }, worker));
  return results;
}

/** Says what went wrong in one line and makes the script exit with an error. */
export function reportFailure(err: unknown): void {
  if (err instanceof Anthropic.AuthenticationError) {
    console.error(`Claude rejected ANTHROPIC_API_KEY. Check the key in ${ENV_FILE} (see SETUP.md).`);
  } else if (err instanceof Anthropic.RateLimitError) {
    console.error("Claude's rate limit was reached. Wait a minute and run it again.");
  } else if (err instanceof Anthropic.APIError) {
    console.error(`The Claude API returned an error (${err.status ?? "no status"}): ${err.message}`);
  } else {
    console.error(err instanceof Error ? err.message : err);
  }
  process.exitCode = 1;
}
