/**
 * What the farm map shows: the farm's bins as points and its current fields
 * as outlines. Read from the database on every visit.
 *
 * The demo has one farm and no logins, so nothing here filters by insured.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SavedBin } from "../bins/add-bin";
import { nextBinName } from "../rules/bin-capacity";
import { BIN_COLUMNS, binFromRow, type BinRow } from "./bin-store";

/** A field as the map draws it. Outline points are [longitude, latitude]. */
export interface MapField {
  id: string;
  name: string;
  /** Acres the database measured from the outline. */
  acres: number | null;
  outline: [number, number][][];
}

export interface FarmMap {
  bins: SavedBin[];
  fields: MapField[];
  /** The name offered for the next bin the farmer adds. */
  nextBinName: string;
}

interface FieldRow {
  id: string;
  name: string;
  mapped_acres: number | null;
  boundary: { type: "Polygon"; coordinates: [number, number][][] };
}

export async function loadFarmMap(db: SupabaseClient): Promise<FarmMap> {
  const [bins, fields] = await Promise.all([
    db.from("bin").select(BIN_COLUMNS),
    db.from("field").select("id, name, mapped_acres, boundary").is("valid_to", null),
  ]);
  if (bins.error) throw new Error(`Reading bins failed: ${bins.error.message}`);
  if (fields.error) throw new Error(`Reading fields failed: ${fields.error.message}`);

  const binRows = bins.data as unknown as BinRow[];
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "en", { numeric: true });
  return {
    bins: binRows.flatMap((row) => binFromRow(row) ?? []).sort(byName),
    fields: (fields.data as unknown as FieldRow[])
      .map((row) => ({
        id: row.id,
        name: row.name,
        acres: row.mapped_acres === null ? null : Number(row.mapped_acres),
        outline: row.boundary.coordinates,
      }))
      .sort(byName),
    // Every bin's name counts, including one the map can't draw.
    nextBinName: nextBinName(binRows.map((row) => row.name)),
  };
}
