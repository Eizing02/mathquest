-- ============================================================
-- MATH Quest pet system migration 02
-- Adds the updated_at trigger and RLS policies for pet tables.
-- Run after: 20260705_01_pet_system_tables.sql
-- Safe to run more than once.
-- ============================================================

create or replace function public.set_current_timestamp_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_student_pets_updated_at on public.student_pets;
create trigger set_student_pets_updated_at
  before update on public.student_pets
  for each row execute function public.set_current_timestamp_updated_at();

alter table public.student_pets enable row level security;
alter table public.student_pet_events enable row level security;

drop policy if exists "student_pets_public_all" on public.student_pets;
create policy "student_pets_public_all"
  on public.student_pets
  for all
  to public
  using (true)
  with check (true);

drop policy if exists "student_pet_events_public_all" on public.student_pet_events;
create policy "student_pet_events_public_all"
  on public.student_pet_events
  for all
  to public
  using (true)
  with check (true);
