-- ============================================================
-- 191_result_tables_ingredient_id_expand.sql
-- Этап 4 Pass 4.2b-2 (expand, продолжение) — расширяем
-- переименование inventory_product_id → ingredient_id на оставшиеся
-- две таблицы, чтобы имя было согласовано во всех трёх
-- (document_items уже расширен миграцией 190):
--   - inventory_result_exclusion_rules  (FK on delete cascade)
--   - inventory_result_resort_items     (FK on delete set null)
--
-- Паттерн тот же: add ingredient_id + FK-зеркало + бэкфилл + индекс +
-- двунаправленный sync-триггер. Код НЕ меняется (Pass 4.2b-3).
-- ============================================================

-- Общая trigger-функция (имена колонок одинаковы в обеих таблицах).
create or replace function public.tg_sync_ingredient_product_id()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    new.ingredient_id := coalesce(new.ingredient_id, new.inventory_product_id);
    new.inventory_product_id := coalesce(new.inventory_product_id, new.ingredient_id);
  else
    if new.ingredient_id is distinct from old.ingredient_id then
      new.inventory_product_id := new.ingredient_id;
    elsif new.inventory_product_id is distinct from old.inventory_product_id then
      new.ingredient_id := new.inventory_product_id;
    end if;
  end if;
  return new;
end;
$$;

-- inventory_result_exclusion_rules ---------------------------------
alter table public.inventory_result_exclusion_rules
  add column if not exists ingredient_id uuid;

alter table public.inventory_result_exclusion_rules
  add constraint inventory_result_exclusion_rules_ingredient_id_fkey
  foreign key (ingredient_id)
  references public.ingredients(id) on delete cascade;

update public.inventory_result_exclusion_rules
  set ingredient_id = inventory_product_id
  where ingredient_id is null and inventory_product_id is not null;

create index if not exists inventory_result_exclusion_rules_ingredient_idx
  on public.inventory_result_exclusion_rules(ingredient_id)
  where ingredient_id is not null;

create trigger trg_excl_rules_sync_ingredient_id
  before insert or update on public.inventory_result_exclusion_rules
  for each row execute function public.tg_sync_ingredient_product_id();

-- inventory_result_resort_items ------------------------------------
alter table public.inventory_result_resort_items
  add column if not exists ingredient_id uuid;

alter table public.inventory_result_resort_items
  add constraint inventory_result_resort_items_ingredient_id_fkey
  foreign key (ingredient_id)
  references public.ingredients(id) on delete set null;

update public.inventory_result_resort_items
  set ingredient_id = inventory_product_id
  where ingredient_id is null and inventory_product_id is not null;

create index if not exists inventory_result_resort_items_ingredient_idx
  on public.inventory_result_resort_items(ingredient_id)
  where ingredient_id is not null;

create trigger trg_resort_items_sync_ingredient_id
  before insert or update on public.inventory_result_resort_items
  for each row execute function public.tg_sync_ingredient_product_id();
