"use server";

import { refresh } from "next/cache";
import { getDb } from "@/lib/db/client";
import { seasonStore } from "@/lib/db/season-store";
import { DEFAULT_FORM_READ_MODEL } from "@/lib/extract/models";
import { readFsa578 } from "@/lib/extract/read-fsa-578";
import { readSummaryOfCoverage } from "@/lib/extract/read-summary-of-coverage";
import { readCaptureInfo } from "@/lib/photos/photo-file";
import { getCurrentRole } from "@/lib/role/current-role";
import type { SeasonProposal } from "@/lib/rules/season-setup";
import { confirmSeason, readSeasonDocuments } from "@/lib/season/setup-season";
import { FARM_TIME_ZONE } from "@/lib/tickets/farm-time-zone";

/** Two files travel in one request, which next.config.ts caps at 21 MB. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export type ReadSeasonState =
  | { status: "idle" }
  /** Both documents are read and saved, and this is the season they describe. Nothing is set up yet. */
  | { status: "ready"; documents: { fsa578Id: string; coverageId: string }; proposal: SeasonProposal; warnings: string[] }
  /** One plain sentence per reason. No season can be set up from these files. */
  | { status: "problem"; messages: string[] };

export type ConfirmSeasonState =
  | { status: "idle" }
  | { status: "set_up"; proposal: SeasonProposal }
  | { status: "problem"; messages: string[] };

const problem = (...messages: string[]) => ({ status: "problem" as const, messages });

/**
 * Step 1 of season setup: reads the FSA-578 and the Summary of Coverage the
 * farmer chose, saves both as documents, and returns the season they
 * describe. Each call reads the two files with Claude, about a fifth of a
 * cent, unless these exact files were read before.
 */
export async function readSeasonDocumentsAction(_previous: ReadSeasonState, formData: FormData): Promise<ReadSeasonState> {
  const role = await getCurrentRole();

  const [fsa578, coverage] = [formData.get("fsa_578"), formData.get("summary_of_coverage")];
  const missing = [
    ...(fsa578 instanceof File && fsa578.size > 0 ? [] : ["Choose a photo of your FSA-578."]),
    ...(coverage instanceof File && coverage.size > 0 ? [] : ["Choose your Summary of Coverage."]),
  ];
  if (missing.length > 0 || !(fsa578 instanceof File) || !(coverage instanceof File)) return problem(...missing);
  const tooLarge = [
    ...(fsa578.size > MAX_FILE_BYTES ? ["Your FSA-578 is larger than 10 MB. Choose a smaller file."] : []),
    ...(coverage.size > MAX_FILE_BYTES ? ["Your Summary of Coverage is larger than 10 MB. Choose a smaller file."] : []),
  ];
  if (tooLarge.length > 0) return problem(...tooLarge);

  let outcome;
  try {
    outcome = await readSeasonDocuments(
      { fsa578: new Uint8Array(await fsa578.arrayBuffer()), coverage: new Uint8Array(await coverage.arrayBuffer()) },
      role,
      {
        store: seasonStore(getDb()),
        readFsa578: (file) => readFsa578(file, { model: DEFAULT_FORM_READ_MODEL }),
        readSummaryOfCoverage: (file) => readSummaryOfCoverage(file, { model: DEFAULT_FORM_READ_MODEL }),
        captureInfo: (photo) => readCaptureInfo(photo, FARM_TIME_ZONE),
        now: () => new Date(),
      },
    );
  } catch (error) {
    console.error("Reading the season's documents failed:", error instanceof Error ? error.message : error);
    return problem("Something went wrong and your documents weren't read. Try again in a moment.");
  }
  if (outcome.status === "not_ready") return problem(...outcome.messages);
  return outcome;
}

/**
 * Step 2: the farmer confirms. The form carries only which two documents; the
 * season is worked out again from what was saved for them.
 */
export async function confirmSeasonAction(_previous: ConfirmSeasonState, formData: FormData): Promise<ConfirmSeasonState> {
  const role = await getCurrentRole();
  const [fsa578Id, coverageId] = [formData.get("fsa_578_document"), formData.get("summary_of_coverage_document")];
  if (typeof fsa578Id !== "string" || typeof coverageId !== "string") {
    return problem("Add your FSA-578 and Summary of Coverage first.");
  }

  let outcome;
  try {
    outcome = await confirmSeason({ fsa578Id, coverageId }, role, { store: seasonStore(getDb()), now: () => new Date() });
  } catch (error) {
    console.error("Setting up the season failed:", error instanceof Error ? error.message : error);
    return problem("Something went wrong and the season wasn't set up. Nothing was saved. Try again in a moment.");
  }
  if (outcome.status === "not_set_up") return problem(...outcome.messages);

  // The home screen's totals and Needs attention list are read from the database; this makes sure the next visit asks again.
  refresh();
  return outcome;
}
