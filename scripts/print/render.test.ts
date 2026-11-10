import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { groundSize } from "../outlines/map-area";
import { loadSampleFiles, type FieldFeature } from "../seed/sample-files";
import { documentsOfKind, loadDocumentsFile, type FsaMapDoc } from "./documents-file";
import { loadMapInputs } from "./map-inputs";
import { countPdfPages, FIXED_PDF_DATE, pdfContains, withFixedDates } from "./pdf";
import { esc, handwrittenEntries, longDate, projector, renderDocument, scaleBarFeet, time12, usDate } from "./render";

const file = loadDocumentsFile();
const map = loadMapInputs(loadSampleFiles().fields);
const rendered = Object.entries(file.documents).map(([name, doc]) => renderDocument(name, doc, map));
const html = (name: string) => {
  const page = rendered.find((r) => r.name === name);
  if (!page) throw new Error(`no ${name}`);
  return page.html;
};
const PRINT_DIR = path.resolve("sample-data", "print");

describe("formatting", () => {
  it("writes dates and times the way the documents print them", () => {
    expect(usDate("2026-10-12")).toBe("10/12/2026");
    expect(usDate("2026-06-12", "-")).toBe("06-12-2026");
    expect(["09:55", "12:05", "13:15", "00:30"].map(time12)).toEqual(["9:55 AM", "12:05 PM", "1:15 PM", "12:30 AM"]);
    expect(longDate("2026-04-14")).toBe("April 14, 2026");
    expect(longDate("2026-12-01")).toBe("December 1, 2026");
  });

  it("escapes names for HTML", () => {
    expect(esc(`Dave's <b>"Farm" & Co`)).toBe("Dave&#39;s &lt;b&gt;&quot;Farm&quot; &amp; Co");
  });
});

describe("rendered pages", () => {
  it("say SAMPLE ONLY at the top and bottom of every page and carry the SAMPLE watermark", () => {
    for (const page of rendered) {
      expect(page.html).toContain('<div class="sample-top">SAMPLE ONLY</div>');
      expect(page.html).toContain('<div class="sample-bottom">SAMPLE ONLY');
      expect(page.html).toContain('<div class="watermark" aria-hidden="true"><span>SAMPLE</span></div>');
      expect(page.title).toBe(`${page.name} SAMPLE ${page.hash}`);
    }
  });

  it("print each printed ticket's values, including the date and time it links by", () => {
    for (const [name, doc] of documentsOfKind(file, "scale_ticket")) {
      if (doc.filled_in === "by_hand") continue;
      const v = doc.values;
      for (const text of [v.ticket_number, usDate(v.ticket_date), time12(v.ticket_time), "SAMPLE-C-2611", "Yellow Corn"]) {
        expect(html(name)).toContain(text);
      }
      expect(html(name)).toContain(v.gross_lbs.toLocaleString("en-US"));
    }
  });

  it("leave the hand-filled ticket blank apart from its number and the elevator's terms", () => {
    const v = documentsOfKind(file, "scale_ticket").find(([n]) => n === "ticket-3")?.[1].values;
    if (!v) throw new Error("no ticket-3");
    const page = html("ticket-3");
    expect(page).toContain(v.ticket_number);
    expect(page).toContain("1.4% per point of moisture over 15.0%");
    for (const text of ["79,740", "1:15 PM", "10/12/2026", "SAMPLE-C-2611", "945.01", "(X)"]) {
      expect(page).not.toContain(text);
    }
  });

  it("show 80.20 acres for North 80 on the FSA-578, under a not-official banner", () => {
    expect(html("fsa-578")).toContain(">80.20<");
    expect(html("fsa-578")).toContain("SAMPLE: NOT AN OFFICIAL USDA FORM");
  });

  it("show 80.00 acres for Unit 1 on the Summary of Coverage, with the 2026 projected price", () => {
    expect(html("summary-of-coverage")).toContain(">80.00<");
    expect(html("summary-of-coverage")).toContain("$4.62 per bushel");
    expect(html("summary-of-coverage")).toContain("SAMPLE-2026-CORN");
  });

  it("list five tickets on the settlement, not ticket-5", () => {
    const page = html("settlement");
    for (const n of ["20871", "20876", "20888", "20934", "20967"]) expect(page).toContain(`>${n}<`);
    expect(page).not.toContain("20941");
    expect(page).toContain("$18,989.12");
  });

  it("name only fictional businesses, never a real company from the reference sources", () => {
    const real = ["Wisconsin", "DATCP", "Dunkerton", "Agvance", "ProAg", "NAU Country", "COUNTRY Financial",
      "Farmers Mutual Hail", "Hudson", "FCS America", "Iowa Corn Promotion"];
    for (const page of rendered) {
      // Without the aerial photo, whose encoded bytes could spell anything.
      const text = page.html.replace(/data:image\/jpeg;base64,[A-Za-z0-9+/=]+/g, "").toLowerCase();
      for (const name of real) expect(text).not.toContain(name.toLowerCase());
    }
  });
});

