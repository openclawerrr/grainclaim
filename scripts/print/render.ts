/**
 * Turns each document in documents-2026.json into one printable HTML page.
 * Pure: values in, HTML out. index.ts prints the HTML to PDF with Chrome.
 *
 * Layouts:
 * - Scale tickets follow the blocks of Wisconsin's government SAMPLE scale
 *   ticket (sample-data/reference/), branded only as the fictional Main Street
 *   Elevator. Its Wisconsin legal text is replaced with SAMPLE notes and terms.
 * - The FSA-578 follows page 1 of the real blank form, with a large
 *   "not an official USDA form" banner.
 * - The Summary of Coverage and settlement are our own layouts (no public
 *   sample exists), with a fictional insurer and the fictional elevator.
 *
 * Every page says SAMPLE ONLY at the top and bottom and carries a faint
 * diagonal SAMPLE watermark, kept light so it doesn't spoil reading tests.
 */
import { createHash } from "node:crypto";
import type {
  Fsa578Doc,
  SampleDocument,
  SettlementDoc,
  SummaryOfCoverageDoc,
  TicketDoc,
  TicketValues,
} from "./documents-file";

export interface RenderedDocument {
  name: string;
  /** The PDF's title. Ends with `hash`, so a test can tell a stale PDF. */
  title: string;
  /** First 12 hex characters of the SHA-256 of the page's style and body. */
  hash: string;
  html: string;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITIES[c]);

const fixed = (n: number, digits: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const whole = (n: number) => fixed(n, 0);
const money = (n: number) => `${n < 0 ? "-" : ""}$${fixed(Math.abs(n), 2)}`;
const pct = (fraction: number) => `${fixed(fraction * 100, 0)}%`;

/** 2026-10-12 → 10/12/2026 (or 10-12-2026 with sep "-"). */
export function usDate(iso: string, sep = "/"): string {
  const [y, m, d] = iso.split("-");
  return [m, d, y].join(sep);
}

/** 13:15 → 1:15 PM */
export function time12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "SAMPLE: Main Street, Nevada, IA" → ["SAMPLE: Main Street", "Nevada, IA"] */
function addressLines(address: string): string[] {
  const i = address.indexOf(",");
  return i === -1 ? [address] : [address.slice(0, i), address.slice(i + 1).trim()];
}

const STATES: Record<string, string> = { IA: "Iowa" };
const PLANS: Record<string, string> = {
  RP: "Revenue Protection (RP)",
  "RP-HPE": "Revenue Protection with Harvest Price Exclusion (RP-HPE)",
  YP: "Yield Protection (YP)",
};
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

const LANDSCAPE = `@page { size: 11in 8.5in; margin: 0.4in 0.45in; }
.watermark span { font-size: 170pt; transform: rotate(-24deg); }`;
const PORTRAIT = `@page { size: 8.5in 11in; margin: 0.45in 0.55in; }
.watermark span { font-size: 125pt; transform: rotate(-52deg); }`;

const BASE_CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 9pt;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sample-top { text-align: center; font-size: 15pt; letter-spacing: 0.06em; margin: 0 0 6pt; }
.sample-bottom { position: fixed; left: 0; right: 0; bottom: 0; text-align: center;
  font-size: 15pt; letter-spacing: 0.06em; }
.sample-bottom .form-id { display: block; font-size: 7pt; letter-spacing: 0; margin-top: 2pt; }
.watermark { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
  pointer-events: none; z-index: 10; }
.watermark span { font-weight: 700; letter-spacing: 0.08em; color: rgba(190, 30, 30, 0.07); }
.typed { font-family: "Courier New", Courier, monospace; font-weight: 700; }
.small { font-size: 7.5pt; }
table { border-collapse: collapse; }
`;

function page(name: string, pageCss: string, css: string, body: string, formId: string): RenderedDocument {
  const style = `${pageCss}\n${BASE_CSS}\n${css}`;
  const fullBody = `
<div class="sample-top">SAMPLE ONLY</div>
${body}
<div class="sample-bottom">SAMPLE ONLY<span class="form-id">${esc(formId)}</span></div>
<div class="watermark" aria-hidden="true"><span>SAMPLE</span></div>`;
  const hash = createHash("sha256").update(style).update(fullBody).digest("hex").slice(0, 12);
  const title = `${name} SAMPLE ${hash}`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>${style}</style>
</head>
<body>${fullBody}
</body>
</html>
`;
  return { name, title, hash, html };
}

export function renderDocument(name: string, doc: SampleDocument): RenderedDocument {
  switch (doc.kind) {
    case "scale_ticket":
      return renderTicket(name, doc);
    case "fsa_578":
      return renderFsa578(name, doc);
    case "summary_of_coverage":
      return renderSummaryOfCoverage(name, doc);
    case "settlement":
      return renderSettlement(name, doc);
  }
}

