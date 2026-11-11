# GrainClaim build plan

_Last updated: November 11, 2026._

GrainClaim is built in stages. This stage is a web app in a desktop browser that carries the whole record pipeline in `docs/spec.md`, from the farm map to the production report the agent sees. The next stage, which starts with the phone layout, is under "After the hackathon" at the end.

The steps under "Build order" are built in order. Each one works for real when it's merged: location is read from the browser and documents are read live.

## Status

- [x] Setup: repo, Supabase with PostGIS, `AGENTS.md`, `docs/spec.md`
- [x] Database schema (12 tables)
- [x] Calculations in `lib/rules/` with tests
- [x] Seed: `npm run seed` loads Dave's farm in stages (`farm-base` → `bin-3` → `fields` → `season-2026`) and resets it safely
- [x] Sample documents: `npm run print-docs` and the PDFs in `sample-data/print/` (PR #6)
- [x] Sample photos in `sample-data/photos/`: the six tickets, the FSA-578 and the FSA map
- [x] App shell and roles: the top bar, icon rail, Farmer / Agent switcher and a home screen for each role
- [x] Thin slice: a ticket photo becomes a row in a unit's total
- [x] Farm map: fields from a photo of the FSA map, and adding a bin
- [x] Season setup from the FSA-578 and Summary of Coverage
- [x] Readers refuse the wrong kind of document, by name, before anything is saved
- [ ] The build order below, steps 3 to 16

## Who owns what

| Person | Owns |
|---|---|
| **A** | Database and migrations, seed and sample data, matching rules, season setup, report numbers |
| **B** | Reading documents (tickets, FSA-578, Summary of Coverage, settlements, FSA maps), ticket review screen, Needs attention |
| **C** | App shell and roles, farm map and bins, harvest log, agent view, deployment |

## Rules

- **In order, and for real.** Build the steps under "Build order" in order. Every feature works for real when it's merged: location comes from the browser and documents are read live, with no simulated or cached stand-ins. If a task starts pulling in something from "After the hackathon", stop and leave it for the next stage.
- **One task, one branch, one pull request.** Have Claude Code plan before it codes. Tests, lint and build pass, and a teammate reviews before merging.
- **One migration at a time.** Only one open pull request may contain a migration. Whoever merges it runs `npx supabase db push --remote` and tells the team.
- **Rules before screens.** Matching and flag rules go in `lib/rules/` as pure functions with tests, then get wired into screens.
- **Record design choices.** A task that makes a real design choice adds or updates a one-page record in `docs/decisions/`: what we picked, the main alternative, and why.
- **Use the spec's numbers.** Sample data matches Part 9 exactly (80.20 vs 80.00 acres, 5 of 6 tickets on the settlement), so every screen shows the spec's numbers.
- **Every screen follows `docs/spec.md` Part 11** (UI principles) and the farmer rules in `AGENTS.md`: ask for the minimum, capture the rest automatically, show details on request. Design for a laptop browser.
- **Seeding resets the shared database for everyone.** Tell the team before running it.

## What's built

### Foundations

- **Seed and reset (A).** Done.
- **Sample documents (B).** Done (PR #6). The tickets, the FSA-578 and the FSA map are printed and photographed into `sample-data/photos/`, named after each document (`ticket-3.jpg`); the Summary of Coverage and settlement are uploaded as the PDFs themselves.
- **Ticket reading (B).** Done. `npm run read-ticket -- <photo>` reads one ticket photo with Claude structured outputs into a schema with every ticket field (including the time in) and runs the arithmetic checks. `npm run score-tickets` reads every sample photo with Claude Sonnet 5.5 and Claude Haiku 5.5 and scores each value against the answer key in `documents-2026.json`. The scores are in `docs/decisions/document-reading-model.md`.
- **App shell and roles (C).** Done. A role switcher (Farmer, Agent) and a home screen for each, laid out for a laptop browser, with the colors and fonts from `docs/design.md`. The role is kept in a cookie; server code reads it with `getCurrentRole()` in `lib/role/` and saves it in each record's "who" fields, since the audit log can't see who acted without logins. The farmer's home screen has Add ticket, the season totals beside each unit's guarantee, Needs attention and the farm map, all read from the database. "Start harvesting" is on the screen and turned off until step 7. The agent's home screen is a placeholder until the report is built in steps 13 and 14, and the farm name in the top bar is fixed text.
- **Decision records (anyone).** A short page for each main choice, in `docs/decisions/`. Written so far: which model reads documents, how loads work, and how a reader notices the wrong kind of document. The rest come with step 16.

### Thin slice: one load, start to finish

Upload a ticket photo: it's hashed and stored, GPS and time are read, the ticket is read and checked, linked to North 80 through a hard-coded harvest log entry, its bushels calculated, and the row saved. Its migration also adds a ticket time column (time in, as printed), covered by the read-value lock. *Done when a sample photo adds a row to the Unit 1 total.* This proves the riskiest part early.

Built. What it leaves for later steps:

- **Steps 6 and 7 replace `originOfLoad()`** in `lib/rules/load-origin.ts`, which returns North 80 for every ticket, with the load rules. Nothing else should need to change to link tickets to their loads.
- **Step 6's migration makes a trip's truck and estimate optional.** Until then a ticket whose truck number or buyer isn't on the farm's records is not saved, and the screen says why.
- **The result screen is read-only.** "Looks right" and flagging a value come with ticket review (step 9). A failed check is saved, counted and shown in yellow; no flag row is created yet.
- **A second photo of the same ticket** (same buyer, number and date) is kept with `duplicate_of` set and no trip, so it isn't counted. No flag row is created for it yet either.
- **The farm's time zone is one constant** (`lib/tickets/farm-time-zone.ts`, Central time), used to turn a ticket's printed time into the trip's time.
- **Not built:** the second independent read. It comes with ticket review (step 9).

### Farm map and season setup

- **Farm map (C).** Built: the satellite map on the farmer's home screen, with each field as a translucent outline. The panel that opens when a field is clicked, with its FSA numbers, acres and legal description, is step 3.
- **AI-proposed outlines (B and C, migration with A).** Dave uploads a photo of his FSA map and clicks roughly where the farm is; Claude reads the map's field numbers and acres, GrainClaim pairs them with nearby outlines, and Dave confirms them. *Done when the sample FSA map photo produces North 80 and South 40 outlines that Dave can confirm.* Built: "Add fields from FSA map" on the home screen's map takes the photo and a click roughly where the farm is. The photo is read and saved as a document (kind `fsa_map`), and each cropland field on it is paired with one outline by acres: the outline must measure within 1% of the acres the map prints, among outlines within 2 km of the click. A field that fits no outline, or more than one, is left unpaired with a sentence saying why; nothing is guessed. The pairs show as dashed outlines with their FSA numbers and acres, each with a name offered from where it lies and its size (North 80, South 40), which Dave can type over. Fields are written only when he confirms, with `source = 'ai_proposed'`, the map's erodibility, printed acres and section label, and a link to the document; a field whose FSA numbers are already on the farm is skipped. At this stage the nearby outlines come from `sample-data/nearby-outlines.geojson`, a file of USDA crop-field outlines around the sample farm: North 80's and South 40's outlines, which measure 80.20 and 40.00 acres, and six real neighbors. Loading the outlines around any farm is in the next stage.
- **Add a bin (C, seed change with A).** Click a spot on the map, enter diameter and eave height on the same screen (both required, no default); capacity is calculated. *Done when adding Bin 3 (36 ft, 24 ft) takes about 10 seconds.* Done: "Add a bin" on the home screen's map, then a click on the spot and the two sizes in the panel beside it. The name is offered as the next number and can be typed over. The seed still loads the farm name, trucks and elevator, and loads Bin 3 in its own stage (`bin-3`) right after `farm-base`, so Dave can add Bin 3 from the map himself.
- **Reading the FSA map (B).** Done. `npm run read-document -- <file>` reads an FSA map, from a photo or a PDF, into the farm, its tracts and each field's number, acres, erodibility and land use, and checks that each tract's cropland fields add up to its cropland total and that no field number repeats in a tract. It returns no coordinates: the outlines, above, are what place the fields. `npm run score-documents` reads the sample map photo too.
- **Reading the FSA-578 and Summary of Coverage (B).** Done. `npm run read-document -- <file>` reads either one, from a photo or a PDF, into a schema with every value in the answer key and runs its checks (shares, acres and dates on the FSA-578; guarantees, liability and totals on the Summary of Coverage). `npm run score-documents` reads the sample FSA-578 photo and Summary of Coverage PDF with Claude Sonnet 5.5 and Claude Haiku 5.5 and scores each value against `documents-2026.json`. The scores are in `docs/decisions/document-reading-model.md`. Comparing the two documents with each other (the acre mismatch) is season setup, below.
- **Season setup (A).** The two documents create the policy, units and field seasons, matched to fields by FSA number. Guarantees are calculated, and acre or share mismatches are flagged. *Done when the sample documents create Units 1 and 2 with guarantees of 10,827 and 3,600 bushels and one acre-mismatch flag.* Built: "Set up your season" on the home screen takes the two files, reads and saves them (the `document` table, from this task's migration), shows the units, fields, acres, shares and guarantees, and writes the season when the farmer confirms. Rows of the Summary of Coverage with the same unit number are one unit with several fields, and a row with no field number covers its whole tract. Acres are checked field by field: flagged when the two documents differ at all, or when the map is more than 1% off the FSA-578; a mapped field missing from the FSA-578 is flagged too. A field on the FSA-578 that no unit covers is kept as not insured, with no unit and no guarantee. A 100% share is saved as owned, since neither document says owned or cash rent.

## Build order

Each step is one task, with its own branch and pull request. Steps 6, 11 and 13 each carry a migration.

- [x] **1. These docs.** `docs/spec.md`, this plan and `AGENTS.md` describe the product, how loads work and this build order. `docs/decisions/loads.md` records the choice behind loads.
- [x] **2. Readers refuse the wrong document.** Each reader (ticket, FSA map, FSA-578, Summary of Coverage) says in one plain sentence that the file isn't the document it was asked for, saves nothing, and lets the farmer choose another. *Done when the FSA map photo chosen as the FSA-578 is refused by name, and choosing the right file on the same screen then works.* Built: in the same Claude call that reads a file, the reader also says what it is (an FSA-578, a Summary of Coverage, an FSA map, a scale ticket, a settlement, or something else). A file of the wrong kind is refused before anything of it is saved, with one sentence beside the file's chooser: "This looks like an FSA map, not an FSA-578. Choose your FSA-578." The farmer chooses another file there and reads again; a file chosen in the other slot stays chosen, and a right-kind file in the other slot is saved as usual, so it isn't read twice. The refused file isn't remembered, so it can still be added where it belongs. There is no override: if a real document is named wrong, the farmer can only try another photo. How it was chosen and measured is in `docs/decisions/wrong-document.md`.
- [ ] **3. Field details panel on the map.** Clicking a field opens a panel beside the map with its name, FSA farm, tract and field numbers, mapped acres, legal description and where its outline came from. It also shows the field's harvest so far against its expected harvest (planted acres × approved yield; for North 80, 80.20 × 180 = 14,436 bu). In this step the harvest so far is the ticketed part; the "still in bins" part joins in step 8. *Done when clicking North 80 shows FSA 1234 / 5678 / 3, 80.20 acres, and its ticketed bushels against an expected harvest of 14,436 bu.*
- [ ] **4. Ticket log.** One list of every ticket. Each row shows the ticket's basic stats (moisture, test weight, bushels) and the field or bin it came from; a short summary sits above the list, and each row opens in place. *Done when the sample tickets added so far are listed with their summary above them.*
- [ ] **5. Coverage on the map.** The confirmed coverage (units, shares, guarantees) on the clickable farm map. *Done when North 80 shows Unit 1 with a 10,827-bushel guarantee and South 40 shows Unit 2, Dave's two-thirds share and 3,600 bushels.*
- [ ] **6. Loads: database and rules (migration).** A harvest log table (field, start and end, location, trust). A trip links to its harvest log entry, records how it was created ("New load", end-of-day catch-up, or a ticket with no open load), and gets an optional truck and estimate. The migration lets a truck have several loads waiting for tickets, lifting today's limit of one open trip per truck, because a ticket may be photographed after the truck's next load has left. The Part 4 rules become tested pure functions in `lib/rules/`: the open load a ticket fits, the latest load for one of the farmer's own trucks, the bushels check after linking, a ticket with no open load, the same-unit shortcut, the farmer picking a different load or field, and a load open for more than 3 days. This step updates `docs/decisions/loads.md` as the rules are built. *Done when the rules link each of the six sample tickets to the right load in tests.*
- [ ] **7. Start harvesting, New load and finishing a load with its ticket.** "Start harvesting" reads the browser's location once, pre-selects the field it falls in and opens a harvest log entry; picking the field on the map instead is marked lower trust. "New load" records each truck going to a buyer, and the load stays open until its ticket is photographed. Loads into a bin are step 8. Add ticket links the ticket to its open load and finishes it, and `originOfLoad()` goes. *Done when Dave starts North 80 from his browser's location, records a load to the elevator, and `ticket-1.jpg` finishes it.*
- [ ] **8. Bins.** A bin's contents by unit, field and crop year, and its percent full. Loads into a bin: "New load" with a bin as where the truck is going. Choosing the bin checks it first: a different crop is blocked, last year's grain gets a warning, and a different unit stops with three choices. A load to a bin is finished at once at the truck's capacity. Loads out of a bin: click the bin and "New load", and the load waits for its ticket, which traces back through the bin to the fields. The end-of-day catch-up, "How many loads went into Bin 3?" by truck. Field totals: the "still in bins" part joins the ticketed part from step 3, so each field shows its harvest so far, ticketed and still in bins, against its expected harvest. *Done when choosing Bin 3 for a South 40 load shows the three choices, and a ticket for a load out of Bin 3 traces back to North 80.*
- [ ] **9. Ticket review.** The photo beside the read values, with low-confidence values highlighted and the load it finishes pre-selected. The farmer clicks "Looks right" or flags one value, never edits it. The second independent read is built in this step, so a value's confidence comes from the checks and from two reads agreeing. A ticket marked for review by the bushels check shows here. *Done when a printed and a handwritten ticket each finish the right load, and flagging a value creates a misread flag.*
- [ ] **10. Settlement reader.** The settlement is read into its own schema with its checks, and scored against `documents-2026.json` like the other documents. *Done when the sample settlement reads with its five tickets, price and net payment right.*
- [ ] **11. Add a settlement (migration).** The farmer adds a settlement; its tickets are matched by number, then bushels, and a ticket to that buyer on no settlement is flagged. *Done when the sample settlement matches 5 tickets and fires one missing-load flag.*
- [ ] **12. Needs attention with fixes.** One list of every open flag and every load open for more than 3 days, each in one plain sentence with its fixes as buttons. *Done when the acre mismatch (80.20 vs 80.00), the missing load (ticket 5, on no settlement) and a load left open for more than 3 days each show in the list with their fixes, and using a fix closes the item.*
- [ ] **13. Production report and approval (migration).** Unit totals by record type, acres, share, yield, guarantee and shortfall. Approval locks the report and saves a hashed snapshot. *Done when the report shows Unit 1 (80.20 acres, 100% share, 10,827-bushel guarantee) and Unit 2 (40.00 acres, Dave's two-thirds share, 3,600 bushels), each with its production by record type, and Dave's approval locks it and saves the snapshot's hash.*
- [ ] **14. Agent view and the record chain.** A read-only report where clicking a ticket shows its chain (photo, ticket, trip, bin, field, unit). *Done when the agent sees the report Dave approved, clicking a North 80 ticket shows its chain back to North 80 and Unit 1, and clicking the ticket for the load out of Bin 3 shows Bin 3 in its chain.*
- [ ] **15. Look and feel pass.** Every screen checked against `docs/design.md` and `docs/spec.md` Part 11. *Done when every screen in the walkthrough (spec Part 10) uses only the colors and fonts in `docs/design.md`, has one main button, and gives each warning as one plain sentence with its fixes as buttons.*
- [ ] **16. README and decision records.** A README that explains the pipeline and how to run GrainClaim, and a decision record for each main choice still without one. *Done when someone outside the team can run GrainClaim from the README, and every choice in `SETUP.md`'s stack table has its record in `docs/decisions/`.*

## After the hackathon

The next stage:

- **Phone layout:** every screen at phone width, large buttons, usable one-handed in a combine cab
- **Real phone location** for "Start harvesting": this stage reads the desktop browser's location once; location on a phone in the field is the next stage
- **Import field file:** fields from a farmers.gov field file (GeoJSON), as a second way onto the map beside the FSA map photo
- **HEIC uploads** from iPhones, converted to JPEG before reading
- **Offline mode:** records saved in the browser and synced later
- **Outline editing with Terra Draw** and its limits (corners and edges only, at least 90% overlap with the original, original kept for the agent)
- **Real USDA Crop Sequence Boundaries** around any farm for AI-proposed outlines, beyond the file of outlines around the sample farm
- **Full farm setup from an empty database:** farm name, trucks, buyers created from the first ticket that names them
- **PDF and CSV export** of the report, the year-over-year view and prior-history import
- **The claim packet** (spec Phase 8)
- **Realistic data** from `docs/sample-data-sources.md` in place of the placeholders, and a test run by someone outside the team