describe("the FSA map", () => {
  const page = html("fsa-map");
  const [[, doc]] = documentsOfKind(file, "fsa_map");
  /** The page without the aerial photo's bytes. */
  const text = page.replace(map.image.dataUri, "PHOTO");
  const ground = groundSize(map.image.bbox);
  const width = (1000 * ground.width) / ground.height;
  const place = projector(map.image.bbox, width, 1000);
  const one = (n: number) => (Math.round(n * 10) / 10).toString();
  const drawn = (ring: readonly (readonly number[])[]) =>
    `M${ring.slice(0, -1).map((point) => place(point).map(one).join(",")).join(" L")} Z`;

  it("has an FSA map's header: the agency, county, program year, date made, farm, and each tract's cropland", () => {
    for (const expected of [
      "<b>United States Department of Agriculture</b><br>Farm Service Agency<br>",
      "Story County, Iowa",
      "<b>2026 Program Year</b><br>Map Created April 14, 2026",
      '<div class="t">Farm 1234</div>',
      "<b>Tract 5678</b> &nbsp;Cropland Total: 80.20 acres",
      "<b>Tract 6012</b> &nbsp;Cropland Total: 40.00 acres",
    ]) {
      expect(text).toContain(expected);
    }
  });

  it("says it is not an official USDA map, in a banner, and carries no logo: the only picture is the aerial photo", () => {
    expect(text).toContain('<div class="banner">SAMPLE: NOT AN OFFICIAL USDA MAP</div>');
    expect(text).toContain("FSA farm map SAMPLE for the GrainClaim demo. Not an official USDA map.");
    expect(text).not.toContain("<img");
    expect(text.match(/<image /g)).toHaveLength(1);
    expect(text).toContain('<image href="PHOTO"');
    expect(map.image.dataUri.startsWith("data:image/jpeg;base64,/9j/")).toBe(true);
  });

  it("draws each field's outline from farm.geojson, placed on the photo's bounding box", () => {
    for (const field of map.fields) {
      const ring = field.geometry.coordinates[0];
      expect(text, field.properties.name).toContain(`<path class="clu" d="${drawn(ring)}"/>`);
      for (const [x, y] of ring.map(place)) {
        expect(x).toBeGreaterThan(0);
        expect(x).toBeLessThan(width);
        expect(y).toBeGreaterThan(0);
        expect(y).toBeLessThan(1000);
      }
    }
    expect(text).toContain(`viewBox="0 0 ${one(width)} 1000"`);
    expect(width / 1000).toBeCloseTo(1.4, 2);
  });

  it("follows farm.geojson when an outline changes, with no change to the document's values", () => {
    const moved = map.fields.map((field): FieldFeature => {
      if (field.properties.name !== "South 40") return field;
      const ring = field.geometry.coordinates[0].map(([lon, lat]): [number, number] => [lon, lat - 0.001]);
      return { ...field, geometry: { type: "Polygon", coordinates: [ring] } };
    });
    const movedPage = renderDocument("fsa-map", doc, { ...map, fields: moved }).html;
    const south = map.fields.find((f) => f.properties.name === "South 40")!;
    expect(movedPage).not.toContain(drawn(south.geometry.coordinates[0]));
    expect(movedPage).toContain(drawn(moved.find((f) => f.properties.name === "South 40")!.geometry.coordinates[0]));
    expect(renderDocument("fsa-map", doc, { ...map, fields: moved }).hash).not.toBe(rendered.find((r) => r.name === "fsa-map")!.hash);
  });

  it("labels each field the FSA way (number, acres, erodibility) and each tract with its number", () => {
    const labels = [...text.matchAll(/<text class="field-label"[^>]*>([\s\S]*?)<\/text>/g)].map((m) =>
      [...m[1].matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((t) => t[1]),
    );
    expect(labels).toEqual([["3", "80.20", "NHEL"], ["1", "40.00", "NHEL"]]);
    expect([...text.matchAll(/<text class="tract-label"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1])).toEqual([
      "Tract 5678",
      "Tract 6012",
    ]);
  });

  it("puts each field's label inside its own outline", () => {
    const at = [...text.matchAll(/<text class="field-label" x="([\d.]+)" y="([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(at).toHaveLength(map.fields.length);
    at.forEach(([x, y], i) => {
      const points = map.fields[i].geometry.coordinates[0].map(place);
      expect(x).toBeGreaterThan(Math.min(...points.map((p) => p[0])));
      expect(x).toBeLessThan(Math.max(...points.map((p) => p[0])));
      expect(y).toBeGreaterThan(Math.min(...points.map((p) => p[1])));
      expect(y).toBeLessThan(Math.max(...points.map((p) => p[1])));
    });
  });

  it("draws one boundary around each tract", () => {
    expect(text.match(/<path class="tract" /g)).toHaveLength(2);
    for (const field of map.fields) expect(text).toContain(`<path class="tract" d="${drawn(field.geometry.coordinates[0])}"/>`);
  });

  it("draws one boundary around a tract of two fields that share an edge", () => {
    const square = (id: string, fsaField: string, west: number): FieldFeature => ({
      ...map.fields[0],
      id,
      properties: { ...map.fields[0].properties, name: `Field ${fsaField}`, fsa_tract: "7000", fsa_field: fsaField, expected_acres: 20 },
      geometry: {
        type: "Polygon",
        coordinates: [[[west, 42.092], [west + 0.003, 42.092], [west + 0.003, 42.095], [west, 42.095], [west, 42.092]]],
      },
    });
    const twoFields: FsaMapDoc = structuredClone(doc);
    const field = { acres: 20, hel: "NHEL", land_use: "cropland" } as const;
    twoFields.values.tracts = [
      { tract: "7000", cropland_acres: 40, fields: [{ field: "1", ...field }, { field: "2", ...field, land_use: "non_cropland" }] },
    ];
    const fields = [square("5eed0000-0000-4000-8000-000000000901", "1", -93.424), square("5eed0000-0000-4000-8000-000000000902", "2", -93.421)];
    const built = renderDocument("fsa-map", twoFields, { ...map, fields }).html.replace(map.image.dataUri, "PHOTO");
    expect(built.match(/<path class="tract" /g)).toHaveLength(1);
    expect(built.match(/<path class="clu" /g)).toHaveLength(1);
    expect(built.match(/<path class="clu non-cropland" /g)).toHaveLength(1);
  });

  it("has the PLSS label, a north arrow and a scale bar in feet", () => {
    expect(text).toContain('<text class="plss" x="18" y="38">SAMPLE: Sec. 14 T84N R23W</text>');
    expect(text).toContain('<text class="panel-text n"');
    for (const mark of [">0<", ">500<", ">1,000<", ">Feet<"]) expect(text).toContain(mark);
    // The map shows about 5,150 feet across, so a 1,000-foot bar is a fifth of it.
    expect(Math.round(ground.width / 0.3048)).toBeGreaterThan(5000);
    expect(scaleBarFeet(ground.width / 0.3048)).toBe(1000);
    expect([400, 1000, 2500, 12_000, 100_000].map(scaleBarFeet)).toEqual([50, 200, 500, 2000, 10_000]);
  });

  it("has the legend, the crop conventions, a short notice and the imagery credit", () => {
    for (const expected of [
      "Common Land Unit",
      "</svg>Cropland</div>",
      "</svg>Non-Cropland</div>",
      "</svg>Tract Boundary</div>",
      "</svg>PLSS (section, township, range)</div>",
      "<b>Unless otherwise noted:</b> shares are 100% operator, crops are non-irrigated, corn is yellow for grain.",
      "FSA maps are for FSA program administration only. This map is not a",
      "legal survey and does not show ownership",
      "Imagery: 2023 NAIP imagery, USDA National Agriculture Imagery Program (public domain).",
    ]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toMatch(/esri/i);
  });

  it("places longitude and latitude on the drawing: west and north are the top-left corner", () => {
    const corner = projector([-93.43, 42.08, -93.41, 42.1], 1400, 1000);
    expect(corner([-93.43, 42.1])).toEqual([0, 0]);
    expect(corner([-93.41, 42.08])).toEqual([1400, 1000]);
    expect(corner([-93.42, 42.09]).map((n) => Math.round(n))).toEqual([700, 500]);
  });

  it("can't be drawn without the aerial photo, or with a field that has no outline", () => {
    expect(() => renderDocument("fsa-map", doc)).toThrow("fsa-map is an FSA map, so it needs the aerial photo and the field outlines.");
    expect(() => renderDocument("fsa-map", doc, { ...map, fields: map.fields.slice(0, 1) })).toThrow(
      "fsa-map: farm 1234 tract 6012 field 1 has no outline in farm.geojson.",
    );
  });
});

describe("sample-data/print/README.md", () => {
  it("tells the person filling in ticket 3 exactly the answer-key values", () => {
    const readme = readFileSync(path.join(PRINT_DIR, "README.md"), "utf8");
    const v = documentsOfKind(file, "scale_ticket").find(([n]) => n === "ticket-3")?.[1].values;
    if (!v) throw new Error("no ticket-3");
    for (const [box, write] of handwrittenEntries(v)) expect(readme).toContain(`| ${box} | ${write} |`);
  });
});

describe("PDFs in sample-data/print", () => {
  it("are exactly one per document", () => {
    const pdfs = readdirSync(PRINT_DIR).filter((f) => f.endsWith(".pdf")).sort();
    expect(pdfs).toEqual(Object.keys(file.documents).map((n) => `${n}.pdf`).sort());
  });

  it.each(rendered.map((r) => [r.name, r] as const))(
    "%s.pdf is one page, matches the current data and layout, and has the fixed date",
    (name, page) => {
      const pdf = readFileSync(path.join(PRINT_DIR, `${name}.pdf`));
      expect(countPdfPages(pdf)).toBe(1);
      expect(pdfContains(pdf, page.hash), `${name}.pdf is out of date: run npm run print-docs`).toBe(true);
      expect(pdfContains(pdf, `D:${FIXED_PDF_DATE}`)).toBe(true);
    },
  );
});

describe("pdf helpers", () => {
  it("count pages without counting the page tree", () => {
    const fake = Buffer.from("<< /Type /Pages /Count 2 >> << /Type /Page >> << /Type/Page/Parent 1 0 R >>", "latin1");
    expect(countPdfPages(fake)).toBe(2);
  });

  it("swap the print time for the fixed date without changing the file's length", () => {
    const stamped = Buffer.from("/CreationDate (D:20261109053329+00'00')\n/ModDate (D:20261109053329+00'00')", "latin1");
    const fixed = withFixedDates(stamped);
    expect(fixed.length).toBe(stamped.length);
    expect(fixed.toString("latin1")).toBe(
      `/CreationDate (D:${FIXED_PDF_DATE}+00'00')\n/ModDate (D:${FIXED_PDF_DATE}+00'00')`,
    );
  });
});