// ---------------------------------------------------------------------------
// Scale ticket
// ---------------------------------------------------------------------------

const TICKET_CSS = `
.note { display: flex; gap: 14pt; margin: 2pt 0.4in 6pt; font-size: 9pt; }
.note em { font-style: italic; }
.shade-bar { background: #e6e6e6; text-align: center; font-weight: 700; font-size: 10.5pt;
  margin: 0 0.9in 6pt; padding: 3pt; }
.ticket { border: 4px double #111; padding: 4pt 6pt 6pt; }
.title-band { background: #e6e6e6; text-align: center; font-size: 15pt; font-weight: 700;
  padding: 2pt 0; margin-bottom: 4pt; letter-spacing: 0.02em; }
.title-band small { font-size: 8pt; font-weight: 400; letter-spacing: 0; }
.top { display: grid; grid-template-columns: 1.15fr 1fr 1fr; gap: 10pt; align-items: start; }
.entity { font-size: 10.5pt; line-height: 1.45; }
.entity-name { font-weight: 700; font-size: 13pt; letter-spacing: 0.03em; }
.receipt-title { text-align: center; font-weight: 700; font-size: 11pt; margin-bottom: 3pt; }
.number { text-align: right; font-size: 11pt; margin-bottom: 3pt; }
.number .typed { font-size: 14pt; margin-left: 6pt; letter-spacing: 0.04em; }
.box { border: 1.2px solid #111; padding: 4pt 6pt; background: #f2f2f2; }
.line { display: flex; align-items: flex-end; gap: 5pt; min-height: 27pt; font-size: 10pt; }
.check { display: flex; align-items: baseline; gap: 6pt; min-height: 21pt; font-size: 10pt; }
.line + .check { margin-top: 7pt; }
.paren { font-family: "Courier New", Courier, monospace; font-weight: 700; font-size: 12pt; white-space: pre; }
.v { flex: 1; border-bottom: 1px solid #111; min-height: 17pt; padding: 0 3pt;
  font-family: "Courier New", Courier, monospace; font-weight: 700; font-size: 12.5pt; white-space: nowrap; }
.v.blank { min-height: 24pt; }
.unit { font-size: 9pt; }
.parties { display: grid; grid-template-columns: 2.2fr 1.4fr 0.9fr; gap: 14pt; margin: 6pt 0 8pt; }
.parties .line { font-size: 10.5pt; }
.bottom { display: grid; grid-template-columns: 1fr 1.15fr; gap: 10pt; }
.terms { background: #e6e6e6; padding: 6pt 8pt; font-size: 9pt; line-height: 1.4;
  display: flex; flex-direction: column; gap: 6pt; }
.terms p { margin: 0; }
.weigher { margin-top: auto; }
.weights, .grading { background: #fff; }
.weights table, .grading table { width: 100%; }
.weights td, .grading td { padding: 3pt 4pt; font-size: 9pt; vertical-align: bottom; }
.weights td.label, .grading td.label { white-space: nowrap; width: 1%; text-align: right; }
.weights td.cell, .grading td.cell { border-bottom: 1px solid #111; font-family: "Courier New", Courier, monospace;
  font-weight: 700; font-size: 13pt; text-align: right; padding-right: 6pt; height: 30pt; }
.weights td.u, .grading td.u { width: 1%; white-space: nowrap; }
.driver { text-align: right; font-size: 10pt; margin-bottom: 2pt; }
.grading { margin-top: 6pt; }
.grading-title { text-align: center; font-size: 10.5pt; margin: 2pt 0 4pt; letter-spacing: 0.02em; }
`;

