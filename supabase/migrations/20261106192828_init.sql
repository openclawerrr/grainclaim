-- =====================================================================
-- GrainClaim: first database migration (thin slice)
--
-- Creates the tables the first working version needs. Built from
-- Part 2 of the demo spec. Later phases add more tables in new
-- migration files; never edit this one after it has been pushed.
-- =====================================================================

-- PostGIS adds map types (points, polygons) and map functions (area,
-- "is this point inside this field?"). Supabase keeps it in the
-- "extensions" schema, so map types below are written extensions.xxx.
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;


-- ---------------------------------------------------------------------
-- FARM MAP (permanent layer)
-- ---------------------------------------------------------------------

-- The farmer or farm business named on the insurance policy.
create table public.insured (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  entity_type text,                      -- individual, partnership, LLC...
  created_at  timestamptz not null default now()
);

-- A physical field. The outline is stored as a map polygon, and the
-- mapped acres are calculated from it automatically.
create table public.field (
  id                uuid primary key default gen_random_uuid(),
  insured_id        uuid not null references public.insured(id),
  name              text not null,                 -- "North 80"
  fsa_farm          text,
  fsa_tract         text,
  fsa_field         text,
  state             text not null,
  county            text not null,
  boundary          extensions.geometry(Polygon, 4326) not null,
  mapped_acres      numeric(10,2) generated always as (
                      round((extensions.st_area(boundary::extensions.geography)
                             / 4046.8564224)::numeric, 2)
                    ) stored,
  legal_description text,                          -- section / township / range
  acreage_type      text not null default 'normal'
                    check (acreage_type in ('normal','new_breaking','native_sod','crp')),
  source            text not null default 'drawn'
                    check (source in ('farmers_gov','drawn','sample')),
  valid_from        date not null default current_date,
  valid_to          date,                          -- set when land is sold or renumbered
  created_at        timestamptz not null default now(),
  -- Refuse broken outlines (self-crossing shapes and similar).
  constraint field_boundary_valid check (extensions.st_isvalid(boundary))
);
-- One current field per FSA number.
create unique index field_fsa_current
  on public.field (fsa_farm, fsa_tract, fsa_field)
  where valid_to is null and fsa_farm is not null;
create index field_boundary_gix on public.field using gist (boundary);

-- A grain bin at a map point. Capacity is calculated from its size:
-- bushels ≈ 0.6312 × diameter² × eave height (feet).
create table public.bin (
  id             uuid primary key default gen_random_uuid(),
  insured_id     uuid not null references public.insured(id),
  name           text not null,                    -- "Bin 3"
  location       extensions.geometry(Point, 4326) not null,
  diameter_ft    numeric(6,2) not null check (diameter_ft > 0),
  eave_height_ft numeric(6,2) check (eave_height_ft > 0),
  floor_type     text,
  capacity_bu    numeric(10,0) generated always as (
                   round(0.6312 * diameter_ft * diameter_ft * eave_height_ft)
                 ) stored,
  created_at     timestamptz not null default now()
);
create index bin_location_gix on public.bin using gist (location);

-- Where grain gets sold: elevator, ethanol plant, feedlot, processor.
create table public.buyer (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,                        -- "Main Street Elevator"
  address    text,
  location   extensions.geometry(Point, 4326),
  buyer_type text not null default 'elevator'
             check (buyer_type in ('elevator','ethanol_plant','feedlot','processor')),
  created_at timestamptz not null default now()
);

-- A truck. Farm trucks belong to the insured; buyer trucks (for
-- pickups from a bin) belong to a buyer.
create table public.truck (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                       -- "Truck 1", "Elevator #22"
  capacity_bu numeric(8,0) not null check (capacity_bu > 0),
  owner       text not null default 'farm' check (owner in ('farm','buyer')),
  insured_id  uuid references public.insured(id),
  buyer_id    uuid references public.buyer(id),
  created_at  timestamptz not null default now(),
  constraint truck_owner_matches check (
    (owner = 'farm'  and insured_id is not null and buyer_id is null) or
    (owner = 'buyer' and buyer_id   is not null and insured_id is null)
  )
);


-- ---------------------------------------------------------------------
-- SEASON (yearly layer)
-- ---------------------------------------------------------------------

-- One crop, one county, one crop year, for one insured.
create table public.policy (
  id              uuid primary key default gen_random_uuid(),
  insured_id      uuid not null references public.insured(id),
  crop            text not null check (crop in ('corn','soybeans','wheat')),
  state           text not null,
  county          text not null,
  crop_year       int  not null check (crop_year between 2000 and 2100),
  policy_number   text,
  plan            text not null check (plan in ('RP','RP-HPE','YP')),
  coverage_level  numeric(4,2) not null check (coverage_level > 0 and coverage_level <= 0.95),
  price_election  numeric(4,2) not null default 1.00,
  unit_structure  text not null check (unit_structure in ('basic','optional','enterprise')),
  approved_yield  numeric(8,2) not null check (approved_yield > 0),
  projected_price numeric(8,4),
  created_at      timestamptz not null default now(),
  unique (insured_id, crop, state, county, crop_year)
);

