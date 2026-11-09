/**
 * Reads Dave's sample farm from sample-data/, checks it, and turns it into
 * table rows. Everything here is a pure function of the files, so it is
 * tested without a database (sample-files.test.ts).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CROPS } from "../../lib/rules/crops";

// ---------------------------------------------------------------------------
// File shapes
// ---------------------------------------------------------------------------

/** [longitude, latitude], the GeoJSON order. */
const lonLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
export type LonLat = z.infer<typeof lonLat>;

/** unit.insured_share is numeric(5,4); more decimals would be rounded silently. */
const share = z
  .number()
  .gt(0)
  .max(1)
  .refine((v) => Math.abs(v * 10_000 - Math.round(v * 10_000)) < 1e-9, {
    message: "insured_share can have at most 4 decimal places (numeric(5,4))",
  });

const closedRing = z
  .array(lonLat)
  .min(4)
  .refine((ring) => {
    const [first, last] = [ring[0], ring[ring.length - 1]];
    return first[0] === last[0] && first[1] === last[1];
  }, "the outline's first and last points must be the same");

const fieldFeature = z.object({
  type: z.literal("Feature"),
  id: z.uuid(),
  properties: z.object({
    name: z.string().min(1),
    fsa_farm: z.string().min(1),
    fsa_tract: z.string().min(1),
    fsa_field: z.string().min(1),
    state: z.string().length(2),
    county: z.string().min(1),
    /** Acres the database must calculate from the outline (rounded to 2 decimals). */
    expected_acres: z.number().positive(),
    source: z.literal("sample"),
    sample: z.literal(true),
  }),
  geometry: z.object({
    type: z.literal("Polygon"),
    // One outer ring, no holes.
    coordinates: z.tuple([closedRing]),
  }),
});
export type FieldFeature = z.infer<typeof fieldFeature>;

export const farmGeoJsonSchema = z.object({
  type: z.literal("FeatureCollection"),
  sample: z.literal(true),
  features: z.array(fieldFeature).min(1),
});

export const farmSchema = z.object({
  sample: z.literal(true),
  insured: z.object({
    id: z.uuid(),
    name: z.string().includes("SAMPLE"),
    entity_type: z.string().min(1),
  }),
  buyers: z.array(
    z.object({
      id: z.uuid(),
      name: z.string().min(1),
      address: z.string().includes("SAMPLE"),
      buyer_type: z.enum(["elevator", "ethanol_plant", "feedlot", "processor"]),
      location: lonLat,
    }),
  ),
  bins: z.array(
    z.object({
      id: z.uuid(),
      name: z.string().min(1),
      location: lonLat,
      diameter_ft: z.number().positive(),
      eave_height_ft: z.number().positive(),
      /** Capacity the database must calculate: round(0.6312 × diameter² × eave height). */
      expected_capacity_bu: z.number().int().positive(),
    }),
  ),
  trucks: z.array(
    z.object({
      id: z.uuid(),
      name: z.string().min(1),
      capacity_bu: z.number().int().positive(),
      owner: z.literal("farm"),
    }),
  ),
});
export type Farm = z.infer<typeof farmSchema>;

const unitKind = z.enum(["basic", "optional", "enterprise"]);

export const seasonSchema = z.object({
  sample: z.literal(true),
  policy: z.object({
    id: z.uuid(),
    crop: z.enum(CROPS),
    state: z.string().length(2),
    county: z.string().min(1),
    crop_year: z.number().int().min(2000).max(2100),
    policy_number: z.string().includes("SAMPLE"),
    plan: z.enum(["RP", "RP-HPE", "YP"]),
    coverage_level: z.number().gt(0).max(0.95),
    price_election: z.number().positive(),
    unit_structure: unitKind,
    approved_yield: z.number().positive(),
    projected_price: z.number().positive().nullable(),
  }),
  units: z
    .array(
      z.object({
        id: z.uuid(),
        unit_number: z.string().min(1),
        unit_type: unitKind,
        practice: z.string().min(1),
        share_arrangement: z.enum(["owned", "cash_rent", "crop_share"]),
        insured_share: share,
      }),
    )
    .min(1),
  field_seasons: z.array(
    z.object({
      id: z.uuid(),
      /** Field name from farm.geojson. */
      field: z.string().min(1),
      /** Unit number from this file. */
      unit: z.string().min(1),
      crop: z.enum(CROPS),
      planted_acres: z.number().nonnegative(),
      planting_date: z.iso.date(),
      planting_completed_date: z.iso.date(),
      practice: z.string().min(1),
      insured: z.boolean(),
    }),
  ),
});
export type Season = z.infer<typeof seasonSchema>;

export interface SampleFiles {
  farm: Farm;
  fields: FieldFeature[];
  season: Season;
}

// ---------------------------------------------------------------------------
// Loading and cross-file checks
// ---------------------------------------------------------------------------

export const SAMPLE_FILE_NAMES = {
  farm: "farm.json",
  fields: "farm.geojson",
  season: "season-2026.json",
} as const;

