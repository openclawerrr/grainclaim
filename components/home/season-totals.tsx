import { getDb } from "@/lib/db/client";
import { loadSeasonTotals, type SeasonTotals as Totals } from "@/lib/db/season-totals";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { countOf, formatAcres, formatWholeBushels } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The big numbers on the farmer's home screen: each unit's production to
 * count, added up from its tickets by following ticket → trip → field → unit,
 * beside the unit's guarantee. Read from the database on every visit; nothing
 * is cached or counted apart. Until a season is set up, the way to set one up.
 */
export async function SeasonTotals() {
  let season: Totals | null;
  try {
    season = await loadSeasonTotals(getDb());
  } catch (error) {
    console.error("Loading the season totals failed:", error instanceof Error ? error.message : error);
    return <p className="col-span-3 text-base text-ink">The season totals can&apos;t be loaded right now.</p>;
  }
  if (!season) {
    return (
      <div className="col-span-3 flex items-center justify-between gap-4">
        <p className="text-base text-ink-muted">Totals show here once this season is set up.</p>
        <Link href="/season/new" className={cn(buttonVariants({ variant: "outline" }), "h-12 shrink-0 rounded-xl bg-card px-5 text-base font-semibold")}>
          Set up your season
        </Link>
      </div>
    );
  }

  return (
    <>
      {season.units.map((unit) => (
        <Total
          key={unit.unitId}
          figure={formatWholeBushels(unit.productionToCountBu)}
          label={`Unit ${unit.unitNumber} bushels`}
          details={[
            `of ${formatWholeBushels(unit.guaranteeBu)} guaranteed`,
            countOf(unit.tickets, "ticket"),
            `${formatWholeBushels(unit.elevatorDryBu)} elevator dry`,
          ]}
        />
      ))}
      <Total figure={null} label="Loads today" />
      {season.uninsuredFields.length > 0 ? (
        <div className="col-span-3 rounded-xl bg-yellow-100 px-4 py-3">
          <p className="text-sm font-semibold text-ink">Not insured</p>
          <p className="text-base text-ink">
            {season.uninsuredFields.map((field) => `${field.fieldName} (${formatAcres(field.plantedAcres)} acres)`).join(", ")}.
            Grain from {season.uninsuredFields.length === 1 ? "this field" : "these fields"} isn&apos;t counted in a unit&apos;s total.
          </p>
        </div>
      ) : null}
    </>
  );
}

/** The same tiles with dashes, shown for the moment the totals are loading. */
export function SeasonTotalsLoading() {
  return (
    <>
      <Total figure={null} label="Unit 1 bushels" />
      <Total figure={null} label="Unit 2 bushels" />
      <Total figure={null} label="Loads today" />
    </>
  );
}

/** A big number with a small label. The number is a dash until there is one. */
function Total({ figure, label, details = [] }: { figure: string | null; label: string; details?: string[] }) {
  return (
    <div>
      <p className="font-heading text-4xl font-semibold tabular-nums text-ink">
        {figure ?? (
          <>
            <span aria-hidden="true">—</span>
            <span className="sr-only">Not available yet</span>
          </>
        )}
      </p>
      <p className="mt-1 text-sm font-medium text-ink">{label}</p>
      {details.map((detail) => (
        <p key={detail} className="text-sm text-ink-muted tabular-nums">
          {detail}
        </p>
      ))}
    </div>
  );
}
