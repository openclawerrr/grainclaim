# GrainClaim: demo spec and build path

GrainClaim is one pipeline for the farmer. Every record is captured at the moment it's created, so by report time nothing has to be dug up, remembered or retyped.

```
Farm map ─► Season setup ─► Field ─► Bin ─► Trip ─► Ticket ─► Settlement ─► Production report / claim packet
                                └──────────► Trip (straight from field) ──┘
```

Demo deliverable: a working demo plus the code, in a GitHub repository. The team must be able to explain why each tool and workflow was chosen, so keep a short decision record for each one (see Phase 0).

---

## Part 1. The rules the pipeline is built on

**How insurance organizes data**
- **Policy** = one crop, one county, one crop year, for one insured. A farm with corn and soybeans, or land in two counties, has several policies.
- **Unit** = an insurance bucket inside a policy. Guarantee and loss are calculated per unit; notice of loss is given by unit.
  - Basic: all of the crop in the county under one ownership arrangement. A crop-share rented field is its own basic unit.
  - Optional: a basic unit split by FSA farm number or section. Only valid if each one's production is recorded separately.
  - Enterprise: every field of the crop in the county, as one unit.
- **Field** = the physical ground (FSA farm / tract / field). One unit holds several fields; each field belongs to exactly one unit in a given season.
- Records must cover **100% of production**, including a landlord's share, and stay separated by unit.

**Record at the field, add up by unit.** Units can change every year (enterprise one year, optional the next), and many rules ask about fields (acreage, planting dates, load records, appraisals). Fields are the building block; units are a grouping laid on top each season.

**Two layers that change at different speeds**
- Farm map (permanent): field outlines, FSA numbers, bins. Changes only when land is bought, sold, re-rented or renumbered.
- Season (yearly): crop, planted acres, share, unit and guarantee for each field.

**Trips are the glue.** A trip is one load leaving a field or a bin. Each truck has one open trip at a time; a ticket closes the trip it belongs to. A ticket inherits the chain: ticket ← trip ← bin ← unit ← fields.

**Bins hold one crop and are tracked by unit and crop year.** Mixing fields in the same unit is fine. Mixing different units makes that grain unprovable unless the bin is measured first or the adjuster approved a separation method (load records).

