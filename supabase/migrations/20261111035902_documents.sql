-- =====================================================================
-- GrainClaim: documents (FSA-578, Summary of Coverage, FSA map), and
-- field seasons that aren't insured
--
-- 1. The private bucket also takes PDFs, because a Summary of Coverage
--    arrives as the insurer's PDF.
-- 2. A `document` table: the original file of a document the farmer
--    added, and the values read from it. One table for every kind of
--    document that isn't a scale ticket.
-- 3. The file and the read values lock once saved, as a ticket's do.
-- 4. A field season can be uninsured: a field on the FSA-578 that no
--    unit covers keeps its season and planted acres, with no unit.
--
-- Scale tickets stay in public.ticket, which has a column for each
-- value.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. FILE STORAGE
-- ---------------------------------------------------------------------

-- The bucket is still called `photos`. Documents go in their own
-- folder, each named by its SHA-256 hash and real extension:
-- documents/<hash>.jpg, documents/<hash>.png or documents/<hash>.pdf.
update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'application/pdf']
 where id = 'photos';


-- ---------------------------------------------------------------------
-- 2. THE DOCUMENT TABLE
-- ---------------------------------------------------------------------

-- One row per file the farmer added: an FSA-578, a Summary of Coverage
-- or an FSA map. The values read from it are kept whole, as the reader
-- returned them, with the checks run on them. What GrainClaim makes
-- from a document (a season, field outlines) lives in its own tables;
-- the farmer confirms that separately, and nothing here changes it.
create table public.document (
  id               uuid primary key default gen_random_uuid(),
  insured_id       uuid not null references public.insured(id),
  kind             text not null
                   check (kind in ('fsa_578', 'summary_of_coverage', 'fsa_map')),

  -- The original file. The SHA-256 fingerprint proves it hasn't changed.
  file_path        text not null,          -- where it sits in Supabase Storage
  file_sha256      text not null unique check (file_sha256 ~ '^[0-9a-f]{64}$'),
  media_type       text not null
                   check (media_type in ('image/jpeg', 'image/png', 'application/pdf')),
  captured_at      timestamptz,            -- from a photo's metadata; a PDF has none
  capture_location extensions.geometry(Point, 4326),
  uploaded_by      text,
  uploaded_at      timestamptz not null default now(),

  -- Values read from the file. Locked once saved (see trigger below).
  read_values      jsonb,                  -- every value, named as in the reader's schema
  read_checks      jsonb not null default '[]'::jsonb,  -- the checks run on those values
  read_model       text,                   -- which AI model read it
  read_at          timestamptz,

  -- Set when the farmer confirms what was made from this document.
  confirmed_by     text,
  confirmed_at     timestamptz,

  created_at       timestamptz not null default now()
);
create index document_insured_kind on public.document (insured_id, kind);


-- ---------------------------------------------------------------------
-- 3. RULES ENFORCED BY THE DATABASE
-- ---------------------------------------------------------------------

-- "The farmer reviews but can't fabricate": a document's file can't be
-- replaced, and once it has been read its values can't be changed. A
-- wrong value is handled by adding a 'misread' flag, never by editing.
create function public.lock_document_readings()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- (Map points are compared as text, which is exact.)
  if (new.insured_id, new.kind, new.file_path, new.file_sha256, new.media_type,
      new.captured_at, new.capture_location::text, new.uploaded_by, new.uploaded_at)
     is distinct from
     (old.insured_id, old.kind, old.file_path, old.file_sha256, old.media_type,
      old.captured_at, old.capture_location::text, old.uploaded_by, old.uploaded_at) then
    raise exception 'Document files are locked and cannot be replaced.';
  end if;

  if old.read_at is not null and
     (new.read_values, new.read_checks, new.read_model, new.read_at)
     is distinct from
     (old.read_values, old.read_checks, old.read_model, old.read_at) then
    raise exception 'Document readings are locked. Add a misread flag instead of editing.';
  end if;

  return new;
end $$;

create trigger document_lock_readings
  before update on public.document
  for each row execute function public.lock_document_readings();

-- Every change goes to audit_event, as for the other tables.
create trigger document_audit
  after insert or update or delete on public.document
  for each row execute function public.write_audit_event();

-- Row Level Security, with no access rules: only server-side code using
-- the secret key can read or write documents.
alter table public.document enable row level security;


-- ---------------------------------------------------------------------
-- 4. FIELD SEASONS THAT AREN'T INSURED
-- ---------------------------------------------------------------------

-- A field the FSA-578 reports but no unit on the Summary of Coverage
-- covers is kept: it has a season, a crop and planted acres, but it is
-- in no unit, so it has no guarantee and its grain counts toward no
-- unit's total. An insured season always has a unit, and an uninsured
-- one never does.
alter table public.field_season
  alter column unit_id drop not null;

alter table public.field_season
  add constraint field_season_insured_has_unit
  check ((insured and unit_id is not null) or (not insured and unit_id is null));
