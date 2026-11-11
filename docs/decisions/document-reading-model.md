# Decision: which model reads documents

**Status:** decided 2026-11-09 (Derrick) for tickets, the FSA-578 and the Summary of Coverage, measured the same day. The FSA map was measured and decided 2026-11-10 (Derrick).

## What we picked

- **Tickets: Claude Sonnet 5.5** (`claude-sonnet-5-5`). It is `DEFAULT_READ_MODEL` in `lib/extract/models.ts`.
- **FSA-578, Summary of Coverage and FSA map: Claude Haiku 5.5** (`claude-haiku-5-5`), for cost. It is `DEFAULT_FORM_READ_MODEL` in the same file.

All four are read through the Claude API with structured outputs, and switching a model is a one-word change.

## The main alternative

The other model in each case: the same API, prompt and schema. Haiku costs about one eighteenth of what Sonnet does.

## What we measured: tickets

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

## What we measured: FSA-578 and Summary of Coverage

`npm run score-documents -- --runs 3` read the sample FSA-578 from its phone photo and the sample Summary of Coverage from its PDF, three times with each model, and compared every value with the answer key in `sample-data/documents-2026.json`. That is 6 reads and 237 values per model: 36 values on the FSA-578 and 43 on the Summary of Coverage. Both models had the same prompts and schemas, at effort `medium`.

| | Claude Sonnet 5.5 | Claude Haiku 5.5 |
|---|---|---|
| FSA-578 (photo), 36 values | 108 of 108 | 108 of 108 |
| Summary of Coverage (PDF), 43 values | 129 of 129 | 129 of 129 |
| All values | 237 of 237 (100%) | 237 of 237 (100%) |
| Reads that failed | 0 | 0 |
| Cost per FSA-578 | $0.0212 | $0.0011 |
| Cost per Summary of Coverage | $0.0180 | $0.0011 |
| Time per FSA-578 | 5.3 s | 2.9 s |
| Time per Summary of Coverage | 3.5 s | 3.6 s |

- **Neither model missed a value,** so these scores don't separate the models. That is why cost decides for these two documents (see "Why Haiku for the FSA-578, Summary of Coverage and FSA map").
- **Both read correctly with the first prompts and schemas.** Nothing was tuned against the sample.
- **Rows are scored by what identifies them,** not by their position: an FSA-578 field by its farm, tract and field number, a share by its producer key, a unit by its unit number. A row the read leaves out counts every one of its values as a miss, and so does a row the document doesn't have.
- **Cost** is from the tokens each read was billed: about 8,600 in and 400 out for the FSA-578 photo, and about 6,500 in and 500 (Sonnet) to 960 (Haiku) out for the PDF.

## What we measured: FSA map

`npm run score-documents -- --runs 3` read the sample FSA map from its photo (`sample-data/photos/fsa-map.jpg`) three times with each model and compared every value with the answer key in `sample-data/documents-2026.json`. That is 3 reads and 57 values per model: 19 values on the map. Both models had the same prompt and schema, at effort `medium`.

| | Claude Sonnet 5.5 | Claude Haiku 5.5 |
|---|---|---|
| FSA map (photo), 19 values | 57 of 57 | 57 of 57 |
| Reads that failed | 0 | 0 |
| Cost per map | $0.0168 | $0.0011 |
| Time per map | 3.2 s | 4.1 s |

- **Neither model missed a value,** so these scores don't separate the models here either, and cost decides again.
- **Both read correctly with the first prompt and schema.** Nothing was tuned against the sample, and the answer key wasn't changed.
- **The 19 values** are the program year, farm number, state, county, the date the map was made, the PLSS label and the imagery credit; each tract's number and cropland total; and each field's number, acres, erodibility code and land use.
- **Four values take more than copying.**
  - The state is printed as "Iowa" and stored as `IA`: the model copies the name and code looks up the abbreviation.
  - A field's land use isn't printed: the model compares how the field is drawn with the legend.
  - A field's tract is the boundary its label sits inside.
  - The imagery credit is the year and program out of a longer line.
- **Rows are scored by what identifies them:** a tract by its farm and tract number, a field by its farm, tract and field number. A field read into the wrong tract scores as a missing row and an extra one.
- **The reader returns no coordinates.** A photo of a map doesn't say where on the earth its fields are; placing them is the pairing step's job.
- **The same run read the FSA-578 and Summary of Coverage again,** with the scores above: 108 of 108 and 129 of 129 for both models.
- **Cost** is from the tokens each read was billed: about 7,300 in, and 225 (Sonnet) to 640 (Haiku) out.

## Why Sonnet for tickets

- **Reliability on harder photos in a live demo.** The measured scores don't separate the models, so this is a judgment, not a measurement: a ticket photographed live will be harder than our six, and the larger model is the safer one to put in front of judges. Sonnet was also the only model with no misses at all.
- **Cost doesn't decide it.** A farm with 300 tickets in a season (our example, not a measured number) would pay about $6 with Sonnet and $0.33 with Haiku. Either is small next to one wrong load on a production report.

