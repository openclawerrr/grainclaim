# GrainClaim: setup and status

_Last updated: November 11, 2026_

This file records what's been set up so far, how a teammate gets running, how we work together, and what comes next. The full product spec is `docs/spec.md` (pipeline, data model, calculations, matching rules, walkthrough).

---

## What's set up

### Accounts and services

| Service | What exists | Access |
|---|---|---|
| GitHub | Private repo `openclawerrr/grainclaim` | Derrick (owner) + 2 invited collaborators |
| Supabase | Project `grainclaim`, project ref `dmepqunvusduqwanqsce`. Postgres with PostGIS turned on (in the `extensions` schema) | Derrick; teammates to be invited |
| Anthropic | Claude Console organization with an API key for ticket reading | Derrick; teammates to be invited |

### In the repo

- **Next.js app** (App Router, TypeScript, Tailwind), created with `create-next-app`. Run it with `npm run dev`, then open http://localhost:3000.
- **shadcn/ui** set up for ready-made UI components (tables, buttons, tabs, dialogs).
- **Libraries** (all listed in `package.json`, installed by `npm install`):

| Library | Used for |
|---|---|
| `@supabase/supabase-js` | Reading and writing the database and photo storage |
| `zod` | Defining what a ticket reading looks like; checking the AI's output |
| `exifr` | Reading GPS location and time from uploaded photos |
| `maplibre-gl` | The farm map |
| `terra-draw`, `terra-draw-maplibre-gl-adapter` | Adjusting proposed field outlines and drawing missing ones |
| `@turf/turf` | Map math in the browser (point inside field, distances) |
| `@anthropic-ai/sdk` | Sending ticket photos to Claude and getting values back |
| `vitest` | Tests for the calculations and matching rules |
| `supabase` | Command-line tool for database migrations |

- **`supabase/` folder**: Supabase CLI config, plus `supabase/migrations/<timestamp>_init.sql`, the first database migration.

### Database (first migration)

12 tables, pushed to the Supabase project with `npx supabase db push --remote`:

| Group | Tables |
|---|---|
| Farm map (permanent) | `insured`, `field`, `bin`, `buyer`, `truck` |
| Season (yearly) | `policy`, `unit`, `field_season` |
| Harvest | `trip`, `ticket` |
| Integrity | `flag`, `audit_event` |

Rules the database enforces on its own:

- Field mapped acres are calculated from the outline; broken outlines are refused.
- Bin capacity is calculated from diameter and eave height.
- A truck can have only one open trip at a time.
- A trip has exactly one origin (field or bin) and one destination (bin or buyer).
- Ticket photos can't be replaced, and read values lock once saved. A wrong value gets a `misread` flag instead of an edit.
- The same photo file can't be uploaded twice (SHA-256 fingerprint).
- Every insert, change and delete is copied into `audit_event`, which can't be edited or deleted.
- Row Level Security is on for every table. The public key can't read or write anything until login rules are added; server-side code uses the secret key.

### Stack decisions (summary)

One-page decision records go in `docs/decisions/` (Phase 0 requirement). Written so far: [which model reads documents](docs/decisions/document-reading-model.md), [how a load is recorded and finished](docs/decisions/loads.md) and [how a reader notices the wrong kind of document](docs/decisions/wrong-document.md). The rest still need writing.

