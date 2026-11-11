/**
 * Pairs the cropland fields read from an FSA map with public field outlines
 * near the spot the farmer clicked (spec Phase 2). A photo of a map has no
 * coordinates, so the outlines are what place its fields on the ground.
 * Pure: plain data in, pairs out. Nothing here saves anything.
 *
 * - Only outlines within about 2 km of the click are looked at.
 * - A field and an outline pair when the outline measures within 1% of the
 *   acres the map prints for the field. The outline is measured the way the
 *   database measures `mapped_acres` (scripts/outlines/acres.ts), so a pair
 *   made here doesn't fire the season's acre flag once it is saved.
 * - A pair is made only when it is the one answer: the field fits exactly one
 *   outline, and that outline fits no other field. Anything else is left
 *   unpaired with one plain sentence saying why. Never a guess.
 * - Fields the map draws as something other than cropland (a farmstead, a
 *   waterway, trees) are left out: the public outlines are of crop fields.
 */
import { point, pointToPolygonDistance } from "@turf/turf";
import { databaseAcres } from "../../scripts/outlines/acres";
import { listOf } from "./document-checks";
import { CROPLAND } from "./fsa-map-checks";
import { MAP_ACRE_TOLERANCE } from "./season-setup";

/** How far from the click an outline can be and still be looked at. */
export const NEARBY_METERS = 2000;
/** An outline fits a field when it measures within this share of the field's printed acres: 1%, as season setup allows. */
export const PAIRING_ACRE_TOLERANCE = MAP_ACRE_TOLERANCE;

// ---------------------------------------------------------------------------
// What goes in
// ---------------------------------------------------------------------------

/** The FSA map values pairing uses. Null means the value wasn't read. */
export interface PairingMap {
  farm_number: string | null;
  tracts: readonly {
    tract: string | null;
    fields: readonly {
      field: string | null;
      acres: number | null;
      /** HEL, NHEL or UHEL, as the field's label prints it. */
      hel: string | null;
      /** "cropland" or "non_cropland", by how the map draws the field. */
      land_use: string | null;
    }[];
  }[];
}

/** A public field outline: a polygon with no name and no FSA numbers. */
export interface PublicOutline {
  id: string;
  /** The polygon's rings of [longitude, latitude] points: the outer ring, then any holes. */
  coordinates: number[][][];
}

export interface MapSpot {
  longitude: number;
  latitude: number;
}

// ---------------------------------------------------------------------------
// What comes out
// ---------------------------------------------------------------------------

/** One field's label on the map, with the farm and tract it sits in. */
export interface MapFieldLabel {
  farm: string | null;
  tract: string | null;
  field: string | null;
  /** The acres the map prints. */
  acres: number | null;
  hel: string | null;
}

export type UnpairedReason =
  /** Its FSA numbers or acres weren't read, so there is nothing to match on or save it under. */
  | "not_read"
  /** The photo doesn't show whether it is cropland. */
  | "land_use_not_read"
  /** The map shows its field number more than once in the tract. */
  | "repeated"
  /** No nearby outline measures within 1% of its acres. */
  | "no_fit"
  /** More than one nearby outline does. */
  | "several_fit"
  /** The one outline that fits it also fits another field. */
  | "shared_fit";

export type FieldPairing =
  | {
      paired: true;
      farm: string;
      tract: string;
      field: string;
      acres: number;
      hel: string | null;
      outline: PublicOutline;
      /** What the outline measures, as the database will store it. */
      outlineAcres: number;
    }
  | (MapFieldLabel & {
      paired: false;
      reason: UnpairedReason;
      /** One plain sentence saying why this field has no outline. */
      message: string;
    });

