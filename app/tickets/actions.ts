"use server";

import { refresh } from "next/cache";
import { getDb } from "@/lib/db/client";
import { loadTicketResult } from "@/lib/db/ticket-result";
import { ticketStore } from "@/lib/db/ticket-store";
import { DEFAULT_READ_MODEL } from "@/lib/extract/models";
import { readTicket } from "@/lib/extract/read-ticket";
import { readCaptureInfo } from "@/lib/photos/photo-file";
import { getCurrentRole } from "@/lib/role/current-role";
import { addTicket } from "@/lib/tickets/add-ticket";
import { FARM_TIME_ZONE } from "@/lib/tickets/farm-time-zone";
import type { TicketResult } from "@/lib/tickets/ticket-result";

/** The same limit as the `photos` bucket. next.config.ts allows a little more for the form around the file. */
const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

export type AddTicketState =
  | { status: "idle" }
  /** saved: counted. duplicate: kept but not counted. already_added: nothing new. */
  | { status: "saved" | "duplicate" | "already_added"; ticket: TicketResult }
  /** One plain sentence saying what went wrong. Nearly always, nothing was saved. */
  | { status: "problem"; message: string };

function problem(message: string): AddTicketState {
  return { status: "problem", message };
}

/**
 * The Add ticket screen's one action: takes the chosen photo through
 * lib/tickets/add-ticket.ts and returns the saved ticket as the database
 * holds it. Each call reads the photo with Claude, which costs about 2 cents.
 */
export async function addTicketAction(_previous: AddTicketState, formData: FormData): Promise<AddTicketState> {
  const role = await getCurrentRole();
  if (role !== "farmer") return problem("Only the farmer adds tickets. Switch to Farmer to add one.");

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return problem("Choose a photo of the ticket first.");
  if (file.size > MAX_PHOTO_BYTES) return problem("That photo is larger than 20 MB. Choose a smaller one.");

  let db;
  let outcome;
  try {
    db = getDb();
    outcome = await addTicket(new Uint8Array(await file.arrayBuffer()), role, {
      store: ticketStore(db),
      read: (photo) => readTicket(photo, { model: DEFAULT_READ_MODEL }),
      captureInfo: (photo) => readCaptureInfo(photo, FARM_TIME_ZONE),
      now: () => new Date(),
    });
  } catch (error) {
    console.error("Adding a ticket failed:", error instanceof Error ? error.message : error);
    return problem("Something went wrong and the ticket wasn't added. Try again in a moment.");
  }

  if (outcome.status === "not_saved") {
    if (outcome.detail) console.error("The ticket wasn't saved:", outcome.detail);
    return problem(outcome.message);
  }

  // The home screen's totals are read from the database; this makes sure the next visit asks again.
  refresh();

  try {
    const ticket = await loadTicketResult(db, outcome.ticketId);
    if (ticket) return { status: outcome.status, ticket };
  } catch (error) {
    console.error("Loading the saved ticket failed:", error instanceof Error ? error.message : error);
  }
  return problem(SAVED_BUT_NOT_SHOWN[outcome.status]);
}

const SAVED_BUT_NOT_SHOWN = {
  saved: "The ticket was saved, but it can't be shown right now. Its bushels are on the home screen.",
  duplicate: "This is a second photo of a ticket already in your records. It was kept and isn't counted again, but it can't be shown right now.",
  already_added: "This photo is already in your records, but it can't be shown right now.",
} as const;
