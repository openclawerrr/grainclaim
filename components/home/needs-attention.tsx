import { getDb } from "@/lib/db/client";
import { loadOpenFlags, type OpenFlag } from "@/lib/db/flags";

/**
 * Needs attention on the farmer's home screen: every open flag, each one
 * plain sentence saying what is wrong and what to do. Read from the database
 * on every visit. Closing a flag from here comes with ticket review.
 */
export async function NeedsAttention() {
  let flags: OpenFlag[];
  try {
    flags = await loadOpenFlags(getDb());
  } catch (error) {
    console.error("Loading the flags failed:", error instanceof Error ? error.message : error);
    return <p className="text-base text-ink">What needs attention can&apos;t be loaded right now.</p>;
  }
  if (flags.length === 0) {
    return <p className="text-base text-ink-muted">Nothing needs a look right now.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {flags.map((flag) => (
        <li key={flag.id} className="rounded-xl bg-yellow-100 px-4 py-3 text-base text-ink">
          {flag.message}
        </li>
      ))}
    </ul>
  );
}
