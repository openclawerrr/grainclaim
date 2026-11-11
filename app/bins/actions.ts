"use server";

import { refresh } from "next/cache";
import { addBin, type BinProblemField, type NewBinInput, type SavedBin } from "@/lib/bins/add-bin";
import { binStore } from "@/lib/db/bin-store";
import { getDb } from "@/lib/db/client";
import { getCurrentRole } from "@/lib/role/current-role";

export type AddBinState =
  | { status: "idle" }
  | { status: "saved"; bin: SavedBin }
  /** One plain sentence saying what is wrong. Nothing was saved. `field` is the box it is about. */
  | { status: "problem"; message: string; field?: BinProblemField };

const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

/**
 * The farm map's one action: saves a bin at the spot the farmer clicked, with
 * the name and size he entered. The role comes from the cookie, never from
 * the form.
 */
export async function addBinAction(_previous: AddBinState, formData: FormData): Promise<AddBinState> {
  const role = await getCurrentRole();
  const input: NewBinInput = {
    name: text(formData, "name"),
    diameterFt: text(formData, "diameter_ft"),
    eaveHeightFt: text(formData, "eave_height_ft"),
    longitude: text(formData, "longitude"),
    latitude: text(formData, "latitude"),
  };

  let outcome;
  try {
    outcome = await addBin(input, role, { store: binStore(getDb()) });
  } catch (error) {
    console.error("Adding a bin failed:", error instanceof Error ? error.message : error);
    return { status: "problem", message: "Something went wrong and the bin wasn't added. Try again in a moment." };
  }
  if (outcome.status === "not_saved") return { status: "problem", message: outcome.message, field: outcome.field };

  // The map is read from the database; this makes sure the next look asks again.
  refresh();
  return { status: "saved", bin: outcome.bin };
}
