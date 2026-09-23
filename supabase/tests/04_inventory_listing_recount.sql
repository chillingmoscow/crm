-- ============================================================
-- 04_inventory_listing_recount.sql — RPC list_inventory_documents
-- (фильтры/поиск/пагинация/venue) и триггер автомаркера пересчёта
-- inventory_apply_recount_threshold.
--
-- Run AFTER all migrations on a fresh local Supabase DB:
--   supabase db reset --local
--   docker exec -i supabase_db_crm psql -U postgres -d postgres -f - \
--     < supabase/tests/04_inventory_listing_recount.sql
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
values
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ac000000-0000-0000-0000-000000000001'::uuid, 'authenticated', 'authenticated', 'inv04-owner@test.local',   crypt('password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ac000000-0000-0000-0000-000000000002'::uuid, 'authenticated', 'authenticated', 'inv04-manager@test.local', crypt('password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, first_name, last_name)
values
  ('ac000000-0000-0000-0000-000000000001', 'Inv04', 'Owner'),
  ('ac000000-0000-0000-0000-000000000002', 'Inv04', 'Manager')
on conflict (id) do nothing;

insert into public.accounts (id, name, owner_id)
values ('aa000000-0000-0000-0000-000000000001', 'Inv04 Account', 'ac000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

-- venue1 + venue2 в одном аккаунте; пороги пересчёта явно (sum=500, percent=10).
insert into public.venues (id, account_id, name, type, inventory_recount_threshold_sum, inventory_recount_threshold_percent)
values
  ('ab000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000001', 'Inv04 Venue 1', 'restaurant', 500, 10),
  ('ab000000-0000-0000-0000-000000000002', 'aa000000-0000-0000-0000-000000000001', 'Inv04 Venue 2', 'restaurant', 500, 10)
on conflict (id) do nothing;

update public.profiles set active_venue_id = 'ab000000-0000-0000-0000-000000000001'
where id in ('ac000000-0000-0000-0000-000000000001', 'ac000000-0000-0000-0000-000000000002');

-- Тест-пользователю назначаем глобальную preset-роль owner (venue_id is null):
-- у неё все inventory-права, включая view_all_venues, поэтому она видит акты
-- обоих заведений аккаунта (нужно для проверки venue-фильтра RPC).
insert into public.user_venue_roles (user_id, venue_id, role_id, status)
select 'ac000000-0000-0000-0000-000000000002', 'ab000000-0000-0000-0000-000000000001', id, 'active'
from public.roles where code = 'owner' and venue_id is null
on conflict (user_id, venue_id) do update set role_id = excluded.role_id, status = 'active';

insert into public.ingredient_groups (id, account_id, external_id, name)
values ('ae000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000001', 'g04-1', 'Inv04 group');

insert into public.ingredients (id, account_id, external_id, name, group_id)
values ('ae100000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000001', 'p04-1', 'Zubrovka Poisk', 'ae000000-0000-0000-0000-000000000001');

insert into public.stores (id, account_id, external_id, title, local_venue_id)
values
  ('ad000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000001', 's04-1', 'Inv04 Store 1', 'ab000000-0000-0000-0000-000000000001'),
  ('ad000000-0000-0000-0000-000000000002', 'aa000000-0000-0000-0000-000000000001', 's04-2', 'Inv04 Store 2', 'ab000000-0000-0000-0000-000000000002');

-- Три акта: D1 (venue1, assigned менеджеру, status assigned),
-- D2 (venue1, без исполнителя, synced), D3 (venue2, ready_for_review).
insert into public.documents (id, account_id, external_id, document_kind, document_number, invoice_date, store_id, venue_id, assigned_to, status, processed)
values
  ('af000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000001', 'd04-1', 'inventory', 'INV-RPC-1', '2026-05-01', 'ad000000-0000-0000-0000-000000000001', 'ab000000-0000-0000-0000-000000000001', 'ac000000-0000-0000-0000-000000000002', 'assigned', false),
  ('af000000-0000-0000-0000-000000000002', 'aa000000-0000-0000-0000-000000000001', 'd04-2', 'inventory', 'INV-RPC-2', '2026-05-02', 'ad000000-0000-0000-0000-000000000001', 'ab000000-0000-0000-0000-000000000001', null, 'synced', false),
  ('af000000-0000-0000-0000-000000000003', 'aa000000-0000-0000-0000-000000000001', 'd04-3', 'inventory', 'INV-RPC-3', '2026-05-03', 'ad000000-0000-0000-0000-000000000002', 'ab000000-0000-0000-0000-000000000002', null, 'ready_for_review', false);

-- Позиция с уникальным product_name для проверки поиска + matched_ingredients.
insert into public.document_items (id, account_id, document_id, external_item_id, ingredient_id, product_name, actual_amount)
values
  ('a5000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000001', 'af000000-0000-0000-0000-000000000001', 'i04-1', 'ae100000-0000-0000-0000-000000000001', 'Zubrovka Poisk', 5);

-- ────────────────────────────────────────────────────────────
-- 1. Триггер автомаркера пересчёта (inventory_apply_recount_threshold).
--    Контекст суперпользователя; триггер срабатывает на INSERT/UPDATE.
-- ────────────────────────────────────────────────────────────
do $$
declare
  v_needs boolean;
  v_auto  boolean;
begin
  -- Превышение по СУММЕ (|-600| > 500) при заданном факте → авто-флаг.
  insert into public.document_items (id, account_id, document_id, external_item_id, product_name, actual_amount, calculated_amount, difference_amount, difference_sum)
  values ('a5000000-0000-0000-0000-0000000000a1', 'aa000000-0000-0000-0000-000000000001', 'af000000-0000-0000-0000-000000000001', 'rc-sum', 'RC sum breach', 10, 12, -2, -600)
  returning needs_recount, recount_auto_flagged into v_needs, v_auto;
  perform public.test_assert(v_needs and v_auto, 'sum breach (>500) must auto-flag needs_recount');

  -- Без превышения (|-100|<500, 1%<10%) → не флажим.
  insert into public.document_items (id, account_id, document_id, external_item_id, product_name, actual_amount, calculated_amount, difference_amount, difference_sum)
  values ('a5000000-0000-0000-0000-0000000000a2', 'aa000000-0000-0000-0000-000000000001', 'af000000-0000-0000-0000-000000000001', 'rc-ok', 'RC within thresholds', 99, 100, -1, -100)
  returning needs_recount, recount_auto_flagged into v_needs, v_auto;
  perform public.test_assert(not v_needs and not v_auto, 'within thresholds must NOT flag');

  -- Превышение по ПРОЦЕНТУ (20% > 10%) при сумме ниже порога → авто-флаг.
  insert into public.document_items (id, account_id, document_id, external_item_id, product_name, actual_amount, calculated_amount, difference_amount, difference_sum)
  values ('a5000000-0000-0000-0000-0000000000a3', 'aa000000-0000-0000-0000-000000000001', 'af000000-0000-0000-0000-000000000001', 'rc-pct', 'RC pct breach', 80, 100, -20, -50)
  returning needs_recount, recount_auto_flagged into v_needs, v_auto;
  perform public.test_assert(v_needs and v_auto, 'percent breach (>10%) must auto-flag');

  -- Несосчитанная строка (actual_amount NULL) НЕ флажится даже при огромной разнице (211).
  insert into public.document_items (id, account_id, document_id, external_item_id, product_name, actual_amount, calculated_amount, difference_amount, difference_sum)
  values ('a5000000-0000-0000-0000-0000000000a4', 'aa000000-0000-0000-0000-000000000001', 'af000000-0000-0000-0000-000000000001', 'rc-null', 'RC uncounted', null, 1000, -1000, -99999)
  returning needs_recount, recount_auto_flagged into v_needs, v_auto;
  perform public.test_assert(not v_needs and not v_auto, 'uncounted row (actual NULL) must be skipped');

  -- Авто-флаг снимается, когда расхождение «исправилось» (UPDATE ниже порога).
  update public.document_items
     set difference_sum = -100, difference_amount = -1, calculated_amount = 100
   where id = 'a5000000-0000-0000-0000-0000000000a1'
  returning needs_recount, recount_auto_flagged into v_needs, v_auto;
  perform public.test_assert(not v_needs and not v_auto, 'auto-flag must clear when difference drops below threshold');

  -- Ручная пометка (recount_marked_by задан) НЕ снимается автомаркером,
  -- даже когда расхождение ниже порога.
  insert into public.document_items (id, account_id, document_id, external_item_id, product_name, actual_amount, calculated_amount, difference_amount, difference_sum, needs_recount, recount_marked_by)
  values ('a5000000-0000-0000-0000-0000000000a5', 'aa000000-0000-0000-0000-000000000001', 'af000000-0000-0000-0000-000000000001', 'rc-manual', 'RC manual', 50, 100, -1, -100, true, 'ac000000-0000-0000-0000-000000000002')
  returning needs_recount into v_needs;
  perform public.test_assert(v_needs, 'manual recount flag must survive insert below threshold');

  update public.document_items
     set difference_sum = -10, difference_amount = -1
   where id = 'a5000000-0000-0000-0000-0000000000a5'
  returning needs_recount into v_needs;
  perform public.test_assert(v_needs, 'manual recount flag must survive update below threshold');
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 1b. Пока акт на пересчёте, автомаркер НЕ снимает пометку (миграция 228):
--     синхронизация во время круга не должна уводить отметки из-под
--     исполнителя. Поставить новую пометку при этом можно.
-- ────────────────────────────────────────────────────────────
do $$
declare
  v_needs boolean;
  v_auto  boolean;
begin
  update public.documents set status = 'recount_pending'
   where id = 'af000000-0000-0000-0000-000000000001';

  -- Авто-отмеченная строка: расхождение ушло ниже порога — флаг остаётся.
  insert into public.document_items (id, account_id, document_id, external_item_id, product_name, actual_amount, calculated_amount, difference_amount, difference_sum)
  values ('a5000000-0000-0000-0000-0000000000b1', 'aa000000-0000-0000-0000-000000000001', 'af000000-0000-0000-0000-000000000001', 'rc-round', 'RC round', 10, 12, -2, -600)
  returning needs_recount, recount_auto_flagged into v_needs, v_auto;
  perform public.test_assert(v_needs and v_auto, 'setup: row must be auto-flagged before the round');

  update public.document_items
     set difference_sum = -100, difference_amount = -1, calculated_amount = 100
   where id = 'a5000000-0000-0000-0000-0000000000b1'
  returning needs_recount, recount_auto_flagged into v_needs, v_auto;
  perform public.test_assert(v_needs and v_auto, 'auto-flag must SURVIVE while the document is on recount');

  -- Новая строка с превышением порога всё ещё может быть помечена.
  insert into public.document_items (id, account_id, document_id, external_item_id, product_name, actual_amount, calculated_amount, difference_amount, difference_sum)
  values ('a5000000-0000-0000-0000-0000000000b2', 'aa000000-0000-0000-0000-000000000001', 'af000000-0000-0000-0000-000000000001', 'rc-round-new', 'RC round new', 10, 12, -2, -900)
  returning needs_recount, recount_auto_flagged into v_needs, v_auto;
  perform public.test_assert(v_needs and v_auto, 'auto-flag must still be settable during the round');

  -- Вне пересчёта снятие работает как раньше.
  update public.documents set status = 'assigned'
   where id = 'af000000-0000-0000-0000-000000000001';
  update public.document_items
     set difference_sum = -50, difference_amount = -1, calculated_amount = 100
   where id = 'a5000000-0000-0000-0000-0000000000b1'
  returning needs_recount, recount_auto_flagged into v_needs, v_auto;
  perform public.test_assert(not v_needs and not v_auto, 'auto-flag must clear again once the round is over');
end;
$$;

-- Чистим recount-строки, чтобы не искажать счётчики RPC (matched_ingredients
-- по поиску и т.п. не затронуты — у них нет product_name 'Zubrovka').
delete from public.document_items where external_item_id in ('rc-sum','rc-ok','rc-pct','rc-null','rc-manual','rc-round','rc-round-new');

-- ────────────────────────────────────────────────────────────
-- 2. RPC list_inventory_documents — менеджер (security invoker → RLS).
-- ────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"ac000000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role = authenticated;

do $$
declare
  v_rows  int;
  v_total bigint;
begin
  perform public.test_assert(public.get_active_account_id() = 'aa000000-0000-0000-0000-000000000001', 'manager active account mismatch');

  -- Без фильтров: 3 акта аккаунта, total в каждой строке = 3.
  select count(*) into v_rows from public.list_inventory_documents();
  perform public.test_assert(v_rows = 3, 'no-filter must return 3 account documents');
  select coalesce(max(total), 0) into v_total from public.list_inventory_documents();
  perform public.test_assert(v_total = 3, 'window total must equal 3');

  -- Фильтр по статусу.
  select count(*) into v_rows from public.list_inventory_documents(p_filter_status := array['assigned']);
  perform public.test_assert(v_rows = 1, 'status filter [assigned] must return 1');

  -- Фильтр assigned = текущий пользователь (раскрытие 'me').
  select count(*) into v_rows from public.list_inventory_documents(p_filter_assigned := 'me');
  perform public.test_assert(v_rows = 1, 'assigned=me must return 1 (D1)');

  -- Фильтр assigned = none.
  select count(*) into v_rows from public.list_inventory_documents(p_filter_assigned := 'none');
  perform public.test_assert(v_rows = 2, 'assigned=none must return 2 (D2, D3)');

  -- Venue-фильтр: venue1 → 2 акта, venue2 → 1 акт.
  select count(*) into v_rows from public.list_inventory_documents(p_filter_venue := 'ab000000-0000-0000-0000-000000000001');
  perform public.test_assert(v_rows = 2, 'venue1 filter must return 2 documents');
  select count(*) into v_rows from public.list_inventory_documents(p_filter_venue := 'ab000000-0000-0000-0000-000000000002');
  perform public.test_assert(v_rows = 1, 'venue2 filter must return 1 document');

  -- Поиск по номеру акта.
  select count(*) into v_rows from public.list_inventory_documents(p_filter_q := 'INV-RPC-3');
  perform public.test_assert(v_rows = 1, 'search by document_number must return 1');

  -- Поиск по названию позиции + matched_ingredients заполнен.
  select count(*) into v_rows from public.list_inventory_documents(p_filter_q := 'Poisk');
  perform public.test_assert(v_rows = 1, 'search by product_name must return the doc');
  perform public.test_assert(
    exists (
      select 1 from public.list_inventory_documents(p_filter_q := 'Poisk')
      where 'Zubrovka Poisk' = any(matched_ingredients)
    ),
    'matched_ingredients must surface the matched product_name'
  );

  -- Слишком короткий запрос (<2 символов) игнорируется → все 3.
  select count(*) into v_rows from public.list_inventory_documents(p_filter_q := 'I');
  perform public.test_assert(v_rows = 3, 'short query (<2 chars) must be ignored');

  -- Фильтр по дате (inclusive).
  select count(*) into v_rows from public.list_inventory_documents(p_filter_date_from := '2026-05-02');
  perform public.test_assert(v_rows = 2, 'date_from filter must return 2 (D2, D3)');

  -- Пагинация: страница из 1 строки, total всё равно 3.
  select count(*) into v_rows from public.list_inventory_documents(p_page := 1, p_page_size := 1);
  perform public.test_assert(v_rows = 1, 'page_size=1 must return 1 row');
  select coalesce(max(total), 0) into v_total from public.list_inventory_documents(p_page := 1, p_page_size := 1);
  perform public.test_assert(v_total = 3, 'paged total must still equal 3');
end;
$$;

reset role;

rollback;

select '04_inventory_listing_recount.sql passed' as result;