function renderTicket(name: string, doc: TicketDoc): RenderedDocument {
  const v: TicketValues = doc.values;
  // The hand-filled ticket prints only what a pre-numbered ticket book would:
  // the elevator, the labels, the number and the terms.
  const blank = doc.filled_in === "by_hand";
  const val = (text: string) => (blank ? `<span class="v blank"></span>` : `<span class="v">${esc(text)}</span>`);
  const cell = (text: string) => `<td class="cell">${blank ? "" : esc(text)}</td>`;
  const box = (checked: boolean) => `<span class="paren">(${!blank && checked ? "X" : " "})</span>`;
  const [addr1, addr2] = addressLines(v.buyer_address);

  const body = `
<div class="note"><span>* NOTE *</span><em>This is a SAMPLE scale ticket made up for the GrainClaim demo.
${esc(v.buyer_name)}, ${esc(v.customer)} and every value on it are fictional.</em></div>
<div class="shade-bar">SAMPLE ONLY: not a receipt for real grain.</div>
<div class="ticket">
  <div class="title-band">SCALE TICKET</div>
  <div class="top">
    <div class="entity">
      <div class="entity-name">${esc(v.buyer_name.toUpperCase())}</div>
      <div>${esc(addr1)}</div>
      ${addr2 ? `<div>${esc(addr2)}</div>` : ""}
      <div class="line">Location: <span class="v${blank ? " blank" : ""}"></span></div>
    </div>
    <div>
      <div class="receipt-title">Receipt for Grain</div>
      <div class="box">
        <div class="line">Date: ${val(usDate(v.ticket_date))}</div>
        <div class="line">Time In: ${val(time12(v.ticket_time))}</div>
        <div class="check">${box(v.direction === "in")} Received / In</div>
        <div class="check">${box(v.direction === "out")} Withdrawn / Out</div>
      </div>
    </div>
    <div>
      <div class="number">NUMBER <span class="typed">${esc(v.ticket_number)}</span></div>
      <div class="box">
        <div class="check">${box(v.purchase_type === "storage")} STORAGE</div>
        <div class="check">${box(v.purchase_type === "spot")} SPOT PURCHASE</div>
        <div class="check">${box(v.purchase_type === "contract")} CONTRACT PURCHASE</div>
        <div class="line">Contract No. ${val(v.contract_number ?? "")}</div>
      </div>
    </div>
  </div>
  <div class="parties">
    <div class="line">Customer: ${val(v.customer)}</div>
    <div class="line">Grain: ${val(v.grain)}</div>
    <div class="line">Truck No. ${val(v.truck_number)}</div>
  </div>
  <div class="bottom">
    <div class="terms">
      <p>${esc(v.buyer_name)} (SAMPLE) is a made-up business for the GrainClaim demo. This ticket is not a receipt for real grain.</p>
      <p><b>Moisture shrink:</b> ${fixed(v.shrink_pct_per_point, 1)}% per point of moisture over ${fixed(v.base_moisture_pct, 1)}%.
      Dry bushels = bushels &times; (1 &minus; shrink).</p>
      <p>Contract grain is paid at the contract price on the settlement statement, less drying charges and the corn checkoff.</p>
      <div class="line weigher">WEIGHER: ${val(v.weigher)}</div>
    </div>
    <div>
      <div class="box weights">
        <div class="driver">Driver: ${box(v.driver_on)} ON &nbsp; ${box(!v.driver_on)} OFF</div>
        <table>
          <tr><td class="label">GROSS WEIGHT</td>${cell(whole(v.gross_lbs))}<td class="u">lb</td><td></td><td></td><td></td></tr>
          <tr><td class="label">TARE WEIGHT</td>${cell(whole(v.tare_lbs))}<td class="u">lb</td><td></td><td></td><td></td></tr>
          <tr><td class="label">NET WEIGHT</td>${cell(whole(v.net_lbs))}<td class="u">lb</td>
            <td class="label">BUSHELS</td>${cell(fixed(v.wet_bu, 2))}<td class="u"></td></tr>
        </table>
      </div>
      <div class="box grading">
        <div class="grading-title">QUALITY &amp; GRADING FACTORS</div>
        <table>
          <tr><td class="label">TEST WEIGHT</td>${cell(fixed(v.test_weight, 1))}<td class="u">lb</td>
            <td class="label">FOREIGN MATERIAL</td>${cell(fixed(v.foreign_material_pct, 1))}<td class="u">%</td></tr>
          <tr><td class="label">MOISTURE</td>${cell(fixed(v.moisture_pct, 1))}<td class="u">%</td>
            <td class="label">DAMAGE</td>${cell(fixed(v.damage_pct, 1))}<td class="u">%</td></tr>
          ${
            v.dockage_pct === null
              ? ""
              : `<tr><td class="label">DOCKAGE</td>${cell(fixed(v.dockage_pct, 1))}<td class="u">%</td><td></td><td></td><td></td></tr>`
          }
          <tr><td class="label">SHRINK</td>${cell(fixed(v.shrink_pct, 2))}<td class="u">%</td>
            <td class="label">DRY BUSHELS</td>${cell(fixed(v.elevator_dry_bu, 2))}<td class="u"></td></tr>
        </table>
      </div>
    </div>
  </div>
</div>`;

  return page(name, LANDSCAPE, TICKET_CSS, body, `${v.buyer_name} SAMPLE ticket form (GrainClaim demo)`);
}

const PURCHASE_LABELS: Record<TicketValues["purchase_type"], string> = {
  storage: "STORAGE",
  spot: "SPOT PURCHASE",
  contract: "CONTRACT PURCHASE",
};

/**
 * What to write on a hand-filled ticket, box by box, exactly as
 * sample-data/print/README.md lists it (a test keeps the two in step).
 */
