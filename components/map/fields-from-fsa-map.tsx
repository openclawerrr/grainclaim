"use client";

import { useEffect, useRef, useState } from "react";
import type { ConfirmFieldsState, ReadFsaMapState } from "@/app/fields/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { countOf, formatAcres } from "@/lib/format";
import type { LonLat } from "@/lib/map/geometry";
import { MAX_FIELD_NAME_LENGTH } from "@/lib/rules/field-names";
import type { ProposedField } from "@/lib/rules/field-proposal";
import { sendKeepingForm } from "@/lib/submit-form";
import { cn } from "@/lib/utils";

const PANEL = "flex flex-col gap-4 rounded-2xl bg-card p-4 shadow-card ring-1 ring-line";
const INPUT =
  "h-12 w-full rounded-xl border border-line bg-card px-3 text-base text-ink outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-yellow-400 aria-invalid:bg-yellow-100";

/** A field's FSA numbers as the spec writes them: "FSA 1234 / 5678 / 3". */
export function fsaNumbers(field: Pick<ProposedField, "fsaFarm" | "fsaTract" | "fsaField">): string {
  return `FSA ${field.fsaFarm} / ${field.fsaTract} / ${field.fsaField}`;
}

/** The map's erodibility code in plain words, with the code as printed. */
const HEL_WORDS: Record<string, string> = {
  HEL: "highly erodible (HEL)",
  NHEL: "not highly erodible (NHEL)",
  UHEL: "erodibility undetermined (UHEL)",
};

function Sentences({ title, sentences }: { title?: string; sentences: string[] }) {
  return (
    <div role="alert" className="flex flex-col gap-1 rounded-xl bg-yellow-100 px-4 py-3 text-base text-ink">
      {title ? <p className="font-semibold">{title}</p> : null}
      {sentences.map((sentence) => (
        <p key={sentence}>{sentence}</p>
      ))}
    </div>
  );
}

/**
 * Step 1, in the panel beside the map: the farmer chooses the photo of his
 * FSA map and clicks the map roughly where his farm is. That is all he gives;
 * the field numbers, acres and outlines are read and matched on the server.
 * After a read that fails, the chosen file and the clicked spot are kept: the
 * form is sent from onSubmit, because React empties a form sent through its
 * `action` prop.
 */
export function ChooseFsaMap({
  submit,
  reading,
  spot,
  problems,
  onCancel,
}: {
  submit: (formData: FormData) => void;
  reading: boolean;
  /** Where he clicked, once he has. */
  spot: LonLat | null;
  problems: string[] | null;
  onCancel: () => void;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  return (
    <form
      onSubmit={sendKeepingForm(submit)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !reading) onCancel();
      }}
      className={PANEL}
    >
      <h2 className="text-lg font-semibold text-ink">Add fields from your FSA map</h2>
      <input type="hidden" name="longitude" value={spot?.[0] ?? ""} />
      <input type="hidden" name="latitude" value={spot?.[1] ?? ""} />

      <div className="flex flex-col gap-1">
        <label
          className={cn(
            buttonVariants({ variant: "outline" }),
            "h-14 cursor-pointer justify-between rounded-xl bg-card px-4 text-base font-semibold has-focus-visible:border-ring has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
            reading && "pointer-events-none opacity-50",
          )}
        >
          <span>FSA map</span>
          <span className="font-normal text-ink-muted">{fileName ? "Change" : "Choose file"}</span>
          <input
            type="file"
            name="fsa_map"
            accept="image/jpeg,image/png,application/pdf"
            required
            className="sr-only"
            onChange={(event) => setFileName(event.target.files?.[0]?.name ?? null)}
          />
        </label>
        <p className="truncate text-sm text-ink-muted">{fileName ?? "A photo of the map FSA printed for your farm, or its PDF."}</p>
      </div>

      <p role="status" className={cn("rounded-xl px-4 py-3 text-base text-ink", spot ? "bg-green-100" : "bg-page font-semibold")}>
        {spot ? "Spot chosen. Click the map again to move it." : "Click the map roughly where your farm is."}
      </p>

      {problems && !reading ? <Sentences sentences={problems} /> : null}

      <div className="flex gap-3">
        <Button type="submit" disabled={!fileName || !spot || reading} className="h-12 flex-1 rounded-xl text-base font-semibold">
          {reading ? "Reading your map…" : "Read my map"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={reading} className="h-12 rounded-xl bg-card px-4 text-base">
          Cancel
        </Button>
      </div>
      <p className="text-sm text-ink-muted">
        {reading
          ? "Reading the field numbers and acres, then matching them to field outlines near your click. This takes a few seconds."
          : "GrainClaim reads the field numbers and acres, and matches each field to an outline near your click."}
      </p>
    </form>
  );
}

/**
 * Step 2: the fields the map would add, each drawn on the map and named
 * here. The names are offered and can be typed over; everything else was
 * read. Nothing is a field until he confirms.
 */
