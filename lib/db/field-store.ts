/**
 * The database and Storage calls behind lib/fields/add-fields.ts.
 *
 * The demo has one farm and no logins, so the farm is the one insured there
 * is. An FSA map is a row in `document` like the FSA-578 and Summary of
 * Coverage, so finding, storing and confirming it are season-store.ts's
 * calls. A field's acres are never sent: the database measures them from the
 * outline.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FieldStore, SavedDocument, SavedField } from "../fields/add-fields";
import type { DocumentCheck } from "../rules/document-checks";
import { seasonStore } from "./season-store";

function fail(doing: string, error: { message: string }): never {
  throw new Error(`${doing} failed: ${error.message}`);
}

const FIELD_COLUMNS = "id, name, mapped_acres, boundary";

/** A field row as the REST API returns it: the outline comes back as GeoJSON. */
interface FieldRow {
  id: string;
  name: string;
  mapped_acres: number | string | null;
  boundary: { type: "Polygon"; coordinates: [number, number][][] };
}

export function fieldStore(db: SupabaseClient): FieldStore {
  const documents = seasonStore(db);
  return {
    loadFarm: documents.loadFarm,
    findDocumentByHash: documents.findDocumentByHash,
    loadDocument: documents.loadDocument,
    saveFile: documents.saveFile,
    confirmDocuments: documents.confirmDocuments,

    async insertDocument(document) {
      const { data, error } = await db.from("document").insert(document).select("id, kind, read_values, read_checks").single();
      if (error) fail("Saving the FSA map", error);
      const row = data as unknown as { id: string; kind: string; read_values: unknown; read_checks: DocumentCheck[] | null };
      return { id: row.id, kind: row.kind, readValues: row.read_values, readChecks: row.read_checks ?? [] } satisfies SavedDocument;
    },

    async insertFields(fields) {
      if (fields.length === 0) return [];
      // One insert for all of them: the database writes every row or none.
      const { data, error } = await db.from("field").insert(fields).select(FIELD_COLUMNS);
      if (error) fail("Saving the fields", error);
      return (data as unknown as FieldRow[]).map(
        (row): SavedField => ({
          id: row.id,
          name: row.name,
          acres: row.mapped_acres === null ? null : Number(row.mapped_acres),
          outline: row.boundary.coordinates,
        }),
      );
    },

    async removeFields(ids) {
      if (ids.length === 0) return;
      const { error } = await db.from("field").delete().in("id", ids);
      if (error) fail("Removing the half-saved fields", error);
    },
  };
}