export function handwrittenEntries(v: TicketValues): [box: string, write: string][] {
  return [
    ["Date", usDate(v.ticket_date)],
    ["Time In", time12(v.ticket_time)],
    [v.direction === "in" ? "Received / In" : "Withdrawn / Out", "X"],
    [PURCHASE_LABELS[v.purchase_type], "X"],
    ["Contract No.", v.contract_number ?? "(leave blank)"],
    ["Customer", v.customer],
    ["Grain", v.grain],
    ["Truck No.", v.truck_number],
    [`Driver ${v.driver_on ? "ON" : "OFF"}`, "X"],
    ["Gross weight", whole(v.gross_lbs)],
    ["Tare weight", whole(v.tare_lbs)],
    ["Net weight", whole(v.net_lbs)],
    ["Bushels", fixed(v.wet_bu, 2)],
    ["Test weight", fixed(v.test_weight, 1)],
    ["Moisture", fixed(v.moisture_pct, 1)],
    ["Foreign material", fixed(v.foreign_material_pct, 1)],
    ["Damage", fixed(v.damage_pct, 1)],
    ["Shrink", fixed(v.shrink_pct, 2)],
    ["Dry bushels", fixed(v.elevator_dry_bu, 2)],
    ["Weigher", v.weigher],
  ];
}

// ---------------------------------------------------------------------------
// FSA-578
// ---------------------------------------------------------------------------

const FSA_CSS = `
.sample-top { margin-bottom: 2pt; }
.fsa-head { display: grid; grid-template-columns: 1.3fr 1.6fr 1.1fr 0.55fr; border: 1px solid #111; border-bottom: 0; }
.fsa-head > div { padding: 3pt 5pt; }
.formid { font-weight: 700; font-size: 11pt; }
.fsa-title { text-align: center; }
.fsa-title .t { font-size: 13pt; font-weight: 700; letter-spacing: 0.08em; }
.banner { display: inline-block; margin-top: 3pt; border: 2px solid #b11; color: #b11; font-weight: 700;
  font-size: 12pt; padding: 2pt 8pt; letter-spacing: 0.02em; white-space: nowrap; }
.usda { text-align: right; font-size: 8.5pt; line-height: 1.3; }
.usda b { font-size: 9pt; }
.pagebox { border-left: 1px solid #111; font-size: 8pt; }
.pagebox .typed { font-size: 10pt; }
table.fsa { width: 100%; table-layout: fixed; }
table.fsa td, table.fsa th { border: 1px solid #111; padding: 1.5pt 3pt; vertical-align: top; }
table.fsa th { font-weight: 400; font-size: 6.8pt; text-align: center; line-height: 1.15; }
table.fsa td { height: 15pt; }
.fsa .typed { font-size: 10.5pt; }
.lbl { font-size: 6.8pt; display: block; }
.key1 { font-size: 6.8pt; }
.key1 .big { display: block; font-size: 18pt; font-weight: 700; text-align: center; margin-top: 4pt; }
.operator { display: grid; grid-template-columns: 0.55in 1fr; height: 100%; }
.operator > div:first-child { border-right: 1px solid #111; padding-right: 3pt; }
.operator > div:last-child { padding-left: 5pt; }
table.grid td.sub { height: 13pt; }
table.grid td.det { border: 2px solid #111; }
table.grid td.c, table.grid th.c { text-align: center; vertical-align: middle; }
table.grid td.acres { text-align: right; vertical-align: middle; padding: 1pt 2pt; }
table.grid td.acres .typed { font-size: 9.5pt; }
table.grid tr.field td { height: 17pt; }
table.cert .typed { font-size: 9.5pt; white-space: nowrap; }
.crop .typed { font-size: 10.5pt; }
.crop .small { display: block; font-size: 6.5pt; line-height: 1.2; }
td.black { background: #111; }
table.cert td { font-size: 6.6pt; line-height: 1.25; }
.sig { font-family: "Bradley Hand", "Segoe Script", "Snell Roundhand", cursive; font-size: 13pt; display: block;
  margin-top: 3pt; white-space: nowrap; }
.codes { font-size: 6.3pt; line-height: 1.2; }
`;