-- An insurance bucket inside a policy. Guarantee and loss are
-- calculated per unit. insured_share is Dave's share of the crop
-- (1.0 if he owns or cash-rents, 0.6667 on a 2/3 crop share).
create table public.unit (
  id                uuid primary key default gen_random_uuid(),
  policy_id         uuid not null references public.policy(id),
  unit_number       text not null,                 -- from the Summary of Coverage
  unit_type         text not null check (unit_type in ('basic','optional','enterprise')),
  practice          text not null default 'non-irrigated',
  share_arrangement text not null check (share_arrangement in ('owned','cash_rent','crop_share')),
  insured_share     numeric(5,4) not null check (insured_share > 0 and insured_share <= 1),
  created_at        timestamptz not null default now(),
  unique (policy_id, unit_number)
);

-- What happened on one field in one crop year, and which unit it
-- belongs to. A field can only be in one unit per year.
create table public.field_season (
  id                      uuid primary key default gen_random_uuid(),
  field_id                uuid not null references public.field(id),
  unit_id                 uuid not null references public.unit(id),
  crop_year               int  not null,
  crop                    text not null check (crop in ('corn','soybeans','wheat')),
  planted_acres           numeric(10,2) not null check (planted_acres >= 0),  -- from the FSA-578
  planting_date           date,
  planting_completed_date date,
  practice                text not null default 'non-irrigated',
  insured                 boolean not null default true,
  end_status              text check (end_status in
                            ('harvested','partly_harvested','destroyed',
                             'other_use','prevented_planting','appraised')),
  created_at              timestamptz not null default now(),
  unique (field_id, crop_year)
);


-- ---------------------------------------------------------------------
-- HARVEST
-- ---------------------------------------------------------------------

-- Short human-readable trip codes: T-0001, T-0002...
create sequence public.trip_code_seq;

-- One load leaving a field or a bin. Every trip carries an estimate
-- (the field harvest record); the ticket gives the official number.
create table public.trip (
  id              uuid primary key default gen_random_uuid(),
  trip_code       text not null unique
                  default ('T-' || lpad(nextval('public.trip_code_seq')::text, 4, '0')),
  truck_id        uuid not null references public.truck(id),
  driver_name     text,
  origin_field_id uuid references public.field(id),
  origin_bin_id   uuid references public.bin(id),
  dest_bin_id     uuid references public.bin(id),
  dest_buyer_id   uuid references public.buyer(id),
  crop_year       int  not null,
  started_at      timestamptz not null default now(),
  location        extensions.geometry(Point, 4326),
  estimated_bu    numeric(8,0) not null check (estimated_bu > 0),
  moisture_pct    numeric(5,2),
  status          text not null default 'open'
                  check (status in ('open','ticket_later','closed')),
  trust           text not null default 'manual' check (trust in ('gps','manual')),
  created_at      timestamptz not null default now(),
  -- Exactly one origin and exactly one destination.
  constraint trip_one_origin      check (num_nonnulls(origin_field_id, origin_bin_id) = 1),
  constraint trip_one_destination check (num_nonnulls(dest_bin_id, dest_buyer_id) = 1),
  constraint trip_not_same_bin    check (origin_bin_id is null or origin_bin_id is distinct from dest_bin_id)
);
-- Matching rule 1: a truck has only one open trip at a time.
create unique index trip_one_open_per_truck
  on public.trip (truck_id) where status = 'open';
create index trip_location_gix on public.trip using gist (location);

-- A scale ticket photo, what was read from it, and the bushels
-- calculated from those readings.
create table public.ticket (
  id                    uuid primary key default gen_random_uuid(),
  trip_id               uuid unique references public.trip(id),   -- one ticket per trip

  -- The original photo. The SHA-256 fingerprint proves it hasn't changed.
  photo_path            text not null,          -- where it sits in Supabase Storage
  photo_sha256          text not null unique check (photo_sha256 ~ '^[0-9a-f]{64}$'),
  photo_phash           text,                   -- catches the same ticket photographed twice
  captured_at           timestamptz,            -- from the photo's metadata
  capture_location      extensions.geometry(Point, 4326),
  source                text not null default 'upload'
                        check (source in ('camera','upload','email','import')),
  uploaded_by           text,
  uploaded_at           timestamptz not null default now(),

  -- Values read from the photo. Locked once saved (see trigger below).
  buyer_name            text,
  ticket_number         text,
  ticket_date           date,
  crop                  text check (crop in ('corn','soybeans','wheat')),
  gross_lbs             numeric(10,0),
  tare_lbs              numeric(10,0),
  net_lbs               numeric(10,0),
  moisture_pct          numeric(5,2),
  test_weight           numeric(5,2),
  foreign_material_pct  numeric(5,2),
  damage_pct            numeric(5,2),
  dockage_pct           numeric(5,2),
  truck_number          text,
  shrink_pct_per_point  numeric(5,3),
  base_moisture_pct     numeric(5,2),
  contract_number       text,
  read_confidence       jsonb not null default '{}'::jsonb,  -- per-value confidence and check results
  read_model            text,                   -- which AI model read it
  read_at               timestamptz,

  -- Calculated by the app's calculations module (Part 3 of the spec).
  wet_bu                numeric(10,2),
  elevator_dry_bu       numeric(10,2),
  production_to_count_bu numeric(10,2),
  calc_version          text,

  trust                 text not null default 'manual' check (trust in ('gps','manual')),
  duplicate_of          uuid references public.ticket(id),
  created_at            timestamptz not null default now()
);
create index ticket_buyer_number_date on public.ticket (buyer_name, ticket_number, ticket_date);


