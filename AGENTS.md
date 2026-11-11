<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## GrainClaim project rules

GrainClaim is one record pipeline for a farmer: farm map → season setup → harvest log, loads and bins → scale tickets → settlements → crop insurance production report. It is a product built in stages. This stage is a web app in a desktop browser; "After the hackathon" in `docs/build-plan.md` is the next, so leave anything listed there for later. Build the steps in `docs/build-plan.md` in order. Before starting any feature, read `docs/spec.md`. It defines the data model (Part 2), calculations (Part 3), matching rules (Part 4), flags (Part 5), sample data (Part 9), the walkthrough (Part 10) and UI principles (Part 11). `docs/build-plan.md` lists what's built and the build order. `SETUP.md` covers setup, environment variables and team workflow.

### Stack

- Next.js (App Router) + TypeScript + Tailwind + shadcn/ui
- Supabase Postgres with PostGIS. PostGIS lives in the `extensions` schema, so map types are written `extensions.geometry`.
- Supabase Storage for photos and documents, in the private `photos` bucket, each file named by its SHA-256 hash and real extension (`tickets/<hash>.jpg`, `documents/<hash>.pdf`)
- Claude API (`@anthropic-ai/sdk`) with structured outputs for reading tickets and forms; one zod schema per document type
- MapLibre GL + Turf.js for the map; Terra Draw for adjusting proposed field outlines and drawing missing ones; exifr for GPS and time from photos
- Vitest for tests

### Folder layout

