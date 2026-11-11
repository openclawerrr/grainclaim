<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## GrainClaim project rules

GrainClaim is a demo of one record pipeline for a farmer: farm map → season setup → harvest log, bins and trips → scale tickets → settlements → crop insurance production report. The demo is a web app in a desktop browser, built for a hackathon: build only what the demo needs, and leave anything listed under "After the hackathon" in `docs/build-plan.md` for later. Before starting any feature, read `docs/spec.md`. It defines the data model (Part 2), calculations (Part 3), matching rules (Part 4), flags (Part 5), sample data (Part 9), the demo script (Part 10) and UI principles (Part 11). `docs/build-plan.md` lists the milestones. `SETUP.md` covers setup, environment variables and team workflow.

### Stack

- Next.js (App Router) + TypeScript + Tailwind + shadcn/ui
- Supabase Postgres with PostGIS. PostGIS lives in the `extensions` schema, so map types are written `extensions.geometry`.
- Supabase Storage for photos, in the private `photos` bucket, each file named by its SHA-256 hash and real extension (`tickets/<hash>.jpg`)
- Claude API (`@anthropic-ai/sdk`) with structured outputs for reading tickets and forms; one zod schema per document type
- MapLibre GL + Turf.js for the map; Terra Draw for adjusting proposed field outlines and drawing missing ones; exifr for GPS and time from photos
- Vitest for tests

### Folder layout

- `app/`: screens. `app/api/`: server routes.
- `components/shell/`: the frame around every screen (top bar, icon rail, role switcher). `components/home/`: the farmer's and agent's home screens. `components/tickets/`: the Add ticket screen. `components/ui/`: shadcn/ui components.
- `lib/role/`: the two roles. `getCurrentRole()` in `current-role.ts` reads the current role on the server.
- `lib/rules/`: calculations, matching rules and flags. Pure functions only: plain data in, results out, no database or framework calls. Every function has Vitest tests next to it.
- `lib/extract/`: document reading, one schema per document type. `read.ts` holds the one Claude API call that every reader uses.
- `lib/db/`: database queries. `client.ts` holds the one server-only Supabase client.
- `lib/photos/`: a photo file's type, SHA-256 hash, and EXIF time and GPS
- `lib/tickets/`: adding a ticket, start to finish (`add-ticket.ts`). The reader and the database are passed in, so its tests never call Claude or Supabase.
- `lib/format.ts`: how numbers, dates and times are shown. Calculations never round; screens do.
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
- `scripts/seed/`: `npm run seed`, which resets and loads the sample farm in stages (server-side, uses `SUPABASE_SECRET_KEY`). New demo stages go at the end of `STAGES` in `stages.ts`.
- `docs/decisions/`: one-page decision record per stack choice (what we picked, the main alternative, why)

### Rules

- Work on a branch. Never commit directly to `main`.
- Never edit a migration that has already been pushed. Make structure changes in a new file with `npx supabase migration new <name>`. Don't run `npx supabase db push` yourself; say in the pull request that it must be run after merging.
- The database enforces these rules. Design code to fit them; never work around them:
  - Ticket photos and read values lock once saved. A wrong value gets a `flag` row with `flag_type = 'misread'`, never an edit.
  - A truck has only one open trip at a time.
  - A photo's SHA-256 hash must be unique.
  - `audit_event` is append-only and filled automatically by triggers.
