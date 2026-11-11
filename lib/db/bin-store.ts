/**
 * The database calls behind lib/bins/add-bin.ts, and how a bin row becomes
 * the bin the screens use.
 *
 * The demo has one farm and no logins, so the farm is the one insured there
 * is. A bin's capacity is never sent: the database calculates it.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BinStore, SavedBin } from "../bins/add-bin";

function fail(doing: string, error: { message: string }): never {
  throw new Error(`${doing} failed: ${error.message}`);
}

export const BIN_COLUMNS = "id, name, location, diameter_ft, eave_height_ft, capacity_bu";

/** A bin row as the REST API returns it: the point comes back as GeoJSON. */
export interface BinRow {
  id: string;
  name: string;
  location: { type: "Point"; coordinates: [number, number] };
  diameter_ft: number;
  eave_height_ft: number | null;
  capacity_bu: number | null;
}

/** Null for a bin saved without an eave height, which has no capacity. The app never saves one. */
export function binFromRow(row: BinRow): SavedBin | null {
  if (row.eave_height_ft === null || row.capacity_bu === null) return null;
  const [longitude, latitude] = row.location.coordinates;
  return {
    id: row.id,
    name: row.name,
    longitude,
    latitude,
    diameterFt: Number(row.diameter_ft),
    eaveHeightFt: Number(row.eave_height_ft),
    capacityBu: Number(row.capacity_bu),
  };
}

export function binStore(db: SupabaseClient): BinStore {
  return {
    async loadFarm() {
      // One question to the database: the farm, and the names of its bins with it.
      const { data, error } = await db.from("insured").select("id, bin(name)").order("created_at").limit(1).maybeSingle();
      if (error) fail("Reading the farm and its bins", error);
      if (!data) return null;
      const farm = data as unknown as { id: string; bin: { name: string }[] };
      return { insuredId: farm.id, binNames: farm.bin.map((bin) => bin.name) };
    },

    async insertBin(bin) {
      const { data, error } = await db.from("bin").insert(bin).select(BIN_COLUMNS).single();
      if (error) fail("Saving the bin", error);
      const saved = binFromRow(data as unknown as BinRow);
      if (!saved) throw new Error("Saving the bin failed: the database returned it without a capacity.");
      return saved;
    },
  };
}
