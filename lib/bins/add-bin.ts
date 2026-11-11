/**
 * Adds one grain bin to the farm: the spot the farmer clicked on the map, a
 * name, and the bin's diameter and eave height. Both sizes are required and
 * neither has a default. The database works out the capacity.
 *
 * Nothing is written until every value is right. Each problem comes back as
 * one plain sentence, with the box it is about so the screen can point at it.
 *
 * The database is passed in, so this is tested without Supabase
 * (add-bin.test.ts). The real one is wired up in app/bins/actions.ts.
 */
import type { Role } from "../role/role";
import { binSizeProblem, sameBinName } from "../rules/bin-capacity";

/** The longest name that still fits on a map label. */
export const MAX_BIN_NAME_LENGTH = 40;

/** What the farmer gave, as the form sends it: text, not yet checked. */
export interface NewBinInput {
  name: string;
  diameterFt: string;
  eaveHeightFt: string;
  longitude: string;
  latitude: string;
}

/** A bin as the database holds it. */
export interface SavedBin {
  id: string;
  name: string;
  longitude: number;
  latitude: number;
  diameterFt: number;
  eaveHeightFt: number;
  /** Calculated by the database from the diameter and eave height. */
  capacityBu: number;
}

/** A bin row to insert. The database adds the id and the capacity. */
export interface NewBinRow {
  insured_id: string;
  name: string;
  /** EWKT: SRID=4326;POINT(longitude latitude). */
  location: string;
  diameter_ft: number;
  eave_height_ft: number;
}

// ---------------------------------------------------------------------------
// What adding a bin needs from the database (implemented in lib/db/bin-store.ts)
// ---------------------------------------------------------------------------

export interface BinStore {
  /** The farm the bin belongs to, with the names of the bins it already has. Null if no farm is set up. */
  loadFarm(): Promise<{ insuredId: string; binNames: string[] } | null>;
  insertBin(bin: NewBinRow): Promise<SavedBin>;
}

export type BinProblemField = "name" | "diameter" | "eave_height" | "location";

export type AddBinOutcome =
  | { status: "saved"; bin: SavedBin }
  /** Nothing was saved. `field` is the box the sentence is about, if it is about one. */
  | { status: "not_saved"; message: string; field?: BinProblemField };

function notSaved(message: string, field?: BinProblemField): AddBinOutcome {
  return { status: "not_saved", message, field };
}

/** A number as typed, or null when the box was empty or didn't hold a number. "36", " 36.5 " and "36." are numbers; "36 ft" is not. */
export function typedNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(trimmed)) return null;
  return Number(trimmed);
}

/** PostGIS reads this as a point in longitude and latitude (WGS 84). */
export function ewktPoint(longitude: number, latitude: number): string {
  return `SRID=4326;POINT(${longitude} ${latitude})`;
}

/** About 11 cm on the ground: finer than a click on the map, and short in the database. */
const sixPlaces = (degrees: number) => Math.round(degrees * 1e6) / 1e6;

export async function addBin(input: NewBinInput, role: Role, deps: { store: BinStore }): Promise<AddBinOutcome> {
  if (role !== "farmer") return notSaved("Only the farmer adds bins. Switch to Farmer to add one.");

  const [longitude, latitude] = [typedNumber(input.longitude), typedNumber(input.latitude)];
  if (longitude === null || latitude === null || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) {
    return notSaved("Click the spot on the map where the bin stands.", "location");
  }

  const name = input.name.trim().replace(/\s+/g, " ");
  if (name === "") return notSaved("Give the bin a name, such as Bin 3.", "name");
  if (name.length > MAX_BIN_NAME_LENGTH) {
    return notSaved(`That name is too long. Keep it to ${MAX_BIN_NAME_LENGTH} letters or fewer.`, "name");
  }

  const [diameterFt, eaveHeightFt] = [typedNumber(input.diameterFt), typedNumber(input.eaveHeightFt)];
  const diameterProblem = binSizeProblem("diameter", diameterFt);
  if (diameterProblem) return notSaved(diameterProblem, "diameter");
  const heightProblem = binSizeProblem("eave_height", eaveHeightFt);
  if (heightProblem) return notSaved(heightProblem, "eave_height");

  const farm = await deps.store.loadFarm();
  if (!farm) return notSaved("Your farm isn't set up yet, so there is nowhere to add a bin.");
  const taken = farm.binNames.find((existing) => sameBinName(existing, name));
  if (taken) return notSaved(`You already have a ${taken}. Give this bin a different name.`, "name");

  const bin = await deps.store.insertBin({
    insured_id: farm.insuredId,
    name,
    location: ewktPoint(sixPlaces(longitude), sixPlaces(latitude)),
    diameter_ft: diameterFt!,
    eave_height_ft: eaveHeightFt!,
  });
  return { status: "saved", bin };
}
