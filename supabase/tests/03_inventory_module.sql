-- ============================================================
-- 03_inventory_module.sql — inventory schema, permissions, RLS.
--
-- Run AFTER all migrations on a fresh local Supabase DB:
--   supabase db reset --local
--   docker exec -i supabase_db_crm psql -U postgres -d postgres -f - \
--     < supabase/tests/03_inventory_module.sql
--
-- Модель прав/ролей — текущая (venue-scoped):
--   * роли скоупятся по venue_id (account_id удалён миграцией 172);
--   * единственный глобальный preset — owner (venue_id is null), у него все
--     inventory-права;
--   * права inventory лежат в модулях inventory_documents / inventory_products /
--     inventory_stores / inventory_integration / inventory_scope (15 шт.);
--   * has_permission резолвит через user_venue_roles → role_permissions →
--     permissions для активного venue.
-- Для «ограниченного» тира (только заполнение) собираем кастомную роль прямо
-- в тесте: триггер roles_apply_default_inventory_permissions выдаёт дефолтный
-- набор на INSERT роли, поэтому после вставки пересобираем её role_permissions.
--
-- Всё в одной транзакции с ROLLBACK в конце — тестовых данных не остаётся.
-- ============================================================

\set ON_ERROR_STOP on

begin;

create or replace function public.test_assert(p_condition boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if not p_condition then
    raise exception 'TEST FAILED: %', p_message;
  end if;
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 1. Schema exists.
-- ────────────────────────────────────────────────────────────
do $$
begin
  perform public.test_assert(
    exists (select 1 from pg_type where typname = 'inventory_document_status_enum'),
    'inventory_document_status_enum is missing'
  );

  perform public.test_assert(
    (select count(*)
       from information_schema.tables
      where table_schema = 'public'
        and table_name in (
          'ingredient_groups',
          'ingredients',
          'stores',
          'documents',
          'document_items',
          'inventory_result_resorts',
          'inventory_result_resort_items',
          'inventory_result_events',
          'inventory_result_exclusion_rules'
        )
    ) = 9,
    'one of inventory tables is missing'
  );

  perform public.test_assert(
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'ingredients'
        and column_name = 'primary_image_file_id'
    ),
    'ingredients.primary_image_file_id is missing'
  );

  perform public.test_assert(
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'document_items'
        and column_name = 'excluded_from_totals'
    ),
    'document_items.excluded_from_totals is missing'
  );

  -- Денормализованный venue_id на documents (миграция 194) — основа venue-скопа.
  perform public.test_assert(
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'documents'
        and column_name = 'venue_id'
    ),
    'documents.venue_id is missing'
  );
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 2. Permission catalog + глобальный owner-preset.
-- ────────────────────────────────────────────────────────────
do $$
begin
  -- 15 inventory-прав по модулям inventory_*.
  perform public.test_assert(
    (select count(*) from public.permissions where module like 'inventory%') = 15,
    'expected 15 inventory permissions across inventory_* modules'
  );

  -- Глобальный preset owner (venue_id is null) грантит ВСЕ inventory-права.
  perform public.test_assert(
    (select count(*) from public.permissions p where p.module like 'inventory%')
      = (
        select count(*)
          from public.role_permissions rp
          join public.roles r       on r.id = rp.role_id
          join public.permissions p on p.id = rp.permission_id
         where r.code = 'owner' and r.venue_id is null
           and p.module like 'inventory%'
           and rp.granted = true
      ),
    'global owner role must grant every inventory permission'
  );

  -- Ключевые коды на месте.
  perform public.test_assert(
    (select count(*) from public.permissions
      where code in (
        'inventory.view_documents',
        'inventory.manage_documents',
        'inventory.fill_assigned_documents',
        'inventory.view_results',
        'inventory.adjust_results',
        'inventory.finalize_results',
        'inventory.recount_documents',
        'inventory.view_all_venues'
      )
    ) = 8,
    'one of the key inventory permission codes is missing'
  );
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 3. Тестовые данные в двух аккаунтах + кастомная «fill-only» роль.
-- ────────────────────────────────────────────────────────────
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000'::uuid, 'b9000000-0000-0000-0000-000000000001'::uuid, 'authenticated', 'authenticated', 'inv03-full@test.local',  crypt('password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'b9000000-0000-0000-0000-000000000002'::uuid, 'authenticated', 'authenticated', 'inv03-fill@test.local',  crypt('password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'b9000000-0000-0000-0000-000000000003'::uuid, 'authenticated', 'authenticated', 'inv03-other@test.local', crypt('password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, first_name, last_name)
values
  ('b9000000-0000-0000-0000-000000000001', 'Inv03', 'Full'),
  ('b9000000-0000-0000-0000-000000000002', 'Inv03', 'Fill'),
  ('b9000000-0000-0000-0000-000000000003', 'Inv03', 'Other')
on conflict (id) do nothing;

insert into public.accounts (id, name, owner_id)
values
  ('b1000000-0000-0000-0000-000000000001', 'Inv03 Account 1', 'b9000000-0000-0000-0000-000000000001'),
  ('b1000000-0000-0000-0000-000000000002', 'Inv03 Account 2', 'b9000000-0000-0000-0000-000000000003')
