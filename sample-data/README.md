# Sample data (SAMPLE: all made up)

Everything in this folder is invented for the GrainClaim demo. Dave's Farm, its fields, bins, trucks, policy and Main Street Elevator are not real. The field outlines are made-up coordinates in rural Story County, Iowa.

## Files

| File | What it holds | Loaded by stage |
|---|---|---|
| `farm.json` | The permanent farm layer without fields: the insured, Main Street Elevator, Bins 3 and 4, Trucks 1 and 2 | `farm-base` |
| `farm.geojson` | North 80 and South 40 as field outlines with FSA numbers. Demo beat 1 imports this same file live | `fields` |
| `season-2026.json` | The 2026 corn policy, Units 1 and 2, and a field season for each field | `season-2026` |

`season-2026.json` points to fields by name and to units by unit number, so it reads easily. The seed turns those into IDs.

## How it's marked SAMPLE

There's no `is_sample` column, so the markers are:

- the insured is named **Dave's Farm (SAMPLE)**
- both fields have `source = 'sample'`
- the policy number is `SAMPLE-2026-CORN`
- the elevator's address starts with `SAMPLE:`
- every row the seed creates has a fixed ID that starts with **`5eed0000-`**

Bins, trucks, units and field seasons have no free-text column for a marker without renaming "Bin 3" or "Truck 1". They count as SAMPLE because they belong to the SAMPLE insured.

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

Not loaded yet: the Summary of Coverage's 80.00 acres and the acre-mismatch flag, trips, tickets, elevator truck #22, the settlement and the hail notice. They belong to later stages or happen live in the demo.

## Adding a demo stage

1. Add the stage's data file here.
2. Add one entry at the end of `STAGES` in `scripts/seed/stages.ts`, listing the rows it adds.
3. If it writes to a table that `scripts/seed/reset.ts` doesn't cover yet, add that table there.
4. A stage with photos (tickets) must also make reset delete tickets by the SHA-256 hashes of its photos. A ticket with no trip has no link back to the farm, and the unique-hash rule would block re-seeding.

## Reset and the audit trail

The seed never deletes from `audit_event`, because that table is append-only. It also never uses `TRUNCATE`, which would skip the audit triggers. Each reset adds `delete` rows and each load adds `insert` rows, so a sample record's history shows every reseed. Screens that show a record's history should start from its latest insert.