-- ---------------------------------------------------------------------
-- INTEGRITY
-- ---------------------------------------------------------------------

-- Anything that needs a person's attention: mismatches, mixing
-- warnings, low-confidence reads, missing loads, a farmer marking a
-- misread value. Resolved flags stay, with the note explaining why.
create table public.flag (
  id              uuid primary key default gen_random_uuid(),
  flag_type       text not null,              -- acre_mismatch, mixed_bin, missing_load, misread...
  severity        text not null default 'warn' check (severity in ('info','warn','block')),
  message         text not null,
  record_type     text not null,              -- which table the flag is about
  record_id       uuid not null,
  field_name      text,                       -- for a misread: which value is wrong
  related         jsonb not null default '[]'::jsonb,  -- other linked records
  status          text not null default 'open' check (status in ('open','resolved')),
  resolution_note text,
  resolved_by     text,
  resolved_at     timestamptz,
  created_by      text,
  created_at      timestamptz not null default now()
);
create index flag_open on public.flag (status, record_type);

-- Every insert, change and delete on the tables above, with before
-- and after copies. Rows here can be added but never changed.
create table public.audit_event (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      text,
  table_name text not null,
  record_id  uuid,
  action     text not null check (action in ('insert','update','delete')),
  before     jsonb,
  after      jsonb
);


-- ---------------------------------------------------------------------
-- RULES ENFORCED BY THE DATABASE
-- ---------------------------------------------------------------------

-- "The farmer reviews but can't fabricate": once a ticket has been
-- read, its photo and read values can't be changed. A wrong value is
-- handled by adding a 'misread' flag, never by editing.
create function public.lock_ticket_readings()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- (Map points are compared as text, which is exact.)
  if (new.photo_path, new.photo_sha256, new.captured_at, new.capture_location::text, new.source)
     is distinct from
     (old.photo_path, old.photo_sha256, old.captured_at, old.capture_location::text, old.source) then
    raise exception 'Ticket photos are locked and cannot be replaced.';
  end if;

  if old.read_at is not null and
     (new.buyer_name, new.ticket_number, new.ticket_date, new.crop, new.gross_lbs,
      new.tare_lbs, new.net_lbs, new.moisture_pct, new.test_weight,
      new.foreign_material_pct, new.damage_pct, new.dockage_pct, new.truck_number,
      new.shrink_pct_per_point, new.base_moisture_pct, new.contract_number,
      new.read_confidence, new.read_model, new.read_at)
     is distinct from
     (old.buyer_name, old.ticket_number, old.ticket_date, old.crop, old.gross_lbs,
      old.tare_lbs, old.net_lbs, old.moisture_pct, old.test_weight,
      old.foreign_material_pct, old.damage_pct, old.dockage_pct, old.truck_number,
      old.shrink_pct_per_point, old.base_moisture_pct, old.contract_number,
      old.read_confidence, old.read_model, old.read_at) then
    raise exception 'Ticket readings are locked. Add a misread flag instead of editing.';
  end if;

  return new;
end $$;

create trigger ticket_lock_readings
  before update on public.ticket
  for each row execute function public.lock_ticket_readings();

-- Write every change to audit_event.
create function public.write_audit_event()
returns trigger language plpgsql set search_path = '' as $$
declare
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  insert into public.audit_event (actor, table_name, record_id, action, before, after)
  values (
    coalesce(claims ->> 'email', claims ->> 'sub', current_user),
    tg_table_name,
    coalesce((to_jsonb(new) ->> 'id')::uuid, (to_jsonb(old) ->> 'id')::uuid),
    lower(tg_op),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

-- The audit trail itself can't be edited or deleted.
create function public.block_audit_changes()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'The audit trail cannot be changed.';
end $$;

create trigger audit_event_append_only
  before update or delete on public.audit_event
  for each row execute function public.block_audit_changes();

do $$
declare t text;
begin
  foreach t in array array['insured','field','bin','buyer','truck','policy',
                           'unit','field_season','trip','ticket','flag']
  loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function public.write_audit_event()',
      t || '_audit', t);
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- ACCESS
-- ---------------------------------------------------------------------

-- Row Level Security on every table. With no access rules added yet,
-- the public (publishable) key can't read or write anything; only
-- server-side code using the secret key can. Access rules come later,
-- once there are logins for owner, driver and agent.
do $$
declare t text;
begin
  foreach t in array array['insured','field','bin','buyer','truck','policy',
                           'unit','field_season','trip','ticket','flag','audit_event']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;