on conflict (id) do nothing;

insert into public.venues (id, account_id, name, type)
values
  ('b2000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'Inv03 Venue 1', 'restaurant'),
  ('b2000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000002', 'Inv03 Venue 2', 'restaurant')
on conflict (id) do nothing;

update public.profiles set active_venue_id = 'b2000000-0000-0000-0000-000000000001'
where id in ('b9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000002');
update public.profiles set active_venue_id = 'b2000000-0000-0000-0000-000000000002'
where id = 'b9000000-0000-0000-0000-000000000003';

-- Кастомная роль «только заполнение» в venue1. После INSERT триггер выдаёт
-- дефолтный inventory-набор → пересобираем role_permissions до одного права.
insert into public.roles (id, name, code, venue_id)
values ('b3f00000-0000-0000-0000-000000000001', 'Inv03 Fill Only', 'custom_inv03_fill', 'b2000000-0000-0000-0000-000000000001');

delete from public.role_permissions where role_id = 'b3f00000-0000-0000-0000-000000000001';
insert into public.role_permissions (role_id, permission_id, granted)
select 'b3f00000-0000-0000-0000-000000000001', id, true
from public.permissions where code = 'inventory.fill_assigned_documents';

-- full-доступ → глобальная роль owner (все inventory-права + view_all_venues).
insert into public.user_venue_roles (user_id, venue_id, role_id, status)
select 'b9000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', id, 'active'
from public.roles where code = 'owner' and venue_id is null
on conflict (user_id, venue_id) do update set role_id = excluded.role_id, status = 'active';

-- fill-only пользователь → кастомная роль.
insert into public.user_venue_roles (user_id, venue_id, role_id, status)
values ('b9000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000001', 'b3f00000-0000-0000-0000-000000000001', 'active')
on conflict (user_id, venue_id) do update set role_id = excluded.role_id, status = 'active';

-- владелец другого аккаунта → глобальная owner в venue2.
insert into public.user_venue_roles (user_id, venue_id, role_id, status)
select 'b9000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-000000000002', id, 'active'
from public.roles where code = 'owner' and venue_id is null
on conflict (user_id, venue_id) do update set role_id = excluded.role_id, status = 'active';

insert into public.ingredient_groups (id, account_id, external_id, name)
values
  ('b4000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'g03-1', 'Inv03 group 1'),
  ('b4000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 'g03-2', 'Inv03 group 2'),
  ('b4000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000002', 'g03-3', 'Inv03 other-account group');

insert into public.ingredients (id, account_id, external_id, name, group_id)
values
  ('b5000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'p03-1', 'Inv03 product 1', 'b4000000-0000-0000-0000-000000000001'),
  ('b5000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 'p03-2', 'Inv03 product 2', 'b4000000-0000-0000-0000-000000000002'),
  ('b5000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000002', 'p03-3', 'Inv03 other-account product', 'b4000000-0000-0000-0000-000000000003');

insert into public.stores (id, account_id, external_id, title, local_venue_id)
values
  ('b6000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 's03-1', 'Inv03 store 1', 'b2000000-0000-0000-0000-000000000001'),
  ('b6000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 's03-2', 'Inv03 store 2', 'b2000000-0000-0000-0000-000000000001'),
  ('b6000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000002', 's03-3', 'Inv03 other-account store', 'b2000000-0000-0000-0000-000000000002');

-- D1 (venue1, назначен fill-only), D2 (venue1, без исполнителя), D3 (другой аккаунт).
insert into public.documents (id, account_id, external_id, document_kind, document_number, store_id, venue_id, assigned_to, status, processed)
values
  ('b7000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'd03-1', 'inventory', 'INV03-1', 'b6000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000002', 'assigned', false),
  ('b7000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 'd03-2', 'inventory', 'INV03-2', 'b6000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000001', null, 'synced', false),
  ('b7000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000002', 'd03-3', 'inventory', 'INV03-3', 'b6000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-000000000002', 'b9000000-0000-0000-0000-000000000003', 'assigned', false);

insert into public.document_items (id, account_id, document_id, external_item_id, ingredient_id, product_name)
values
  ('b8000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000001', 'i03-1', 'b5000000-0000-0000-0000-000000000001', 'Inv03 product 1'),
  ('b8000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000002', 'i03-2', 'b5000000-0000-0000-0000-000000000002', 'Inv03 product 2'),
  ('b8000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000002', 'b7000000-0000-0000-0000-000000000003', 'i03-3', 'b5000000-0000-0000-0000-000000000003', 'Inv03 other-account product');

insert into public.inventory_result_resorts (id, account_id, document_id, group_id, group_name, measure_unit_key, reason, offset_amount, created_by)
values ('bb000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000001', 'b4000000-0000-0000-0000-000000000001', 'Inv03 group 1', 'id:1', 'Test resort', 1, 'b9000000-0000-0000-0000-000000000001');

insert into public.inventory_result_resort_items (id, account_id, resort_id, document_id, document_item_id, ingredient_id, product_name, role)
values ('bc000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000001', 'b5000000-0000-0000-0000-000000000001', 'Inv03 product 1', 'shortage');

insert into public.inventory_result_events (id, account_id, document_id, document_item_id, resort_id, event_type, message, created_by)
values ('bd000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-000000000001', 'resort_created', 'Created resort', 'b9000000-0000-0000-0000-000000000001');

insert into public.inventory_result_exclusion_rules (id, account_id, ingredient_id, external_product_id, product_name, reason, created_by)
values ('be000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'b5000000-0000-0000-0000-000000000001', 'p03-1', 'Inv03 product 1', 'Never charge staff for this product', 'b9000000-0000-0000-0000-000000000001');

-- ────────────────────────────────────────────────────────────
-- 4. Полный доступ (owner-роль): видит весь инвентарь своего аккаунта.
-- ────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"b9000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role = authenticated;

do $$
begin
  perform public.test_assert(public.get_active_account_id() = 'b1000000-0000-0000-0000-000000000001', 'full active account mismatch');
  perform public.test_assert(public.has_permission('inventory.view_documents'), 'full should view documents');
  perform public.test_assert(public.has_permission('inventory.manage_documents'), 'full should manage documents');
  perform public.test_assert(public.has_permission('inventory.view_results'), 'full should view results');
  perform public.test_assert(public.has_permission('inventory.sync_quickresto'), 'full should sync inventory');

  perform public.test_assert((select count(*) from public.documents) = 2, 'full should see 2 account documents');
  perform public.test_assert((select count(*) from public.document_items) = 2, 'full should see 2 account items');
  perform public.test_assert((select count(*) from public.ingredients) = 2, 'full should see 2 account products');
  perform public.test_assert((select count(*) from public.ingredient_groups) = 2, 'full should see 2 account groups');
  perform public.test_assert((select count(*) from public.stores) = 2, 'full should see 2 account stores');
  perform public.test_assert((select count(*) from public.inventory_result_resorts) = 1, 'full should see account resort');
  perform public.test_assert((select count(*) from public.inventory_result_events) = 1, 'full should see account result events');
  perform public.test_assert((select count(*) from public.inventory_result_exclusion_rules) = 1, 'full should see account exclusion rules');
end;
$$;

reset role;

-- ────────────────────────────────────────────────────────────
-- 5. Fill-only: видит только назначенный акт, не видит итоги, не пишет напрямую.
-- ────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"b9000000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role = authenticated;

do $$
declare
  v_rows int;
  v_denied boolean := false;
begin
  perform public.test_assert(public.get_active_account_id() = 'b1000000-0000-0000-0000-000000000001', 'fill active account mismatch');
  perform public.test_assert(public.has_permission('inventory.fill_assigned_documents'), 'fill should fill assigned documents');
  perform public.test_assert(not public.has_permission('inventory.view_documents'), 'fill should NOT view all documents');
  perform public.test_assert(not public.has_permission('inventory.manage_documents'), 'fill should NOT manage documents');
  perform public.test_assert(not public.has_permission('inventory.view_results'), 'fill should NOT view results');
  perform public.test_assert(not public.has_permission('inventory.adjust_results'), 'fill should NOT adjust results');

  perform public.test_assert((select count(*) from public.documents) = 1, 'fill should see only the assigned document');
  perform public.test_assert((select count(*) from public.document_items) = 1, 'fill should see only assigned items');
  perform public.test_assert((select count(*) from public.inventory_result_resorts) = 0, 'fill should not see result decisions');
  perform public.test_assert((select count(*) from public.inventory_result_events) = 0, 'fill should not see result events');
  perform public.test_assert((select count(*) from public.inventory_result_exclusion_rules) = 0, 'fill should not see exclusion rules');

  -- Прямая запись в document_items недоступна (фактические значения пишет
  -- server action под admin-клиентом). Блокировка либо на уровне grant
  -- (insufficient_privilege), либо RLS отфильтровывает строку (0 rows).
  begin
    update public.document_items set actual_amount = 999 where id = 'b8000000-0000-0000-0000-000000000001';
    get diagnostics v_rows = row_count;
  exception when insufficient_privilege then
    v_denied := true;
    v_rows := 0;
  end;
  perform public.test_assert(v_denied or v_rows = 0, 'fill-only direct document_items update must not take effect');
end;
$$;

reset role;

-- ────────────────────────────────────────────────────────────
-- 6. Владелец другого аккаунта не видит строки аккаунта 1.
-- ────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"b9000000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role = authenticated;

do $$
begin
  perform public.test_assert(public.get_active_account_id() = 'b1000000-0000-0000-0000-000000000002', 'other owner active account mismatch');
  perform public.test_assert((select count(*) from public.documents) = 1, 'other owner should see only own account document');
  perform public.test_assert((select count(*) from public.document_items) = 1, 'other owner should see only own account item');
  perform public.test_assert((select count(*) from public.ingredients) = 1, 'other owner should see only own account product');
end;
$$;

reset role;

rollback;

select '03_inventory_module.sql passed' as result;
