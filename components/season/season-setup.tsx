"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  confirmSeasonAction,
  readSeasonDocumentsAction,
  type ConfirmSeasonState,
  type ReadSeasonState,
} from "@/app/season/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { sendKeepingForm } from "@/lib/submit-form";
import { cn } from "@/lib/utils";
import { SeasonProposalView, seasonTitle } from "./season-proposal";

const IDLE = { status: "idle" } as const;

/**
 * Season setup on one screen (docs/spec.md Phase 3 and Part 11). The farmer
 * chooses his FSA-578 and Summary of Coverage and that is all he gives: the
 * policy, units, fields, acres, shares and guarantees are read and worked out
 * on the server. He looks them over and confirms. Nothing is typed.
 */
export function SeasonSetup() {
  const [round, setRound] = useState(0);
  return <SetUpOnce key={round} onStartOver={() => setRound((n) => n + 1)} />;
}

function SetUpOnce({ onStartOver }: { onStartOver: () => void }) {
  const [read, submitRead, reading] = useActionState(readSeasonDocumentsAction, IDLE as ReadSeasonState);
  const [confirmed, submitConfirm, confirming] = useActionState(confirmSeasonAction, IDLE as ConfirmSeasonState);

  if (confirmed.status === "set_up") {
    const { proposal } = confirmed;
    return (
      <div className="flex flex-col gap-4">
        <div role="status" className="flex items-center justify-between gap-6 rounded-2xl bg-green-100 px-6 py-4 ring-1 ring-line">
          <div>
            <h1 className="text-xl font-semibold text-ink">Season set up: {seasonTitle(proposal)}</h1>
            <p className="text-base text-ink">
              {proposal.flags.length === 0
                ? "Its guarantees are on your home screen."
                : "Its guarantees are on your home screen, and what needs a look is under Needs attention."}
            </p>
          </div>
          <Link href="/" className={cn(buttonVariants(), "h-12 shrink-0 rounded-xl px-5 text-base font-semibold")}>
            Back to home
          </Link>
        </div>
        <SeasonProposalView proposal={proposal} />
      </div>
    );
  }

  if (read.status === "ready") {
    const { proposal, warnings, documents } = read;
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-6 rounded-2xl bg-card px-6 py-4 shadow-card ring-1 ring-line">
          <div>
            <h1 className="text-xl font-semibold text-ink">{seasonTitle(proposal)}</h1>
            <p className="text-base text-ink-muted">
              Read from your FSA-578 and Summary of Coverage. Nothing is set up until you confirm.
            </p>
          </div>
          <form action={submitConfirm} className="flex shrink-0 gap-3">
            <input type="hidden" name="fsa_578_document" value={documents.fsa578Id} />
            <input type="hidden" name="summary_of_coverage_document" value={documents.coverageId} />
            <Button type="button" variant="outline" onClick={onStartOver} disabled={confirming} className="h-12 rounded-xl bg-card px-5 text-base font-semibold">
              Start over
            </Button>
            <Button type="submit" disabled={confirming} className="h-12 rounded-xl px-5 text-base font-semibold">
              {confirming ? "Setting up…" : "Looks right, set up the season"}
            </Button>
          </form>
        </div>

        {confirmed.status === "problem" ? <Problems messages={confirmed.messages} /> : null}
        <SeasonProposalView proposal={proposal} warnings={warnings} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[30rem_minmax(0,1fr)] items-start gap-6">
      <Card>
        <CardHeader>
          <h1 className="text-lg leading-snug font-semibold">Set up your season</h1>
          <CardDescription className="text-base">
            Choose your FSA-578 and your Summary of Coverage. GrainClaim reads them, matches them to your fields and works out
            each unit&apos;s guarantee.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChooseDocuments submit={submitRead} reading={reading} />
          {read.status === "problem" && !reading ? (
            <div className="mt-4">
              <Problems messages={read.messages} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex min-h-[28rem] items-center justify-center rounded-2xl bg-green-100 p-6 text-center ring-1 ring-line">
        <p className="max-w-md text-base text-ink-muted">
          Your units, fields and guarantees show here once the two documents are read. You confirm before anything is set up.
        </p>
      </div>
    </div>
  );
}

function Problems({ messages }: { messages: string[] }) {
  return (
    <div role="alert" className="flex flex-col gap-1 rounded-xl bg-yellow-100 px-4 py-3 text-base text-ink">
      {messages.map((message) => (
        <p key={message}>{message}</p>
      ))}
    </div>
  );
}

/**
 * The two file choosers. After a read that fails, both keep their files, so only the wrong one needs replacing:
 * the form is sent from onSubmit, because React empties a form sent through its `action` prop.
 */
function ChooseDocuments({ submit, reading }: { submit: (formData: FormData) => void; reading: boolean }) {
  const [names, setNames] = useState<{ fsa578: string | null; coverage: string | null }>({ fsa578: null, coverage: null });
  return (
    <form onSubmit={sendKeepingForm(submit)} className="flex flex-col gap-4">
      <FileChooser
        name="fsa_578"
        label="FSA-578"
        hint="A photo of the printed form, or its PDF."
        accept="image/jpeg,image/png,application/pdf"
        chosen={names.fsa578}
        disabled={reading}
        onChoose={(name) => setNames((current) => ({ ...current, fsa578: name }))}
      />
      <FileChooser
        name="summary_of_coverage"
        label="Summary of Coverage"
        hint="The PDF from your agent, or a photo of it."
        accept="application/pdf,image/jpeg,image/png"
        chosen={names.coverage}
        disabled={reading}
        onChoose={(name) => setNames((current) => ({ ...current, coverage: name }))}
      />
      <Button type="submit" disabled={!names.fsa578 || !names.coverage || reading} className="h-14 rounded-xl text-base font-semibold">
        {reading ? "Reading your documents…" : "Read documents"}
      </Button>
      {reading ? <p className="text-sm text-ink-muted">This takes a few seconds.</p> : null}
    </form>
  );
}

function FileChooser({
  name,
  label,
  hint,
  accept,
  chosen,
  disabled,
  onChoose,
}: {
  name: string;
  label: string;
  hint: string;
  accept: string;
  chosen: string | null;
  disabled: boolean;
  onChoose: (fileName: string | null) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label
        className={cn(
          buttonVariants({ variant: "outline" }),
          "h-14 cursor-pointer justify-between rounded-xl bg-card px-4 text-base font-semibold has-focus-visible:border-ring has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        <span>{label}</span>
        <span className="font-normal text-ink-muted">{chosen ? "Change" : "Choose file"}</span>
        <input
          type="file"
          name={name}
          accept={accept}
          required
          className="sr-only"
          onChange={(event) => onChoose(event.target.files?.[0]?.name ?? null)}
        />
      </label>
      <p className="truncate text-sm text-ink-muted">{chosen ?? hint}</p>
    </div>
  );
}
