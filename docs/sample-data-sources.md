# GrainClaim: real data to use as sample inputs

_Last updated: November 8, 2026. Organized by the stages in `docs/build-plan.md`. Use these when swapping placeholder data for realistic data (Milestone 8), and as layout references for the sample documents (Milestone 1)._

The demo's farm (Dave's Farm, Main Street Elevator) stays made up and marked SAMPLE. This list is real public data that makes those samples look and behave like the real thing: real field shapes, real form layouts, real prices and county yields.

## Quick summary

| Stage | Real data available | Best use |
|---|---|---|
| Farm map (fields) | USDA Crop Sequence Boundaries: real field shapes, public domain | Give North 80 and South 40 real outlines that line up with the satellite photo |
| Farm map (file format) | RMA's CLU shapefile schema | Use the real attribute names in `farm.geojson` so the importer handles real farmers.gov exports |
| Satellite imagery | Esri World Imagery, USGS imagery, USDA NAIP | The map background |
| Season setup | The real blank FSA-578 and its manual; 2026 RMA projected price | A realistic sample FSA-578; the policy's projected price |
| Summary of Coverage | No public sample found | Build ours from the handbook's elements; ask an agent for a redacted real one |
| Scale tickets | Wisconsin's government-published SAMPLE scale tickets | Layout model for our printed sample tickets |
| Settlements | Field lists from grain accounting software; a real co-op's shrink and drying schedule | What our sample settlement shows, with realistic deductions |
| Report and claim | NASS county yields for Story County; RMA corn loss adjustment handbook | "Yield far from county" flag; claim worksheets |

## Milestone 1: seed data

### Field outlines: USDA Crop Sequence Boundaries (CSB)

- **What it is:** about 16 million real crop-field outlines across the lower 48 states, drawn by USDA NASS from satellite crop maps, with each field's acres, county and crop for each year (crop code 1 = corn, 5 = soybeans).
- **License:** public domain, free to redistribute.
- **Formats:** NASS publishes a file geodatabase and a web viewer. Source Cooperative hosts a GeoParquet version (2016–2023, about 4 GB) that can be queried for a small area without downloading the whole file, for example with DuckDB and a bounding box.
- **Story County, Iowa** is county FIPS 19169.
- **Why it matters:** made-up rectangles placed on a real satellite photo can cut across real roads, farmsteads and field edges. Real CSB outlines line up with what's in the photo.
- **Caveats:** these are crop-field outlines, not FSA's official CLU boundaries, and they have no FSA farm, tract or field numbers (we add made-up ones). They aren't ownership boundaries. A real field won't measure exactly 80.20 acres, so nudge the outline until the database calculates 80.20; otherwise the map's acres would trigger a second acre-mismatch flag.

### File format: the CLU shapefile schema (RMA P105)

The public schema for FSA field boundary (CLU) files as insurance companies receive them. Key attributes:

| Attribute | Meaning |
|---|---|
| `FARMNUM`, `TRACTNUM`, `FIELDNUM` | FSA farm, tract and field numbers |
| `CALCACRE` | Acres calculated from the outline (2 decimals) |
| `LOCSTATE`, `LOCCNTY` | State and county where the field is |
| `CLUCLASS` | Land type (cropland, rangeland…) |
| `HELCODE`, `CROPLDIND`, `SAPCRP` | Highly erodible land, cropland and CRP indicators |

farmers.gov lets farmers export their own field boundaries as ESRI shapefiles or GeoJSON, but doesn't publish the exported attribute list. P105 is the closest public spec, so using these names in `farm.geojson` makes the importer more likely to accept a real export.

**Real CLU data for a real farm isn't public.** Only the farmer can export it from farmers.gov. If a teammate knows a farmer willing to share an export, it's the best real test of the importer. Get permission, and keep it out of the repo.

### Satellite imagery (map background)

- **Esri World Imagery:** already planned. Free with attribution to Esri and its data providers.
- **USGS Imagery Only basemap:** a US government tile service built on NAIP imagery.
- **USDA NAIP (National Agriculture Imagery Program):** the aerial photos FSA itself uses, about 1-meter resolution, available as an image service at imagery.geoplatform.gov.

## Milestone 1: sample documents

### Scale tickets: Wisconsin's SAMPLE tickets

Wisconsin's agriculture department publishes two government SAMPLE scale tickets showing what a compliant grain receipt must include:

- ticket number, date, location, customer
- commodity
- gross, tare and net weight; bushels
- test weight, moisture, foreign material, damage
- weigher
- storage in or out; spot or contract purchase, with the contract number

They're the best public model for the layout of our printed sample tickets. Agvance's help center also documents what real elevator software prints on a grain scale ticket. Our tickets use the fictional Main Street Elevator, not a real company's name or design.

### FSA-578: the real blank form

- **The form:** FSA publishes the current blank FSA-578 (Report of Acreage). Its headings are Farm No., Field No., Crop or Land Use, Practice, Crop Status, Share and Tract No., Total Operator Report and Total Determined Acreage, with code keys for practice and crop status.
- **The manual:** the FSA-578 manual on farmers.gov explains each field and code.
- **Use:** base our sample FSA-578 on the real layout so ticket reading is tested on a realistic document. Fill it with Dave's made-up data and mark it SAMPLE in large text.

