"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { addTicketAction, type AddTicketState } from "@/app/tickets/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { formatDayOf } from "@/lib/format";
import { sendKeepingForm } from "@/lib/submit-form";
import { FARM_TIME_ZONE } from "@/lib/tickets/farm-time-zone";
import type { TicketResult } from "@/lib/tickets/ticket-result";
import { cn } from "@/lib/utils";
import { TicketResultView } from "./ticket-result-view";

const IDLE: AddTicketState = { status: "idle" };

/**
 * The Add ticket screen. The farmer chooses a photo and that is all he gives:
 * the time, GPS, values, field, unit and bushels are worked out on the
 * server. "Add another ticket" starts the screen over.
 */
export function AddTicket() {
  const [round, setRound] = useState(0);
  return <AddOneTicket key={round} onAddAnother={() => setRound((n) => n + 1)} />;
}

function AddOneTicket({ onAddAnother }: { onAddAnother: () => void }) {
  const [state, submit, pending] = useActionState(addTicketAction, IDLE);
  const [photo, setPhoto] = useState<{ name: string; url: string } | null>(null);

  // The preview is a link to the chosen file in this browser's memory. Let it go when the screen closes.
  const photoUrl = useRef<string | null>(null);
  useEffect(() => () => void (photoUrl.current && URL.revokeObjectURL(photoUrl.current)), []);

  // A problem is about the photo it was reported for; choosing another photo clears it.
  const [answered, setAnswered] = useState<AddTicketState>(IDLE);

  function choose(file: File | undefined) {
    if (photoUrl.current) URL.revokeObjectURL(photoUrl.current);
    photoUrl.current = file ? URL.createObjectURL(file) : null;
    setPhoto(file && photoUrl.current ? { name: file.name, url: photoUrl.current } : null);
    setAnswered(state);
  }

  if (state.status === "saved" || state.status === "duplicate" || state.status === "already_added") {
    return <Saved status={state.status} ticket={state.ticket} photo={photo} onAddAnother={onAddAnother} />;
  }

  return (
    <div className="grid grid-cols-[30rem_minmax(0,1fr)] items-start gap-6">
      <Card>
        <CardHeader>
          <h1 className="text-lg leading-snug font-semibold">Add ticket</h1>
          <CardDescription className="text-base">
            Choose a photo of a scale ticket. GrainClaim reads it, checks it and links it to its field.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Sent from onSubmit, so a photo that couldn't be added stays chosen and can be tried again. */}
          <form onSubmit={sendKeepingForm(submit)} className="flex flex-col gap-4">
            <label
              className={cn(
                buttonVariants({ variant: "outline" }),
                "h-14 cursor-pointer rounded-xl bg-card text-base font-semibold has-focus-visible:border-ring has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                pending && "pointer-events-none opacity-50",
              )}
            >
              {photo ? "Choose a different photo" : "Choose photo"}
              <input
                type="file"
                name="photo"
                accept="image/jpeg,image/png"
                required
                className="sr-only"
                onChange={(event) => choose(event.target.files?.[0])}
              />
            </label>
            {photo ? <p className="truncate text-sm text-ink-muted">{photo.name}</p> : null}

            <Button type="submit" disabled={!photo || pending} className="h-14 rounded-xl text-base font-semibold">
              {pending ? "Reading the ticket…" : "Add ticket"}
            </Button>
            {pending ? <p className="text-sm text-ink-muted">This takes a few seconds.</p> : null}

            {state.status === "problem" && state !== answered ? (
              <p role="alert" className="rounded-xl bg-yellow-100 px-4 py-3 text-base text-ink">
                {state.message}
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <PhotoPanel photo={photo} />
    </div>
  );
}

const HEADLINE: Record<"saved" | "duplicate" | "already_added", string> = {
  saved: "Ticket added",
  duplicate: "Same ticket, second photo",
  already_added: "Already in your records",
};

function summary(status: "saved" | "duplicate" | "already_added", ticket: TicketResult): string {
  if (status === "duplicate") {
    const first = ticket.duplicateOf;
    const when = first ? ` on ${formatDayOf(first.uploadedAt, FARM_TIME_ZONE)}` : "";
    return `You added this ticket${when}. This photo was kept, but its bushels aren't counted again.`;
  }
  const where = ticket.origin
    ? [ticket.origin.fieldName, ticket.origin.unitNumber ? `Unit ${ticket.origin.unitNumber}` : null].filter(Boolean).join(", ")
    : null;
  if (status === "already_added") {
    return `This exact photo was added on ${formatDayOf(ticket.uploadedAt, FARM_TIME_ZONE)}. Nothing new was saved.`;
  }
  if (ticket.origin?.insured === false) {
    return `It's linked to ${where}, which isn't insured, so it isn't counted in a unit's total.`;
  }
  return where ? `It's linked to ${where} and counted in the season totals.` : "It was saved.";
}

function Saved({
  status,
  ticket,
  photo,
  onAddAnother,
}: {
  status: "saved" | "duplicate" | "already_added";
  ticket: TicketResult;
  photo: { name: string; url: string } | null;
  onAddAnother: () => void;
}) {
  return (
    <div className="grid grid-cols-[24rem_minmax(0,1fr)] items-start gap-6">
      <div className="sticky top-6 flex flex-col gap-4">
        <PhotoPanel photo={photo} />
      </div>

      <div className="flex flex-col gap-4">
        <div
          role="status"
          className={cn(
            "flex items-center justify-between gap-6 rounded-2xl px-6 py-4 ring-1 ring-line",
            status === "saved" ? "bg-green-100" : "bg-yellow-100",
          )}
        >
          <div>
            <h1 className="text-xl font-semibold text-ink">{HEADLINE[status]}</h1>
            <p className="text-base text-ink">{summary(status, ticket)}</p>
          </div>
          <div className="flex shrink-0 gap-3">
            <Link href="/" className={cn(buttonVariants({ variant: "outline" }), "h-12 rounded-xl bg-card px-5 text-base font-semibold")}>
              Back to home
            </Link>
            <Button onClick={onAddAnother} className="h-12 rounded-xl px-5 text-base font-semibold">
              Add another ticket
            </Button>
          </div>
        </div>

        <TicketResultView ticket={ticket} />
      </div>
    </div>
  );
}

/** The chosen photo, shown from this browser. The original is what the server stores. */
function PhotoPanel({ photo }: { photo: { name: string; url: string } | null }) {
  if (!photo) {
    return (
      <div className="flex min-h-[28rem] items-center justify-center rounded-2xl bg-green-100 p-6 text-center ring-1 ring-line">
        <p className="text-base text-ink-muted">The photo you choose shows here.</p>
      </div>
    );
  }
  return (
    // A blob: link to a local file, which next/image can't optimize.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={photo.url}
      alt={`The ticket photo you chose, ${photo.name}`}
      className="max-h-[calc(100dvh-7rem)] w-full rounded-2xl bg-card object-contain shadow-card ring-1 ring-line"
    />
  );
}
