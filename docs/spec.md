# GrainClaim: demo spec and build path

GrainClaim is one pipeline for the farmer. Every record is captured at the moment it's created, so by report time nothing has to be dug up, remembered or retyped.

```
Farm map ─► Season setup ─► Field ─► Bin ─► Trip ─► Ticket ─► Settlement ─► Production report / claim packet
                                └──────────► Trip (straight from field) ──┘
```

The diagram shows the order grain and records move through, not which record belongs to which. For that, see "How the records connect" in Part 2.

**The farmer records everything from his own phone.** Truck drivers and elevator staff never use GrainClaim. There are two roles: the farmer and his crop insurance agent.

Demo deliverable: a working web demo (no phone app) plus the code, in a GitHub repository. The team must be able to explain why each tool and workflow was chosen, so keep a short decision record for each one (see Phase 0).

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

**Outlines are proposed, then confirmed.** Field outlines come from the farmers.gov field file, or AI proposes them from a photo of the farmer's FSA map and public field outlines. The farmer adjusts or draws any outline, and nothing is used until he confirms it. He can reshape an outline (move its corners and edges) but never move a whole field. An edited outline must overlap the original by at least 90%; otherwise it's treated as a new field and flagged for the agent. The original is kept, and the agent sees every edit with the old and new acres. Editing an outline never changes insured acres, which come from the FSA-578 and Summary of Coverage.

**Trips are the glue, and the farmer records them.** A trip is one load leaving a field or a bin. Every trip comes from the farmer's own records:
- **Harvest log.** When he starts a field, he taps "Start harvesting". GrainClaim reads his phone's location once, picks the field he's in and asks where the grain is going (a buyer, a bin, or both). He's usually in that field, running the combine.
- **Loads into a bin.** At the end of the day he says how many loads went into each bin; each becomes one trip from the field to the bin.
- **Tickets.** A ticket links to the field that was being harvested at its printed date and time, creating and closing a trip in one step.
- **Pickups.** When grain leaves a bin, he taps the bin and "Pickup"; the trip waits for its ticket.

