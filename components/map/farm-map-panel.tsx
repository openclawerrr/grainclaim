import { getDb } from "@/lib/db/client";
import { loadFarmMap, type FarmMap as FarmMapRecords } from "@/lib/db/farm-map";
import { FarmMap } from "./farm-map";

/**
 * The farm map on the farmer's home screen, with what the database holds
 * right now: the farm's bins and its current fields. Read on every visit.
 */
export async function FarmMapPanel() {
  let farm: FarmMapRecords;
  try {
    farm = await loadFarmMap(getDb());
  } catch (error) {
    console.error("Loading the farm map failed:", error instanceof Error ? error.message : error);
    return (
      <p className="flex min-h-[32rem] flex-1 items-center justify-center bg-green-100 p-6 text-center text-base text-ink">
        The farm map can&apos;t be loaded right now.
      </p>
    );
  }
  return <FarmMap bins={farm.bins} fields={farm.fields} nextBinName={farm.nextBinName} />;
}

/** The map's place on the screen for the moment its records are loading. */
export function FarmMapLoading() {
  return (
    <p className="flex min-h-[32rem] flex-1 items-center justify-center bg-green-100 p-6 text-center text-base text-ink-muted">
      Loading your farm map…
    </p>
  );
}
