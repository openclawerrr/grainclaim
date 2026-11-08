<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## GrainClaim project rules

GrainClaim is a demo of one record pipeline for a farmer: farm map → season setup → trips → scale tickets → settlements → crop insurance production report. Before starting any feature, read `docs/spec.md`. It defines the data model (Part 2), calculations (Part 3), matching rules (Part 4), flags (Part 5), sample data (Part 9) and the demo script (Part 10). `SETUP.md` covers setup, environment variables and team workflow.

### Stack

- Next.js (App Router) + TypeScript + Tailwind + shadcn/ui
- Supabase Postgres with PostGIS. PostGIS lives in the `extensions` schema, so map types are written `extensions.geometry`.
- Supabase Storage for photos, each file named by its SHA-256 hash
- Claude API (`@anthropic-ai/sdk`) with structured outputs for reading tickets and forms; one zod schema per document type
- MapLibre GL + Terra Draw + Turf.js for the map; exifr for GPS and time from photos
- Vitest for tests

### Folder layout

- `app/`: screens. `app/api/`: server routes.
- `lib/rules/`: calculations, matching rules and flags. Pure functions only: plain data in, results out, no database or framework calls. Every function has Vitest tests next to it.
- `lib/extract/`: document reading, one schema per document type
- `lib/db/`: database queries
- `supabase/migrations/`: database structure changes
- `sample-data/`: Dave's sample farm, sample ticket photos, harvest replay file. Everything in it is made up and marked SAMPLE.
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
- The demo has no logins. An Owner / Driver / Agent switcher changes the view.
- Before opening a pull request, `npx vitest run`, `npm run lint` and `npm run build` must pass.