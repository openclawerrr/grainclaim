# GrainClaim build plan

_Last updated: November 8, 2026._

The plan works backward from the 3-minute demo in `docs/spec.md` Part 10. Each milestone makes one more beat of the demo work, so the demo always runs as far as the build has got. The demo is a web app only; there's no phone app and no app for drivers.

| Demo beat | What the audience sees | Milestone |
|---|---|---|
| 1. "Here's Dave's farm." | Field file imported (or outlines proposed from his FSA map photo); FSA-578 and Summary of Coverage read; acre mismatch flag | 3 |
| 2. "Harvest." | "Start harvesting" in North 80; a ticket photo reads itself and links to North 80; choosing Bin 3 for South 40 fires the mixing warning | 4 |
| 3. "Payday." | The settlement match catches the missing load | 5 |
| 4. "Winter." | Dave taps Bin 3 and "Pickup"; the late ticket matches the waiting pickup by itself | 6 |
| 5. "April." | Dave approves; the agent sees the report and taps a ticket to see its chain back to the field | 7 |

## Status

- [x] Setup: repo, Supabase with PostGIS, `AGENTS.md`, `docs/spec.md`
- [x] Database schema (12 tables)
- [x] Calculations in `lib/rules/` with tests
- [x] Seed: `npm run seed` loads Dave's farm in stages (`farm-base` → `fields` → `season-2026`) and resets it safely
- [ ] Everything below

## Who owns what

| Person | Owns |
|---|---|
| **A** | Database and migrations, seed and demo data, matching rules, season setup, report numbers |
| **B** | Reading documents (tickets, FSA-578, Summary of Coverage, settlements, FSA maps), ticket review screen, Needs attention |
| **C** | App shell and roles, farm map and farm setup, harvest log and bins, agent view and PDF, deployment |

## Rules

- **One task, one branch, one pull request.** Have Claude Code plan before it codes. Tests, lint and build pass, and a teammate reviews before merging.
- **One migration at a time.** Only one open pull request may contain a migration. Whoever merges it runs `npx supabase db push --remote` and tells the team.
- **Rules before screens.** Matching and flag rules go in `lib/rules/` as pure functions with tests, then get wired into screens.
- **Use the spec's numbers.** Sample data matches Part 9 exactly (80.20 vs 80.00 acres, 5 of 6 tickets on the settlement), so the demo shows the spec's numbers.
- **Every screen follows `docs/spec.md` Part 11** (UI principles) and the farmer rules in `AGENTS.md`: ask for the minimum, capture the rest automatically, show details on request.
- **Seeding resets the shared database for everyone.** Tell the team before running it.

## Milestones

### 1. Foundations

- **Seed and reset (A).** Done.
- **Sample documents (B).** SAMPLE documents in `sample-data/print/`, made from `sample-data/documents-2026.json` by `npm run print-docs`: 6 scale tickets from Main Street Elevator (one filled in by hand), an FSA-578 showing 80.20 acres for North 80, a Summary of Coverage showing 80.00, and a settlement listing 5 of the 6 tickets. Layouts follow the real forms in `sample-data/reference/`. Print and photograph the tickets and the FSA-578 into `sample-data/photos/`, named after each document (`ticket-3.jpg`); the Summary of Coverage and settlement are uploaded as the PDFs themselves.
- **Ticket reading (B).** Read a ticket photo with Claude structured outputs into a schema with every ticket field, run the arithmetic checks, and score accuracy per field against the answer key in `documents-2026.json`. Compare Claude Sonnet 5.5 and Claude Haiku 5.5 and record the choice as a decision record. *Done when one command scores all sample photos.*
- **App shell and roles (C).** Replace the welcome page with a role switcher (Farmer, Agent) and a home screen for each, working at phone width. The current role is passed to the server and saved in each record's "who" fields, since the audit log can't see who acted without logins.
- **Decision records (anyone).** One page per stack choice in `docs/decisions/`.

### 2. Thin slice: one load, start to finish

Upload a ticket photo: it's hashed and stored, GPS and time are read, the ticket is read and checked, linked to North 80 through a hard-coded harvest log entry, its bushels calculated, and the row saved. Uploads accept iPhone HEIC photos and convert them to JPEG before reading, since the Claude API doesn't accept HEIC. Its migration also adds a ticket time column (time in, as printed), covered by the read-value lock. *Done when a sample photo adds a row to the Unit 1 total.* This proves the riskiest part early.

### 3. Beat 1: "Here's Dave's farm"

