-- ============================================================
-- 190_document_items_ingredient_id_expand.sql
-- Этап 4 Pass 4.2b (expand) — переименование колонки
-- document_items.inventory_product_id → ingredient_id через
-- expand/contract (у колонки нет compat-view-моста, прямой RENAME
-- дал бы скью-окно код↔БД между Coolify-деплоем и SSH-накатом).
--
-- Здесь: добавляем ingredient_id, бэкфилл, FK-зеркало, индекс,
-- двунаправленный sync-триггер. Код НЕ меняется. Старый код пишет
-- inventory_product_id — триггер зеркалит в ingredient_id и наоборот.
-- Cutover кода + drop старой колонки/триггера — Pass 4.2b-contract.
-- ============================================================

alter table public.document_items
  add column if not exists ingredient_id uuid;

alter table public.document_items
  add constraint document_items_ingredient_id_fkey
  foreign key (ingredient_id)
  references public.ingredients(id) on delete set null;

update public.document_items
  set ingredient_id = inventory_product_id
  where ingredient_id is null and inventory_product_id is not null;

create index if not exists document_items_ingredient_idx
  on public.document_items(ingredient_id)
  where ingredient_id is not null;

create or replace function public.tg_document_items_sync_ingredient_id()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  -- Зеркалим обе колонки: какой бы версией кода ни писалась строка
  -- (старая → inventory_product_id, новая → ingredient_id), обе
  -- остаются согласованы на время перехода.
  new.ingredient_id := coalesce(new.ingredient_id, new.inventory_product_id);
  new.inventory_product_id := coalesce(new.inventory_product_id, new.ingredient_id);
  return new;
end;
$$;

create trigger trg_document_items_sync_ingredient_id
  before insert or update on public.document_items
  for each row execute function public.tg_document_items_sync_ingredient_id();