function readJson<T>(dir: string, name: string, schema: z.ZodType<T>): T {
  const raw: unknown = JSON.parse(readFileSync(path.join(dir, name), "utf8"));
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new Error(`sample-data/${name} is not valid:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** Reads and checks all sample files. Throws with every problem found. */
export function loadSampleFiles(dir = path.resolve("sample-data")): SampleFiles {
  const files: SampleFiles = {
    farm: readJson(dir, SAMPLE_FILE_NAMES.farm, farmSchema),
    fields: readJson(dir, SAMPLE_FILE_NAMES.fields, farmGeoJsonSchema).features,
    season: readJson(dir, SAMPLE_FILE_NAMES.season, seasonSchema),
  };
  const problems = findProblems(files);
  if (problems.length > 0) {
    throw new Error(`sample-data/ has problems:\n- ${problems.join("\n- ")}`);
  }
  return files;
}

function duplicates(values: string[]): string[] {
  return [...new Set(values.filter((v, i) => values.indexOf(v) !== i))];
}

/** Problems the schemas can't see because they span records or files. */
export function findProblems({ farm, fields, season }: SampleFiles): string[] {
  const problems: string[] = [];

  const ids = [
    farm.insured.id,
    ...farm.buyers.map((b) => b.id),
    ...farm.bins.map((b) => b.id),
    ...farm.trucks.map((t) => t.id),
    ...fields.map((f) => f.id),
    season.policy.id,
    ...season.units.map((u) => u.id),
    ...season.field_seasons.map((fs) => fs.id),
  ];
  for (const id of duplicates(ids)) problems.push(`ID ${id} is used more than once`);

  const fieldNames = fields.map((f) => f.properties.name);
  for (const name of duplicates(fieldNames)) problems.push(`two fields are named "${name}"`);

  const fsaNumbers = fields.map(
    ({ properties: p }) => `${p.fsa_farm}/${p.fsa_tract}/${p.fsa_field}`,
  );
  for (const fsa of duplicates(fsaNumbers)) problems.push(`two fields have FSA number ${fsa}`);

  const unitNumbers = season.units.map((u) => u.unit_number);
  for (const n of duplicates(unitNumbers)) problems.push(`two units are numbered "${n}"`);

  const seasonFields = season.field_seasons.map((fs) => fs.field);
  for (const name of duplicates(seasonFields)) {
    problems.push(`field "${name}" has more than one ${season.policy.crop_year} field season`);
  }

  for (const fs of season.field_seasons) {
    if (!fieldNames.includes(fs.field)) {
      problems.push(`field season ${fs.id} names field "${fs.field}", which is not in farm.geojson`);
    }
    if (!unitNumbers.includes(fs.unit)) {
      problems.push(`field season ${fs.id} names unit "${fs.unit}", which is not in season-2026.json`);
    }
    if (fs.crop !== season.policy.crop) {
      problems.push(`field season ${fs.id} is ${fs.crop} but the policy is ${season.policy.crop}`);
    }
    if (fs.planting_completed_date < fs.planting_date) {
      problems.push(`field season ${fs.id} finishes planting before it starts`);
    }
  }

  return problems;
}

/** Every fixed ID in the sample files, by table. Reset always removes these. */
export function fixedIds({ farm, fields, season }: SampleFiles) {
  return {
    insured: [farm.insured.id],
    buyer: farm.buyers.map((b) => b.id),
    bin: farm.bins.map((b) => b.id),
    truck: farm.trucks.map((t) => t.id),
    field: fields.map((f) => f.id),
    policy: [season.policy.id],
    unit: season.units.map((u) => u.id),
    field_season: season.field_seasons.map((fs) => fs.id),
  };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** Map shapes go to PostGIS as EWKT text, which it reads on insert. */
export function ewktPoint([lon, lat]: LonLat): string {
  return `SRID=4326;POINT(${lon} ${lat})`;
}

export function ewktPolygon(ring: LonLat[]): string {
  return `SRID=4326;POLYGON((${ring.map(([lon, lat]) => `${lon} ${lat}`).join(",")}))`;
}

export function insuredRows({ farm }: SampleFiles) {
  return [{ id: farm.insured.id, name: farm.insured.name, entity_type: farm.insured.entity_type }];
}

export function buyerRows({ farm }: SampleFiles) {
  return farm.buyers.map((b) => ({
    id: b.id,
    name: b.name,
    address: b.address,
    buyer_type: b.buyer_type,
    location: ewktPoint(b.location),
  }));
}

export function binRows({ farm }: SampleFiles) {
  return farm.bins.map((b) => ({
    id: b.id,
    insured_id: farm.insured.id,
    name: b.name,
    location: ewktPoint(b.location),
    diameter_ft: b.diameter_ft,
    eave_height_ft: b.eave_height_ft,
  }));
}

export function truckRows({ farm }: SampleFiles) {
  return farm.trucks.map((t) => ({
    id: t.id,
    name: t.name,
    capacity_bu: t.capacity_bu,
    owner: t.owner,
    insured_id: farm.insured.id,
  }));
}

export function fieldRows({ farm, fields }: SampleFiles) {
  return fields.map(({ id, properties: p, geometry }) => ({
    id,
    insured_id: farm.insured.id,
    name: p.name,
    fsa_farm: p.fsa_farm,
    fsa_tract: p.fsa_tract,
    fsa_field: p.fsa_field,
    state: p.state,
    county: p.county,
    boundary: ewktPolygon(geometry.coordinates[0]),
    source: p.source,
  }));
}

export function policyRows({ farm, season }: SampleFiles) {
  const { id, ...policy } = season.policy;
  return [{ id, insured_id: farm.insured.id, ...policy }];
}

export function unitRows({ season }: SampleFiles) {
  return season.units.map((u) => ({ ...u, policy_id: season.policy.id }));
}

export function fieldSeasonRows({ fields, season }: SampleFiles) {
  return season.field_seasons.map((fs) => {
    const field = fields.find((f) => f.properties.name === fs.field);
    const unit = season.units.find((u) => u.unit_number === fs.unit);
    if (!field || !unit) throw new Error(`field season ${fs.id} has an unknown field or unit`);
    return {
      id: fs.id,
      field_id: field.id,
      unit_id: unit.id,
      crop_year: season.policy.crop_year,
      crop: fs.crop,
      planted_acres: fs.planted_acres,
      planting_date: fs.planting_date,
      planting_completed_date: fs.planting_completed_date,
      practice: fs.practice,
      insured: fs.insured,
    };
  });
}