- Row Level Security is on for every table and there are no access policies yet. Read and write the database from server code only, using `SUPABASE_SECRET_KEY`.
- Keep `SUPABASE_SECRET_KEY` and `ANTHROPIC_API_KEY` in server code only. Never give them a `NEXT_PUBLIC_` prefix or import them into client components.
- Never print, copy or commit the contents of `.env.local`. Variable names are listed in `SETUP.md`.
- Store raw values from documents (gross, tare, moisture) and calculate elevator and insurance bushels separately; they differ.
- A read value's confidence comes from checks we can explain (gross − tare = net; net ÷ standard weight = bushels; date inside harvest) and a second independent read, not from the model rating itself.
- The demo has no logins. A Farmer / Agent switcher changes the view. The current role is saved in each record's "who" field (`uploaded_by`, `created_by`, `resolved_by`), because the audit log can't tell who acted. Get the role with `getCurrentRole()` from `lib/role/current-role.ts` when saving; never take it from a request body or form field. It reads a cookie, so a component that awaits it must sit inside a `<Suspense>` boundary.
- Colors and fonts come from `docs/design.md` and are set up as theme tokens in `app/globals.css`. Use the class names (`bg-page`, `text-ink`, `border-line`, `bg-green-700`, `font-heading`); never write a hex value in a screen.
- A unit's total is added up by following ticket → trip → field → field season → unit (`lib/rules/unit-totals.ts`). Never keep a separate counter. A ticket with no trip counts nowhere.
- "Which field or bin did this load come from?" is answered in one place, `originOfLoad()` in `lib/rules/load-origin.ts`. Until Milestone 4 it returns North 80.
- Before opening a pull request, `npx vitest run`, `npm run lint` and `npm run build` must pass.

### How the farmer's records work

These apply to every screen. Details are in `docs/spec.md` Parts 1, 4 and 11.

- **Two roles: Farmer and Agent.** The farmer records everything from his own phone; the agent sees the finished report. Truck drivers and elevator staff never use GrainClaim, so never build a driver screen or ask a driver for input.
- **Minimum input, answers on demand.** Never ask for anything GrainClaim can get itself: time and GPS from photos, the field from where the farmer is, crop and unit from the field's season, values from documents, the truck from the ticket, bushels from `lib/rules/`.
- **Fields are clickable outlines.** Translucent outlines over satellite imagery, from the farmers.gov field file or proposed by AI from a photo of the farmer's FSA map paired with public field outlines. The farmer adjusts or draws one with Terra Draw only when it's wrong or missing, and nothing is used until he confirms it. For the demo he only confirms; editing outlines with Terra Draw comes after the hackathon. He can reshape an outline (corners and edges) but never move a whole field; an edit that leaves less than 90% overlap with the original is saved as a new field and flagged. Keep the original outline. Outline edits never change insured acres.
- **Harvest log, not driver taps.** "Start harvesting" reads the browser's location once on the tap (a web app can't track location in the background), pre-selects the field it falls in and pre-fills last time's destinations; the farmer confirms. Picking the field on the map instead is marked lower trust. For the demo, the location comes from the "Simulate location" switch.
- **Bins record where their grain came from.** At the end of a harvest day, "How many loads went into Bin 3?" by truck creates one trip per load with crop, field, unit, date, truck, estimated bushels and bin, which are the fields an adjuster's load record needs. The mixing warnings fire when the farmer chooses a bin, before any grain goes in. A landlord's and tenant's shares of the same unit aren't mixing.
- **Tickets link by their printed time.** A ticket is linked to the field being harvested at its printed date and time, or to a field printed on it, or to a waiting pickup. The link is pre-selected and the farmer confirms; ask "Which field?" only when it's unclear. A ticket photo's own GPS and time prove when it was photographed, not where the grain came from.
- **The farmer has the final say on where grain came from.** Save his choice, keep the app's suggestion beside it, mark disagreements lower trust, and flag a choice that moves grain to a different unit.
- **Selling from a bin:** the farmer taps the bin and "Pickup"; the trip waits for its ticket.
- **Confirm, don't type.** Read values appear beside the photo; the farmer taps "Looks right" or flags one value, never edits it.
- **Every warning says what's wrong in one plain sentence** and offers its fixes as buttons.
- **Everything the seed loads** (farm name, fields, bins, trucks, buyers) must eventually be possible for the farmer to enter through the app. For the demo, only adding a bin is built; the seed loads the rest.
- **Desktop browser for the demo:** design screens for a laptop browser with clear, large controls. Phone layout comes after the hackathon; don't spend time on it now.