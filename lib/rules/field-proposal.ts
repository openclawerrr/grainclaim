/**
 * The fields a read FSA map would add to the farm (spec Phase 2): each
 * cropland field on the map paired with a public outline near the farmer's
 * click, with a name offered for it. Pure: plain data in, a proposal out.
 * Nothing here saves anything, and nothing is a field until the farmer
 * confirms it.
 *
 * - Pairing is in outline-pairing.ts; the offered names are in field-names.ts.
 * - A field whose FSA numbers are already on the farm map is left as it is,
 *   and said so.
 * - A field that couldn't be paired is listed with its reason, never guessed.
 *
 * What stops any field from being added comes back as plain sentences
 * (`problems`).
 */
import { outlineCenter } from "../map/geometry";
import { defaultFieldNames } from "./field-names";
import { fieldWords, pairFieldsWithOutlines, type MapSpot, type PairingMap, type PublicOutline } from "./outline-pairing";

/** The FSA map values a proposal uses. Null means the value wasn't read. */
export interface ProposalMap extends PairingMap {
  /** The two-letter postal code. */
  state: string | null;
  county: string | null;
  /** The section, township and range printed on the map. */
  plss_label: string | null;
}

/** A field already on the farm map. */
export interface ExistingField {
  id: string;
  name: string;
  fsa_farm: string | null;
  fsa_tract: string | null;
  fsa_field: string | null;
}

/** One field the farmer is asked to confirm. */
export interface ProposedField {
  /** Its FSA farm, tract and field number, as "1234/5678/3". Names it between the screen and the server. */
  key: string;
  fsaFarm: string;
  fsaTract: string;
  fsaField: string;
  /** The acres the FSA map prints for it. */
  fsaMapAcres: number;
  /** HEL, NHEL or UHEL as its label prints it, or null if it prints none. */
  hel: string | null;
  outlineId: string;
  /** The outline's rings of [longitude, latitude] points. */
  outline: number[][][];
  /** What the outline measures, as the database will store it. */
  outlineAcres: number;
  /** The name offered. The farmer can type over it. */
  defaultName: string;
}

export interface FieldProposal {
  farmNumber: string | null;
  state: string;
  county: string;
  /** The section, township and range printed on the map, as printed. */
  legalDescription: string | null;
  /** The fields that would be added, in the map's order. */
  fields: ProposedField[];
  /** One sentence per field on the map that the farm already has. */
  alreadyOnMap: string[];
  /** One sentence per field that has no outline, saying why. */
  unpaired: string[];
  /** How many fields the map draws as something other than cropland. They are left out. */
  notCropland: number;
}

export type FieldProposalResult = { ok: true; proposal: FieldProposal } | { ok: false; problems: string[] };

/** A field's FSA numbers as one key, or null when one wasn't read. Spaces around a number don't count. */
export function fsaFieldKey(farm: string | null, tract: string | null, field: string | null): string | null {
  return farm === null || tract === null || field === null ? null : `${farm.trim()}/${tract.trim()}/${field.trim()}`;
}

/** The sentence for a field on the map that the farm already has: left alone when proposing, skipped when saving. */
export function alreadyOnMapSentence(
  label: { tract: string | null; field: string | null },
  existing: ExistingField,
  what: "left" | "skipped" = "left",
): string {
  const then = what === "left" ? "is left as it is" : "was skipped";
  return `${fieldWords({ ...label, acres: null })} is already on your map as ${existing.name}, so it ${then}.`;
}

export function proposeFieldsFromMap(
  map: ProposalMap,
  outlines: readonly PublicOutline[],
  click: MapSpot,
  existing: readonly ExistingField[],
): FieldProposalResult {
  const problems: string[] = [];
  if (map.tracts.every((tract) => tract.fields.length === 0)) {
    problems.push("No fields could be read from that photo. Try a clearer one, with the whole map flat and in the frame.");
  }
  const missing = [...(map.state === null ? ["state"] : []), ...(map.county === null ? ["county"] : [])];
  if (missing.length > 0) {
    problems.push(
      `The map's ${missing.join(" and ")} couldn't be read from its heading, so its fields can't be added. Try a clearer photo, with the heading in the frame.`,
    );
  }
  if (problems.length > 0 || map.state === null || map.county === null) return { ok: false, problems };

  const onFarm = new Map(
    existing.flatMap((field): [string, ExistingField][] => {
      const key = fsaFieldKey(field.fsa_farm, field.fsa_tract, field.fsa_field);
      return key === null ? [] : [[key, field]];
    }),
  );

  const { pairings, notCropland } = pairFieldsWithOutlines(map, outlines, click);
  const alreadyOnMap: string[] = [];
  const unpaired: string[] = [];
  const paired: Omit<ProposedField, "defaultName">[] = [];
  for (const pairing of pairings) {
    const key = fsaFieldKey(pairing.farm, pairing.tract, pairing.field);
    const have = key === null ? undefined : onFarm.get(key);
    // A field the farm already has stays as it is, whether or not an outline fits it now.
    if (have) {
      alreadyOnMap.push(alreadyOnMapSentence(pairing, have));
    } else if (!pairing.paired) {
      unpaired.push(pairing.message);
    } else {
      paired.push({
        key: key!,
        fsaFarm: pairing.farm.trim(),
        fsaTract: pairing.tract.trim(),
        fsaField: pairing.field.trim(),
        fsaMapAcres: pairing.acres,
        hel: pairing.hel,
        outlineId: pairing.outline.id,
        outline: pairing.outline.coordinates,
        outlineAcres: pairing.outlineAcres,
      });
    }
  }

  const names = defaultFieldNames(
    paired.map((field) => ({
      center: outlineCenter(field.outline[0]),
      acres: field.fsaMapAcres,
      fsaTract: field.fsaTract,
      fsaField: field.fsaField,
    })),
    existing.map((field) => field.name),
  );

  return {
    ok: true,
    proposal: {
      farmNumber: map.farm_number,
      state: map.state,
      county: map.county,
      legalDescription: map.plss_label,
      fields: paired.map((field, i) => ({ ...field, defaultName: names[i] })),
      alreadyOnMap,
      unpaired,
      notCropland,
    },
  };
}
