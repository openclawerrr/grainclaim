# Sample document photos (SAMPLE)

Phone photos of the printed sample documents: `ticket-1.jpg` … `ticket-6.jpg` and `fsa-578.jpg`, each named after its document in [`../documents-2026.json`](../documents-2026.json). They're the inputs for the reading tests. They must be JPEG and keep the phone's GPS and time.

`fsa-map.jpg` is the FSA map, photographed from the PDF on a screen, cropped to the map page and resized to 3,000 px wide. It keeps the phone's date and time but has no GPS, because the map's location comes from the farmer's click, not from where the photo was taken. Nothing reads it yet: `npm run score-tickets` and `npm run score-documents` both skip it.

How to print, fill in, photograph and name them: [`../print/README.md`](../print/README.md).