### Summary of Coverage: no public sample found

Each insurance company formats its own Summary of Coverage, and I found no public example. Options:

- Build ours from what the spec lists (Part 2, Policy and Unit): policy number, crop, county, year, plan, coverage level, price election, unit numbers and types, practice, share, approved yield, acres and guarantee.
- University of Wisconsin Extension has a worked example of unit structures and guarantees (170 bu APH, 75% coverage, by section) that's useful for checking the numbers.
- Best: ask a crop insurance agent for a redacted real one.

### Settlements

No public sample image found. What a real settlement contains, from Agvance's grain settlement documentation:

- the tickets settled and their bushels
- price per bushel, contract number
- discounts and premiums, drying charges, storage fees, grain taxes, other deductions
- advances, check number, payees

For realistic numbers, Dunkerton Co-op (Iowa) publishes its harvest policies:

- corn shrink of 1.4% per point (matching our sample buyer's rate)
- corn drying charges of 4 to 5 cents per point
- test-weight discounts and storage rates

Use the numbers, not the company's name.

## Milestones 3 and 7: season setup and the report

- **2026 projected price (RMA):** corn $4.62 per bushel, volatility factor 0.15; soybeans $11.09, volatility 0.13. Use $4.62 for the seed policy's projected price, which is currently empty.
- **Story County corn yields (NASS county estimates):** 207.1 bu/acre in 2022 and 211.4 in 2023. 2025 county yields were released around May 2026 and are in NASS Quick Stats. Use these for the "yield far from county" flag: Unit 1's roughly 110 bu/acre after hail is far below the county.
- **Claims (Phase 8, stretch):** RMA's Corn Loss Adjustment Handbook contains the production worksheets adjusters fill in. Use it as the model for the claim packet.

## Ground rules for real data

- **Real farmer data** (CLU exports, real policies) only with permission, and never committed to the repo.
- **Real businesses' numbers, not their names or designs.** The demo's elevator and insurance company stay fictional.
- **Government forms** (FSA-578) are fine to copy for layout, filled with made-up data and marked SAMPLE.
- **Credit what the licenses require:** Esri imagery needs attribution. CSB and NAIP are public domain.

## Sources

- [USDA NASS: Crop Sequence Boundaries](https://www.nass.usda.gov/research-and-science/crop-sequence-boundaries)
- [CSB 2025 metadata](https://data.nass.usda.gov/Research_and_Science/Crop-Sequence-Boundaries/metadata_Crop-Sequence-Boundaries-2025.htm)
- [Source Cooperative: USDA Crop Sequence Boundaries (GeoParquet)](https://source.coop/fiboa/us-usda-cropland)
- [RMA: CLU AIP shapefile schema (P105)](https://pubfs-rma.fpac.usda.gov/pub/Publications/M13_Handbook/2017/Approved/P105_CLU_AIP_Shapefile_Schema.pdf)
- [FSA: Farm Records on farmers.gov fact sheet](https://www.fsa.usda.gov/sites/default/files/2025-04/FARMERS_FarmRecords_Factsheet_508_25.pdf)
- [USGS Imagery Only basemap](https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer)
- [NAIP image service](https://imagery.geoplatform.gov/iipp/rest/services/NAIP/NAIP_plus/ImageServer)
- [Wisconsin DATCP: SAMPLE scale ticket (warehouse)](https://datcp.wi.gov/Documents/WHS_Scale_Ticket_SAMPLE.pdf)
- [Wisconsin DATCP: SAMPLE scale ticket (dealer)](https://datcp.wi.gov/Documents/DLR_Scale_Ticket_SAMPLE_8-21-09.pdf)
- [Agvance: required information on a grain scale ticket](https://helpcenter.agvance.net/home/scale-ticket-level-management-mode-required-information-on-a-grain-scale-ticket)
- [FSA-578 blank form](https://www.fsa.usda.gov/sites/default/files/2025-03/FSA-578.pdf)
- [FSA-578 manual](https://farmers.gov/sites/default/files/documents/fsa-578-manual.pdf)
- [UW Extension: crop insurance coverage levels and units](https://farms.extension.wisc.edu/articles/crop-insurance-coverage-levels-and-insurance-units)
- [Agvance: settlements in grain](https://helpcenter.agvance.net/home/settlements-in-grain)
- [Dunkerton Co-op: harvest and storage policies](https://s3.amazonaws.com/media.agricharts.com/sites/2485/Harvest%20&%20Storage%20Policies%202022-2023.pdf)
- [farmdoc daily: 2026 projected prices and volatility factors](https://farmdocdaily.illinois.edu/2026/03/projected-prices-and-volatility-factors-for-2026.html)
- [NASS: Iowa county estimates, corn (2023)](https://www.nass.usda.gov/Statistics_by_State/Iowa/Publications/County_Estimates/2024/IA-CtyEst-Corn-02-24.pdf)
- [farmdoc daily: 2025 NASS county yields](https://farmdocdaily.illinois.edu/2026/05/2025-nass-county-corn-soybean-and-winter-wheat-yields.html)
- [RMA: Corn Loss Adjustment Handbook](https://rma.usda.gov/sites/default/files/handbooks/2024-25080-Corn-Loss-Adjustment-Handbook.pdf)
