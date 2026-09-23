-- Гигиена схемы модуля инвентаризации по итогам ревью: индексы под FK,
-- тенантные композитные FK, разделение RLS-политик и мелкие огрехи прав.
-- Данные не меняются: перед написанием проверено, что кросс-аккаунтных ссылок
-- нет ни локально, ни на проде (ни одной строки по всем шести связям).

-- ── 1. Индексы под FK, по которым идёт каскад ───────────────────────────────
--
-- Строки актов физически удаляются: синхронизацией (позиции, которых больше
-- нет в Quick Resto) и при выносе в акт пересчёта. Каждое такое удаление
-- заставляет Postgres искать ссылки в inventory_result_resort_items и
-- inventory_result_events по document_item_id — а индекса на эту колонку не
-- было. Существующие индексы начинаются с document_id, для FK-lookup они не
-- годятся: нужен индекс, ведущий колонкой самого FK.
create index if not exists inventory_result_resort_items_document_item_idx
  on public.inventory_result_resort_items (document_item_id);

create index if not exists inventory_result_events_document_item_idx
  on public.inventory_result_events (document_item_id)
  where document_item_id is not null;

create index if not exists inventory_result_events_resort_idx
  on public.inventory_result_events (resort_id)
  where resort_id is not null;

-- ── 2. Тенантные композитные FK (docs/CONVENTIONS.md) ───────────────────────
--
-- Конвенция: ссылка внутри аккаунта идёт по (account_id, X) → (account_id, id),
-- тогда БД сама не даёт связать сущности разных аккаунтов. В модуле это было
-- сделано для строк актов, пересортов и событий, но не для ссылок на
-- заведения, ингредиенты и группы — их правили одиночные FK по id.
--
-- ON DELETE SET NULL (колонка): у композитного FK по умолчанию зануляются ОБА
-- столбца, а account_id — NOT NULL, поэтому удаление родителя падало бы вместо
-- отвязки. Указание конкретной колонки поддерживается с PostgreSQL 15
-- (прод — 15.8). Тот же приём уже применён в миграции 223.

-- documents.venue_id → venues
alter table public.documents drop constraint if exists documents_venue_id_fkey;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'documents_venue_tenant_fkey') then
    alter table public.documents
      add constraint documents_venue_tenant_fkey
      foreign key (account_id, venue_id)
      references public.venues (account_id, id)
      on delete set null (venue_id);
  end if;
end $$;
-- Покрывающий индекс уже есть: documents_account_venue_idx (account_id, venue_id).

-- stores.local_venue_id → venues
alter table public.stores drop constraint if exists stores_local_venue_id_fkey;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stores_local_venue_tenant_fkey') then
    alter table public.stores
      add constraint stores_local_venue_tenant_fkey
      foreign key (account_id, local_venue_id)
      references public.venues (account_id, id)
      on delete set null (local_venue_id);
  end if;
end $$;
create index if not exists stores_account_local_venue_idx
  on public.stores (account_id, local_venue_id)
  where local_venue_id is not null;

-- document_items.ingredient_id → ingredients
alter table public.document_items drop constraint if exists document_items_ingredient_id_fkey;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'document_items_ingredient_tenant_fkey') then
    alter table public.document_items
      add constraint document_items_ingredient_tenant_fkey
      foreign key (account_id, ingredient_id)
      references public.ingredients (account_id, id)
      on delete set null (ingredient_id);
  end if;
end $$;
create index if not exists document_items_account_ingredient_idx
  on public.document_items (account_id, ingredient_id)
  where ingredient_id is not null;

-- ingredients.group_id → ingredient_groups
alter table public.ingredients drop constraint if exists ingredients_group_id_fkey;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ingredients_group_tenant_fkey') then
    alter table public.ingredients
      add constraint ingredients_group_tenant_fkey
      foreign key (account_id, group_id)
      references public.ingredient_groups (account_id, id)
      on delete set null (group_id);
  end if;
end $$;
create index if not exists ingredients_account_group_idx
  on public.ingredients (account_id, group_id)
  where group_id is not null;

-- inventory_result_resort_items.ingredient_id → ingredients
alter table public.inventory_result_resort_items
  drop constraint if exists inventory_result_resort_items_ingredient_id_fkey;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_result_resort_items_ingredient_tenant_fkey') then
    alter table public.inventory_result_resort_items
      add constraint inventory_result_resort_items_ingredient_tenant_fkey
      foreign key (account_id, ingredient_id)
      references public.ingredients (account_id, id)
      on delete set null (ingredient_id);
  end if;
end $$;
-- Покрывающий индекс уже есть (миграция 192).

-- inventory_recount_moves.ingredient_id — FK не было вовсе (миграция 223).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_recount_moves_ingredient_tenant_fkey') then
    alter table public.inventory_recount_moves
      add constraint inventory_recount_moves_ingredient_tenant_fkey
      foreign key (account_id, ingredient_id)
      references public.ingredients (account_id, id)
      on delete set null (ingredient_id);
  end if;
end $$;
create index if not exists inventory_recount_moves_ingredient_idx
  on public.inventory_recount_moves (account_id, ingredient_id)
  where ingredient_id is not null;

