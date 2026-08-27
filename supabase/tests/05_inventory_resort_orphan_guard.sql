-- ============================================================
-- 05_inventory_resort_orphan_guard.sql — триггер
-- inventory_void_orphan_resort (миграция 226): активный пересорт
-- не может остаться без пары, когда строка акта удалена.
--
-- Run AFTER all migrations on a fresh local Supabase DB:
--   supabase db reset --local
--   docker exec -i supabase_db_crm psql -U postgres -d postgres -f - \
--     < supabase/tests/05_inventory_resort_orphan_guard.sql
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
-- Test data.
-- ────────────────────────────────────────────────────────────
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values ('00000000-0000-0000-0000-000000000000'::uuid, 'bc000000-0000-0000-0000-000000000001'::uuid, 'authenticated', 'authenticated', 'inv05-owner@test.local', crypt('password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, first_name, last_name)
values ('bc000000-0000-0000-0000-000000000001', 'Inv05', 'Owner')
on conflict (id) do nothing;

insert into public.accounts (id, name, owner_id)
values ('ba000000-0000-0000-0000-000000000001', 'Inv05 Account', 'bc000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.venues (id, account_id, name, type)
values ('bb000000-0000-0000-0000-000000000001', 'ba000000-0000-0000-0000-000000000001', 'Inv05 Venue', 'restaurant')
on conflict (id) do nothing;

insert into public.stores (id, account_id, external_id, title, local_venue_id)
values ('bd000000-0000-0000-0000-000000000001', 'ba000000-0000-0000-0000-000000000001', 's05-1', 'Inv05 Store', 'bb000000-0000-0000-0000-000000000001');

insert into public.documents (id, account_id, external_id, document_kind, document_number, invoice_date, store_id, venue_id, status, processed)
values
  ('bf000000-0000-0000-0000-000000000001', 'ba000000-0000-0000-0000-000000000001', 'd05-1', 'inventory', 'INV-05-1', '2026-05-01', 'bd000000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-000000000001', 'ready_for_review', false),
  ('bf000000-0000-0000-0000-000000000002', 'ba000000-0000-0000-0000-000000000001', 'd05-2', 'inventory', 'INV-05-2', '2026-05-02', 'bd000000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-000000000001', 'ready_for_review', false);

-- Акт 1: пара из двух строк (недостача + излишек).
insert into public.document_items (id, account_id, document_id, external_item_id, product_name, actual_amount, calculated_amount, difference_amount, difference_sum)
values
  ('b5000000-0000-0000-0000-000000000001', 'ba000000-0000-0000-0000-000000000001', 'bf000000-0000-0000-0000-000000000001', 'i05-1', 'Inv05 shortage', 8,  10, -2, -200),
  ('b5000000-0000-0000-0000-000000000002', 'ba000000-0000-0000-0000-000000000001', 'bf000000-0000-0000-0000-000000000001', 'i05-2', 'Inv05 surplus',  12, 10,  2,  200);

insert into public.inventory_result_resorts (id, account_id, document_id, measure_unit_key, reason, status, offset_amount)
values ('b6000000-0000-0000-0000-000000000001', 'ba000000-0000-0000-0000-000000000001', 'bf000000-0000-0000-0000-000000000001', 'kg', 'Inv05 pair', 'active', 2);

insert into public.inventory_result_resort_items (id, account_id, resort_id, document_id, document_item_id, product_name, role, source_difference_amount, source_difference_sum, offset_amount)
values
  ('b7000000-0000-0000-0000-000000000001', 'ba000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001', 'bf000000-0000-0000-0000-000000000001', 'b5000000-0000-0000-0000-000000000001', 'Inv05 shortage', 'shortage', -2, -200, 2),
  ('b7000000-0000-0000-0000-000000000002', 'ba000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001', 'bf000000-0000-0000-0000-000000000001', 'b5000000-0000-0000-0000-000000000002', 'Inv05 surplus',  'surplus',   2,  200, 2);

-- Акт 2: пересорт из трёх строк (две недостачи + один излишек).
insert into public.document_items (id, account_id, document_id, external_item_id, product_name, actual_amount, calculated_amount, difference_amount, difference_sum)
values
  ('b5000000-0000-0000-0000-000000000011', 'ba000000-0000-0000-0000-000000000001', 'bf000000-0000-0000-0000-000000000002', 'i05-11', 'Inv05 shortage A', 9,  10, -1, -100),
  ('b5000000-0000-0000-0000-000000000012', 'ba000000-0000-0000-0000-000000000001', 'bf000000-0000-0000-0000-000000000002', 'i05-12', 'Inv05 shortage B', 9,  10, -1, -100),
  ('b5000000-0000-0000-0000-000000000013', 'ba000000-0000-0000-0000-000000000001', 'bf000000-0000-0000-0000-000000000002', 'i05-13', 'Inv05 surplus',    12, 10,  2,  200);

insert into public.inventory_result_resorts (id, account_id, document_id, measure_unit_key, reason, status, offset_amount)
values ('b6000000-0000-0000-0000-000000000002', 'ba000000-0000-0000-0000-000000000001', 'bf000000-0000-0000-0000-000000000002', 'kg', 'Inv05 trio', 'active', 2);

insert into public.inventory_result_resort_items (id, account_id, resort_id, document_id, document_item_id, product_name, role, source_difference_amount, source_difference_sum, offset_amount)
values
  ('b7000000-0000-0000-0000-000000000011', 'ba000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000002', 'bf000000-0000-0000-0000-000000000002', 'b5000000-0000-0000-0000-000000000011', 'Inv05 shortage A', 'shortage', -1, -100, 1),
  ('b7000000-0000-0000-0000-000000000012', 'ba000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000002', 'bf000000-0000-0000-0000-000000000002', 'b5000000-0000-0000-0000-000000000012', 'Inv05 shortage B', 'shortage', -1, -100, 1),
  ('b7000000-0000-0000-0000-000000000013', 'ba000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000002', 'bf000000-0000-0000-0000-000000000002', 'b5000000-0000-0000-0000-000000000013', 'Inv05 surplus',    'surplus',   2,  200, 2);

-- ────────────────────────────────────────────────────────────
-- 1. Удаление строки акта → пересорт из двух позиций аннулируется.
-- ────────────────────────────────────────────────────────────
do $$
declare
  v_status  text;
  v_reason  text;
  v_events  integer;
  v_items   integer;
begin
  delete from public.document_items where id = 'b5000000-0000-0000-0000-000000000001';

  select count(*) into v_items
    from public.inventory_result_resort_items
   where resort_id = 'b6000000-0000-0000-0000-000000000001';
  perform public.test_assert(v_items = 1, 'cascade must remove the resort item of a deleted document row');

  select status, void_reason into v_status, v_reason
    from public.inventory_result_resorts
   where id = 'b6000000-0000-0000-0000-000000000001';
  perform public.test_assert(v_status = 'voided', 'resort left without a pair must be voided');
  perform public.test_assert(v_reason is not null, 'voided resort must carry a reason');

  select count(*) into v_events
    from public.inventory_result_events
   where resort_id = 'b6000000-0000-0000-0000-000000000001'
     and event_type = 'resort_voided'
     and payload->>'reason' = 'orphan_resort_item';
  perform public.test_assert(v_events = 1, 'voiding must leave exactly one journal event');
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 2. Пересорт из трёх позиций: удаление одной недостачи оставляет
--    и недостачу, и излишек → пересорт остаётся активным.
-- ────────────────────────────────────────────────────────────
do $$
declare
  v_status text;
  v_events integer;
begin
  delete from public.document_items where id = 'b5000000-0000-0000-0000-000000000011';

  select status into v_status
    from public.inventory_result_resorts
   where id = 'b6000000-0000-0000-0000-000000000002';
  perform public.test_assert(v_status = 'active', 'resort that still has both roles must stay active');

  select count(*) into v_events
    from public.inventory_result_events
   where resort_id = 'b6000000-0000-0000-0000-000000000002';
  perform public.test_assert(v_events = 0, 'surviving resort must not produce a journal event');

  -- А вот потеря второй недостачи оставляет пересорт без пары.
  delete from public.document_items where id = 'b5000000-0000-0000-0000-000000000012';

  select status into v_status
    from public.inventory_result_resorts
   where id = 'b6000000-0000-0000-0000-000000000002';
  perform public.test_assert(v_status = 'voided', 'resort must be voided once a role disappears');
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 3. Удаление акта целиком (каскад) не падает и ничего не оставляет:
--    триггер обязан различать каскад и точечное удаление позиции.
-- ────────────────────────────────────────────────────────────
do $$
declare
  v_rows integer;
begin
  delete from public.documents where id = 'bf000000-0000-0000-0000-000000000002';

  select count(*) into v_rows
    from public.inventory_result_resorts
   where document_id = 'bf000000-0000-0000-0000-000000000002';
  perform public.test_assert(v_rows = 0, 'document delete must cascade resorts away');

  select count(*) into v_rows
    from public.inventory_result_events
   where document_id = 'bf000000-0000-0000-0000-000000000002';
  perform public.test_assert(v_rows = 0, 'document delete must cascade journal events away');
end;
$$;

rollback;

select '05_inventory_resort_orphan_guard.sql passed' as result;
