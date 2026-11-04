-- ============================================================
-- 311_exclusion_rules_from_glide.sql
-- Перенос названий из stock_deduction_rules.config->'inventoryExclusions'
-- (последняя версия по каждому заведению) в inventory_result_exclusion_rules.
--   ровно одна группа с таким именем        → group
--   иначе ровно один товар (в т.ч. архивный) → product (если активного правила ещё нет)
--   иначе                                    → legacy_name
-- Идемпотентно. Строки актов не трогаем: ретро-применение — при первом
-- применении правил (metadata.retro_applied_at = null).
-- ============================================================

with latest as (
  select distinct on (r.account_id, r.venue_id)
         r.account_id, r.config
  from public.stock_deduction_rules r
  order by r.account_id, r.venue_id, r.version desc
),
names as (
  select l.account_id,
         lower(btrim(n.value)) as norm,
         min(btrim(n.value))   as display
  from latest l
  cross join lateral jsonb_array_elements_text(
    case when jsonb_typeof(l.config -> 'inventoryExclusions') = 'array'
         then l.config -> 'inventoryExclusions' else '[]'::jsonb end
  ) as n(value)
  where btrim(n.value) <> ''
  group by l.account_id, lower(btrim(n.value))
),
matched as (
  select n.account_id, n.norm, n.display,
         (select count(*) from public.ingredient_groups g
           where g.account_id = n.account_id and lower(btrim(g.name)) = n.norm) as group_cnt,
         (select min(g.id::text)::uuid from public.ingredient_groups g
           where g.account_id = n.account_id and lower(btrim(g.name)) = n.norm) as group_id,
         (select min(g.external_id) from public.ingredient_groups g
           where g.account_id = n.account_id and lower(btrim(g.name)) = n.norm) as group_ext,
         (select count(*) from public.ingredients i
           where i.account_id = n.account_id and lower(btrim(i.name)) = n.norm) as ing_cnt,
         (select min(i.id::text)::uuid from public.ingredients i
           where i.account_id = n.account_id and lower(btrim(i.name)) = n.norm) as ing_id
  from names n
),
decided as (
  select m.*,
         case when m.group_cnt = 1 then 'group'
              when m.group_cnt = 0 and m.ing_cnt = 1 then 'product'
              else 'legacy_name' end as kind
  from matched m
)
insert into public.inventory_result_exclusion_rules
  (account_id, target_kind, ingredient_id, ingredient_group_id, external_group_id,
   product_name, reason, status, created_by, metadata)
select d.account_id,
       d.kind,
       case when d.kind = 'product' then d.ing_id end,
       case when d.kind = 'group' then d.group_id end,
       case when d.kind = 'group' then d.group_ext end,
       d.display,
       'Перенесено из Glide',
       'active',
       null,
       jsonb_build_object('source', 'glide', 'retro_applied_at', null)
from decided d
where not exists (
  select 1 from public.inventory_result_exclusion_rules x
  where x.account_id = d.account_id and x.status = 'active'
    and (
      (d.kind = 'group'  and x.target_kind = 'group' and x.ingredient_group_id = d.group_id)
      or (d.kind = 'product' and x.target_kind = 'product' and x.ingredient_id = d.ing_id)
      or (d.kind = 'legacy_name' and x.target_kind = 'legacy_name' and lower(x.product_name) = d.norm)
    )
);