**The farmer has the final say on where grain came from.** GrainClaim pre-selects the field (from his location or the ticket's time) and he confirms or picks another. When he picks a different field, both answers are kept and the record is marked lower trust; when his pick puts the grain in a different unit, it's flagged, because moving production between units is what an adjuster checks.

A ticket inherits the chain: ticket ← trip ← field, or ticket ← trip ← bin ← fields. The field's season gives the unit.

**Bins hold one crop and are tracked by unit and crop year.** A farm with storage usually has several bins at one site serving all its fields, so each bin records which field and unit every load came from. Mixing fields in the same unit is fine, and so is a landlord's and tenant's share of the same unit. Mixing different units makes that grain unprovable unless the bin is measured first or the adjuster approves a separation method (load records, bin markings or combine monitor printouts). Otherwise the adjuster splits the mixed grain between units in proportion to each unit's liability, which can erase a damaged unit's claim.

**Estimates are records, not evidence of totals.** A field harvest record must show estimated bushels per load, so every load into a bin carries an estimate (defaulting to the truck's capacity), along with the crop, field, date, truck and bin. The official numbers are tickets and the adjuster's or FSA's bin measurement.

**The farmer reviews but can't fabricate.** Photos are locked with a hash, time and GPS. A ticket photo's time and GPS show when and where it was photographed, not where the grain came from; the ticket's printed date and time do that. A farmer can flag a misread but never overwrite it. Shared records are frozen.

---

## Part 2. Data model

**How the records connect.** The insured (the farm business) is the root. Fields, bins and farm trucks each belong to one insured. Buyers, like the elevator, are separate businesses. Fields, bins and trucks aren't linked to each other directly; trips link them. A trip records grain moving from a field or bin to a bin or buyer, and a ticket closes a trip. That's how every bushel traces back to the field it grew on: ticket ← trip ← field, directly or through a bin.

```
Insured (Dave's Farm)          the root
├── Fields                     where grain grows
├── Bins                       where grain is stored
├── Trucks                     what carries it (optional on a trip)
└── Harvest log                which field was being harvested, when, and where its grain went
Buyers (Main Street Elevator)  separate businesses
Trips link them: origin (field or bin) + destination (bin or buyer)
```

Season records (policy, units, field seasons) group the fields for one crop year without changing them.

### Farm map (permanent)
| Entity | Key fields |
|---|---|
| **Insured** | Name as on policy, entity type, contact, linked agent |
| **User** | Role: farmer or agent. The farmer records everything and approves sharing; the agent sees the finished report. Drivers don't use GrainClaim |
| **Field** | Name, FSA farm / tract / field, state, county, boundary (GeoJSON polygon), original boundary and edit history, mapped acres, legal description (section / township / range, from the map), acreage type flag (new breaking, native sod, CRP), source (farmers.gov file / AI-proposed / drawn), confirmed by the farmer, valid-from / valid-to |
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
| **Harvest log** | Field, start and end time, destinations (buyers and bins), location when started, trust (location-confirmed or picked on the map), crop year |
| **Trip** | ID, origin (field or bin), destination (bin or buyer), time, how it was created (bin load / ticket / pickup), truck (optional: read from the ticket, or the farm truck for a bin load), driver name if the ticket shows one, estimated bushels, moisture (if known), status (waiting for its ticket / closed), trust level (location-confirmed, field printed on the ticket, or picked by hand), trip code |
| **Pickup** | A trip that starts at a bin, created when the farmer taps the bin and "Pickup": buyer, buyer truck number if known, optional photo of the truck at the bin |
| **Bin contents** | Bin, crop, crop year, bushels by unit (estimated), bushels by field where known, mixed flag, measurement status |
| **Bin event** | Bin, in / out, trip, estimated bushels, unit |
| **Measurement** | Bin, measured by (adjuster / FSA / approved third party), date, grain depth, test weight, moisture, pack factor, bushels, photo of the measurement sheet |
| **Ticket** | Original photo, SHA-256 hash, capture time, capture GPS, source (camera / upload / email / import); read values (buyer, ticket number, date, time in, crop, gross, tare, net, moisture, test weight, foreign material, damage, dockage, truck number, buyer's shrink, contract number) with a confidence for each; farmer flags; calculated wet bushels, elevator dry bushels, insurance production to count; trip link and how it was made (harvest log time, field printed on the ticket, waiting pickup, or the farmer's choice); trust level; duplicate result |
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

**Harvest ticket → field**
1. A field named on the ticket (printed, or written at the scale) wins.
2. Otherwise, use the ticket's printed date and time: the field being harvested then, among harvest-log entries that sent grain to that buyer.
3. The field is pre-selected and the farmer confirms with one tap. GrainClaim then creates a trip from that field to the buyer and closes it with the ticket.
4. Ask the farmer only when it's unclear: the ticket was weighed within an hour of a switch between two fields that both sent grain to that buyer (a load may still have been on the road), it has no time and two such fields were harvested that day, or no harvest was logged then.

**Loads into a bin**
At the end of each harvest day, for each bin in that day's harvest log, ask "How many loads went into Bin 3 today?" by truck. Each load becomes one trip from the field to the bin, estimated at the truck's capacity. The farmer can instead tap "+1 load" as each one goes in; records made at the time are stronger evidence for an adjuster.

**Pickup → late ticket (selling from a bin)**
The farmer taps the bin and "Pickup" when a buyer's truck loads; the trip waits. Match a ticket to a waiting pickup on: same buyer → weighed the same day or the next → truck number if printed → bushels within 10–15% of the estimate → earliest pickup to earliest ticket. An exact trip code in the ticket's remarks wins outright. If only one pickup is waiting for that buyer, it matches automatically and the farmer confirms. If a ticket could be either a pickup or a harvest load, ask.

**Same-unit shortcut:** if every possible origin for a ticket (fields in the harvest log, or the bins of waiting pickups) is in the same unit, the ticket's unit is settled even if the exact field or trip isn't. Ask the farmer only when the possible origins are in different units.

**Ticket → settlement:** match by ticket number, then bushels. A ticket on no settlement is flagged.

**Unmatched anything** → Needs attention, with the most likely matches suggested.

---

## Part 5. Warnings and flags

| When | What GrainClaim does |
|---|---|
| Choosing a bin that holds a different crop | Block |
| Choosing a bin that holds last year's grain | Warn: get the carryover measured first |
| Choosing a bin that holds a different unit | Stop with three choices: use another bin / request measurement first (notifies agent or adjuster, bin marked "waiting for measurement") / mix anyway (recorded as mixed, estimated split kept, flagged in the packet) |
| Harvest started by picking the field on the map, with no location match | Marked lower trust |
| A ticket that could have come from two units and the farmer can't tell | Flag possibly mixed load |
| Farmer picks a different field than his location or the ticket's time suggests | Keep both answers, mark lower trust; flag if the pick changes the unit |
| End of a harvest day with a bin in the log | Ask how many loads went into it, by truck |
| Acres differ between FSA-578, Summary of Coverage and map | Flag before harvest |
| Mapped field not on the FSA-578 | Flag possible unreported or uninsured acres |
| Edited outline overlaps its original by less than 90% | Treat as a new field; flag for the agent |
| Low-confidence read | Highlight for review |
| Duplicate ticket (buyer + number + date) | Flag |
| Edited photo or screenshot | Flag |
| Pickup with no ticket after 3 days / ticket that can't be linked to a field or pickup | Needs attention |
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
- Per unit: tickets with photos, settlements, the harvest log and trips (field harvest records), bin contents and measurement status, 100% of production including landlord shares
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
- One field in the harvest log, one ticket photo read automatically and linked to that field, one line of a production report.
- Hard-code whatever isn't built yet.
- **Done when:** a sample ticket photo becomes a row in a unit total. This proves the riskiest part early.

### Phase 2: Farm map
- Import a field file (GeoJSON from farmers.gov). Fields show as translucent, clickable outlines over satellite imagery.
- AI-proposed outlines: the farmer uploads a photo of his FSA map and taps roughly where the farm is. GrainClaim loads public field outlines nearby (USDA Crop Sequence Boundaries), and Claude reads the FSA map's field numbers and acres and pairs them with those outlines. A map photo has no coordinates, so the public outlines are what place it.
- The farmer adjusts any outline or draws a missing one (Terra Draw): corners and edges only, never moving a whole field, keeping at least 90% overlap with the original. The original is kept. Nothing is used until he confirms it; acres are recalculated from the confirmed outline.
- Show FSA numbers, mapped acres and legal description.
- Shape checks: overlaps, broken outlines.
- Add bins at a point with size; add trucks.
- **Done when:** Dave's sample farm displays with fields, bins and trucks, and a sample FSA map photo produces outlines he can adjust and confirm.

### Phase 3: Season setup (acreage snapshot)
- Photograph the FSA-578 and Summary of Coverage; read them; match lines to fields by FSA numbers.
- Create the policy, units and field-seasons; shares from the lease.
- Calculate the guarantee per unit.
- Flag acre and share mismatches and unreported fields.
- Year-over-year view: show what changed from last season.
- **Done when:** the sample FSA-578 and Summary of Coverage set up two units with guarantees and fire one mismatch flag.

### Phase 4: Harvest log, bins and pickups
- "Start harvesting": the phone's location is read once on the tap (a web app can't follow location in the background), the field it falls in is pre-selected, and the farmer picks the destinations (pre-filled with last time's). Picking the field on the map instead is the fallback, marked lower trust.
- End-of-day bin loads: one trip per load, by truck.
- Pickups from a bin: tap the bin, then "Pickup"; optional truck photo; trip code.
- Bin contents by unit and crop year, with the mixing, carryover and crop warnings when a bin is chosen.
- Works offline: the harvest log and photos are saved in the browser with their original time and location, and synced later.
- "Simulate location" switch for the demo, which runs on a laptop.
- **Done when:** the sample harvest log sends North 80 to the elevator and Bin 3, and choosing Bin 3 for South 40 fires the mixing warning.

### Phase 5: Tickets
- Photograph or upload; photo hash, time and GPS locked.
- Automatic reading with confidence per value; review screen with flag-not-edit.
- Duplicate check; trust levels.
- Linking to the harvest log or a waiting pickup with the rules in Part 4; the farmer confirms.
- Wet, elevator-dry and insurance bushels calculated.
- **Done when:** a printed and a handwritten-style sample ticket each link to the right field and unit.

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

**If time runs short, cut from the bottom:** Phase 8 first, then the year-over-year view, offline mode, pickups and AI-proposed outlines (the farmers.gov import stays). Keep Phases 1–7's core: map, acreage snapshot, harvest log and bins, tickets, settlements, production report.

---

## Part 8. Stack decisions to make (with a default to start from)

The team is choosing the stack; this is a starting point to compare against, not a decision.

| Need | A reasonable default | Main alternative | Trade-off |
|---|---|---|---|
| App the farmer uses | Mobile-first web app (the demo is web only) | React Native or native app | Web is one codebase and easy to demo; native has better background GPS and camera control |
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
- Field map: a photo of Dave's FSA map (SAMPLE) for AI-proposed outlines, with the farmers.gov field file as the backup. Bin 3 is added live in beat 1
- Harvest log: North 80 on Oct 12–13, going to Main Street Elevator and Bin 3; then South 40, where choosing Bin 3 fires the mixing warning
  - 6 loads North 80 → Main Street Elevator (about 5,800 bu), each with a ticket
  - 3 loads North 80 → Bin 3 (about 3,000 bu), counted at the end of the day
- January: Dave taps Bin 3 and "Pickup" when elevator truck #22 loads; the ticket arrives 3 days later and matches the waiting pickup
- Tickets: one handwritten-style, the rest printed
- Settlement lists 5 of the 6 elevator tickets: the missing-load flag fires
- FSA-578 shows 80.20 acres for North 80; Summary of Coverage shows 80.00: the acre mismatch flag fires
- July hail notice of loss for Unit 1

---

## Part 10. Demo script (about 3 minutes)

1. **"Here's Dave's farm."** Dave uploads a photo of his FSA map and taps near his farm; outlines appear on the satellite map and he confirms them (backup: import the field file). He taps beside his farmstead and enters 36 ft to add Bin 3. He adds the FSA-578 and Summary of Coverage; the mismatch flag appears.
2. **"Harvest."** Dave taps "Start harvesting" in North 80, sending grain to the elevator and Bin 3; a ticket photo reads itself and links to North 80. He starts South 40, picks Bin 3, and the mixing warning stops him.
3. **"Payday."** The settlement match catches the missing load.
4. **"Winter."** Dave taps Bin 3 and "Pickup" as the elevator's truck loads; the emailed ticket matches the waiting pickup by itself.
5. **"April."** Dave approves; switch to the agent's view of the finished production report, and tap one ticket to show its full chain back to the field.

Say what's simulated: location (the demo runs on a laptop) and the sample documents.

---

## Part 11. UI principles

The farmer gives the minimum and gets answers on demand.

**Capture, don't ask.** Never ask for anything GrainClaim can get itself: time and GPS from the photo or phone, the field from where the farmer is when he starts harvesting, the crop and unit from the field's season, values from the document photo, the truck from the ticket, and bushels from the calculations.

**One action per step.**

| Step | What the farmer does | What GrainClaim does |
|---|---|---|
| Farm map | Uploads the farmers.gov field file, or a photo of his FSA map | Shows each field as a clickable outline, proposing outlines from the FSA map when needed; reads FSA numbers, acres and legal description |
| Season setup | Photographs the FSA-578 and Summary of Coverage | Creates the policy, units and field seasons; flags mismatches |
| Harvest | Taps "Start harvesting" in the field (picks destinations only if they differ from last time) | Picks the field from his location; at the end of the day asks how many loads went into each bin |
| Ticket | Photographs or uploads it, whenever | Reads it, checks it, links it to its field or pickup, calculates bushels |
| Pickup | Taps the bin, then "Pickup" | Creates a waiting trip and matches the ticket when it arrives |
| Settlement | Photographs or uploads it | Matches tickets and flags missing loads |
| Report | Reviews it and taps Approve | Locks the report and shares it with the agent |

**Select on the map; draw only to fix.** Fields appear as translucent, clickable outlines over satellite imagery. The farmer taps a field to select it or see its details. Outlines come from the farmers.gov file or are proposed by AI from his FSA map; he adjusts or draws one only when it's wrong or missing. He can reshape an outline but not move it.

**Defaults everywhere.** Pre-fill the most likely answer: the field he's standing in, last time's destinations, truck capacity. The farmer changes only what's wrong.

**Confirm, don't type.** Read values appear beside the photo. The farmer taps "Looks right" or flags one value. Only low-confidence values are highlighted. Where a ticket came from is pre-selected the same way; he can change it, and the app's suggestion is kept beside his choice.

**Show only what needs action.** The farmer's home screen is the Needs attention list and the season totals. Details (the record chain, the math behind a number) open on tap.

**Plain words for the farmer, insurance terms for the agent.** "This bin already has grain from your rented ground," not "unit commingling." The agent view uses the formal terms.

**Every warning offers its fix.** A flag says what's wrong in one sentence and gives the choices as buttons.

**Each role sees only its job.** Farmer: Start harvesting, add tickets, totals, Needs attention and Approve. Agent: the finished report.

**Phone first.** Large buttons, one column, usable one-handed in a combine cab. The demo is a web app in a browser, and every screen works at phone width.

---

## Out of scope for the demo

A phone app, an app for truck drivers, background location tracking, feeding logs, grain cart and combine data, quality tests, automatic bin sensors, direct filing into insurer systems, Bushel import, the email forwarding address, Canada.

---

Sources used: RMA FAD-288 (notice and claims by unit); COUNTRY Financial claims checklist and APH review guidelines (records, separate by unit, 100% of production, bin rules, field on tickets); NAU Country compliance checklist (field harvest records, acreage proof) and review types (data mining, excessive yields, large claims); ProAg production report form 16063 and production reporting requirements; FCS America moisture adjustment; Hudson Crop farm-stored production rules (3% tolerance); FSA farmers.gov farm records fact sheet (field exports); GAO-12-256 (data mining and FSA inspections); RMA Loss Adjustment Standards Handbook FCIC-25010-1, paragraph 1133 (commingled production); Farmers Mutual Hail and ProAg harvest and storage record requirements (load records, bin markings, measurement before mixing).