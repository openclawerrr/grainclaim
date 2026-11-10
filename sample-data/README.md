# Sample data (SAMPLE: all made up)

Everything in this folder is invented for the GrainClaim demo. Dave's Farm, its fields, bins, trucks, policy and Main Street Elevator are not real. The field outlines are made-up coordinates in rural Story County, Iowa.

## Files

| File | What it holds | Loaded by stage |
|---|---|---|
| `farm.json` | The permanent farm layer without fields: the insured, Main Street Elevator, Bins 3 and 4, Trucks 1 and 2 | `farm-base` |
| `farm.geojson` | North 80 and South 40 as field outlines with FSA numbers. Demo beat 1 imports this same file live | `fields` |
| `nearby-outlines.geojson` | The outlines GrainClaim chooses from when it reads a photo of Dave's FSA map: North 80 and South 40 with the same coordinates as `farm.geojson`, and six real neighboring fields. No outline has a name or FSA numbers; the map photo supplies those. Made by `npm run build-outlines` | Not loaded |
| `season-2026.json` | The 2026 corn policy, Units 1 and 2, and a field season for each field | `season-2026` |
| `documents-2026.json` | Every value on Dave's 2026 sample documents (6 scale tickets, the FSA-578, the Summary of Coverage, the settlement), keyed by document name. It's the answer key for the reading tests | Not loaded: the documents are read live in the demo |
| `print/` | The documents as one-page PDFs, made from `documents-2026.json` by `npm run print-docs`. How to print, fill in and photograph them: [`print/README.md`](print/README.md) | Not loaded |
| `photos/` | Phone photos of the printed tickets and FSA-578, named after each document (`ticket-3.jpg`). Inputs for the reading tests | Not loaded |
| `reference/` | Real blank forms (the Wisconsin SAMPLE scale ticket, the FSA-578), for layout only, and the public data the outlines are built from (see "Public data in `reference/`") | Not loaded |

`season-2026.json` points to fields by name and to units by unit number, so it reads easily. The seed turns those into IDs.

To change the outlines, edit `farm.geojson` or the rules in `scripts/outlines/outlines.ts` and run `npm run build-outlines`. Never edit `nearby-outlines.geojson` or the preview page by hand; `npx vitest run` fails when either is out of date.

## Public data in `reference/`

| File | What it is |
|---|---|
| `csb-near-daves-farm.geojson` | USDA NASS Crop Sequence Boundaries, public domain. The 39 real crop-field outlines that touch the box around Dave's fields (longitude -93.425 to -93.390, latitude 42.080 to 42.100), clipped with DuckDB from the 2016–2023 national release on Source Cooperative (crops as of 2023). These are crop-field outlines, not FSA's field boundaries, and they say nothing about who farms the land |
| `outlines-preview.html` | Every outline in `nearby-outlines.geojson` over Esri World Imagery, to check by eye that the outlines sit on real fields. Open it with `open sample-data/reference/outlines-preview.html`; it needs the internet. Made by `npm run build-outlines` |

To change a document, edit `documents-2026.json`, run `npm run print-docs`, then reprint and re-photograph it. Never edit the PDFs by hand; `npx vitest run` fails when one is out of date.

## How it's marked SAMPLE

There's no `is_sample` column, so the markers are:

- the insured is named **Dave's Farm (SAMPLE)**
- both fields have `source = 'sample'`
- the policy number is `SAMPLE-2026-CORN`
- the elevator's address starts with `SAMPLE:`
- every row the seed creates has a fixed ID that starts with **`5eed0000-`**

Bins, trucks, units and field seasons have no free-text column for a marker without renaming "Bin 3" or "Truck 1". They count as SAMPLE because they belong to the SAMPLE insured.

Every sample document says "SAMPLE ONLY" at the top and bottom and carries a faint SAMPLE watermark. The FSA-578 also has a large "SAMPLE: NOT AN OFFICIAL USDA FORM" banner.

## Loading it