export function ReviewProposedFields({
  answer,
  submit,
  confirming,
  problem,
  picked,
  onStartOver,
  onCancel,
}: {
  answer: Extract<ReadFsaMapState, { status: "ready" }>;
  submit: (formData: FormData) => void;
  confirming: boolean;
  problem: Extract<ConfirmFieldsState, { status: "problem" }> | null;
  /** The proposed outline he last clicked on the map, so its name box can take the cursor. */
  picked: { key: string; at: number } | null;
  onStartOver: () => void;
  onCancel: () => void;
}) {
  const { proposal, warnings, documentId, click } = answer;
  const { fields } = proposal;
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((field) => [field.key, field.defaultName])));
  const nameBoxes = useRef(new Map<string, HTMLInputElement>());

  // Clicking a proposed outline on the map puts the cursor in its name.
  useEffect(() => {
    if (!picked) return;
    const box = nameBoxes.current.get(picked.key);
    box?.focus();
    box?.select();
  }, [picked]);

  const where = [
    proposal.farmNumber ? `FSA farm ${proposal.farmNumber}` : null,
    `${proposal.county} County, ${proposal.state}`,
    proposal.legalDescription,
  ].filter(Boolean);
  const needsALook = [...warnings, ...proposal.unpaired];

  return (
    <form
      action={submit}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !confirming) onCancel();
      }}
      className={cn(PANEL, "min-h-0 overflow-y-auto")}
    >
      <div>
        <h2 className="text-lg font-semibold text-ink">Fields from your FSA map</h2>
        <p className="text-sm text-ink-muted">{where.join(" · ")}</p>
      </div>
      <input type="hidden" name="fsa_map_document" value={documentId} />
      <input type="hidden" name="longitude" value={click.longitude} />
      <input type="hidden" name="latitude" value={click.latitude} />

      {fields.length === 0 ? (
        <p className="text-base text-ink">
          {proposal.alreadyOnMap.length > 0 && proposal.unpaired.length === 0
            ? "Every field on this map is already on your farm map, so there is nothing to add."
            : "No field on this map could be matched to an outline, so there is nothing to add."}
        </p>
      ) : null}

      {needsALook.length > 0 ? <Sentences title="Needs a look" sentences={needsALook} /> : null}

      {fields.map((field) => (
        <div key={field.key} className="flex flex-col gap-2 rounded-xl border border-line p-3">
          <input type="hidden" name="field_key" value={field.key} />
          <input type="hidden" name="field_outline" value={field.outlineId} />
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            Name
            <input
              ref={(box) => {
                if (box) nameBoxes.current.set(field.key, box);
                else nameBoxes.current.delete(field.key);
              }}
              name="field_name"
              value={names[field.key] ?? ""}
              onChange={(event) => setNames((current) => ({ ...current, [field.key]: event.target.value }))}
              maxLength={MAX_FIELD_NAME_LENGTH}
              autoComplete="off"
              aria-invalid={problem?.key === field.key || undefined}
              className={INPUT}
            />
          </label>
          <p className="text-base text-ink tabular-nums">
            {fsaNumbers(field)} · <span className="font-semibold">{formatAcres(field.fsaMapAcres)} acres</span>
          </p>
          <p className="text-sm text-ink-muted tabular-nums">
            The outline measures {formatAcres(field.outlineAcres)} acres
            {field.hel && HEL_WORDS[field.hel] ? ` · ${HEL_WORDS[field.hel]}` : ""}
          </p>
        </div>
      ))}

      {proposal.alreadyOnMap.length > 0 || proposal.notCropland > 0 ? (
        <div className="flex flex-col gap-1 text-sm text-ink-muted">
          {proposal.alreadyOnMap.map((sentence) => (
            <p key={sentence}>{sentence}</p>
          ))}
          {proposal.notCropland > 0 ? (
            <p>
              {countOf(proposal.notCropland, "area")} on the map {proposal.notCropland === 1 ? "isn't" : "aren't"} cropland, so{" "}
              {proposal.notCropland === 1 ? "it was" : "they were"} left out.
            </p>
          ) : null}
        </div>
      ) : null}

      {problem ? <Sentences sentences={problem.messages} /> : null}

      <div className="flex gap-3">
        {fields.length > 0 ? (
          <Button type="submit" disabled={confirming} className="h-12 flex-1 rounded-xl text-base font-semibold">
            {confirming ? "Adding…" : `Looks right, add ${fields.length === 1 ? "this field" : `${fields.length} fields`}`}
          </Button>
        ) : (
          <Button type="button" onClick={onCancel} className="h-12 flex-1 rounded-xl text-base font-semibold">
            Close
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onStartOver} disabled={confirming} className="h-12 rounded-xl bg-card px-4 text-base">
          Start over
        </Button>
      </div>
      {fields.length > 0 ? (
        <p className="text-sm text-ink-muted">Nothing is added to your farm until you confirm. Click an outline on the map to name it.</p>
      ) : null}
    </form>
  );
}
