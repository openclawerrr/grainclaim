# Sample documents (SAMPLE: all made up)

`npm run print-docs` makes these PDFs from [`../documents-2026.json`](../documents-2026.json), which holds every value on every document and is the answer key for the reading tests. Don't edit the PDFs by hand. To change a document, edit the JSON, run `npm run print-docs`, then reprint and re-photograph the ones that changed. `npx vitest run` fails if a PDF is out of date with the JSON or the layout.

`npm run print-docs` checks every value first, using the same calculations as the app (`lib/rules/`), and prints nothing if one is wrong. It uses the Google Chrome installed on your computer, and refuses to write a PDF that comes out longer than one page.

## The documents

| Document | File | What it shows | How it gets into GrainClaim |
|---|---|---|---|
| Scale tickets 1, 2, 4, 5, 6 | `ticket-1.pdf` … `ticket-6.pdf` | North 80 loads to Main Street Elevator on Oct 12–13, 2026, by Truck 1 (tickets 1, 3, 4, 6) and Truck 2 (tickets 2, 5). Each has a printed date and time in | Print and photograph |
| Scale ticket 3 | `ticket-3.pdf` | The same form, blank except the elevator, the labels, the number (20888) and the terms, like a page from a ticket book | Print, fill in by hand, photograph |
| FSA map | `fsa-map.pdf` | Farm 1234 on an aerial photo: field 3 (North 80, 80.20 acres) in tract 5678 and field 1 (South 40, 40.00 acres) in tract 6012, each outlined and labeled | Print in color and photograph |
| FSA-578 | `fsa-578.pdf` | North 80 at **80.20** acres; South 40 at 40.00, shared 0.6667 / 0.3333 with the landlord | Print and photograph |
| Summary of Coverage | `summary-of-coverage.pdf` | Unit 1 (North 80) at **80.00** acres, so the acre-mismatch flag fires; Unit 2 at 40.00 | Upload the PDF itself |
| Settlement | `settlement.pdf` | **5 of the 6** tickets. Ticket 5 (No. 20941) is missing, so the missing-load flag fires | Upload the PDF itself |

## 1. Print

Print the six tickets, the FSA map and the FSA-578 on Letter paper, landscape, at **100% ("Actual size")**, not "Fit to page". Don't print the Summary of Coverage or the settlement.

Print the FSA map **in color**, at the printer's best quality. Its field outlines are yellow and white on a green aerial photo, and they disappear in black and white.

## 2. Fill in ticket 3 by hand

Write these on the printed `ticket-3.pdf` with a dark pen in ordinary handwriting. Put an X inside the brackets where it says X. The date and time matter most: GrainClaim links a ticket to the field being harvested at its printed date and time.

| Box | Write |
|---|---|
| Date | 10/12/2026 |
| Time In | 1:15 PM |
| Received / In | X |
| CONTRACT PURCHASE | X |
| Contract No. | SAMPLE-C-2611 |
| Customer | Dave's Farm (SAMPLE) |
| Grain | Yellow Corn |
| Truck No. | 1 |
| Driver ON | X |
| Gross weight | 79,740 |
| Tare weight | 24,580 |
| Net weight | 55,160 |
| Bushels | 985.00 |
| Test weight | 55.5 |
| Moisture | 17.9 |
| Foreign material | 1.3 |
| Damage | 2.1 |
| Shrink | 4.06 |
| Dry bushels | 945.01 |
| Weigher | KL |

Leave Location blank.

## 3. Set up the phone

- **Photos must be JPEG.** The Claude API doesn't accept HEIC, the iPhone's default. On an iPhone: Settings > Camera > Formats > **Most Compatible**.
- **Location must be on for the camera.** GrainClaim reads each photo's GPS and time as proof of when and where it was photographed. On an iPhone: Settings > Privacy & Security > Location Services > Camera > **While Using the App**, with Precise Location on.

## 4. Photograph

- Photograph the six tickets, the FSA map and the FSA-578, one photo each: the whole page in the frame, lying flat, in even light without glare.
- Keep the location when you move the photos to the Mac. AirDrop keeps it if you tap **Options** at the top of the share sheet and turn on **All Photos Data**; importing with Image Capture or Photos also keeps it. Messages and some email apps remove it.
- Rename each photo after its document and put it in [`../photos/`](../photos/): `ticket-1.jpg` … `ticket-6.jpg`, `fsa-map.jpg` and `fsa-578.jpg`. The names must match the document names in `documents-2026.json`, which the reading tests use to find each photo's answers.
- To check that a photo kept its location, open it in Preview, press ⌘I, and look for a GPS tab.

The photos' own dates will be after the harvest. That's expected: a ticket photo proves when it was photographed, and the ticket's printed date and time say when the grain was weighed.

## How they're marked SAMPLE

- "SAMPLE ONLY" at the top and bottom of every page, and a faint diagonal SAMPLE watermark, kept light so it doesn't get in the way of reading tests.
- "(SAMPLE)" in the farm's, landlord's and agency's names, and SAMPLE in the addresses, policy number and contract number.
- The FSA-578 has a large "SAMPLE: NOT AN OFFICIAL USDA FORM" banner, and the FSA map a large "SAMPLE: NOT AN OFFICIAL USDA MAP" banner. Neither carries the USDA logo.

Main Street Elevator, Sample Mutual Crop Insurance, Main Street Insurance Agency, Dave's Farm and Pat Landowner are all fictional. The tickets follow the layout of Wisconsin's government SAMPLE scale ticket, and the FSA-578 follows page 1 of the real blank form; both are in [`../reference/`](../reference/). The Summary of Coverage and settlement use our own layouts, because no public sample exists. No real company's name or design is used.

The FSA map has the parts of a real FSA aerial map: the header, the photo with numbered field outlines and tract boundaries, the legend and the footer. Its photo is USDA NAIP imagery, public domain (`../reference/naip-daves-farm.jpg`, from `npm run fetch-naip`), and its outlines are drawn straight from `../farm.geojson`, so the map can't drift from the outlines GrainClaim pairs it with. It follows the layout real FSA maps share; no real map is in this repository and no number on this map comes from one. The section, township and range printed on it are made up.