```bash
npm run seed                            # remove the sample farm, then load every stage
npm run seed -- --through farm-base     # demo beat 1: everything except the fields and the season
npm run seed -- --through fields        # fields too, but no 2026 season
npm run seed -- --reset-only            # remove the sample farm, load nothing
npm run seed -- --list                  # list the stages
```

The database is shared, so seeding replaces the sample farm for everyone. Tell the team before you run it.

Before demo beat 1, run `--through farm-base`. A live import of `farm.geojson` would otherwise fail, because North 80 and South 40 already exist with the same FSA numbers.

## Values

| Item | Value |
|---|---|
| North 80 | FSA 1234 / 5678 / 3. A ½ × ¼ mile rectangle whose outline the database measures at exactly 80.20 acres |
| South 40 | FSA 1234 / 6012 / 1 (a different tract: rented land). A ¼ × ¼ mile square across the road, 40.00 acres |
| Bin 3 | 36 ft diameter, 24 ft eave height, 19,633 bu capacity (calculated by the database) |
| Bin 4 | 30 ft diameter, 20 ft eave height, 11,362 bu capacity |
| Bins' location | Farmstead east of North 80, about 135 m from the nearest field edge |
| Truck 1 / Truck 2 | 1,000 bu / 900 bu, owned by the farm |
| Main Street Elevator | In Nevada, IA, about 5 miles from the fields |
| Policy | 2026 corn, IA / Story, RP, 75% coverage, 100% price election, approved yield 180, basic units, projected price $4.62 (the 2026 RMA price) |
| Unit 1 | North 80, owned, share 1 |
| Unit 2 | South 40, crop share, Dave's share stored as 0.6667 (the column holds 4 decimals). Screens show guarantees rounded to whole bushels |
| Field seasons | Corn, non-irrigated. Planted acres 80.20 and 40.00 (the FSA-578 numbers). Planting Apr 28 to May 2, 2026 |
| Scale tickets | 6 North 80 loads to Main Street Elevator on Oct 12–13, 2026, each with a printed date and time: Truck 1 carries tickets 1, 3, 4 and 6, Truck 2 carries 2 and 5. About 5,720 wet bushels in all (5,535 elevator dry). Ticket 1 is the worked example in `lib/rules/ticket.test.ts`; ticket 3 is filled in by hand |
| FSA-578 | North 80 at 80.20 acres (key 1, share 1.0000); South 40 at 40.00 acres (key 1 at 0.6667, key 2 Pat Landowner (SAMPLE) at 0.3333) |
| Summary of Coverage | Sample Mutual Crop Insurance (fictional). Unit 1 at 80.00 acres, guarantee 10,800 bu; Unit 2 at 40.00 acres, 3,600 bu. Season setup uses the FSA-578's 80.20 acres, so Unit 1's guarantee becomes 10,827 bu |
| Settlement | Main Street Elevator, contract SAMPLE-C-2611 at $4.18: 5 of the 6 tickets. Ticket 5 (No. 20941) is missing |

Not loaded yet: the harvest log, trips, tickets, the settlement, elevator truck #22's pickup and the hail notice. They belong to later stages or happen live in the demo. The documents in `documents-2026.json` aren't loaded either; the demo reads them live, so the acre-mismatch flag (80.20 vs 80.00) and the missing-load flag (ticket 5) come from reading them.

## Adding a demo stage

1. Add the stage's data file here.
2. Add one entry at the end of `STAGES` in `scripts/seed/stages.ts`, listing the rows it adds.
3. If it writes to a table that `scripts/seed/reset.ts` doesn't cover yet, add that table there.
4. A stage with photos (tickets) must also make reset delete tickets by the SHA-256 hashes of its photos. A ticket with no trip has no link back to the farm, and the unique-hash rule would block re-seeding.

## Reset and the audit trail

The seed never deletes from `audit_event`, because that table is append-only. It also never uses `TRUNCATE`, which would skip the audit triggers. Each reset adds `delete` rows and each load adds `insert` rows, so a sample record's history shows every reseed. Screens that show a record's history should start from its latest insert.