function renderFsa578(name: string, doc: Fsa578Doc): RenderedDocument {
  const v = doc.values;
  const typed = (s: string) => `<span class="typed">${esc(s)}</span>`;
  const crops = [...new Set(v.fields.map((f) => f.crop))];
  const SUMMARY_COLUMNS = 10;
  const ROWS = 5;
  const share = (n: number) => fixed(n, 4);

  const producerRows = Array.from({ length: 4 }, (_, i) => v.other_producers[i]);
  const producerCells = (p: (typeof producerRows)[number]) =>
    p
      ? `<td class="c">${typed(p.key)}</td><td>${typed(p.name.toUpperCase())}</td><td></td><td></td>`
      : `<td></td><td></td><td></td><td></td>`;

  const summaryHeader = Array.from({ length: SUMMARY_COLUMNS }, (_, i) =>
    `<th class="c">${crops[i] ? typed(crops[i].toUpperCase()) : ""}</th>`,
  ).join("");

  const fieldRows = Array.from({ length: ROWS }, (_, i) => {
    const f = v.fields[i];
    const upper = Array.from({ length: SUMMARY_COLUMNS }, (_, c) =>
      `<td class="sub acres">${f && crops[c] === f.crop ? typed(fixed(f.reported_acres, 2)) : ""}</td>`,
    ).join("");
    const lower = Array.from({ length: SUMMARY_COLUMNS }, () => `<td class="sub det"></td>`).join("");
    const crop = f
      ? `${typed(f.crop.toUpperCase())}<span class="small">${esc(f.crop_type)} / ${esc(f.intended_use)}</span>` +
        `<span class="small">Planted ${esc(usDate(f.planting_date, "-"))}</span>`
      : "";
    return `
<tr class="field">
  <td rowspan="2" class="c">${f ? typed(f.tract) : ""}</td>
  <td rowspan="2" class="c">${f ? typed(f.field) : ""}</td>
  <td rowspan="2" class="crop">${crop}</td>
  <td rowspan="2" class="c">${f ? typed(f.practice) : ""}</td>
  <td class="sub c">${f ? typed(f.crop_status) : ""}</td>
  ${upper}
  <td rowspan="2" class="c">${f ? f.shares.map((s) => typed(s.key)).join("<br>") : ""}</td>
  <td rowspan="2" class="c">${f ? f.shares.map((s) => typed(share(s.share))).join("<br>") : ""}</td>
</tr>
<tr><td class="sub"></td>${lower}</tr>`;
  }).join("");

  const totals = Array.from({ length: SUMMARY_COLUMNS }, (_, c) =>
    `<td class="sub acres">${c === 0 ? typed(fixed(v.total_operator_report, 2)) : ""}</td>`,
  ).join("");
  const determined = Array.from({ length: SUMMARY_COLUMNS }, () => `<td class="sub det"></td>`).join("");

  const body = `
<div class="fsa-head">
  <div>
    <div class="small"><b>SAMPLE: made up for the GrainClaim demo.</b></div>
    <div class="formid">FSA-578 (SAMPLE)</div>
    <div class="small">Layout copied from the blank FSA-578 (08-22-19). See page 2 of the real form for the Privacy Act statement.</div>
  </div>
  <div class="fsa-title">
    <div class="t">REPORT OF ACREAGE</div>
    <div class="banner">SAMPLE: NOT AN OFFICIAL USDA FORM</div>
  </div>
  <div class="usda"><b>U.S. Department of Agriculture</b><br>Farm Service Agency</div>
  <div class="pagebox">PAGE ${typed("1")}<br><br>OF ${typed("1")}</div>
</div>
<table class="fsa">
  <colgroup><col style="width:12%"><col style="width:12%"><col style="width:12%"><col style="width:13%">
    <col style="width:6%"><col style="width:23%"><col style="width:11%"><col style="width:11%"></colgroup>
  <tr><th>1.<br>FARM NO.</th><th>2.<br>FARMLAND</th><th>3.<br>CROPLAND</th><th>4.<br>PROGRAM YR.</th>
    <th>7.<br>KEY</th><th>8.<br>NAMES OF OTHER PRODUCERS</th><th>9.<br>ID NUMBER</th><th>10.<br>OTHER FARMS</th></tr>
  <tr><td class="c">${typed(v.farm_number)}</td><td class="c">${typed(fixed(v.farmland_acres, 2))}</td>
    <td class="c">${typed(fixed(v.cropland_acres, 2))}</td><td class="c">${typed(String(v.program_year))}</td>
    ${producerCells(producerRows[0])}</tr>
  <tr>
    <td colspan="3" rowspan="2" style="padding:0">
      <div class="operator">
        <div class="key1">KEY<span class="big">${esc(v.operator.key)}</span></div>
        <div><span class="lbl">5. OPERATOR NAME AND ADDRESS</span>${typed(v.operator.name.toUpperCase())}<br>
          ${addressLines(v.operator.address).map((l) => typed(l.toUpperCase())).join("<br>")}</div>
      </div>
    </td>
    <td rowspan="2"><span class="lbl">6. OTHER FARMS</span></td>
    ${producerCells(producerRows[1])}
  </tr>
  <tr>${producerCells(producerRows[2])}</tr>
  <tr><td colspan="4"><span class="lbl">11. PHOTO NO. - LEGAL DESCRIPTION</span></td>${producerCells(producerRows[3])}</tr>
</table>
<table class="fsa grid">
  <colgroup><col style="width:6%"><col style="width:5.5%"><col style="width:11%"><col style="width:5.5%"><col style="width:6%">
    ${Array.from({ length: SUMMARY_COLUMNS }, () => `<col style="width:5.3%">`).join("")}
    <col style="width:5%"><col style="width:8%"></colgroup>
  <tr>
    <th rowspan="2">12<br>TRACT<br>NO.</th><th rowspan="2">13.<br>FIELD<br>NO.</th><th rowspan="2">14.<br>CROP OR LAND USE</th>
    <th rowspan="2">15.<br>PRAC-<br>TICE 1/</th><th rowspan="2">16.<br>CROP<br>STATUS<br>2/</th>
    <th colspan="${SUMMARY_COLUMNS}">17. CROP OR LAND USE SUMMARY <i>(Maple trees, after number enter "T"; Honey, after number enter "H")</i></th>
    <th rowspan="2">18.<br>KEY</th><th rowspan="2">19.<br>SHARE</th>
  </tr>
  <tr>${summaryHeader}</tr>
  ${fieldRows}
  <tr><td colspan="5" class="sub"><span class="lbl">20. TOTAL OPERATOR REPORT</span></td>${totals}<td colspan="2" rowspan="2" class="black"></td></tr>
  <tr><td colspan="5" class="sub"><span class="lbl">21. TOTAL DETERMINED ACREAGE</span></td>${determined}</tr>
</table>
<table class="fsa cert">
  <colgroup><col style="width:15%"><col style="width:10.5%"><col style="width:15%"><col style="width:10.5%"><col style="width:15%"><col style="width:10.5%"><col style="width:23.5%"></colgroup>
  <tr>
    <td colspan="6"><b>22. CERTIFICATION</b> - <i>I certify to the best of my knowledge and belief that the acreage of crops/commodities and land uses listed herein are true and correct and that all required crops/commodities and land uses have been reported for the farms as applicable.</i> (SAMPLE: certification text shortened.)</td>
    <td class="codes">1/ I = Irrigated &nbsp; N = Nonirrigated<br>O = Other (Honey or Maple Sap)</td>
  </tr>
  <tr>
    <td><span class="lbl">A. CERTIFIER'S SIGNATURE</span><span class="sig">${esc(v.certified_by)}</span></td>
    <td><span class="lbl">B. DATE (MM-DD-YYYY)</span>${typed(usDate(v.certification_date, "-"))}</td>
    <td><span class="lbl">A. CERTIFIER'S SIGNATURE (BY)</span></td>
    <td><span class="lbl">B. DATE (MM-DD-YYYY)</span></td>
    <td><span class="lbl">A. CERTIFIER'S SIGNATURE (BY)</span></td>
    <td><span class="lbl">B. DATE (MM-DD-YYYY)</span></td>
    <td class="codes">2/ I = Initial, P = Prevented, F = Failed, S = Subsequent Crop, D = Double Crop, R = Repeat,
      V = Volunteer, E = Experimental, IF = Initial Failed, IP = Initial Prevented, SF = Subsequent Failed,
      DF = Double-cropped Failed, DP = Double-cropped Prevented</td>
  </tr>
</table>`;

  return page(name, LANDSCAPE, FSA_CSS, body, "FSA-578 SAMPLE for the GrainClaim demo. Not an official USDA form.");
}

