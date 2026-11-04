-- ============================================================
-- 310_exclusion_rule_targets.sql
-- Правила «Исключать всегда» получают вид цели:
--   product     — конкретный товар (как раньше);
--   group       — группа номенклатуры целиком (с подгруппами);
--   legacy_name — название из старого списка Glide, которое не удалось
--                 однозначно сопоставить с товаром или группой.
-- product_name остаётся «названием на момент создания» для всех видов.
-- ============================================================

alter table public.inventory_result_exclusion_rules
  add column if not exists target_kind text not null default 'product',
  add column if not exists ingredient_group_id uuid,
  add column if not exists external_group_id text;

alter table public.inventory_result_exclusion_rules
  drop constraint if exists inventory_result_exclusion_rules_target_kind_check;
alter table public.inventory_result_exclusion_rules
  add constraint inventory_result_exclusion_rules_target_kind_check
  check (target_kind in ('product', 'group', 'legacy_name'));

-- Тенантный ключ родителя уже есть (ingredient_groups_account_id_id_key); на
-- случай расхождения окружений — добавляем только если его нет.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ingredient_groups'::regclass
      and conname = 'ingredient_groups_account_id_id_key'
  ) then
    alter table public.ingredient_groups
      add constraint ingredient_groups_account_id_id_key unique (account_id, id);
  end if;
end $$;

alter table public.inventory_result_exclusion_rules
  drop constraint if exists inventory_result_exclusion_rules_group_tenant_fkey;
alter table public.inventory_result_exclusion_rules
  add constraint inventory_result_exclusion_rules_group_tenant_fkey
  foreign key (account_id, ingredient_group_id)
  references public.ingredient_groups(account_id, id)
  on delete cascade;

create index if not exists inventory_result_exclusion_rules_group_idx
  on public.inventory_result_exclusion_rules(account_id, ingredient_group_id)
  where ingredient_group_id is not null;

-- Ограничение по виду цели вместо «нужен товар».
alter table public.inventory_result_exclusion_rules
  drop constraint if exists inventory_result_exclusion_rules_ingredient_required;
alter table public.inventory_result_exclusion_rules
  drop constraint if exists inventory_result_exclusion_rules_product_required;
alter table public.inventory_result_exclusion_rules
  drop constraint if exists inventory_result_exclusion_rules_target_check;
alter table public.inventory_result_exclusion_rules
  add constraint inventory_result_exclusion_rules_target_check
  check (
    case target_kind
      when 'product' then
        (ingredient_id is not null or external_product_id is not null)
        and ingredient_group_id is null
        and external_group_id is null
      when 'group' then
        ingredient_group_id is not null
        and ingredient_id is null
        and external_product_id is null
      when 'legacy_name' then
        ingredient_id is null
        and external_product_id is null
        and ingredient_group_id is null
        and external_group_id is null
      else false
    end
  );

-- Существующие уникальные индексы — только для товарных правил.
drop index if exists public.inventory_result_exclusion_rules_active_ingredient_idx;
create unique index inventory_result_exclusion_rules_active_ingredient_idx
  on public.inventory_result_exclusion_rules(account_id, ingredient_id)
  where status = 'active' and target_kind = 'product' and ingredient_id is not null;

drop index if exists public.inventory_result_exclusion_rules_active_external_idx;
create unique index inventory_result_exclusion_rules_active_external_idx
  on public.inventory_result_exclusion_rules(account_id, external_product_id)
  where status = 'active' and target_kind = 'product'
    and ingredient_id is null and external_product_id is not null;

create unique index if not exists inventory_result_exclusion_rules_active_group_idx
  on public.inventory_result_exclusion_rules(account_id, ingredient_group_id)
  where status = 'active' and target_kind = 'group';

create unique index if not exists inventory_result_exclusion_rules_active_legacy_name_idx
  on public.inventory_result_exclusion_rules(account_id, lower(product_name))
  where status = 'active' and target_kind = 'legacy_name';

comment on column public.inventory_result_exclusion_rules.target_kind is
  'Вид цели: product — товар, group — группа номенклатуры целиком, legacy_name — название из Glide без сопоставления.';
comment on column public.inventory_result_exclusion_rules.metadata is
  'metadata.source: act | manual | glide; metadata.retro_applied_at — когда правило применено к уже загруженным актам (NULL — ещё нет).';
