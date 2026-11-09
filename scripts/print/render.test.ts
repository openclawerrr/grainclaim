import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { documentsOfKind, loadDocumentsFile } from "./documents-file";
import { countPdfPages, FIXED_PDF_DATE, pdfContains, withFixedDates } from "./pdf";
import { esc, handwrittenEntries, renderDocument, time12, usDate } from "./render";

const file = loadDocumentsFile();
const rendered = Object.entries(file.documents).map(([name, doc]) => renderDocument(name, doc));
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
      for (const name of real) expect(page.html.toLowerCase()).not.toContain(name.toLowerCase());
    }
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