**Estimates are records, not evidence of totals.** A field harvest record must show estimated bushels per load, so every trip carries an estimate (defaulting to the truck's capacity). The official numbers are tickets and the adjuster's or FSA's bin measurement.

**The farmer reviews but can't fabricate.** Photos are locked with a hash, time and GPS. A farmer can flag a misread but never overwrite it. Shared records are frozen.

---

## Part 2. Data model

### Farm map (permanent)
| Entity | Key fields |
|---|---|
| **Insured** | Name as on policy, entity type, contact, linked agent |
| **User** | Role: owner, driver, agent. Drivers record trips and tickets; only the owner approves sharing |
| **Field** | Name, FSA farm / tract / field, state, county, boundary (GeoJSON polygon), mapped acres, legal description (section / township / range, from the map), acreage type flag (new breaking, native sod, CRP), source, valid-from / valid-to |
| **Bin** | Name, GPS point, diameter, eave height, floor type, capacity (calculated), photo |
| **Truck** | Name or number, capacity in bushels, owner (farm or buyer) |
| **Buyer** | Name, address, GPS point, type (elevator, ethanol plant, feedlot, processor) |

### Season (per crop year)
| Entity | Key fields |
|---|---|
| **Policy** | Crop, county, crop year, policy number, plan (RP / YP), coverage level, price election, unit structure, approved yield, projected price |
| **Unit** | Unit number (from the Summary of Coverage), type, practice, share arrangement, guarantee |
| **Field-season** | Field, crop, unit, planted acres (FSA-578), planting date, date planting completed, practice, crop status, intended use, insured or uninsured, end-of-season status (harvested / partly harvested / destroyed / other use / prevented planting / appraised) |
| **Share** | Party, percent, arrangement (cash rent / crop share), lease photo |

### Harvest
| Entity | Key fields |
|---|---|
| **Trip** | ID, truck, driver, origin (field or bin, set from GPS), destination (bin or buyer), start time, GPS point, estimated bushels, moisture (if known), status (open / ticket coming later / closed), trust level (GPS-confirmed or manual), trip code |
| **Pickup** | A trip that starts at a bin with a buyer's truck: buyer, buyer truck number, driver name, photo of the truck at the bin |
| **Bin contents** | Bin, crop, crop year, bushels by unit (estimated), bushels by field where known, mixed flag, measurement status |
| **Bin event** | Bin, in / out, trip, estimated bushels, unit |
| **Measurement** | Bin, measured by (adjuster / FSA / approved third party), date, grain depth, test weight, moisture, pack factor, bushels, photo of the measurement sheet |
| **Ticket** | Original photo, SHA-256 hash, capture time, capture GPS, source (camera / upload / email / import); read values (buyer, ticket number, date, crop, gross, tare, net, moisture, test weight, foreign material, damage, dockage, truck number, buyer's shrink, contract number) with a confidence for each; farmer flags; calculated wet bushels, elevator dry bushels, insurance production to count; trip link; trust level; duplicate result |
| **Settlement** | Original photo and hash, buyer, number, date, contract type, tickets listed with bushels, price, futures and basis, deductions, net payment, match results |
| **Notice of loss** | Units, cause, date discovered, date reported, written record |

### Integrity and sharing
| Entity | Key fields |
|---|---|
| **Flag** | Type, severity, linked records, status, resolution note, resolved by |
| **Audit event** | Who, when, what, before and after |
| **Share / export** | What, to whom, when, approved by, frozen snapshot hash |
| **Prior history** | Imported past years per unit (from the agent's history report) |

---

## Part 3. Calculations

| What | Formula |
|---|---|
| Net weight | gross − tare |
| Wet bushels | net lbs ÷ standard weight (corn 56, soybeans 60, wheat 60) |
| Elevator dry bushels | wet bushels × (1 − buyer shrink per point × points above buyer's base moisture) |
| Insurance production to count, corn | wet bushels × (1 − reduction). Reduction is 1.2% per point from 15% to 30% moisture, plus 2% per point only for the points above 30% (32% moisture: 15 × 1.2% + 2 × 2% = 22%) |
| Insurance production to count, soybeans | wet bushels × (1 − 1.2% per point above 13% moisture) |
| Insurance production to count, wheat | No insurance moisture rule yet. GrainClaim reports an error rather than guess a rate |
| Bin estimate | ≈ 0.63 × diameter² × grain depth (feet) |
| Bin balance | estimated in ≈ ticketed out + measured remaining; flag a gap over 3% of estimated in |
| Unit production | sold and commercially stored (tickets) + measured farm-stored + fed (later) + appraised |
| Unit yield | unit production ÷ planted acres, using 100% of production (including a landlord's share), not the insured's share |
| Guarantee | approved yield × coverage level × acres × share |
| Insured's share of production | unit production to count × insured's share |
| Shortfall | guarantee − insured's share of production to count, never below zero |

Store raw gross, tare and moisture, and calculate the elevator and insurance numbers separately: they differ. Quality adjustments are out of scope.

---

## Part 4. Matching rules

**Trip → ticket (farm truck)**
1. A truck has one open trip at a time.
2. A ticket photographed by that truck's driver closes the open trip.
3. If a truck leaves again with an open trip, ask: "Mark trip #3 'ticket coming later'?" That trip moves aside and waits.

**Waiting trip → late ticket (including buyer pickups)**
Match on: same buyer → weighed the same day or the next → truck number if printed → bushels within 10–15% of the estimate → earliest pickup to earliest ticket. Exact trip code in the ticket's remarks wins outright.

**Same-unit shortcut:** if every waiting trip for that buyer and day came from the same unit, any of those tickets belongs to that unit even if the exact trip is unclear. Ask the farmer only when trips from different units are waiting.

**Ticket → settlement:** match by ticket number, then bushels. A ticket on no settlement is flagged.

**Unmatched anything** → Needs attention, with the most likely matches suggested.

---

## Part 5. Warnings and flags

| When | What GrainClaim does |
|---|---|
| Trip into a bin holding a different crop | Block |
| Trip into a bin holding last year's grain | Warn: get the carryover measured first |
| Trip into a bin holding a different unit | Stop with three choices: use another bin / request measurement first (notifies agent or adjuster, bin marked "waiting for measurement") / mix anyway (recorded as mixed, estimated split kept, flagged in the packet) |
| Trip origin picked by hand with no GPS match | Marked lower trust |
| Truck in two places too fast | Flag impossible sequence |
| One truck loaded from two units | Flag mixed load |
| Acres differ between FSA-578, Summary of Coverage and map | Flag before harvest |
| Mapped field not on the FSA-578 | Flag possible unreported or uninsured acres |
| Low-confidence read | Highlight for review |
| Duplicate ticket (buyer + number + date) | Flag |
| Edited photo or screenshot | Flag |
| Trip with no ticket / ticket with no trip | Needs attention |
| Ticket on no settlement; shrink differs from contract | Flag |
| Bin balance off by more than 3% | Flag |
| Unit yield far from county or neighbors | Flag |
| Notice-of-loss deadline (72 hours, 15 days after the insurance period) | Reminder |

---

## Part 6. The production report and claim packet

**Production report** (for the agent, due about 45 days after sales closing; April 29 for Iowa spring crops). Per crop, county and crop year, broken out by unit and practice:
- Insured name, policy number, plan, coverage level, unit structure, landlord / tenant and persons sharing
- Planted acres, date planting completed, share, insured or uninsured
- Production with a **record type** for each entry (sold or commercially stored, farm-stored measured, fed, appraised)
- Harvested and unharvested acres with their status
- Yield, plus imported prior years for a continuous history
- Field location: FSA numbers and legal description
- Records index sorted by crop year and unit, with photos attached
- Farmer approval and signature

**Claim packet** (after a loss, for the adjuster, through the agent):
- Notice of loss record
- Per unit: tickets with photos, settlements, trips (field harvest records), bin contents and measurement status, 100% of production including landlord shares
- Check results, how each flag was resolved, and the audit trail

Outputs: agent web view, PDF, CSV and JSON. Filing directly into insurer systems is out of scope.

---

## Part 7. Build path

Each phase ends with something that works end to end. Build a thin version of the whole pipeline early, then deepen each stage; that gets ticket reading, the riskiest part, tested in week one instead of week six.

### Phase 0: Foundations
- Choose the stack and write a one-page decision record for each choice: what you picked, the main alternative, and why (see Part 8).
- Set up the repo: app, backend, database, photo storage, a `/docs/decisions` folder.
- Write the database schema from Part 2.
- Build the sample data set (Part 9) and load script.
- **Done when:** the sample farm loads into the database and a blank app runs.

### Phase 1: Thin slice (one load, start to finish)
- One field, one bin, one trip, one ticket photo read automatically, one line of a production report.
- Hard-code whatever isn't built yet.
- **Done when:** a sample ticket photo becomes a row in a unit total. This proves the riskiest part early.

### Phase 2: Farm map
- Import a field file (GeoJSON from farmers.gov), or draw a field on a satellite map.
- Show FSA numbers, mapped acres and legal description.
- Shape checks: overlaps, broken outlines.
- Add bins at a GPS point with size; add trucks.
- **Done when:** Dave's sample farm displays with fields, bins and trucks.

### Phase 3: Season setup (acreage snapshot)
- Photograph the FSA-578 and Summary of Coverage; read them; match lines to fields by FSA numbers.
- Create the policy, units and field-seasons; shares from the lease.
- Calculate the guarantee per unit.
- Flag acre and share mismatches and unreported fields.
- Year-over-year view: show what changed from last season.
- **Done when:** the sample FSA-578 and Summary of Coverage set up two units with guarantees and fire one mismatch flag.

### Phase 4: Trips and bins
- Load-out tap: origin from GPS (point inside field outline, or near a bin), destination, truck, estimated bushels, driver.
- One open trip per truck; "ticket coming later."
- Buyer pickups with truck photo and trip code.
- Bin contents by unit and crop year, with the mixing, carryover and crop warnings.
- Works offline: trips saved on the phone with original time and GPS, synced later.
- "Simulate location" switch for the demo.
- **Done when:** the sample harvest runs through trips to the elevator and into Bin 3, and the mixing warning fires.

### Phase 5: Tickets
- In-app capture; photo hash, time and GPS locked.
- Automatic reading with confidence per value; review screen with flag-not-edit.
- Duplicate check; trust levels.
- Matching to trips with the rules in Part 4.
- Wet, elevator-dry and insurance bushels calculated.
- **Done when:** a printed and a handwritten-style sample ticket each attach to the right trip and unit.

### Phase 6: Settlements and Needs attention
- Read settlements; match to tickets; flag missing loads and shrink differences.
- One Needs attention list for every broken link.
- Pipeline board: Fields → Bins → Trips → Tickets → Settlements → Report, with each record's chain view.
- **Done when:** the missing-load flag fires and every open item shows in one list.

### Phase 7: Production report and agent view
- Unit totals with record types; measurement entry for grain still in bins; end-of-season field status.
- Uninsured acres; prior-history import (CSV).
- Farmer approval, lock and snapshot hash.
- Agent web view, PDF and CSV export.
- **Done when:** Dave approves and the agent sees a finished production report with every record attached.

### Phase 8: Claim packet (stretch)
- Notice of loss log with deadline reminders.
- Claim packet per unit; adjuster view.
- Fraud checks: duplicates, edited photos and screenshots, yields against county data.
- **Done when:** the hail scenario produces a packet showing the North 80 shortfall.

### Phase 9: Demo polish
- Demo script (Part 10), README explaining the pipeline, decision records, tests for the calculations and matching rules.
- **Done when:** someone outside the team can run the demo from the README.

**If time runs short, cut from the bottom:** Phase 8 first, then the year-over-year view, offline mode and pickups. Keep Phases 1–7's core: map, acreage snapshot, trips, tickets, settlements, production report.

---

## Part 8. Stack decisions to make (with a default to start from)

The team is choosing the stack; this is a starting point to compare against, not a decision.

| Need | A reasonable default | Main alternative | Trade-off |
|---|---|---|---|
| App farmers and drivers use | Mobile-first web app (installable PWA) | React Native or native app | Web is one codebase and easy to demo; native has better background GPS and camera control |
| Map | MapLibre or Leaflet with a satellite layer | Mapbox or Google Maps | Open libraries are free; commercial maps are polished but billed |
| Database | PostgreSQL with PostGIS | A document database | PostGIS answers "is this point inside this field?" directly |
| Photo storage | S3-compatible storage, hash stored in the database | Database blobs | Object storage scales and keeps originals untouched |
| Reading tickets and forms | A vision AI model returning structured fields and confidence | A dedicated OCR service (e.g. Textract, Document AI) | AI models handle messy handwriting and layouts well; OCR services are more predictable on clean print |
| Backend | One server framework (Node or Python) with a REST API | Hosted backend service | Own server is clearer to explain; hosted is faster to set up |
| Offline | Browser storage queue, synced when online | Native local database | Fine for a demo; native is sturdier in the field |
| PDF output | Server-side HTML-to-PDF | A PDF library | HTML templates are easier to style |
| Logins and roles | A hosted auth service | Own auth | Hosted saves time; own gives full control |

---

## Part 9. Sample data (all made up, marked SAMPLE)

- **Dave's Farm**, Story County, Iowa, 2026 corn, Revenue Protection 75%, approved yield 180
- **North 80** (FSA 1234 / 5678 / 3), 80.20 acres, Unit 1, owned 100%
- **South 40**, rented on crop share (Dave 2/3, landlord 1/3), Unit 2
- **Bin 3**, 36 ft; **Bin 4**, 30 ft
- **Truck 1**, 1,000 bu; **Truck 2**, 900 bu
- Harvest:
  - 6 trips North 80 → Main Street Elevator (about 5,800 bu)
  - 3 trips North 80 → Bin 3 (about 3,000 bu)
  - 1 trip South 40 headed to Bin 3: the mixing warning fires
  - 1 trip with no ticket: "ticket coming later"
- January: buyer pickup of Bin 3 by elevator truck #22; the ticket arrives 3 days later and matches itself
- Tickets: one handwritten-style, the rest printed
- Settlement lists 5 of the 6 elevator tickets: the missing-load flag fires
- FSA-578 shows 80.20 acres for North 80; Summary of Coverage shows 80.00: the acre mismatch flag fires
- July hail notice of loss for Unit 1

---

## Part 10. Demo script (about 3 minutes)

1. **"Here's Dave's farm."** Import the field file; add the FSA-578 and Summary of Coverage; the mismatch flag appears.
2. **"Harvest."** Trips from North 80 to the elevator and to Bin 3; the South 40 mixing warning; a ticket photo reads itself and attaches to its trip.
3. **"Payday."** The settlement match catches the missing load.
4. **"Winter."** A buyer pickup from Bin 3; the emailed ticket matches itself.
5. **"April."** Dave approves; switch to the agent's view of the finished production report, and tap one ticket to show its full chain back to the field.

Say what's simulated: GPS location and the sample documents.

---

## Out of scope for the demo

Feeding logs, grain cart and combine data, quality tests, automatic bin sensors, direct filing into insurer systems, Bushel import, the email forwarding address, Canada.

---

Sources used: RMA FAD-288 (notice and claims by unit); COUNTRY Financial claims checklist and APH review guidelines (records, separate by unit, 100% of production, bin rules, field on tickets); NAU Country compliance checklist (field harvest records, acreage proof) and review types (data mining, excessive yields, large claims); ProAg production report form 16063 and production reporting requirements; FCS America moisture adjustment; Hudson Crop farm-stored production rules (3% tolerance); FSA farmers.gov farm records fact sheet (field exports); GAO-12-256 (data mining and FSA inspections).