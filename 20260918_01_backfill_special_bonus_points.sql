-- Assign explicit values to the two existing special-point products and their history.
-- Safe to run more than once. It changes report metadata only; coins and XP are unchanged.
begin;

with special_items(item_name, bonus_points) as (
  values
    ('แต้มพิเศษ 1 คะแนน'::text, 1::numeric),
    ('แต้มพิเศษ 2 คะแนน'::text, 2::numeric)
)
update public.shop_items as item
set bonus_points = special.bonus_points
from special_items as special
where item.item_name = special.item_name
  and item.bonus_points is distinct from special.bonus_points;

with special_items(item_name, bonus_points) as (
  values
    ('แต้มพิเศษ 1 คะแนน'::text, 1::numeric),
    ('แต้มพิเศษ 2 คะแนน'::text, 2::numeric)
)
update public.redemption_logs as redemption
set bonus_points = special.bonus_points
from special_items as special
where redemption.item_name = special.item_name
  and redemption.bonus_points is distinct from special.bonus_points;

notify pgrst, 'reload schema';
commit;