- `app/`: screens. `app/api/`: server routes.
- `components/shell/`: the frame around every screen (top bar, icon rail, role switcher). `components/home/`: the farmer's and agent's home screens. `components/tickets/`: the Add ticket screen. `components/map/`: the farm map on the farmer's home screen, and what he adds on it: fields from a photo of his FSA map, and a bin. `components/season/`: the season setup screen. `components/ui/`: shadcn/ui components.
- `lib/role/`: the two roles. `getCurrentRole()` in `current-role.ts` reads the current role on the server.
- `lib/rules/`: calculations, matching rules and flags. Pure functions only: plain data in, results out, no database or framework calls. Every function has Vitest tests next to it.
- `lib/extract/`: document reading, one schema per document type. `read.ts` holds the one Claude API call that every reader uses. In that call each reader also says what kind of document the file is, and a file that isn't the kind the reader expects comes back refused with the kind it is. A new reader says which kind it expects; add nothing about the kind to a reader's own prompt.
- `lib/db/`: database queries. `client.ts` holds the one server-only Supabase client.
- `lib/photos/`: a photo file's type, SHA-256 hash, and EXIF time and GPS
- `lib/tickets/`: adding a ticket, start to finish (`add-ticket.ts`). The reader and the database are passed in, so its tests never call Claude or Supabase.
- `lib/season/`: setting up a season from the FSA-578 and Summary of Coverage, start to finish (`setup-season.ts`), built the same way: read and save the documents, then write the season when the farmer confirms. What the season should be, and its flags, is worked out in `lib/rules/season-setup.ts`.
- `lib/bins/`: adding a bin, start to finish (`add-bin.ts`), built the same way. The database calculates a bin's capacity; `lib/rules/bin-capacity.ts` has the same formula for showing it before the bin is saved.
- `lib/fields/`: adding fields from a photo of the FSA map, start to finish (`add-fields.ts`), built the same way: read and save the photo and pair its fields with outlines near the farmer's click, then write the fields when he confirms. Which outline pairs with which field (`outline-pairing.ts`), what a new field is called (`field-names.ts`) and what is proposed (`field-proposal.ts`) are worked out in `lib/rules/`. `nearby-outlines.ts` loads the public outlines; at this stage that is `sample-data/nearby-outlines.geojson`.
- `lib/map/`: small map geometry for screens (where a field's label goes, the area some points cover)
- `lib/format.ts`: how numbers, dates and times are shown. Calculations never round; screens do.
- `lib/submit-form.ts`: how a form with a file chooser is sent to a server action (`sendKeepingForm`, from `onSubmit`). React empties a form sent through its `action` prop, so a failed read would lose the chosen files.
- `supabase/migrations/`: database structure changes
- `sample-data/`: Dave's sample farm and documents. Everything in it is made up and marked SAMPLE. See `sample-data/README.md`.
  - `documents-2026.json`: every value on every sample document, and the answer key for reading tests. To change a document, edit this file, run `npm run print-docs`, then reprint and re-photograph it.
  - `print/`: PDFs made by `npm run print-docs`. Never edit them by hand.
  - `photos/`: phone photos of the printed documents, named after them (`ticket-3.jpg`). Inputs for reading tests.
  - `reference/`: real blank forms, for layout only. Never copy a real company's name or design. Also the public data the map files are made from: the USDA Crop Sequence Boundaries clip and the NAIP aerial photo.
  - `farm.geojson`'s outlines are cut from real fields in that clip (`npm run place-fields`). `nearby-outlines.geojson` holds those two outlines and six real neighbors, for pairing with a photo of the FSA map (`npm run build-outlines`). Never edit either by hand.
- `scripts/print/`: `npm run print-docs`, which turns `documents-2026.json` into the PDFs. The FSA map is drawn from `farm.geojson` onto the NAIP aerial photo.
- `scripts/outlines/`: the sample map files. `npm run place-fields` cuts Dave's fields from real outlines, `npm run build-outlines` picks the neighbors and makes the preview page, and `npm run fetch-naip` downloads the aerial photo. `acres.ts` measures acres the way the database does; use it, not Turf's `area`, wherever acres must match `mapped_acres`. No database, no Claude.
- `scripts/read-tickets/`: `npm run read-ticket -- <photo>`, which reads one ticket photo and prints its values and checks, and `npm run score-tickets`, which reads every sample ticket photo and scores each model against `documents-2026.json`. Both call the Claude API (server-side, uses `ANTHROPIC_API_KEY`) and cost money.
- `scripts/read-documents/`: `npm run read-document -- <file>`, which reads one FSA map, FSA-578 or Summary of Coverage (a photo or a PDF) and prints its values and checks, and `npm run score-documents`, which reads the sample FSA map and FSA-578 photos and the Summary of Coverage PDF and scores each model against `documents-2026.json`. The FSA map reader returns what is printed on the map and no coordinates. Both call the Claude API and cost money.
- `scripts/seed/`: `npm run seed`, which resets and loads the sample farm in stages (server-side, uses `SUPABASE_SECRET_KEY`). New stages go at the end of `STAGES` in `stages.ts`.
- `docs/decisions/`: one-page decision record per design choice (what we picked, the main alternative, why). `loads.md` is how a load is recorded and finished; `wrong-document.md` is how a reader notices the wrong kind of document.

### Rules

- Work on a branch. Never commit directly to `main`.
- Every feature works for real: location comes from the browser and documents are read live, with no simulated or cached stand-ins.
- When a task makes a real design choice, add or update a one-page record in `docs/decisions/` (what we picked, the main alternative, and why).
- Never edit a migration that has already been pushed. Make structure changes in a new file with `npx supabase migration new <name>`. Don't run `npx supabase db push` yourself; say in the pull request that it must be run after merging.
- The database enforces these rules. Design code to fit them; never work around them:
  - Ticket photos and read values lock once saved. A wrong value gets a `flag` row with `flag_type = 'misread'`, never an edit. The same goes for a row in `document`, which holds every other kind of document the farmer adds (FSA-578, Summary of Coverage, FSA map): its file and read values lock once saved.
  - One policy per insured, crop, state, county and crop year. A season is set up once; the app refuses a second.
  - A field with `source = 'ai_proposed'` links to the FSA map it came from (`fsa_map_document_id`). A proposal is never a `field` row: fields are written only when the farmer confirms, because the ticket pipeline reads every field row.
  - A field season is insured and has a unit, or is not insured and has none. A field on the FSA-578 that no unit covers is kept that way: guarantees and unit totals skip it.
  - A truck has only one open trip at a time.
  - A photo's SHA-256 hash must be unique.
  - `audit_event` is append-only and filled automatically by triggers.
- Row Level Security is on for every table and there are no access policies yet. Read and write the database from server code only, using `SUPABASE_SECRET_KEY`.
- Keep `SUPABASE_SECRET_KEY` and `ANTHROPIC_API_KEY` in server code only. Never give them a `NEXT_PUBLIC_` prefix or import them into client components.
- Never print, copy or commit the contents of `.env.local`. Variable names are listed in `SETUP.md`.
- A file of the wrong kind is never saved. Saved documents lock and a file's hash must be unique, so a wrong save can't be taken back. Every pipeline refuses a wrong-kind file by name (`wrongKindMessage()` in `lib/rules/document-kind.ts`) before the file or a row is written, so it can still be added later where it belongs.
- Store raw values from documents (gross, tare, moisture) and calculate elevator and insurance bushels separately; they differ.
- A read value's confidence comes from checks we can explain (gross − tare = net; net ÷ standard weight = bushels; date inside harvest) and a second independent read, not from the model rating itself.
- This stage has no logins. A Farmer / Agent switcher changes the view. The current role is saved in each record's "who" field (`uploaded_by`, `created_by`, `resolved_by`), because the audit log can't tell who acted. Get the role with `getCurrentRole()` from `lib/role/current-role.ts` when saving; never take it from a request body or form field. It reads a cookie, so a component that awaits it must sit inside a `<Suspense>` boundary.
- Colors and fonts come from `docs/design.md` and are set up as theme tokens in `app/globals.css`. Use the class names (`bg-page`, `text-ink`, `border-line`, `bg-green-700`, `font-heading`); never write a hex value in a screen.
- A unit's total is added up by following ticket → trip → field → field season → unit (`lib/rules/unit-totals.ts`). Never keep a separate counter. A ticket with no trip counts nowhere.
- "Which field or bin did this load come from?" is answered in one place, `originOfLoad()` in `lib/rules/load-origin.ts`. It returns North 80, and is replaced by the load rules in steps 6 and 7 of `docs/build-plan.md`.
- Before opening a pull request, `npx vitest run`, `npm run lint` and `npm run build` must pass.

### How the farmer's records work

These apply to every screen. Details are in `docs/spec.md` Parts 1, 4 and 11.

- **Two roles: Farmer and Agent.** The farmer records everything from his own phone; the agent sees the finished report. Truck drivers and elevator staff never use GrainClaim, so never build a driver screen or ask a driver for input.
- **Minimum input, answers on demand.** Never ask for anything GrainClaim can get itself: time and GPS from photos, the field from where the farmer is, crop and unit from the field's season, values from documents, the truck from the ticket, bushels from `lib/rules/`.
- **Fields are clickable outlines.** Translucent outlines over satellite imagery, from the farmers.gov field file or proposed by AI from a photo of the farmer's FSA map paired with public field outlines. The farmer adjusts or draws one with Terra Draw only when it's wrong or missing, and nothing is used until he confirms it. At this stage he only confirms; editing outlines with Terra Draw is in the next stage. He can reshape an outline (corners and edges) but never move a whole field; an edit that leaves less than 90% overlap with the original is saved as a new field and flagged. Keep the original outline. Outline edits never change insured acres.
- **Harvest log, not driver taps.** "Start harvesting" reads the browser's location once on the click (a web app can't track location in the background), pre-selects the field it falls in and opens a harvest log entry for it; the farmer confirms. Picking the field on the map instead is marked lower trust.
- **Every load is recorded when the truck is loaded.** The farmer clicks "New load": the load is linked to the open harvest log entry and records the truck and where it's going, pre-filled with that truck's last destination. A load to a buyer stays open until its ticket is photographed, which is the only way to finish it. A load to a bin is finished at once, with the truck's capacity as its estimate. A load is stored as a trip.
- **Bins record where their grain came from.** A bin keeps which field and harvest log entry each load came from, so every load into it has a crop, field, unit, date, truck, estimated bushels and bin, which are the fields an adjuster's load record needs. At the end of a harvest day, "How many loads went into Bin 3?" by truck is the catch-up for loads not recorded as they went in. The mixing warnings fire when the farmer chooses a bin, before any grain goes in. A landlord's and tenant's shares of the same unit aren't mixing.
- **A ticket finishes its load.** A ticket first looks for the open load it fits: same buyer, the truck number when printed, weighed after the load started and by the end of the next day. A trip code written on the ticket wins. One fitting load links by itself and the farmer confirms; when several fit, ask, with the best fit pre-selected. A ticket with no open load is linked to a field printed on it, then to the field being harvested at its printed time, then by asking; it creates and finishes a trip in one step and is marked lower trust. A load still open after more than 3 days goes to Needs attention. A ticket photo's own GPS and time prove when it was photographed, not where the grain came from.
- **The farmer has the final say on where grain came from.** Save his choice, keep the app's suggestion beside it, mark disagreements lower trust, and flag a choice that moves grain to a different unit.
- **Selling from a bin:** the farmer clicks the bin and "New load"; the load waits for its ticket, which traces back through the bin to the fields its grain came from.
- **Confirm, don't type.** Read values appear beside the photo; the farmer clicks "Looks right" or flags one value, never edits it.
- **Every warning says what's wrong in one plain sentence** and offers its fixes as buttons.
- **Everything the seed loads** (farm name, fields, bins, trucks, buyers) must eventually be possible for the farmer to enter through the app. So far, adding a bin and adding fields from a photo of the FSA map are built; the seed loads the rest.
- **Desktop browser at this stage:** design screens for a laptop browser with clear, large controls. The phone layout is the next stage; don't spend time on it now.