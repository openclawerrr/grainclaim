-- =====================================================================
-- GrainClaim: fields proposed from a photo of the farmer's FSA map
--
-- The farmer adds a photo of his FSA map and clicks roughly where his
-- farm is. GrainClaim reads the map, pairs each cropland field on it
-- with a public field outline nearby, and shows the pairs. Nothing is
-- written to `field` until he confirms them.
--
-- 1. `field.source` gets a new value, 'ai_proposed', for a field whose
--    outline was paired that way.
-- 2. `field` keeps what the FSA map prints for it (erodibility, whether
--    it is cropland, its acres) and a link to the map it came from,
--    which is a row in `document`.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. A NEW SOURCE
-- ---------------------------------------------------------------------

-- The first migration wrote this check inside the column, so Postgres
-- named it field_source_check.
alter table public.field
  drop constraint field_source_check;

alter table public.field
  add constraint field_source_check
  check (source in ('farmers_gov', 'drawn', 'sample', 'ai_proposed'));


-- ---------------------------------------------------------------------
-- 2. WHAT THE FSA MAP SAYS ABOUT A FIELD
-- ---------------------------------------------------------------------

-- All four are empty for a field that didn't come from an FSA map.
-- `fsa_map_acres` is the figure printed in the field's label on the map;
-- `mapped_acres` is still what the outline measures, and insured acres
-- still come from the FSA-578 and Summary of Coverage.
alter table public.field
  add column hel_status          text
             check (hel_status in ('HEL', 'NHEL')),   -- highly erodible, or not
  add column cropland            boolean,              -- counts toward its tract's cropland total
  add column fsa_map_acres       numeric(10,2)
             check (fsa_map_acres >= 0),
  add column fsa_map_document_id uuid references public.document(id);

create index field_fsa_map_document on public.field (fsa_map_document_id);

-- A field paired from an FSA map always says which map.
alter table public.field
  add constraint field_ai_proposed_has_document
  check (source <> 'ai_proposed' or fsa_map_document_id is not null);
