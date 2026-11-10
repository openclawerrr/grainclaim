/**
 * npm run build-outlines: writes sample-data/nearby-outlines.geojson (the
 * outlines Claude chooses from when it reads Dave's FSA map) and
 * sample-data/reference/outlines-preview.html (the same outlines over
 * satellite imagery, to check by eye), from farm.geojson, farm.json and the
 * Crop Sequence Boundaries clip. It reads and writes files only: no database,
 * no Claude.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { buildOutlineFiles, loadOutlineInputs } from "./files";

function main(): void {
  const dir = path.resolve("sample-data");
  const files = buildOutlineFiles(loadOutlineInputs(dir));
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), text);
    console.log(`  sample-data/${name}`);
  }
  console.log("Open the preview with: open sample-data/reference/outlines-preview.html");
}

try {
  main();
} catch (err) {
  console.error(`build-outlines failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