## Why Haiku for the FSA-578, Summary of Coverage and FSA map

- **Haiku matched Sonnet on every value.** Both read 237 of 237 on the FSA-578 and Summary of Coverage and 57 of 57 on the FSA map, with no failed reads, so there is no measured accuracy to pay for.
- **Cost.** One read of all three documents costs about $0.056 with Sonnet and $0.003 with Haiku. The map alone is $0.0168 against $0.0011, about one fifteenth.
- **Unlike on tickets, Haiku had no misses at all here.** Its ticket misses were all one unstored value, the buyer's address.
- **The risk is the same one as for tickets, taken the other way.** A real FSA-578, another insurer's summary or a real FSA map will be harder than our three samples, and the smaller model may fall behind on them. The map is the least tested of the three: it has two fields, and reading a field's land use and tract takes more than copying. The checks in `lib/rules/` flag a number that doesn't add up whichever model read it, and `--model sonnet` (or changing `DEFAULT_FORM_READ_MODEL`) switches back.

## Haiku for the second read, later

AGENTS.md says a value's confidence comes from the arithmetic checks and a second independent read. The second read isn't built yet. Haiku is a cheap candidate for it on tickets: it matched Sonnet on every stored value here, it is a different model from the first read, and it would add about a tenth of a cent per ticket. For the FSA-578, Summary of Coverage and FSA map, where Haiku is the first read, the independent second read would be Sonnet.

## What this doesn't show

- **The sample is small and easy.** Six tickets from one form, five of them printed, one handwritten, all photographed flat in good light. Three runs of the same six photos are not 18 different tickets. Real tickets are thermal prints, carbon copies, creased and filled in by many hands.
- **One FSA map, and an easy one.** It has two tracts with one field each, both cropland, in our own layout, photographed from a screen and then cropped and straightened. A real map can show dozens of fields in several tracts, small labels over busy imagery, non-cropland fields, wetland marks and a state's own layout. No field on ours is non-cropland, so reading land use from the legend was only tested one way.
- **One FSA-578 and one Summary of Coverage.** Each has two rows and one crop, and both are our own layouts. A real FSA-578 runs to many fields, several crops and more than one page, and every insurer lays its summary out differently. The Summary of Coverage was read from a clean PDF; a photo of one wasn't measured.
- **The arithmetic checks never fired on a live read,** because no model misread a number. They are covered by unit tests only (`lib/rules/ticket-checks.test.ts`, `fsa-578-checks.test.ts`, `summary-of-coverage-checks.test.ts` and `fsa-map-checks.test.ts`), including ticket 3's gross read as 77,740.
- **The map's checks are thin on our sample.** With one field in each tract, "cropland fields add up to the tract's total" only compares two printed numbers. It would catch a field read into the wrong tract here, but only because the two tracts' acres differ.
- **The two documents aren't compared with each other here.** The FSA-578's 80.20 acres against the Summary of Coverage's 80.00 is season setup's flag, not a reading check.
- **Dedicated OCR services weren't measured.** Azure Document Intelligence and AWS Textract are the alternative listed in SETUP.md.

## What would change this

If Haiku still matches Sonnet on a harder set of tickets (more handwritten tickets, worse photos, other buyers' forms), switch tickets to Haiku too. If Haiku misses values on a harder FSA-578 or Summary of Coverage (many fields, several crops, another insurer's layout, a photo of a summary) that Sonnet reads, switch those back to Sonnet. The same goes for a harder FSA map (many fields, non-cropland, a printed page photographed at an angle). Add photos to `sample-data/photos/` with their answers in `documents-2026.json` and run `npm run score-tickets` or `npm run score-documents` again.

## Details worth knowing

- **Structured outputs allow at most 16 values that can be null.** A ticket has 27, so the schema Claude fills in (`ticketWireSchema`) keeps null for the numbers and the date, uses `""` for missing text and `"unmarked"` for boxes, and `fromWire` turns those into nulls. The FSA-578, Summary of Coverage and FSA map schemas work the same way, with 8, 14 and 4 nullable values.
- **The model copies percents; code turns them into fractions.** The Summary of Coverage prints 75% and the app stores 0.75. The model returns 75 and code divides, so the model still does no arithmetic. A share printed as a percent is handled the same way.
- **The checks allow for how forms differ.** Shares printed to four decimals may add up to 0.9999, liability may be worked out from the guarantee before or after rounding, and reported acres are compared with farmland only when no field carries a second crop.
- **The prompt tells the model to copy each value and never work one out from another.** If it calculated net from gross and tare, "gross − tare = net" would pass on a misread.
- **No fallback model is set.** A refusal is a failed read, so the model named in `read_model` is always the one that answered.
- **Every reader shares one API call** (`lib/extract/read.ts`). After it was moved there, two runs of `npm run score-tickets -- --runs 1` gave the same ticket scores as above: Sonnet 162 of 162 both times, and Haiku missing only the buyer's address, on 3 and then 4 of its 6 reads.