-- ── 3. Дублирующие permissive-политики ──────────────────────────────────────
--
-- На ingredients / ingredient_groups / stores висели ДВЕ политики на SELECT:
-- собственно *_select и *_write, объявленная как FOR ALL (а значит,
-- покрывающая и чтение). Это, во-первых, advisor-хит multiple_permissive_policies
-- и двойная проверка на каждую строку; во-вторых — неявное расширение
-- видимости: держатель manage_* читал таблицу в обход предиката *_select
-- (для stores — в обход venue-скоупа из миграций 195/210).
--
-- Приводим к конвенции из CLAUDE.md: FOR ALL разбивается на INSERT/UPDATE/DELETE
-- (без SELECT), а *_select расширяется до (view OR manage) — чтобы держатели
-- manage_* не потеряли чтение. Поведение сохраняется ровно то, что было; просто
-- теперь оно записано явно, а не вытекает из write-политики.
--
-- NB: у роли authenticated на этих таблицах есть только грант SELECT, поэтому
-- write-политики и до, и после этой миграции недостижимы — вся запись идёт
-- через server actions под service_role.

drop policy if exists "ingredient_groups_write" on public.ingredient_groups;
create policy "ingredient_groups_write" on public.ingredient_groups
  for insert with check (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.manage_products'::text)
  );
create policy "ingredient_groups_update" on public.ingredient_groups
  for update using (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.manage_products'::text)
  );
create policy "ingredient_groups_delete" on public.ingredient_groups
  for delete using (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.manage_products'::text)
  );
drop policy if exists "ingredient_groups_select" on public.ingredient_groups;
create policy "ingredient_groups_select" on public.ingredient_groups
  for select using (
    account_id = public.get_active_account_id()
    and (
      public.has_permission('inventory.view_products'::text)
      or public.has_permission('inventory.manage_products'::text)
    )
  );

drop policy if exists "ingredients_write" on public.ingredients;
create policy "ingredients_write" on public.ingredients
  for insert with check (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.manage_products'::text)
  );
create policy "ingredients_update" on public.ingredients
  for update using (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.manage_products'::text)
  );
create policy "ingredients_delete" on public.ingredients
  for delete using (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.manage_products'::text)
  );
drop policy if exists "ingredients_select" on public.ingredients;
create policy "ingredients_select" on public.ingredients
  for select using (
    account_id = public.get_active_account_id()
    and (
      public.has_permission('inventory.view_products'::text)
      or public.has_permission('inventory.manage_products'::text)
      or exists (
        select 1
          from public.document_items idi
          join public.documents d on d.id = idi.document_id
         where idi.ingredient_id = ingredients.id
           and d.assigned_to = (select auth.uid())
           and public.has_permission('inventory.fill_assigned_documents'::text)
      )
    )
  );

drop policy if exists "stores_write" on public.stores;
create policy "stores_write" on public.stores
  for insert with check (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.manage_stores'::text)
  );
create policy "stores_update" on public.stores
  for update using (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.manage_stores'::text)
  );
create policy "stores_delete" on public.stores
  for delete using (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.manage_stores'::text)
  );
drop policy if exists "stores_select" on public.stores;
create policy "stores_select" on public.stores
  for select using (
    account_id = public.get_active_account_id()
    -- Кто именно виден по заведению (сохранено из миграции 210) ...
    and (
      public.has_permission('inventory.view_all_venues'::text)
      or public.has_permission('inventory.manage_stores'::text)
      or (local_venue_id is not null and local_venue_id = public.get_active_venue_id())
      or exists (
        select 1 from public.documents d
         where d.store_id = stores.id
           and (
             (d.assigned_to = (select auth.uid())
              and public.has_permission('inventory.fill_assigned_documents'::text))
             or (d.reviewer_id = (select auth.uid())
                 and public.has_permission('inventory.recount_documents'::text))
           )
      )
    )
    -- ... и у кого вообще есть повод видеть склады.
    and (
      public.has_permission('inventory.view_stores'::text)
      or public.has_permission('inventory.view_documents'::text)
      or public.has_permission('inventory.manage_stores'::text)
      or exists (
        select 1 from public.documents d
         where d.store_id = stores.id
           and (
             (d.assigned_to = (select auth.uid())
              and public.has_permission('inventory.fill_assigned_documents'::text))
             or (d.reviewer_id = (select auth.uid())
                 and public.has_permission('inventory.recount_documents'::text))
           )
      )
    )
  );

-- ── 4. anon не должен читать след выноса на пересчёт ────────────────────────
--
-- Миграция 223 выдала anon грант SELECT — единственная такая таблица в модуле.
-- Политика inventory_recount_moves_select собственного предиката аккаунта не
-- содержит, она делегирует его подзапросу к documents; для anon это лишний
-- путь, которого быть не должно.
revoke select on public.inventory_recount_moves from anon;

-- ── 5. search_path у trigger-функций ────────────────────────────────────────
--
-- Две функции модуля остались без SET search_path (в зачистку миграции 160 не
-- попали). Тела плоские, но конвенция репозитория требует явного search_path
-- у каждой функции в public.
create or replace function public.tg_inventory_touch_updated()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.tg_inventory_item_touch_updated()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
