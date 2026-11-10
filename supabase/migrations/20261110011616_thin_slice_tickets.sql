-- =====================================================================
-- GrainClaim: thin slice (one ticket photo, start to finish)
--
-- 1. A private Storage bucket for original photos.
-- 2. Two ticket columns: the time in, and the other values printed on
--    a ticket that have no column of their own.
-- 3. The read-value lock now covers both new columns.
--
-- Nothing on public.trip changes here. Its truck and estimate stay
-- required until the harvest log migration (Milestone 4).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. PHOTO STORAGE
-- ---------------------------------------------------------------------

-- Original photos, each named by its SHA-256 hash and real extension:
-- tickets/<hash>.jpg or tickets/<hash>.png. The bucket is private and
-- has no access rules, so only server code using the secret key can
-- read or write it. Later document types get their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 20971520, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;


-- ---------------------------------------------------------------------
-- 2. TICKET COLUMNS
-- ---------------------------------------------------------------------

alter table public.ticket
  -- Time in, as printed on the ticket (the truck weighing in). It has
  -- no time zone: it is the elevator's local clock. With ticket_date,
  -- it links a ticket to the field being harvested then.
  add column ticket_time time,
  -- The other values read from the ticket, as written: the buyer's
  -- address, the customer, the grain, the marked boxes, the ticket's
  -- own bushels, shrink and dry bushels, and the weigher. The
  -- arithmetic checks compare the ticket's own bushels with ours.
  add column other_printed_values jsonb not null default '{}'::jsonb;


-- ---------------------------------------------------------------------
-- 3. THE READ-VALUE LOCK
-- ---------------------------------------------------------------------

-- The same function as in the first migration, with ticket_time and
-- other_printed_values added to the read values that lock once saved.
create or replace function public.lock_ticket_readings()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- (Map points are compared as text, which is exact.)
  if (new.photo_path, new.photo_sha256, new.captured_at, new.capture_location::text, new.source)
     is distinct from
     (old.photo_path, old.photo_sha256, old.captured_at, old.capture_location::text, old.source) then
    raise exception 'Ticket photos are locked and cannot be replaced.';
  end if;

  if old.read_at is not null and
     (new.buyer_name, new.ticket_number, new.ticket_date, new.ticket_time, new.crop, new.gross_lbs,
      new.tare_lbs, new.net_lbs, new.moisture_pct, new.test_weight,
      new.foreign_material_pct, new.damage_pct, new.dockage_pct, new.truck_number,
      new.shrink_pct_per_point, new.base_moisture_pct, new.contract_number,
      new.other_printed_values, new.read_confidence, new.read_model, new.read_at)
     is distinct from
     (old.buyer_name, old.ticket_number, old.ticket_date, old.ticket_time, old.crop, old.gross_lbs,
      old.tare_lbs, old.net_lbs, old.moisture_pct, old.test_weight,
      old.foreign_material_pct, old.damage_pct, old.dockage_pct, old.truck_number,
      old.shrink_pct_per_point, old.base_moisture_pct, old.contract_number,
      old.other_printed_values, old.read_confidence, old.read_model, old.read_at) then
    raise exception 'Ticket readings are locked. Add a misread flag instead of editing.';
  end if;

  return new;
end $$;