export interface PairingResult {
  /** One per field on the map that is cropland, or might be, in the map's order. */
  pairings: FieldPairing[];
  /** How many outlines were close enough to the click to be looked at. */
  outlinesNearby: number;
  /** How many fields the map draws as something other than cropland. They get no outline. */
  notCropland: number;
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

const usableAcres = (value: number | null): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const acresWords = (value: number) => value.toFixed(2);
const kilometers = `${NEARBY_METERS / 1000} km`;
const percent = `${PAIRING_ACRE_TOLERANCE * 100}%`;

/** "Field 3 on tract 5678 (80.20 acres)", with whatever of that was read. */
export function fieldWords({ tract, field, acres }: Pick<MapFieldLabel, "tract" | "field" | "acres">): string {
  const which = field === null ? "A field" : `Field ${field}`;
  const where = tract === null ? "" : ` on tract ${tract}`;
  return `${which}${where}${usableAcres(acres) ? ` (${acresWords(acres)} acres)` : ""}`;
}

/** How far a spot is from an outline, in meters. Zero inside it. */
export function metersFromOutline(spot: MapSpot, outline: PublicOutline): number {
  const away = pointToPolygonDistance(
    point([spot.longitude, spot.latitude]),
    { type: "Polygon", coordinates: outline.coordinates },
    { units: "meters" },
  );
  return Math.max(0, away);
}

/** True when an outline's measured acres are within the tolerance of the acres the map prints. */
export function acresFit(outlineAcres: number, printedAcres: number): boolean {
  return Math.abs(outlineAcres - printedAcres) <= printedAcres * PAIRING_ACRE_TOLERANCE + 1e-9;
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

export function pairFieldsWithOutlines(map: PairingMap, outlines: readonly PublicOutline[], click: MapSpot): PairingResult {
  const nearby = outlines
    .filter((outline) => metersFromOutline(click, outline) <= NEARBY_METERS)
    .map((outline) => ({ outline, acres: databaseAcres(outline) }));

  const all = map.tracts.flatMap((tract) =>
    tract.fields.map((line) => ({
      label: { farm: map.farm_number, tract: tract.tract, field: line.field, acres: line.acres, hel: line.hel },
      landUse: line.land_use,
    })),
  );
  const numbers = all.map(({ label }) => `${label.farm}/${label.tract}/${label.field}`);
  const listed = all
    .map((entry, i) => ({ ...entry, repeated: numbers.indexOf(numbers[i]) !== numbers.lastIndexOf(numbers[i]) }))
    .filter((entry) => entry.landUse === CROPLAND || entry.landUse === null);

  // Every outline each field's acres fit, whatever else is wrong with the field: a field that can't be paired
  // itself still makes an outline it fits uncertain for the others.
  const fits = listed.map(({ label }) => (usableAcres(label.acres) ? nearby.filter((near) => acresFit(near.acres, label.acres!)) : []));
  const fieldsFitting = (outlineId: string) => listed.filter((_, i) => fits[i].some((near) => near.outline.id === outlineId));

  const pairings = listed.map(({ label, landUse, repeated }, i): FieldPairing => {
    const unpaired = (reason: UnpairedReason, because: string): FieldPairing => ({
      paired: false,
      ...label,
      reason,
      message: `${fieldWords(label)} wasn't matched to an outline because ${because}`,
    });

    const { farm, tract, field, acres, hel } = label;
    const notRead = [
      ...(farm === null ? ["farm number"] : []),
      ...(tract === null ? ["tract number"] : []),
      ...(field === null ? ["field number"] : []),
      ...(usableAcres(acres) ? [] : ["acres"]),
    ];
    if (farm === null || tract === null || field === null || !usableAcres(acres)) {
      return unpaired("not_read", `its ${listOf(notRead)} couldn't be read from the photo.`);
    }
    if (landUse === null) return unpaired("land_use_not_read", "the photo doesn't show whether it is cropland.");
    if (repeated) return unpaired("repeated", "the map shows that field number more than once.");

    if (nearby.length === 0) return unpaired("no_fit", `no field outlines were found within ${kilometers} of where you clicked.`);
    if (fits[i].length === 0) {
      return unpaired("no_fit", `no outline within ${kilometers} of where you clicked measures within ${percent} of its acres.`);
    }
    if (fits[i].length > 1) {
      return unpaired(
        "several_fit",
        `${fits[i].length} outlines near where you clicked measure within ${percent} of its acres, and GrainClaim won't guess between them.`,
      );
    }
    const [{ outline, acres: outlineAcres }] = fits[i];
    const others = fieldsFitting(outline.id).filter((other) => other !== listed[i]);
    if (others.length > 0) {
      return unpaired(
        "shared_fit",
        `the one outline that fits it also fits ${listOf(others.map((other) => lowerFirst(fieldWords(other.label))))}, and GrainClaim won't guess which is which.`,
      );
    }
    return { paired: true, farm, tract, field, acres, hel, outline, outlineAcres };
  });

  return {
    pairings,
    outlinesNearby: nearby.length,
    notCropland: all.length - listed.length,
  };
}
