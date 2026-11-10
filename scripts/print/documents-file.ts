/**
 * Reads sample-data/documents-2026.json: every value printed on Dave's 2026
 * sample documents, and the answer key for the reading tests. Documents are
 * keyed by name; each one prints to sample-data/print/<name>.pdf and, if it's
 * photographed, is saved as sample-data/photos/<name>.jpg.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CROPS } from "../../lib/rules/crops";

/** A number with at most `places` decimals, as printed. */
const decimals = (places: number) =>
  z.number().refine((v) => Math.abs(v * 10 ** places - Math.round(v * 10 ** places)) < 1e-6, {
    message: `can have at most ${places} decimal places`,
  });

const isoDate = z.iso.date();
const time24 = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "use 24-hour HH:MM, such as 13:15");
const markedSample = z.string().includes("SAMPLE");

// ---------------------------------------------------------------------------
// Scale ticket
// ---------------------------------------------------------------------------

const ticketValues = z.object({
  buyer_name: z.string().min(1),
  buyer_address: markedSample,
  ticket_number: z.string().regex(/^\d+$/),
  ticket_date: isoDate,
  /** Printed time in. Tickets link to the field being harvested at this date and time. */
  ticket_time: time24,
  direction: z.enum(["in", "out"]),
  purchase_type: z.enum(["storage", "spot", "contract"]),
  contract_number: z.string().min(1).nullable(),
  customer: markedSample,
  /** As printed, e.g. "Yellow Corn". */
  grain: z.string().min(1),
  /** What GrainClaim calls the grain. */
  crop: z.enum(CROPS),
  truck_number: z.string().min(1),
  driver_on: z.boolean(),
  gross_lbs: z.number().int().positive(),
  tare_lbs: z.number().int().positive(),
  net_lbs: z.number().int().positive(),
  wet_bu: decimals(2),
  test_weight: decimals(1),
  moisture_pct: decimals(1),
  foreign_material_pct: decimals(1),
  damage_pct: decimals(1),
  /** Corn tickets don't print dockage, so a reader should return null. */
  dockage_pct: decimals(1).nullable(),
  base_moisture_pct: decimals(1),
  shrink_pct_per_point: decimals(2),
  /** This load's shrink: shrink per point × points over the base moisture. */
  shrink_pct: decimals(2),
  elevator_dry_bu: decimals(2),
  weigher: z.string().min(1),
});
export type TicketValues = z.infer<typeof ticketValues>;

const ticketDoc = z.object({
  kind: z.literal("scale_ticket"),
  delivery: z.literal("photo"),
  /** "by_hand": the PDF is the blank form, and the values are written on it by hand. */
  filled_in: z.enum(["printed", "by_hand"]),
  values: ticketValues,
});
export type TicketDoc = z.infer<typeof ticketDoc>;

// ---------------------------------------------------------------------------
// FSA map (the aerial photo of a farm with its fields outlined and numbered)
// ---------------------------------------------------------------------------

const fsaMapField = z.object({
  field: z.string().min(1),
  /** The acres printed in the field's label. */
  acres: decimals(2).pipe(z.number().positive()),
  /** Highly erodible land status, as printed in the label: NHEL is "not highly erodible", UHEL "undetermined". */
  hel: z.enum(["HEL", "NHEL", "UHEL"]),
  land_use: z.enum(["cropland", "non_cropland"]),
});

const fsaMapTract = z.object({
  tract: z.string().min(1),
  /** The tract's cropland total, as printed: its cropland fields added up. */
  cropland_acres: decimals(2),
  fields: z.array(fsaMapField).min(1),
});

const fsaMapDoc = z.object({
  kind: z.literal("fsa_map"),
  delivery: z.literal("photo"),
  values: z.object({
    program_year: z.number().int(),
    farm_number: z.string().min(1),
    state: z.string().length(2),
    county: z.string().min(1),
    map_created_date: isoDate,
    tracts: z.array(fsaMapTract).min(1),
    /** The section, township and range printed on the map. Made up. */
    plss_label: markedSample,
    /** The aerial photo's year and program, as the credit line starts. */
    imagery_credit: z.string().regex(/^\d{4} NAIP imagery$/, 'write it like "2023 NAIP imagery"'),
  }),
});
export type FsaMapDoc = z.infer<typeof fsaMapDoc>;

// ---------------------------------------------------------------------------
// FSA-578 (Report of Acreage)
// ---------------------------------------------------------------------------

const fsaShare = z.object({
  key: z.string().min(1),
  share: decimals(4).pipe(z.number().gt(0).max(1)),
});

const fsaField = z.object({
  tract: z.string().min(1),
  field: z.string().min(1),
  crop: z.enum(CROPS),
  crop_type: z.string().min(1),
  intended_use: z.string().min(1),
  practice: z.enum(["I", "N", "O"]),
  crop_status: z.enum(["I", "P", "F", "S", "D", "R", "V", "E", "IF", "IP", "SF", "DF", "DP"]),
  reported_acres: decimals(2).pipe(z.number().positive()),
  planting_date: isoDate,
  shares: z.array(fsaShare).min(1),
});

