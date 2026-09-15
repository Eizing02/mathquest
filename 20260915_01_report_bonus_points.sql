-- Run before deploying reports. Historical rows stay NULL: never infer points from names.
begin;
alter table public.shop_items add column if not exists bonus_points numeric(10,2) not null default 0 check (bonus_points between 0 and 10000);
alter table public.redemption_logs add column if not exists bonus_points numeric(10,2) check (bonus_points between 0 and 10000);

create or replace function public.capture_redemption_bonus_points()
returns trigger language plpgsql set search_path = public as $$
begin
  select coalesce(s.bonus_points, 0) into new.bonus_points
  from public.shop_items s where s.item_id = new.item_id;
  new.bonus_points := coalesce(new.bonus_points, 0);
  return new;
end;
$$;
drop trigger if exists capture_redemption_bonus_points on public.redemption_logs;
create trigger capture_redemption_bonus_points before insert on public.redemption_logs
for each row execute function public.capture_redemption_bonus_points();
notify pgrst, 'reload schema';
commit;
