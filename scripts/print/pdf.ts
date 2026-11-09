/**
 * Small checks on the PDFs Chrome writes. Chrome stores each page as an
 * uncompressed "/Type /Page" object and the page's <title> as the PDF title,
 * so both can be read from the raw bytes without a PDF library.
 */

/** Number of pages in a PDF written by Chrome. */
export function countPdfPages(pdf: Uint8Array): number {
  const text = Buffer.from(pdf).toString("latin1");
  return (text.match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
}

/** The date stamped into every sample PDF in place of the time it was printed. */
export const FIXED_PDF_DATE = "20260101000000";

/**
 * Chrome stamps the print time into each PDF, so reprinting an unchanged
 * document would still change the file. This swaps in a fixed date, digits
 * only, so the PDF's byte offsets stay valid and an unchanged document
 * reprints byte for byte.
 */
export function withFixedDates(pdf: Uint8Array): Buffer {
  const text = Buffer.from(pdf)
    .toString("latin1")
    .replace(/\/(CreationDate|ModDate) ?\(D:\d{14}/g, (match) => `${match.slice(0, -14)}${FIXED_PDF_DATE}`);
  return Buffer.from(text, "latin1");
}

/** True if the PDF's raw bytes contain `text`, such as the render hash in its title. */
export function pdfContains(pdf: Uint8Array, text: string): boolean {
  return Buffer.from(pdf).toString("latin1").includes(text);
}