const fsa578Doc = z.object({
  kind: z.literal("fsa_578"),
  delivery: z.literal("photo"),
  values: z.object({
    program_year: z.number().int(),
    farm_number: z.string().min(1),
    farmland_acres: decimals(2),
    cropland_acres: decimals(2),
    operator: z.object({ key: z.literal("1"), name: markedSample, address: markedSample }),
    other_producers: z.array(z.object({ key: z.string().min(1), name: markedSample })),
    fields: z.array(fsaField).min(1),
    total_operator_report: decimals(2),
    certified_by: markedSample,
    certification_date: isoDate,
  }),
});
export type Fsa578Doc = z.infer<typeof fsa578Doc>;

// ---------------------------------------------------------------------------
// Summary of Coverage
// ---------------------------------------------------------------------------

const socUnit = z.object({
  unit_number: z.string().min(1),
  unit_type: z.enum(["basic", "optional", "enterprise"]),
  practice: z.string().min(1),
  fsa_farm: z.string().min(1),
  fsa_tract: z.string().min(1),
  fsa_field: z.string().min(1),
  acres: decimals(2),
  insured_share: decimals(4),
  approved_yield: z.number().positive(),
  guarantee_bu_per_acre: decimals(1),
  /** Whole bushels, as printed. */
  guarantee_bu: z.number().int(),
  /** Whole dollars, as printed. */
  liability: z.number().int(),
});

const summaryOfCoverageDoc = z.object({
  kind: z.literal("summary_of_coverage"),
  delivery: z.literal("pdf"),
  values: z.object({
    /** Fictional. */
    insurer: z.string().regex(/sample/i),
    agency: markedSample,
    issued_date: isoDate,
    insured_name: markedSample,
    insured_address: markedSample,
    policy_number: markedSample,
    crop_year: z.number().int(),
    crop: z.enum(CROPS),
    crop_type: z.string().min(1),
    state: z.string().length(2),
    county: z.string().min(1),
    plan: z.enum(["RP", "RP-HPE", "YP"]),
    coverage_level: z.number().gt(0).max(0.95),
    price_election: z.number().positive(),
    unit_structure: z.enum(["basic", "optional", "enterprise"]),
    projected_price: decimals(2),
    units: z.array(socUnit).min(1),
    total_acres: decimals(2),
    total_guarantee_bu: z.number().int(),
    total_liability: z.number().int(),
  }),
});
export type SummaryOfCoverageDoc = z.infer<typeof summaryOfCoverageDoc>;

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

const settlementLine = z.object({
  ticket_number: z.string().regex(/^\d+$/),
  ticket_date: isoDate,
  net_lbs: z.number().int().positive(),
  moisture_pct: decimals(1),
  wet_bu: decimals(2),
  shrink_pct: decimals(2),
  elevator_dry_bu: decimals(2),
  drying_charge: decimals(2),
});
export type SettlementLine = z.infer<typeof settlementLine>;

const settlementDoc = z.object({
  kind: z.literal("settlement"),
  delivery: z.literal("pdf"),
  values: z.object({
    buyer_name: z.string().min(1),
    buyer_address: markedSample,
    settlement_number: z.string().min(1),
    settlement_date: isoDate,
    customer: markedSample,
    customer_address: markedSample,
    contract_number: z.string().min(1),
    contract_type: z.string().min(1),
    grain: z.string().min(1),
    crop: z.enum(CROPS),
    futures_month: z.string().min(1),
    futures_price: decimals(2),
    basis: decimals(2),
    price_per_bu: decimals(2),
    base_moisture_pct: decimals(1),
    shrink_pct_per_point: decimals(2),
    /** Dollars per point of moisture over the base, per wet bushel. */
    drying_per_point: decimals(3),
    checkoff_per_bu: decimals(2),
    tickets: z.array(settlementLine).min(1),
    total_net_lbs: z.number().int(),
    total_wet_bu: decimals(2),
    total_dry_bu: decimals(2),
    gross_amount: decimals(2),
    drying_total: decimals(2),
    checkoff_total: decimals(2),
    net_payment: decimals(2),
    check_number: z.string().min(1),
    payee: markedSample,
  }),
});
export type SettlementDoc = z.infer<typeof settlementDoc>;

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

const sampleDocument = z.discriminatedUnion("kind", [
  ticketDoc,
  fsaMapDoc,
  fsa578Doc,
  summaryOfCoverageDoc,
  settlementDoc,
]);
export type SampleDocument = z.infer<typeof sampleDocument>;

export const documentsFileSchema = z.object({
  sample: z.literal(true),
  note: z.string(),
  crop_year: z.number().int().min(2000).max(2100),
  documents: z.record(
    z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "name documents like ticket-3 or fsa-578"),
    sampleDocument,
  ),
});
export type DocumentsFile = z.infer<typeof documentsFileSchema>;

export const DOCUMENTS_FILE = "documents-2026.json";

export function loadDocumentsFile(dir = path.resolve("sample-data")): DocumentsFile {
  const raw: unknown = JSON.parse(readFileSync(path.join(dir, DOCUMENTS_FILE), "utf8"));
  const result = documentsFileSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`sample-data/${DOCUMENTS_FILE} is not valid:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

type ByKind<K extends SampleDocument["kind"]> = Extract<SampleDocument, { kind: K }>;

/** [name, document] pairs of one kind, in file order. */
export function documentsOfKind<K extends SampleDocument["kind"]>(
  file: DocumentsFile,
  kind: K,
): [string, ByKind<K>][] {
  return Object.entries(file.documents).filter(
    (entry): entry is [string, ByKind<K>] => entry[1].kind === kind,
  );
}