// ---------------------------------------------------------------------------
// Summary of Coverage
// ---------------------------------------------------------------------------

const DOC_CSS = `
body { font-size: 9.5pt; }
.head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111;
  padding-bottom: 8pt; margin-bottom: 10pt; }
.org { font-size: 17pt; font-weight: 700; letter-spacing: 0.02em; }
.doc-title { text-align: right; line-height: 1.45; }
.doc-title .t { font-size: 14pt; font-weight: 700; letter-spacing: 0.06em; }
.boxes { display: grid; gap: 8pt; margin-bottom: 10pt; }
.boxes > div { border: 1px solid #111; padding: 5pt 7pt; line-height: 1.4; }
.label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.05em; color: #333; }
.val { font-weight: 700; font-size: 10.5pt; }
h2 { font-size: 10pt; text-transform: uppercase; letter-spacing: 0.05em; margin: 12pt 0 4pt; }
table.data { width: 100%; }
table.data th, table.data td { border: 1px solid #111; padding: 4pt 5pt; }
table.data th { background: #e8e8e8; font-size: 7.8pt; text-align: center; font-weight: 700; }
table.data td.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
table.data td.c { text-align: center; white-space: nowrap; }
table.data tr.total td { font-weight: 700; background: #f2f2f2; }
table.terms { width: 100%; }
table.terms td { border: 1px solid #111; padding: 4pt 6pt; width: 25%; vertical-align: top; }
.notes { margin-top: 12pt; font-size: 8.5pt; line-height: 1.45; }
.notes p { margin: 0 0 5pt; }
table.amounts { margin-left: auto; width: 62%; margin-top: 10pt; }
table.amounts td { padding: 4pt 6pt; border-bottom: 1px solid #bbb; }
table.amounts td.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
table.amounts tr.net td { border-top: 2px solid #111; border-bottom: 3px double #111; font-weight: 700; font-size: 11pt; }
`;

