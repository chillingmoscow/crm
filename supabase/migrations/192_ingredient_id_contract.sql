-- ============================================================
-- 192_ingredient_id_contract.sql
-- Этап 4 Pass 4.2b-4 (contract) — финал переименования
-- inventory_product_id → ingredient_id во всех 3 таблицах
-- (document_items, inventory_result_exclusion_rules,
--  inventory_result_resort_items). Код уже на ingredient_id
-- (Pass 4.2b-3 #357, задеплоен). Здесь убираем старую колонку и
-- весь expand-scaffolding.
--
-- ВАЖНО (зависимости от старой колонки, выявлены интроспекцией):
--   1. RLS-политики ingredients.inventory_products_select и
--      account_files.account_files_select содержат idi.inventory_product_id
--      (тело политики ALTER RENAME не переписывает) — переписываем на
--      ingredient_id.
--   2. Старые индексы НЕ эквивалентны простым *_ingredient_idx из 190/191:
--      - inventory_result_exclusion_rules_active_product_idx — UNIQUE
--        (account_id, inventory_product_id) WHERE status='active'
--        (бизнес-правило: одно активное исключение на товар/аккаунт);
--      - inventory_result_resort_items_product_idx — composite
--        (account_id, inventory_product_id).
--      Пересоздаём их корректно на ingredient_id.
--   3. compat-view inventory_document_items (select * из document_items)
--      зависит от колонки — дропаем (кодом не используется с 4.2;
--      остальные compat-views живут до Pass 4.4).
-- ============================================================

-- 1. RLS-политики на ingredient_id (имена политик пока прежние —
--    косметика в 4.4; (select auth.uid()) InitPlan-форма сохранена).
drop policy "inventory_products_select" on public.ingredients;
create policy "inventory_products_select"
  on public.ingredients for select
  using (
    (account_id = get_active_account_id())
    and (
      has_permission('inventory.view_products'::text)
      or exists (
        select 1
        from document_items idi
        join documents d on d.id = idi.document_id
        where idi.ingredient_id = ingredients.id
          and d.assigned_to = (select auth.uid())
          and has_permission('inventory.fill_assigned_documents'::text)
      )
    )
  );

drop policy "account_files_select" on public.account_files;
create policy "account_files_select"
  on public.account_files for select
  using (
    (account_id = get_active_account_id())
    and (
      exists (
        select 1 from transaction_attachments ta
        join transactions t on t.id = ta.transaction_id
        where ta.file_id = account_files.id
          and t.account_id = get_active_account_id()
          and has_permission('finance.view_attachments'::text)
      )
      or exists (
        select 1 from counterparty_attachments ca
        join counterparties c on c.id = ca.counterparty_id
        where ca.file_id = account_files.id
          and c.account_id = get_active_account_id()
          and has_permission('finance.view_attachments'::text)
      )
      or exists (
        select 1 from legal_entity_attachments la
        join legal_entities le on le.id = la.legal_entity_id
        where la.file_id = account_files.id
          and le.account_id = get_active_account_id()
          and has_permission('org.view_legal_entities'::text)
      )
      or exists (
        select 1 from ingredient_groups ipg
        where ipg.primary_image_file_id = account_files.id
          and ipg.account_id = get_active_account_id()
          and has_permission('inventory.view_products'::text)
      )
      or exists (
        select 1 from ingredients ip
        where ip.primary_image_file_id = account_files.id
          and ip.account_id = get_active_account_id()
          and has_permission('inventory.view_products'::text)
      )
      or exists (
        select 1 from ingredients ip
        join document_items idi on idi.ingredient_id = ip.id
        join documents d on d.id = idi.document_id
        where ip.primary_image_file_id = account_files.id
          and ip.account_id = get_active_account_id()
          and d.assigned_to = (select auth.uid())
          and has_permission('inventory.fill_assigned_documents'::text)
      )
      or uploaded_by = (select auth.uid())
    )
  );

-- 2. Корректные индексы-эквиваленты на ingredient_id.
drop index if exists public.inventory_result_resort_items_ingredient_idx;
create index inventory_result_resort_items_ingredient_idx
  on public.inventory_result_resort_items(account_id, ingredient_id)
  where ingredient_id is not null;

drop index if exists public.inventory_result_exclusion_rules_ingredient_idx;
create unique index inventory_result_exclusion_rules_active_ingredient_idx
  on public.inventory_result_exclusion_rules(account_id, ingredient_id)
  where status = 'active' and ingredient_id is not null;
-- document_items_ingredient_idx (простой партиал из 190) эквивалентен
-- старому inventory_document_items_product_idx — оставляем.

-- 3. sync-триггеры + функции больше не нужны.
drop trigger trg_document_items_sync_ingredient_id on public.document_items;
drop trigger trg_excl_rules_sync_ingredient_id on public.inventory_result_exclusion_rules;
drop trigger trg_resort_items_sync_ingredient_id on public.inventory_result_resort_items;
drop function public.tg_document_items_sync_ingredient_id();
drop function public.tg_sync_ingredient_product_id();

-- 4. Старые FK на inventory_product_id (вкл. composite tenant-FK
--    exclusion_rules из 178 — имя без подстроки inventory_product_id).
alter table public.document_items
  drop constraint inventory_document_items_inventory_product_id_fkey;
alter table public.inventory_result_exclusion_rules
  drop constraint inventory_result_exclusion_rules_inventory_product_id_fkey;
alter table public.inventory_result_exclusion_rules
  drop constraint inventory_result_exclusion_rules_product_tenant_fkey;
alter table public.inventory_result_resort_items
  drop constraint inventory_result_resort_items_inventory_product_id_fkey;

-- 4a. Старый check (178): хотя бы один из product/external обязателен.
alter table public.inventory_result_exclusion_rules
  drop constraint inventory_result_exclusion_rules_product_required;

-- 5. Старые индексы по inventory_product_id (вкл. второй уникальный
--    из 178 — _active_external_idx с условием inventory_product_id is null).
drop index public.inventory_document_items_product_idx;
drop index public.inventory_result_resort_items_product_idx;
drop index public.inventory_result_exclusion_rules_active_product_idx;
drop index public.inventory_result_exclusion_rules_active_external_idx;

-- 6. compat-view, зависящий от колонки (кодом не используется с 4.2).
drop view public.inventory_document_items;

-- 7. Удаляем старую колонку во всех трёх таблицах.
alter table public.document_items
  drop column inventory_product_id;
alter table public.inventory_result_exclusion_rules
  drop column inventory_product_id;
alter table public.inventory_result_resort_items
  drop column inventory_product_id;

-- 8. Эквиваленты на ingredient_id для exclusion_rules (P1: бизнес-
--    инвариант и tenant-FK из 178 должны сохраниться).
alter table public.inventory_result_exclusion_rules
  add constraint inventory_result_exclusion_rules_ingredient_required
  check (ingredient_id is not null or external_product_id is not null);

alter table public.inventory_result_exclusion_rules
  add constraint inventory_result_exclusion_rules_ingredient_tenant_fkey
  foreign key (account_id, ingredient_id)
  references public.ingredients(account_id, id)
  on delete cascade;

create unique index inventory_result_exclusion_rules_active_external_idx
  on public.inventory_result_exclusion_rules(account_id, external_product_id)
  where status = 'active'
    and ingredient_id is null
    and external_product_id is not null;
