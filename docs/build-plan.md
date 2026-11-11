# GrainClaim build plan

_Last updated: November 9, 2026._

**Scope: the hackathon demo first.** This plan builds only what the 3-minute demo in `docs/spec.md` Part 10 shows. The demo is a web app in a desktop browser on a laptop: no phone layout, no phone app, no app for drivers. Everything else waits in "After the hackathon" at the end. Each milestone makes one more beat of the demo work, so the demo always runs as far as the build has got.

| Demo beat | What the audience sees | Milestone |
|---|---|---|
| 1. "Here's Dave's farm." | Outlines proposed from Dave's FSA map photo (backup: field file import); Bin 3 added live; FSA-578 and Summary of Coverage read; acre mismatch flag | 3 |
| 2. "Harvest." | "Start harvesting" in North 80; a ticket photo reads itself and links to North 80; choosing Bin 3 for South 40 fires the mixing warning | 4 |
| 3. "Payday." | The settlement match catches the missing load | 5 |
| 4. "Winter." | Dave taps Bin 3 and "Pickup"; the late ticket matches the waiting pickup by itself | 6 |
| 5. "April." | Dave approves; the agent sees the report and taps a ticket to see its chain back to the field | 7 |

## Status

- [x] Setup: repo, Supabase with PostGIS, `AGENTS.md`, `docs/spec.md`
- [x] Database schema (12 tables)
- [x] Calculations in `lib/rules/` with tests
- [x] Seed: `npm run seed` loads Dave's farm in stages (`farm-base` → `fields` → `season-2026`) and resets it safely
- [x] Sample documents: `npm run print-docs` and the PDFs in `sample-data/print/` (PR #6)
- [ ] Sample photos in `sample-data/photos/`
- [x] App shell and roles: the top bar, icon rail, Farmer / Agent switcher and a placeholder home screen for each role
- [ ] Thin slice: built. Still to do on `main`: push its migration, then upload `ticket-1.jpg` and see the Unit 1 total move
- [ ] Everything below

## Who owns what

| Person | Owns |
|---|---|
| **A** | Database and migrations, seed and demo data, matching rules, season setup, report numbers |
| **B** | Reading documents (tickets, FSA-578, Summary of Coverage, settlements, FSA maps), ticket review screen, Needs attention |
| **C** | App shell and roles, farm map and bins, harvest log, agent view, deployment |

## Rules

- **Demo first.** Build only what the demo shows. If a task starts pulling in something from "After the hackathon", stop and leave it for later.
- **One task, one branch, one pull request.** Have Claude Code plan before it codes. Tests, lint and build pass, and a teammate reviews before merging.
- **One migration at a time.** Only one open pull request may contain a migration. Whoever merges it runs `npx supabase db push --remote` and tells the team.
- **Rules before screens.** Matching and flag rules go in `lib/rules/` as pure functions with tests, then get wired into screens.
- **Use the spec's numbers.** Sample data matches Part 9 exactly (80.20 vs 80.00 acres, 5 of 6 tickets on the settlement), so the demo shows the spec's numbers.
- **Every screen follows `docs/spec.md` Part 11** (UI principles) and the farmer rules in `AGENTS.md`: ask for the minimum, capture the rest automatically, show details on request. Design for a laptop browser.
- **Seeding resets the shared database for everyone.** Tell the team before running it.

## Milestones

### 1. Foundations

- **Seed and reset (A).** Done.
- **Sample documents (B).** Done (PR #6). Print and photograph the tickets and the FSA-578 into `sample-data/photos/`, named after each document (`ticket-3.jpg`); the Summary of Coverage and settlement are uploaded as the PDFs themselves.
- **Ticket reading (B).** Done. `npm run read-ticket -- <photo>` reads one ticket photo with Claude structured outputs into a schema with every ticket field (including the time in) and runs the arithmetic checks. `npm run score-tickets` reads every sample photo with Claude Sonnet 5.5 and Claude Haiku 5.5 and scores each value against the answer key in `documents-2026.json`. The scores are in `docs/decisions/document-reading-model.md`.
- **App shell and roles (C).** Done. The welcome page is replaced with a role switcher (Farmer, Agent) and a home screen for each, laid out for a laptop browser, with the colors and fonts from `docs/design.md`. The role is kept in a cookie; server code reads it with `getCurrentRole()` in `lib/role/` and saves it in each record's "who" fields, since the audit log can't see who acted without logins. The home screens are placeholders: the buttons are off, the totals are dashes and the farm name in the top bar is fixed text, until their screens and `lib/db/` are built.
- **Decision records (anyone).** A short page each for the main choices (document reading model, database, map) in `docs/decisions/`, so the team can answer "why this?" from the judges.

### 2. Thin slice: one load, start to finish

Upload a ticket photo: it's hashed and stored, GPS and time are read, the ticket is read and checked, linked to North 80 through a hard-coded harvest log entry, its bushels calculated, and the row saved. Its migration also adds a ticket time column (time in, as printed), covered by the read-value lock. *Done when a sample photo adds a row to the Unit 1 total.* This proves the riskiest part early.

Built, and waiting for its check on `main` (see Status). What it leaves for later milestones:

- **Milestone 4 replaces `originOfLoad()`** in `lib/rules/load-origin.ts`, which returns North 80 for every ticket. Nothing else should need to change to link tickets by the harvest log.
- **Milestone 4's migration makes a trip's truck and estimate optional.** Until then a ticket whose truck number or buyer isn't on the farm's records is not saved, and the screen says why.
- **The result screen is read-only.** "Looks right" and flagging a value come with ticket review. A failed check is saved, counted and shown in yellow; no flag row is created yet.
- **A second photo of the same ticket** (same buyer, number and date) is kept with `duplicate_of` set and no trip, so it isn't counted. No flag row is created for it yet either.
- **The farm's time zone is one constant** (`lib/tickets/farm-time-zone.ts`, Central time), used to turn a ticket's printed time into the trip's time.
- **Not built:** the second independent read, and the guarantee beside each unit's total (season setup, Milestone 3).

### 3. Beat 1: "Here's Dave's farm"

- **Farm map (C).** Satellite map with each field as a translucent, clickable outline; clicking one shows its FSA numbers, acres and legal description. A farmers.gov file import is the backup way in.
- **AI-proposed outlines (B and C, migration with A).** This opens the demo. Dave uploads a photo of his FSA map and clicks roughly where the farm is; Claude reads the map's field numbers and acres and pairs them with nearby outlines, and Dave confirms them. For the demo, the nearby outlines come from a sample file holding North 80's and South 40's exact outlines plus a few neighbors, so they measure 80.20 and 40.00 and only the planned mismatch flag fires. Needs a sample FSA map added to the sample documents, printed and photographed like the tickets (`fsa-map.jpg`), and a new field `source` value. *Done when the sample FSA map photo produces North 80 and South 40 outlines that Dave can confirm.*
- **Add a bin (C, seed change with A).** Click a spot on the map, enter diameter and eave height on the same screen (both required, no default); capacity is calculated. The seed still loads the farm name, trucks and elevator, but loads Bin 3 in its own stage after `farm-base`, so beat 1 adds it live. *Done when adding Bin 3 (36 ft, 24 ft) takes about 10 seconds.* Done: "Add a bin" on the home screen's map, then a click on the spot and the two sizes in the panel beside it. The name is offered as the next number and can be typed over. The seed's `bin-3` stage comes right after `farm-base`.
- **Reading the FSA map (B).** Done. `npm run read-document -- <file>` reads an FSA map, from a photo or a PDF, into the farm, its tracts and each field's number, acres, erodibility and land use, and checks that each tract's cropland fields add up to its cropland total and that no field number repeats in a tract. It returns no coordinates: pairing the read fields with nearby outlines is the next step, above. `npm run score-documents` reads the sample map photo too.
- **Reading the FSA-578 and Summary of Coverage (B).** Done. `npm run read-document -- <file>` reads either one, from a photo or a PDF, into a schema with every value in the answer key and runs its checks (shares, acres and dates on the FSA-578; guarantees, liability and totals on the Summary of Coverage). `npm run score-documents` reads the sample FSA-578 photo and Summary of Coverage PDF with Claude Sonnet 5.5 and Claude Haiku 5.5 and scores each value against `documents-2026.json`. The scores are in `docs/decisions/document-reading-model.md`. Comparing the two documents with each other (the acre mismatch) is season setup, below.
- **Season setup (A).** The two documents create the policy, units and field seasons, matched to fields by FSA number. Guarantees are calculated, and acre or share mismatches are flagged. *Done when the sample documents create Units 1 and 2 with guarantees of 10,827 and 3,600 bushels and one acre-mismatch flag.*

### 4. Beat 2: "Harvest"

- **Harvest log and trips (A, migration).** A harvest log table (field, start and end, destinations, location, trust). Trips get an optional truck and estimate, a way to record how each was created (bin load, ticket, pickup), and trust levels for location-confirmed and field-printed-on-ticket.
- **Matching rules (A).** The Part 4 rules as tested pure functions: a ticket to its field by printed time against the harvest log (a field printed on the ticket wins), asking only near a field switch; a late ticket to a waiting pickup; the same-unit shortcut; the farmer overriding the suggested field (both kept, lower trust, flagged when the unit changes); ticket-to-settlement matching.
- **Start harvesting (C).** A "Simulate location" switch places Dave in a field (the demo runs on a laptop); "Start harvesting" pre-selects that field and pre-fills last time's destinations, and he confirms or picks another field. At the end of the day, "How many loads went into Bin 3?" by truck creates one trip per load. The sample harvest log covers every sample ticket's printed time (Oct 12, 10:42 AM to Oct 13, 2:05 PM), with South 40 after.
- **Bins and the mixing warning (C).** Bin contents tracked by unit and crop year. Choosing a bin with a different crop is blocked, carryover gets a warning, and a different unit stops with three choices. *Done when choosing Bin 3 for South 40 shows the choices.*
- **Ticket review (B).** The photo next to the read values, with low-confidence values highlighted, and the field it came from pre-selected. The farmer clicks "Looks right" or flags one value, never edits it. *Done when a printed and a handwritten ticket each link to the right field and unit.*

### 5. Beat 3: "Payday"

- **Settlement reading (B)** and **settlement matching (A).** *Done when the sample settlement matches 5 tickets and fires one missing-load flag.*
- **Needs attention (B).** One list of every open flag, in plain words, with its fix as buttons.

### 6. Beat 4: "Winter" (first to cut)

- **Pickup from a bin (C):** the farmer clicks Bin 3 and "Pickup" when elevator truck #22 loads; a trip code.
- **Late ticket matching (A):** an emailed ticket three days later matches the waiting pickup by itself.

### 7. Beat 5: "April"

- **Production report (A, migration).** Unit totals by record type, acres, share, yield, guarantee and shortfall. Approval locks the report and saves a hashed snapshot.
- **Agent view (C).** A read-only report where clicking a ticket shows its chain (photo, ticket, trip, bin, field, unit).

### 8. Demo-ready

- **Demo checkpoints:** one command resets the data to the start of any beat.
- **Cached reads:** a fallback if live document reading is slow on the day, labeled when used.
- **Pre-load the routine work;** do one of each action live.
- **Rehearse** at least three times, under 3 minutes, with a backup recording of a clean run.
- **Say what's simulated:** location and the sample documents.
- **A README** that explains the pipeline and how to run the demo. A deployed web link if there's time.
- **The day before:** open the Supabase dashboard (free projects pause after a week) and check the Anthropic key's expiry.

## If time runs short

Cut beat 4 first, then AI-proposed outlines (beat 1 falls back to the farmers.gov import).

Never cut: the chain view, the mismatch, mixing and missing-load flags, and the approval.

## After the hackathon

Product work the demo doesn't need:

- **Phone layout:** every screen at phone width, large buttons, usable one-handed in a combine cab
- **Real phone location** for "Start harvesting", instead of the simulation
- **HEIC uploads** from iPhones, converted to JPEG before reading
- **Offline mode:** records saved in the browser and synced later
- **Outline editing with Terra Draw** and its limits (corners and edges only, at least 90% overlap with the original, original kept for the agent)
- **Real USDA Crop Sequence Boundaries** for AI-proposed outlines, instead of the sample file
- **Full farm setup from an empty database:** farm name, trucks, buyers created from the first ticket that names them
- **PDF and CSV export** of the report, the year-over-year view and prior-history import
- **The claim packet** (spec Phase 8)
- **Realistic data** from `docs/sample-data-sources.md` in place of the placeholders, and a test run by someone outside the team