function renderSummaryOfCoverage(name: string, doc: SummaryOfCoverageDoc): RenderedDocument {
  const v = doc.values;
  const unitRows = v.units
    .map(
      (u) => `
<tr>
  <td class="c">${esc(u.unit_number)}</td>
  <td class="c">${esc(capitalize(u.unit_type))}</td>
  <td class="c">${esc(`${u.fsa_farm} / ${u.fsa_tract} / ${u.fsa_field}`)}</td>
  <td class="c">${esc(capitalize(u.practice))}</td>
  <td class="n">${fixed(u.acres, 2)}</td>
  <td class="n">${fixed(u.insured_share, 4)}</td>
  <td class="n">${whole(u.approved_yield)}</td>
  <td class="n">${fixed(u.guarantee_bu_per_acre, 1)}</td>
  <td class="n">${whole(u.guarantee_bu)}</td>
  <td class="n">${money(u.liability).replace(".00", "")}</td>
</tr>`,
    )
    .join("");

  const body = `
<div class="head">
  <div>
    <div class="org">${esc(v.insurer)}</div>
    <div class="small">A fictional insurer made up for the GrainClaim demo (SAMPLE)</div>
    <div class="small">Agent: ${esc(v.agency)}</div>
  </div>
  <div class="doc-title">
    <div class="t">SUMMARY OF COVERAGE</div>
    <div>Crop Year ${v.crop_year}</div>
    <div>Issued ${usDate(v.issued_date, "-")}</div>
  </div>
</div>
<div class="boxes" style="grid-template-columns: 1.5fr 1fr">
  <div><div class="label">Insured</div><div class="val">${esc(v.insured_name)}</div>
    ${addressLines(v.insured_address).map((l) => `<div>${esc(l)}</div>`).join("")}</div>
  <div><div class="label">Policy number</div><div class="val">${esc(v.policy_number)}</div>
    <div class="label" style="margin-top:4pt">Agent</div><div>${esc(v.agency)}</div></div>
</div>
<h2>Coverage</h2>
<table class="terms">
  <tr>
    <td><div class="label">State / County</div><div class="val">${esc(STATES[v.state] ?? v.state)} / ${esc(v.county)}</div></td>
    <td><div class="label">Crop / Type</div><div class="val">${esc(capitalize(v.crop))} / ${esc(v.crop_type)}</div></td>
    <td><div class="label">Plan</div><div class="val">${esc(PLANS[v.plan] ?? v.plan)}</div></td>
    <td><div class="label">Unit structure</div><div class="val">${esc(capitalize(v.unit_structure))} units</div></td>
  </tr>
  <tr>
    <td><div class="label">Coverage level</div><div class="val">${pct(v.coverage_level)}</div></td>
    <td><div class="label">Price election</div><div class="val">${pct(v.price_election)}</div></td>
    <td><div class="label">Projected price</div><div class="val">${money(v.projected_price)} per bushel</div></td>
    <td><div class="label">Crop year</div><div class="val">${v.crop_year}</div></td>
  </tr>
</table>
<h2>Units</h2>
<table class="data">
  <tr><th>Unit</th><th>Unit type</th><th>FSA farm / tract / field</th><th>Practice</th><th>Acres</th><th>Share</th>
    <th>Approved yield (bu/acre)</th><th>Guarantee (bu/acre)</th><th>Guarantee (bu)</th><th>Liability</th></tr>
  ${unitRows}
  <tr class="total"><td colspan="4">Total</td><td class="n">${fixed(v.total_acres, 2)}</td><td></td><td></td><td></td>
    <td class="n">${whole(v.total_guarantee_bu)}</td><td class="n">${money(v.total_liability).replace(".00", "")}</td></tr>
</table>
<div class="notes">
  <p><b>How these are figured.</b> Guarantee (bu) = approved yield &times; coverage level &times; acres &times; share.
    Liability = guarantee &times; projected price &times; price election. Revenue Protection pays on the higher of the
    projected and harvest prices.</p>
  <p><b>Check your acres.</b> Acres shown are the acres on file with us for each unit. If they differ from your FSA-578,
    tell your agent before harvest.</p>
  <p><b>SAMPLE.</b> This summary was made up for the GrainClaim demo. It is not a policy, and ${esc(v.insurer)} and
    ${esc(v.agency)} are fictional.</p>
</div>`;

  return page(name, PORTRAIT, DOC_CSS, body, `${v.insurer} SAMPLE Summary of Coverage (GrainClaim demo)`);
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

function renderSettlement(name: string, doc: SettlementDoc): RenderedDocument {
  const v = doc.values;
  const [addr1, addr2] = addressLines(v.buyer_address);
  const lines = v.tickets
    .map(
      (t) => `
<tr>
  <td class="c">${esc(t.ticket_number)}</td>
  <td class="c">${usDate(t.ticket_date)}</td>
  <td class="n">${whole(t.net_lbs)}</td>
  <td class="n">${fixed(t.moisture_pct, 1)}</td>
  <td class="n">${fixed(t.wet_bu, 2)}</td>
  <td class="n">${fixed(t.shrink_pct, 2)}</td>
  <td class="n">${fixed(t.elevator_dry_bu, 2)}</td>
  <td class="n">${money(t.drying_charge)}</td>
</tr>`,
    )
    .join("");

  const body = `
<div class="head">
  <div>
    <div class="org">${esc(v.buyer_name.toUpperCase())}</div>
    <div>${esc(addr1)}</div>${addr2 ? `<div>${esc(addr2)}</div>` : ""}
  </div>
  <div class="doc-title">
    <div class="t">SETTLEMENT STATEMENT</div>
    <div>Settlement No. <b>${esc(v.settlement_number)}</b></div>
    <div>Date <b>${usDate(v.settlement_date)}</b></div>
    <div>Check No. <b>${esc(v.check_number)}</b></div>
  </div>
</div>
<div class="boxes" style="grid-template-columns: 1fr 1fr">
  <div><div class="label">Customer</div><div class="val">${esc(v.customer)}</div>
    ${addressLines(v.customer_address).map((l) => `<div>${esc(l)}</div>`).join("")}</div>
  <div><div class="label">Contract</div><div class="val">${esc(v.contract_number)}</div>
    <div>${esc(v.contract_type)}, ${esc(v.grain)}</div></div>
</div>
<table class="terms">
  <tr>
    <td><div class="label">Futures (${esc(v.futures_month)})</div><div class="val">${money(v.futures_price)}</div></td>
    <td><div class="label">Basis</div><div class="val">${money(v.basis)}</div></td>
    <td><div class="label">Price</div><div class="val">${money(v.price_per_bu)} per bushel</div></td>
    <td><div class="label">Tickets settled</div><div class="val">${v.tickets.length}</div></td>
  </tr>
  <tr>
    <td colspan="2"><div class="label">Moisture shrink</div>${fixed(v.shrink_pct_per_point, 1)}% per point over ${fixed(v.base_moisture_pct, 1)}%</td>
    <td><div class="label">Drying</div>${fixed(v.drying_per_point * 100, 1)}&cent; per point over ${fixed(v.base_moisture_pct, 1)}%, per wet bushel</td>
    <td><div class="label">Corn checkoff</div>${money(v.checkoff_per_bu)} per bushel</td>
  </tr>
</table>
<h2>Tickets</h2>
<table class="data">
  <tr><th>Ticket</th><th>Date</th><th>Net lb</th><th>Moisture %</th><th>Wet bu</th><th>Shrink %</th><th>Dry bu</th><th>Drying</th></tr>
  ${lines}
  <tr class="total"><td colspan="2">Totals</td><td class="n">${whole(v.total_net_lbs)}</td><td></td>
    <td class="n">${fixed(v.total_wet_bu, 2)}</td><td></td><td class="n">${fixed(v.total_dry_bu, 2)}</td>
    <td class="n">${money(v.drying_total)}</td></tr>
</table>
<table class="amounts">
  <tr><td>Gross value (${fixed(v.total_dry_bu, 2)} bu &times; ${money(v.price_per_bu)})</td><td class="n">${money(v.gross_amount)}</td></tr>
  <tr><td>Less drying</td><td class="n">${money(-v.drying_total)}</td></tr>
  <tr><td>Less corn checkoff (${fixed(v.total_dry_bu, 2)} bu &times; ${money(v.checkoff_per_bu)})</td><td class="n">${money(-v.checkoff_total)}</td></tr>
  <tr class="net"><td>Net payment to ${esc(v.payee)}</td><td class="n">${money(v.net_payment)}</td></tr>
</table>
<div class="notes">
  <p>Paid by check No. ${esc(v.check_number)} to ${esc(v.payee)}.</p>
  <p><b>SAMPLE.</b> ${esc(v.buyer_name)} is fictional. This settlement was made up for the GrainClaim demo.</p>
</div>`;

  return page(name, PORTRAIT, DOC_CSS, body, `${v.buyer_name} SAMPLE settlement (GrainClaim demo)`);
}
