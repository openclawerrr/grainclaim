/**
 * npm run place-fields: writes Dave's field outlines into
 * sample-data/farm.geojson, cut from the real fields named in placement.ts.
 * Names, ids, FSA numbers and expected acres stay as they are; only the
 * outlines change. It reads and writes files only: no database, no Claude.
 *
 * Moving a field changes what the seed loads into the shared database, so
 * agree it with the team first. Afterwards run npm run build-outlines,
 * npm run fetch-naip and npm run print-docs, in that order: the neighbors,
 * the aerial photo and the printed map all follow the fields.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadOutlineInputs } from "./files";
import { placeFields } from "./placement";

function main(): void {
  const dir = path.resolve("sample-data");
  const file = path.join(dir, "farm.geojson");
  const placed = placeFields(loadOutlineInputs(dir).clip);
  const farm = JSON.parse(readFileSync(file, "utf8")) as {
    features: { properties: { name: string }; geometry: unknown }[];
  };
  for (const { name, geometry } of placed) {
    const feature = farm.features.find((f) => f.properties.name === name);
    if (!feature) throw new Error(`${name} is in placement.ts but not in farm.geojson.`);
    feature.geometry = geometry;
  }
  // Indented like the rest of the file, with each point on one line.
  const text = JSON.stringify(farm, null, 2).replace(/\[\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s*\]/g, "[$1, $2]");
  writeFileSync(file, `${text}\n`);
  console.log(`  sample-data/farm.geojson: ${placed.map((p) => p.name).join(", ")}`);
  console.log("Now run npm run build-outlines, npm run fetch-naip and npm run print-docs.");
}

try {
  main();
} catch (err) {
  console.error(`place-fields failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
