/**
 * npm run print-docs: turns sample-data/documents-2026.json into one-page
 * SAMPLE PDFs in sample-data/print/, using the Google Chrome installed on this
 * computer (no browser download). See sample-data/print/README.md.
 *
 * It checks the documents first and prints nothing if a value is wrong, and
 * it refuses to write a PDF that comes out longer than one page.
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { loadSampleFiles } from "../seed/sample-files";
import { findDocumentProblems } from "./checks";
import { loadDocumentsFile } from "./documents-file";
import { countPdfPages, withFixedDates } from "./pdf";
import { renderDocument } from "./render";

const OUT_DIR = path.resolve("sample-data", "print");

async function main(): Promise<void> {
  const file = loadDocumentsFile();
  const problems = findDocumentProblems(file, loadSampleFiles());
  if (problems.length > 0) {
    console.error(`sample-data/documents-2026.json has problems, so nothing was printed:\n- ${problems.join("\n- ")}`);
    process.exitCode = 1;
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome" }).catch((err: unknown) => {
    throw new Error(
      `Couldn't start Google Chrome. Install it from google.com/chrome, then run this again.\n${err instanceof Error ? err.message : String(err)}`,
    );
  });

  const tooLong: string[] = [];
  try {
    const page = await browser.newPage();
    for (const [name, doc] of Object.entries(file.documents)) {
      const rendered = renderDocument(name, doc);
      await page.setContent(rendered.html, { waitUntil: "load" });
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      const pages = countPdfPages(pdf);
      if (pages !== 1) {
        tooLong.push(`${name} came out ${pages} pages long`);
        continue;
      }
      writeFileSync(path.join(OUT_DIR, `${name}.pdf`), withFixedDates(pdf));
      console.log(`  sample-data/print/${name}.pdf`);
    }
  } finally {
    await browser.close();
  }

  const names = new Set(Object.keys(file.documents));
  const leftover = readdirSync(OUT_DIR).filter((f) => f.endsWith(".pdf") && !names.has(f.slice(0, -4)));
  if (leftover.length > 0) {
    console.warn(`These PDFs are not in documents-2026.json any more; delete them: ${leftover.join(", ")}`);
  }
  if (tooLong.length > 0) {
    console.error(`Not written, because every document must print on one page:\n- ${tooLong.join("\n- ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Printed ${names.size} documents. Reprint and re-photograph any that changed.`);
}

main().catch((err: unknown) => {
  console.error(`print-docs failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