- **Farm map (C).** Satellite map with each field as a translucent, clickable outline; tapping one shows its FSA numbers, acres and legal description. Fields come from importing the farmers.gov file. The farmer can reshape an outline or draw a missing one with Terra Draw: corners and edges only, never moving a whole field, keeping at least 90% overlap with the original (kept for the agent). Acres are recalculated from the confirmed outline.
- **AI-proposed outlines (B and C, migration with A).** The farmer uploads a photo of his FSA map and taps roughly where the farm is. The app loads public field outlines nearby (USDA Crop Sequence Boundaries), Claude reads the map's field numbers and acres and pairs them with those outlines, and the farmer adjusts and confirms. Needs a sample FSA map in `sample-data/` and a new field `source` value. *Done when the sample FSA map photo produces North 80 and South 40 outlines that Dave can confirm.*
- **Farm setup by the farmer (C).** A farm name on first run; bins added by tapping the map and entering their size; trucks added with a name and capacity; buyers created automatically from the first ticket that names them. *Done when Dave's farm can be set up through the app alone, starting from an empty database.*
- **Reading the FSA-578 and Summary of Coverage (B).** Same approach as the ticket reader, with answer keys and scores.
- **Season setup (A).** The two documents create the policy, units and field seasons, matched to fields by FSA number. Guarantees are calculated, and acre or share mismatches are flagged. *Done when the sample documents create Units 1 and 2 with guarantees of 10,827 and 3,600 bushels and one acre-mismatch flag.*

### 4. Beat 2: "Harvest"

- **Harvest log and trips (A, migration).** A harvest log table (field, start and end, destinations, location, trust). Trips get an optional truck and estimate, a way to record how each was created (bin load, ticket, pickup), and trust levels for location-confirmed and field-printed-on-ticket.
- **Matching rules (A).** The Part 4 rules as tested pure functions: a ticket to its field by printed time against the harvest log (a field printed on the ticket wins), asking only near a field switch; a late ticket to a waiting pickup; the same-unit shortcut; the farmer overriding the suggested field (both kept, lower trust, flagged when the unit changes); ticket-to-settlement matching.
- **Start harvesting (C).** One tap reads the location, pre-selects the field it falls in and pre-fills last time's destinations; picking the field on the map is the fallback, marked lower trust. At the end of the day, "How many loads went into Bin 3?" by truck creates one trip per load. A "Simulate location" switch drives it in the demo. The sample harvest log covers every sample ticket's printed time (Oct 12, 10:42 AM to Oct 13, 2:05 PM), with South 40 after.
- **Bins and the mixing warning (C).** Bin contents tracked by unit and crop year. Choosing a bin with a different crop is blocked, carryover gets a warning, and a different unit stops with three choices. *Done when choosing Bin 3 for South 40 shows the choices.*
- **Ticket review (B).** The photo next to the read values, with low-confidence values highlighted, and the field it came from pre-selected. The farmer taps "Looks right" or flags one value, never edits it. *Done when a printed and a handwritten ticket each link to the right field and unit.*

### 5. Beat 3: "Payday"

- **Settlement reading (B)** and **settlement matching (A).** *Done when the sample settlement matches 5 tickets and fires one missing-load flag.*
- **Needs attention (B).** One list of every open flag, in plain words, with its fix as buttons.

### 6. Beat 4: "Winter" (first to cut)

- **Pickup from a bin (C):** the farmer taps Bin 3 and "Pickup" when elevator truck #22 loads; an optional truck photo; a trip code.
- **Late ticket matching (A):** an emailed ticket three days later matches the waiting pickup by itself.

### 7. Beat 5: "April"

- **Production report (A, migration).** Unit totals by record type, acres, share, yield, guarantee and shortfall. Approval locks the report and saves a hashed snapshot.
- **Agent view (C).** A read-only report where tapping a ticket shows its chain (photo, ticket, trip, bin, field, unit), plus PDF and CSV export.

### 8. Demo-ready

- **Swap placeholders for realistic data** from `docs/sample-data-sources.md`, keeping the spec's numbers, then rerun the tests and reading scores.
- **Demo checkpoints:** one command resets the data to the start of any beat.
- **Cached reads:** a fallback if live ticket reading is slow on the day, labeled when used.
- **Pre-load the routine work;** do one of each action live.
- **Rehearse** at least three times, under 3 minutes, with a backup recording of a clean run.
- **Say what's simulated:** location (the demo runs on a laptop) and the sample documents.
- **Phase 9:** a README that explains the pipeline and how to run the demo, decision records, a deployed web link, and a test run by someone outside the team.
- **The day before:** open the Supabase dashboard (free projects pause after a week) and check the Anthropic key's expiry.

## If time runs short

Cut in this order: the Phase 8 claim packet (not in the demo script), beat 4, AI-proposed outlines (the farmers.gov import stays), PDF and CSV export, then the year-over-year view and offline mode.

Never cut: the chain view, the mismatch, mixing and missing-load flags, and the approval.
