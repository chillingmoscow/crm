-- ============================================================
-- 03_inventory_module.sql — inventory schema, permissions, RLS.
--
-- Run AFTER all migrations on a fresh local Supabase DB:
--   supabase db reset --local
--   docker exec -i supabase_db_crm psql -U postgres -d postgres -f - \
--     < supabase/tests/03_inventory_module.sql
--
-- The script wraps everything in a single transaction and ROLLBACKs at
-- the end, so it never leaves test data behind.
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
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'ingredients'
        and column_name = 'primary_image_file_id'
    ),
    'ingredients.primary_image_file_id is missing'
  );

  perform public.test_assert(
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'document_items'
        and column_name = 'excluded_from_totals'
    ),
    'document_items.excluded_from_totals is missing'
  );
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 2. Permission matrix.
-- ────────────────────────────────────────────────────────────
do $$
begin
  perform public.test_assert(
    (select count(*) from public.permissions where module = 'inventory') = 13,
    'expected 13 inventory permissions'
  );

  perform public.test_assert(
    (select count(*)
       from public.role_permissions rp
       join public.roles r on r.id = rp.role_id
       join public.permissions p on p.id = rp.permission_id
      where r.code = 'manager'
        and r.account_id is null
        and p.module = 'inventory'
        and rp.granted = true
    ) = 13,
    'manager should have all inventory permissions'
  );

  perform public.test_assert(
    exists (
      select 1
      from public.role_permissions rp
      join public.roles r on r.id = rp.role_id
      join public.permissions p on p.id = rp.permission_id
      where r.code = 'waiter'
        and r.account_id is null
        and p.code = 'inventory.fill_assigned_documents'
        and rp.granted = true
    ),
    'waiter should be allowed to fill assigned inventory documents'
  );

  perform public.test_assert(
    not exists (
      select 1
      from public.role_permissions rp
      join public.roles r on r.id = rp.role_id
      join public.permissions p on p.id = rp.permission_id
      where r.code = 'waiter'
        and r.account_id is null
        and p.code in (
          'inventory.view_documents',
          'inventory.manage_documents',
          'inventory.view_results',
          'inventory.comment_results',
          'inventory.adjust_results',
          'inventory.finalize_results',
          'inventory.use_ai_suggestions'
        )
        and rp.granted = true
    ),
    'waiter should not have manager inventory permissions'
  );
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 3. Test data in two accounts.
-- ────────────────────────────────────────────────────────────
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000'::uuid, '90000000-0000-0000-0000-000000000001'::uuid, 'authenticated', 'authenticated', 'inventory-owner@test.local', crypt('password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000'::uuid, '90000000-0000-0000-0000-000000000002'::uuid, 'authenticated', 'authenticated', 'inventory-manager@test.local', crypt('password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000'::uuid, '90000000-0000-0000-0000-000000000003'::uuid, 'authenticated', 'authenticated', 'inventory-waiter@test.local', crypt('password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000'::uuid, '90000000-0000-0000-0000-000000000004'::uuid, 'authenticated', 'authenticated', 'inventory-other@test.local', crypt('password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, first_name, last_name)
values
  ('90000000-0000-0000-0000-000000000001', 'Inventory', 'Owner'),
  ('90000000-0000-0000-0000-000000000002', 'Inventory', 'Manager'),
  ('90000000-0000-0000-0000-000000000003', 'Inventory', 'Waiter'),
  ('90000000-0000-0000-0000-000000000004', 'Inventory', 'Other')
on conflict (id) do nothing;

insert into public.accounts (id, name, owner_id)
values
  ('91000000-0000-0000-0000-000000000001', 'Inventory Account 1', '90000000-0000-0000-0000-000000000001'),
  ('91000000-0000-0000-0000-000000000002', 'Inventory Account 2', '90000000-0000-0000-0000-000000000004')
on conflict (id) do nothing;

