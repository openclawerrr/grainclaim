# Decision: which model reads tickets

**Status:** decided 2026-11-09 (Derrick). Measured the same day.

## What we picked

**Claude Sonnet 5.5** (`claude-sonnet-5-5`) reads ticket photos, through the Claude API with structured outputs. It is `DEFAULT_READ_MODEL` in `lib/extract/models.ts`; switching models is a one-word change.

## The main alternative

**Claude Haiku 5.5** (`claude-haiku-5-5`): the same API, prompt and schema, at about one eighteenth of the cost.

## What we measured

`npm run score-tickets -- --runs 3` read all six sample ticket photos three times with each model and compared every value with the answer key in `sample-data/documents-2026.json`. That is 18 reads and 486 values per model. Both models had the same prompt and schema, at effort `medium`.

| | Claude Sonnet 5.5 | Claude Haiku 5.5 |
|---|---|---|
| The 17 ticket values in spec Part 2 (the ones we store) | 306 of 306 | 306 of 306 |
| The 10 other printed values | 180 of 180 | 173 of 180 |
| All values | 486 of 486 (100%) | 479 of 486 (98.6%) |
| The handwritten ticket (ticket 3) | 81 of 81 | 81 of 81 |
| Reads that failed | 0 | 0 |
| Cost per ticket | $0.0200 | $0.0011 |
| Time per ticket | 3.6 s | 2.9 s |

- **The scores tie on every stored value.** Both models read all 17 Part 2 values correctly in all 18 reads, including ticket 3's handwritten gross weight (79,740, where the 9 looks like a 7).
- **Haiku's only misses were the buyer's address,** seven times out of 18. It returned "Nevada, IA" and dropped the line above it, "SAMPLE: Main Street". The address is not stored. The dropped line is the one that begins with our "SAMPLE:" marker, which reads like a label and not a street, so the marker is likely part of the cause. We did not test a ticket without it.
- **Cost** is from the tokens each read was billed, about 8,300 in (nearly all of it the photo) and 350 to 550 out, at list prices: Sonnet $2 in and $10 out per million tokens, Haiku $0.10 and $0.50.

## Why Sonnet

- **Reliability on harder photos in a live demo.** The measured scores don't separate the models, so this is a judgment, not a measurement: a ticket photographed live will be harder than our six, and the larger model is the safer one to put in front of judges. Sonnet was also the only model with no misses at all.
- **Cost doesn't decide it.** A farm with 300 tickets in a season (our example, not a measured number) would pay about $6 with Sonnet and $0.33 with Haiku. Either is small next to one wrong load on a production report.

## Haiku for the second read, later

AGENTS.md says a value's confidence comes from the arithmetic checks and a second independent read. The second read isn't built yet. Haiku is a cheap candidate for it: it matched Sonnet on every stored value here, it is a different model from the first read, and it would add about a tenth of a cent per ticket.

## What this doesn't show

- **The sample is small and easy.** Six tickets from one form, five of them printed, one handwritten, all photographed flat in good light. Three runs of the same six photos are not 18 different tickets. Real tickets are thermal prints, carbon copies, creased and filled in by many hands.
- **The arithmetic checks never fired on a live read,** because no model misread a number. They are covered by unit tests only (`lib/rules/ticket-checks.test.ts`), including ticket 3's gross read as 77,740.
- **Dedicated OCR services weren't measured.** Azure Document Intelligence and AWS Textract are the alternative listed in SETUP.md.

## What would change this

If Haiku still matches Sonnet on a harder set (more handwritten tickets, worse photos, other buyers' forms), switch to Haiku. Add photos to `sample-data/photos/` with their answers in `documents-2026.json` and run `npm run score-tickets` again.

## Details worth knowing

- **Structured outputs allow at most 16 values that can be null.** A ticket has 27, so the schema Claude fills in (`ticketWireSchema`) keeps null for the numbers and the date, uses `""` for missing text and `"unmarked"` for boxes, and `fromWire` turns those into nulls.
- **The prompt tells the model to copy each value and never work one out from another.** If it calculated net from gross and tare, "gross − tare = net" would pass on a misread.
- **No fallback model is set.** A refusal is a failed read, so the model named in `read_model` is always the one that answered.
