/**
 * The database and Storage calls behind lib/season/setup-season.ts.
 *
 * The demo has one farm and no logins, so the farm is the one insured there
 * is. The REST API has no transactions; setup-season.ts orders these calls
 * and takes a half-written season back out with `removeSeason`.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentCheck } from "../rules/document-checks";
import type { MappedField } from "../rules/season-setup";
import type { SavedDocument, SeasonStore } from "../season/setup-season";
import { PHOTO_BUCKET } from "./client";
import { alreadyStored } from "./ticket-store";

function fail(doing: string, error: { message: string }): never {
  throw new Error(`${doing} failed: ${error.message}`);
}

const DOCUMENT_COLUMNS = "id, kind, read_values, read_checks";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DocumentRow {
  id: string;
  kind: string;
  read_values: unknown;
  read_checks: DocumentCheck[] | null;
}

const savedDocument = (row: DocumentRow): SavedDocument => ({
  id: row.id,
  kind: row.kind,
  readValues: row.read_values,
  readChecks: row.read_checks ?? [],
});

export function seasonStore(db: SupabaseClient): SeasonStore {
  return {
    async loadFarm() {
      const insured = await db.from("insured").select("id").order("created_at").limit(1).maybeSingle();
      if (insured.error) fail("Reading the farm", insured.error);
      if (!insured.data) return null;
      const fields = await db
        .from("field")
        .select("id, name, fsa_farm, fsa_tract, fsa_field, mapped_acres")
        .eq("insured_id", insured.data.id)
        .is("valid_to", null);
      if (fields.error) fail("Reading the farm's fields", fields.error);
      return {
        insuredId: insured.data.id as string,
        fields: (fields.data as unknown as (MappedField & { mapped_acres: number | string | null })[]).map((field) => ({
          ...field,
          mapped_acres: field.mapped_acres === null ? null : Number(field.mapped_acres),
        })),
      };
    },

    async findDocumentByHash(hash) {
      const { data, error } = await db.from("document").select(DOCUMENT_COLUMNS).eq("file_sha256", hash).maybeSingle();
      if (error) fail("Looking up the file's hash", error);
      return data ? savedDocument(data as unknown as DocumentRow) : null;
    },

    async loadDocument(id) {
      // Anything that isn't an id can't be a document, and the database would refuse to compare it.
      if (!UUID.test(id)) return null;
      const { data, error } = await db.from("document").select(DOCUMENT_COLUMNS).eq("id", id).maybeSingle();
      if (error) fail("Reading the document", error);
      return data ? savedDocument(data as unknown as DocumentRow) : null;
    },

    async saveFile(path, file, type) {
      const { error } = await db.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: type.mediaType, upsert: false });
      if (error && !alreadyStored(error)) fail("Storing the document", error);
    },

    async insertDocument(document) {
      const { data, error } = await db.from("document").insert(document).select(DOCUMENT_COLUMNS).single();
      if (error) fail("Saving the document", error);
      return savedDocument(data as unknown as DocumentRow);
    },

    async findPolicy(insuredId, policy) {
      const { data, error } = await db
        .from("policy")
        .select("id")
        .eq("insured_id", insuredId)
        .eq("crop", policy.crop)
        .eq("state", policy.state)
        .eq("county", policy.county)
        .eq("crop_year", policy.crop_year)
        .maybeSingle();
      if (error) fail("Checking for this season", error);
      return data;
    },

    async insertPolicy(policy) {
      const { data, error } = await db.from("policy").insert(policy).select("id").single();
      if (error) fail("Saving the policy", error);
      return data;
    },

    async insertUnits(units) {
      if (units.length === 0) return [];
      const { data, error } = await db.from("unit").insert(units).select("id, unit_number");
      if (error) fail("Saving the units", error);
      return data;
    },

    async insertFieldSeasons(fieldSeasons) {
      if (fieldSeasons.length === 0) return [];
      const { data, error } = await db.from("field_season").insert(fieldSeasons).select("id");
      if (error) fail("Saving the field seasons", error);
      return data;
    },

    async insertFlags(flags) {
      if (flags.length === 0) return [];
      const { data, error } = await db.from("flag").insert(flags).select("id");
      if (error) fail("Saving the flags", error);
      return data;
    },

    async confirmDocuments(ids, who, at) {
      const { error } = await db.from("document").update({ confirmed_by: who, confirmed_at: at }).in("id", ids);
      if (error) fail("Marking the documents confirmed", error);
    },

    async removeSeason(written) {
      const steps: [table: string, ids: string[]][] = [
        ["flag", written.flagIds],
        ["field_season", written.fieldSeasonIds],
        ["unit", written.unitIds],
        ["policy", written.policyId ? [written.policyId] : []],
      ];
      for (const [table, ids] of steps) {
        if (ids.length === 0) continue;
        const { error } = await db.from(table).delete().in("id", ids);
        if (error) fail(`Removing the half-written ${table} rows`, error);
      }
    },
  };
}