| Need | Choice | Main alternative | Why |
|---|---|---|---|
| App | Next.js + TypeScript + Tailwind + shadcn/ui | Streamlit or FastAPI (Python) | Largest ecosystem, one language front to back |
| Database | Supabase Postgres + PostGIS | Document database | Answers "which field is this point in?" in SQL; links between tables enforce the ticket ← trip ← field chain |
| Photo storage | Supabase Storage, files named by SHA-256 | S3 / Cloudflare R2 | Same service as the database; originals never change |
| Reading tickets and forms | Claude API with structured outputs (JSON schema) | Azure Document Intelligence, AWS Textract | Handles handwriting and messy layouts; one service for tickets, FSA-578, Summary of Coverage, settlements |
| Confidence per value | Arithmetic checks + a second independent read, not the model's self-rating | Model self-reported confidence | Research shows self-reported confidence is poorly calibrated |
| Map | MapLibre + Terra Draw + Turf.js, Esri or USGS NAIP satellite imagery | Mapbox / Google Maps | Free, no API key |
| Location | The browser's location, read once when the farmer clicks "Start harvesting"; ticket times; photo GPS and time (exifr) as proof of capture | Native app GPS | No phone app at this stage, and a web app can't track location in the background |
| PDF | Playwright printing the agent-view page | WeasyPrint | PDF matches the web page exactly |
| Roles | Farmer / Agent switcher (drivers don't use the app) | Supabase Auth logins | This stage only needs to switch views |
| Tests | Vitest | pytest | Same language as the app |

---

## Getting a teammate running

1. **Accept the invites**: GitHub (email), Supabase (email), Claude Console (email).
2. **Install the tools.**
   - Mac: install Homebrew from brew.sh, then `brew install git node gh` and `brew install --cask visual-studio-code`.
   - Windows: install Git (git-scm.com), Node (nodejs.org), VS Code (code.visualstudio.com) and the GitHub CLI (cli.github.com).
   - Node must be version 22 or newer: check with `node --version`.
3. **Tell Git who you are**:
   ```bash
   git config --global user.name "Your Name"
   git config --global user.email "you@example.com"
   ```
4. **Get the code**:
   ```bash
   gh auth login
   gh repo clone openclawerrr/grainclaim
   cd grainclaim
   npm install
   ```
5. **Open it in VS Code**: File → Open Folder → `grainclaim`, then click Trust. Open the terminal with Control + `.
6. **Create `.env.local`** in the project folder (see below), then run `npm run dev` and open http://localhost:3000.
7. **Only if you'll push database changes**: `npx supabase login`, then `npx supabase link --project-ref dmepqunvusduqwanqsce`.

Recommended VS Code extensions (optional): ESLint, Tailwind CSS IntelliSense, Live Share (for editing the same file together).

### `.env.local` template

Never commit this file (Git already ignores it). Get the Supabase values from Derrick in a private message; create your own Anthropic key in the Claude Console.

```
NEXT_PUBLIC_SUPABASE_URL=https://dmepqunvusduqwanqsce.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
ANTHROPIC_API_KEY=sk-ant-...
# Needed from the seed script onward (server-side only, never NEXT_PUBLIC_):
SUPABASE_SECRET_KEY=sb_secret_...
```

---

## How we work

- **Pull first.** Start every session with `git checkout main` and `git pull`.
- **Branch per task.** `git checkout -b short-task-name`, commit often, `git push -u origin short-task-name`, then `gh pr create`. A teammate reviews, then merge.
- **Don't push straight to `main`.**
- **After pulling, run `npm install` if `package.json` changed.**
- **Database structure changes go in new migration files** (`npx supabase migration new name`), never by clicking in the Supabase dashboard, and never by editing a migration that's already been pushed. Whoever merges a migration runs `npx supabase db push --remote` and tells the team.
- **The database is shared and live.** Everyone sees data changes instantly. `npm run seed` reloads the sample farm whenever data gets messy (see below).
- **Keys never go in Git, chats or screenshots.** If one leaks, delete it in Supabase or the Claude Console and make a new one.
- **Split work by area** to avoid conflicts:

| Person | Owns |
|---|---|
| A | Database, seed data, calculations, matching rules |
| B | Ticket and settlement reading, review screen |
| C | Farm map, harvest log and bins, agent report view |

### Sample farm (seed)

`npm run seed` removes Dave's sample farm and loads it again from `sample-data/`. It needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` in `.env.local`.

```bash
npm run seed                            # the whole sample farm: farm-base, fields, season-2026
npm run seed -- --through farm-base     # the farm only: no Bin 3, fields or season yet, to add them in the app
npm run seed -- --reset-only            # remove the sample farm
npm run seed -- --help                  # all options
```

- **It replaces the sample farm for everyone.** Post in the team chat before running it.
- It also removes rows added to the sample farm in the app: fields, trips, tickets on those trips, second photos of those tickets, and flags. Photo files stay in Storage; each is named by its hash, so adding the same photo again stores nothing new.
- `audit_event` is never cleared, so it grows with every run.
- `sample-data/README.md` lists every made-up value and how to add a seed stage.

---

## Next steps

See `docs/build-plan.md` for what's built, the build order and who owns what.

### Things to check

- [ ] The Anthropic API key's expiry date (Claude Console → API Keys); make a new one before it lapses.
- [ ] The Supabase free project pauses after a week without activity; open the dashboard the day before GrainClaim is shown to anyone.
