import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadSampleFiles } from "../../scripts/seed/sample-files";
import { loadSampleOutlines, SAMPLE_OUTLINES_FILE } from "./nearby-outlines";

/** A project folder holding one outlines file with this content. */
function folderWith(content: unknown): string {
  const root = mkdtempSync(path.join(tmpdir(), "grainclaim-outlines-"));
  mkdirSync(path.dirname(path.join(root, SAMPLE_OUTLINES_FILE)), { recursive: true });
  writeFileSync(path.join(root, SAMPLE_OUTLINES_FILE), JSON.stringify(content));
  return root;
}

describe("the sample outlines file", () => {
  it("holds Dave's two fields point for point, and six neighbors", async () => {
    const outlines = await loadSampleOutlines();
    expect(outlines).toHaveLength(8);
    for (const field of loadSampleFiles().fields) {
      expect(outlines.find((outline) => outline.id === field.id)?.coordinates, field.properties.name).toEqual(field.geometry.coordinates);
    }
  });

  it("gives each outline an id and its rings, and nothing that says whose field it is", async () => {
    for (const outline of await loadSampleOutlines()) {
      expect(Object.keys(outline).sort()).toEqual(["coordinates", "id"]);
    }
  });
});

describe("a file that isn't an outlines file", () => {
  it("is refused when a ring doesn't end where it starts", async () => {
    const open = {
      type: "FeatureCollection",
      features: [{ type: "Feature", id: "a", geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] } }],
    };
    await expect(loadSampleOutlines(folderWith(open))).rejects.toThrow("is not an outlines file");
  });

  it("is refused when an outline isn't a polygon", async () => {
    const point = { type: "FeatureCollection", features: [{ type: "Feature", id: "a", geometry: { type: "Point", coordinates: [0, 0] } }] };
    await expect(loadSampleOutlines(folderWith(point))).rejects.toThrow("is not an outlines file");
  });
});
