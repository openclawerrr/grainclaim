"use server";

import { refresh } from "next/cache";
import { getDb } from "@/lib/db/client";
import { fieldStore } from "@/lib/db/field-store";
import { DEFAULT_FORM_READ_MODEL } from "@/lib/extract/models";
import { readFsaMap } from "@/lib/extract/read-fsa-map";
import { confirmFields, readFsaMapPhoto, type SavedField } from "@/lib/fields/add-fields";
import { loadSampleOutlines } from "@/lib/fields/nearby-outlines";
import { readCaptureInfo } from "@/lib/photos/photo-file";
import { getCurrentRole } from "@/lib/role/current-role";
import type { FieldProposal } from "@/lib/rules/field-proposal";
import type { MapSpot } from "@/lib/rules/outline-pairing";
import { FARM_TIME_ZONE } from "@/lib/tickets/farm-time-zone";

/** Larger than any phone photo of a map, and well inside the 21 MB a request may carry (next.config.ts). */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export type ReadFsaMapState =
  | { status: "idle" }
  /** The map is read and saved, and these are the fields it would add. No field is saved yet. */
  | { status: "ready"; documentId: string; click: MapSpot; proposal: FieldProposal; warnings: string[] }
  /** One plain sentence per reason. No fields can be proposed from this file. */
  | { status: "problem"; messages: string[] };

export type ConfirmFieldsState =
  | { status: "idle" }
  | { status: "saved"; fields: SavedField[]; skipped: string[] }
  /** Nothing was saved. `key` is the field the first sentence is about, if it is about one. */
  | { status: "problem"; messages: string[]; key?: string };

const problem = (...messages: string[]) => ({ status: "problem" as const, messages });

/** The spot the farmer clicked, as the form sends it. Null when it isn't two numbers. */
function clickedSpot(formData: FormData): MapSpot | null {
  const [longitude, latitude] = [formData.get("longitude"), formData.get("latitude")];
  if (typeof longitude !== "string" || typeof latitude !== "string" || longitude === "" || latitude === "") return null;
  const spot = { longitude: Number(longitude), latitude: Number(latitude) };
  return Number.isFinite(spot.longitude) && Number.isFinite(spot.latitude) ? spot : null;
}

/** For the demo, the outlines near any click are the sample file's. */
const outlinesNear = () => loadSampleOutlines();

/**
 * Step 1 of adding fields: reads the photo of the FSA map the farmer chose,
 * saves it as a document, and pairs its cropland fields with the outlines
 * near his click. Each call reads the photo with Claude, a fraction of a
 * cent, unless this exact file was read before. The role comes from the
 * cookie, never from the form.
 */
export async function readFsaMapAction(_previous: ReadFsaMapState, formData: FormData): Promise<ReadFsaMapState> {
  const role = await getCurrentRole();

  const file = formData.get("fsa_map");
  if (!(file instanceof File) || file.size === 0) return problem("Choose a photo of your FSA map.");
  if (file.size > MAX_FILE_BYTES) return problem("That file is larger than 10 MB. Choose a smaller photo of your FSA map.");
  const click = clickedSpot(formData);
  if (!click) return problem("Click the map roughly where your farm is.");

  let outcome;
  try {
    outcome = await readFsaMapPhoto(new Uint8Array(await file.arrayBuffer()), click, role, {
      store: fieldStore(getDb()),
      readFsaMap: (photo) => readFsaMap(photo, { model: DEFAULT_FORM_READ_MODEL }),
      captureInfo: (photo) => readCaptureInfo(photo, FARM_TIME_ZONE),
      outlinesNear,
      now: () => new Date(),
    });
  } catch (error) {
    console.error("Reading the FSA map failed:", error instanceof Error ? error.message : error);
    return problem("Something went wrong and your FSA map wasn't read. Try again in a moment.");
  }
  if (outcome.status === "not_ready") return problem(...outcome.messages);
  return outcome;
}

/**
 * Step 2: the farmer confirms. The form carries which document, where he
 * clicked, and the name he gave each field with the outline he was shown for
 * it. The outlines themselves are worked out again on the server.
 */
export async function confirmFieldsAction(_previous: ConfirmFieldsState, formData: FormData): Promise<ConfirmFieldsState> {
  const role = await getCurrentRole();

  const documentId = formData.get("fsa_map_document");
  const click = clickedSpot(formData);
  const [keys, outlineIds, names] = ["field_key", "field_outline", "field_name"].map((name) => formData.getAll(name));
  const complete =
    keys.length === outlineIds.length &&
    keys.length === names.length &&
    [...keys, ...outlineIds, ...names].every((value) => typeof value === "string");
  if (typeof documentId !== "string" || !click || !complete) return problem("Add a photo of your FSA map first.");

  let outcome;
  try {
    outcome = await confirmFields(
      {
        documentId,
        click,
        fields: keys.map((key, i) => ({ key: key as string, outlineId: outlineIds[i] as string, name: names[i] as string })),
      },
      role,
      { store: fieldStore(getDb()), outlinesNear, now: () => new Date() },
    );
  } catch (error) {
    console.error("Adding the fields failed:", error instanceof Error ? error.message : error);
    return problem("Something went wrong and the fields weren't added. Try again in a moment.");
  }
  if (outcome.status === "not_saved") return { status: "problem", messages: outcome.messages, key: outcome.key };

  // The map is read from the database; this makes sure the next look asks again.
  refresh();
  return outcome;
}
