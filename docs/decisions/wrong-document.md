# Decision: how a reader notices the wrong kind of document

**Status:** decided and built 2026-11-11 (Derrick), step 2 of `docs/build-plan.md`. Measured the same day.

## The problem

A farmer chose the photo of his FSA map as his FSA-578. The FSA-578 reader read it without complaint, and it was saved as an FSA-578. A saved document is locked, so the same photo was then refused where it belonged.

## What we picked

**Each reader says what the document is, in the same Claude call that reads it.**

- The one Claude call every reader uses (`readWithClaude` in `lib/extract/read.ts`) adds one value, `document_kind`, as the first value Claude fills in: `fsa_578`, `summary_of_coverage`, `fsa_map`, `scale_ticket`, `settlement` or `other`.
- The kind is looked at before anything else in the answer. A file that isn't the kind the reader expects comes back as "not this kind", with the kind it is. It is never reported as a read that failed.
- Nothing of a refused file is saved: no file, no row. So it isn't remembered, and can still be added where it belongs.
- The farmer is told in one sentence, beside the file he chose: "This looks like an FSA map, not an FSA-578. Choose your FSA-578." The sentence is a pure rule in `lib/rules/document-kind.ts`.
- `settlement` can be named before there is a settlement reader (step 10), because a settlement chosen as a scale ticket is a likely mix-up.

## The main alternative

**A separate, cheap call first that only sorts the file into a kind,** and then the reader's call if the kind is right.

It keeps each reader's schema exactly as it was, and a wrong file costs less. But every right file, which is nearly every file, would cost two calls and wait for two answers, and the sorting call would see the same file the reader is about to see anyway.

## Why

- **One call.** No added wait and no second charge for the usual case. The kind costs about 540 more tokens in per read: a ticket read by Claude Sonnet 5.5 went from $0.0200 to $0.0212.
- **The model that reads the file is the one that names it,** so the two can't disagree.
- **One place.** Every reader gets the check, and the next reader (settlements) gets it by saying which kind it expects.

## What we measured

All on the sample documents, with the readers' usual models and effort.

- **Wrong files are refused by name.** 11 of 11, through the real readers: each of the four readers was handed sample files of other kinds (the FSA map as an FSA-578, the FSA-578 as a Summary of Coverage, a ticket as an FSA map, the settlement as a scale ticket, an aerial photo with no map drawn on it as a scale ticket, and so on). Each was named correctly, and the aerial photo as `other`.
- **Right files read as before.** `npm run score-tickets` and `npm run score-documents`, one run each, both models:

| | Claude Sonnet 5.5 | Claude Haiku 5.5 |
|---|---|---|
| Six tickets, 162 values | 162 of 162 | 159 of 162 |
| FSA map, FSA-578 and Summary of Coverage, 98 values | 98 of 98 | 98 of 98 |
| Reads that failed | 0 | 0 |

Haiku's three misses are the buyer's address on three tickets, the same miss at the same rate as in `document-reading-model.md`. The address isn't stored, and Sonnet reads tickets.

- **Where the instructions go matters.** The first version added a paragraph about the kind to the end of each reader's prompt. With it, Sonnet misread the handwritten ticket (ticket 3) in 2 of 27 reads: gross 80,740 and net 56,160, where the ticket says 79,740 and 55,160. Those two wrong values agree with each other, so the "gross − tare = net" check passes on them. The same day, the code before this change read that ticket right 26 times of 26. The version we kept adds nothing to a reader's prompt: everything about the kind is in the description of the `document_kind` value. It read ticket 3 right 41 times of 41. Two misses in 27 is too few to be sure the paragraph caused them, but the version we kept leaves each reader's prompt exactly as it was measured.

## Known limits

- **No override.** If Claude names a real but unusual or badly photographed document as `other`, or as the wrong kind, the farmer can only choose another photo.
- **A wrong file still costs one read.** Claude has to see it to name it.
- **A list of kinds the model is told, not held to.** The SDK sends a list of choices inside the value's description, as it does for every list in the readers' schemas. A name that isn't on the list is treated as `other`.
- **Measured on our own sample documents only,** which are clean and clearly titled.