insert into public.venues (id, account_id, name, type)
values
  ('92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 'Inventory Venue 1', 'restaurant'),
  ('92000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000002', 'Inventory Venue 2', 'restaurant')
on conflict (id) do nothing;

update public.profiles
set active_venue_id = '92000000-0000-0000-0000-000000000001'
where id in (
  '90000000-0000-0000-0000-000000000001',
  '90000000-0000-0000-0000-000000000002',
  '90000000-0000-0000-0000-000000000003'
);

update public.profiles
set active_venue_id = '92000000-0000-0000-0000-000000000002'
where id = '90000000-0000-0000-0000-000000000004';

insert into public.user_venue_roles (user_id, venue_id, role_id, status)
select '90000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001', id, 'active'
from public.roles where code = 'owner' and account_id is null
on conflict (user_id, venue_id) do update set role_id = excluded.role_id, status = 'active';

insert into public.user_venue_roles (user_id, venue_id, role_id, status)
select '90000000-0000-0000-0000-000000000002', '92000000-0000-0000-0000-000000000001', id, 'active'
from public.roles where code = 'manager' and account_id is null
on conflict (user_id, venue_id) do update set role_id = excluded.role_id, status = 'active';

insert into public.user_venue_roles (user_id, venue_id, role_id, status)
select '90000000-0000-0000-0000-000000000003', '92000000-0000-0000-0000-000000000001', id, 'active'
from public.roles where code = 'waiter' and account_id is null
on conflict (user_id, venue_id) do update set role_id = excluded.role_id, status = 'active';

insert into public.user_venue_roles (user_id, venue_id, role_id, status)
select '90000000-0000-0000-0000-000000000004', '92000000-0000-0000-0000-000000000002', id, 'active'
from public.roles where code = 'owner' and account_id is null
on conflict (user_id, venue_id) do update set role_id = excluded.role_id, status = 'active';

insert into public.ingredient_groups (id, account_id, external_id, name)
values
  ('93000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 'g-1', 'Assigned group'),
  ('93000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000001', 'g-2', 'Other group'),
  ('93000000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000002', 'g-3', 'Other account group');

insert into public.ingredients (id, account_id, external_id, name, group_id)
values
  ('93100000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 'p-1', 'Assigned product', '93000000-0000-0000-0000-000000000001'),
  ('93100000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000001', 'p-2', 'Unassigned product', '93000000-0000-0000-0000-000000000002'),
  ('93100000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000002', 'p-3', 'Other account product', '93000000-0000-0000-0000-000000000003');

insert into public.stores (id, account_id, external_id, title)
values
  ('93200000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 's-1', 'Assigned store'),
  ('93200000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000001', 's-2', 'Other store'),
  ('93200000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000002', 's-3', 'Other account store');

insert into public.documents (id, account_id, external_id, document_number, store_id, assigned_to, status, processed)
values
  ('94000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 'd-1', 'INV-1', '93200000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000003', 'assigned', false),
  ('94000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000001', 'd-2', 'INV-2', '93200000-0000-0000-0000-000000000002', null, 'synced', false),
  ('94000000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000002', 'd-3', 'INV-3', '93200000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000004', 'assigned', false);

insert into public.document_items (id, account_id, document_id, external_item_id, ingredient_id, product_name)
values
  ('95000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000001', 'i-1', '93100000-0000-0000-0000-000000000001', 'Assigned product'),
  ('95000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000002', 'i-2', '93100000-0000-0000-0000-000000000002', 'Unassigned product'),
  ('95000000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000002', '94000000-0000-0000-0000-000000000003', 'i-3', '93100000-0000-0000-0000-000000000003', 'Other account product');

insert into public.inventory_result_resorts (
  id, account_id, document_id, group_id, group_name, measure_unit_key,
  reason, offset_amount, created_by
)
values (
  '96000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000001',
  '94000000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000001',
  'Assigned group',
  'id:1',
  'Test resort',
  1,
  '90000000-0000-0000-0000-000000000002'
);

insert into public.inventory_result_resort_items (
  id, account_id, resort_id, document_id, document_item_id,
  ingredient_id, product_name, role
)
values (
  '96100000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000001',
  '96000000-0000-0000-0000-000000000001',
  '94000000-0000-0000-0000-000000000001',
  '95000000-0000-0000-0000-000000000001',
  '93100000-0000-0000-0000-000000000001',
  'Assigned product',
  'shortage'
);

insert into public.inventory_result_events (
  id, account_id, document_id, document_item_id, resort_id,
  event_type, message, created_by
)
values (
  '96200000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000001',
  '94000000-0000-0000-0000-000000000001',
  '95000000-0000-0000-0000-000000000001',
  '96000000-0000-0000-0000-000000000001',
  'resort_created',
  'Created resort',
  '90000000-0000-0000-0000-000000000002'
);

insert into public.inventory_result_exclusion_rules (
  id, account_id, ingredient_id, external_product_id, product_name, reason, created_by
)
values (
  '96300000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000001',
  '93100000-0000-0000-0000-000000000001',
  'p-1',
  'Assigned product',
  'Never charge staff for this product',
  '90000000-0000-0000-0000-000000000002'
);

-- ────────────────────────────────────────────────────────────
-- 4. Manager sees account-local inventory.
-- ────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"90000000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role = authenticated;

do $$
begin
  perform public.test_assert(public.get_active_account_id() = '91000000-0000-0000-0000-000000000001', 'manager active account mismatch');
  perform public.test_assert(public.has_permission('inventory.sync_quickresto'), 'manager should sync inventory');
  perform public.test_assert((select count(*) from public.documents) = 2, 'manager should see 2 account documents');
  perform public.test_assert((select count(*) from public.document_items) = 2, 'manager should see 2 account items');
  perform public.test_assert((select count(*) from public.ingredients) = 2, 'manager should see 2 account products');
  perform public.test_assert((select count(*) from public.ingredient_groups) = 2, 'manager should see 2 account groups');
  perform public.test_assert((select count(*) from public.stores) = 2, 'manager should see 2 account stores');
  perform public.test_assert((select count(*) from public.inventory_result_resorts) = 1, 'manager should see account resort decisions');
  perform public.test_assert((select count(*) from public.inventory_result_events) = 1, 'manager should see account result events');
  perform public.test_assert((select count(*) from public.inventory_result_exclusion_rules) = 1, 'manager should see account exclusion rules');
end;
$$;

reset role;

-- ────────────────────────────────────────────────────────────
-- 5. Assigned waiter sees only assigned document scope and cannot write directly.
-- ────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"90000000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role = authenticated;

do $$
declare
  v_update_denied boolean := false;
begin
  perform public.test_assert(public.get_active_account_id() = '91000000-0000-0000-0000-000000000001', 'waiter active account mismatch');
  perform public.test_assert(public.has_permission('inventory.fill_assigned_documents'), 'waiter should fill assigned documents');
  perform public.test_assert(not public.has_permission('inventory.view_documents'), 'waiter should not view all documents');
  perform public.test_assert(not public.has_permission('inventory.manage_documents'), 'waiter should not manage documents');

  perform public.test_assert((select count(*) from public.documents) = 1, 'waiter should see only assigned document');
  perform public.test_assert((select count(*) from public.document_items) = 1, 'waiter should see only assigned items');
  perform public.test_assert((select count(*) from public.ingredients) = 1, 'waiter should see only products in assigned document');
  perform public.test_assert((select count(*) from public.ingredient_groups) = 0, 'waiter should not browse product groups');
  perform public.test_assert((select count(*) from public.stores) = 1, 'waiter should see only assigned document store');
  perform public.test_assert((select count(*) from public.inventory_result_resorts) = 0, 'waiter should not see result decisions');
  perform public.test_assert((select count(*) from public.inventory_result_events) = 0, 'waiter should not see result events');
  perform public.test_assert((select count(*) from public.inventory_result_exclusion_rules) = 0, 'waiter should not see exclusion rules');

  begin
    update public.document_items
       set actual_amount = 10
     where id = '95000000-0000-0000-0000-000000000001';
  exception
    when insufficient_privilege then
      v_update_denied := true;
  end;

  perform public.test_assert(v_update_denied, 'waiter direct inventory item update should be denied');
end;
$$;

reset role;

-- ────────────────────────────────────────────────────────────
-- 6. Other account owner cannot see account 1 rows.
-- ────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"90000000-0000-0000-0000-000000000004","role":"authenticated"}';
set local role = authenticated;

do $$
begin
  perform public.test_assert(public.get_active_account_id() = '91000000-0000-0000-0000-000000000002', 'other owner active account mismatch');
  perform public.test_assert((select count(*) from public.documents) = 1, 'other owner should see only own account document');
  perform public.test_assert((select count(*) from public.document_items) = 1, 'other owner should see only own account item');
  perform public.test_assert((select count(*) from public.ingredients) = 1, 'other owner should see only own account product');
end;
$$;

reset role;

rollback;

select '03_inventory_module.sql passed' as result;
