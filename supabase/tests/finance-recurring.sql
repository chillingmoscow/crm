-- ============================================================
-- finance-recurring.sql — тесты повторяющихся платежей (этап 1):
-- расчёт сроков, порождение ожидаемых платежей, возврат в pending
-- при удалении проведённой операции, права на функции.
--
-- Прогон внутри одной откатываемой транзакции (reset базы не нужен):
--   cat <(echo 'begin;') \
--       <(sed -E '/^[[:space:]]*(begin|commit);[[:space:]]*$/d' supabase/migrations/378_finance_recurring_payments.sql) \
--       <(sed -E '/^[[:space:]]*begin;[[:space:]]*$/d' supabase/tests/finance-recurring.sql) \
--     | docker exec -i supabase_db_crm psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -
-- ============================================================

\set ON_ERROR_STOP on

begin;

create or replace function public.test_assert(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if not p_condition then
    raise exception 'TEST FAILED: %', p_message;
  end if;
end;
$$;

-- ── Фикстуры: аккаунт, юрлицо, счёт, заведение ─────────────
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000'::uuid, 'cccccccc-1111-1111-1111-cccccccccccc',
  'authenticated', 'authenticated', 'recurring@test.local', crypt('p', gen_salt('bf')),
  now(), '{}'::jsonb, '{}'::jsonb, now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, first_name, last_name)
values ('cccccccc-1111-1111-1111-cccccccccccc', 'Owner', 'Recurring')
on conflict (id) do nothing;

create temp table rf as
with a as (
  insert into public.accounts (name, owner_id)
  values ('Recurring A', 'cccccccc-1111-1111-1111-cccccccccccc') returning id
), le as (
  insert into public.legal_entities (account_id, name, legal_form)
  select id, 'LE R', 'IP'::public.legal_form_enum from a returning id, account_id
), v as (
  insert into public.venues (account_id, name, type, default_legal_entity_id)
  select le.account_id, 'Spot R', 'cafe'::public.venue_type, le.id from le returning id
), ba as (
  insert into public.bank_accounts (account_id, legal_entity_id, name, type)
  select le.account_id, le.id, 'Касса R', 'cash'::public.bank_account_type_enum from le returning id
)
select (select id from a) as account_id, (select id from le) as le_id,
       (select id from v) as venue_id, (select id from ba) as ba_id;

-- Фикстуры ниже вставляют шаблоны с materialize_from в прошлом, чтобы проверить
-- порождение; охрана точки отсчёта на это время выключена и проверяется отдельно (секция 6).
alter table public.finance_recurring_templates disable trigger finance_recurring_templates_guard;

-- Шаблон-образец для расчёта сроков (без вставки в таблицу).
create or replace function pg_temp.tpl(
  p_freq text, p_dom smallint, p_wd smallint, p_qm smallint,
  p_starts date, p_ends date default null
) returns public.finance_recurring_templates
language sql as $$
  select row(
    gen_random_uuid(), (select account_id from rf), (select le_id from rf), null,
    (select ba_id from rf), null, null, 'expense', 100, false, 'RUB', null, 't',
    p_freq, p_dom, p_wd, p_qm, p_starts, p_ends, null, p_starts, null,
    null, now(), null, null, null, null
  )::public.finance_recurring_templates
$$;

-- ── 1. Расчёт сроков ───────────────────────────────────────
do $$
declare r date[];
begin
  select array_agg(d order by d) into r from private.finance_recurring_due_dates(
    pg_temp.tpl('monthly', 31::smallint, null, null, '2020-01-01'), '2027-01-01', '2027-06-30') d;
  perform public.test_assert(r = array['2027-01-31','2027-02-28','2027-03-31','2027-04-30','2027-05-31','2027-06-30']::date[],
    'monthly 31: ' || r::text);

  select array_agg(d order by d) into r from private.finance_recurring_due_dates(
    pg_temp.tpl('monthly', 31::smallint, null, null, '2020-01-01'), '2028-02-01', '2028-02-29') d;
  perform public.test_assert(r = array['2028-02-29']::date[], 'monthly 31, leap Feb: ' || r::text);

  select array_agg(d order by d) into r from private.finance_recurring_due_dates(
    pg_temp.tpl('quarterly', 31::smallint, null, 1::smallint, '2020-01-01'), '2027-01-01', '2027-12-31') d;
  perform public.test_assert(r = array['2027-01-31','2027-04-30','2027-07-31','2027-10-31']::date[],
    'quarterly: ' || r::text);

  select array_agg(d order by d) into r from private.finance_recurring_due_dates(
    pg_temp.tpl('weekly', null, 1::smallint, null, '2020-01-01'), '2026-11-23', '2026-12-07') d;
  perform public.test_assert(r = array['2026-11-23','2026-11-30','2026-12-07']::date[],
    'weekly: ' || r::text);

  select array_agg(d order by d) into r from private.finance_recurring_due_dates(
    pg_temp.tpl('monthly', 5::smallint, null, null, '2026-12-10'), '2026-12-01', '2027-03-31') d;
  perform public.test_assert(r[1] = '2027-01-05', 'starts_on: first due is ' || r[1]::text);

  select array_agg(d order by d) into r from private.finance_recurring_due_dates(
    pg_temp.tpl('monthly', 5::smallint, null, null, '2026-12-10', '2027-02-28'), '2026-12-01', '2027-06-30') d;
  perform public.test_assert(r = array['2027-01-05','2027-02-05']::date[], 'ends_on: ' || r::text);
end $$;

-- ── 2. Порождение ──────────────────────────────────────────
do $$
declare
  v_acc uuid := (select account_id from rf);
  v_today date;
  v_expected int;
  v_wd smallint;
  v_t uuid;
  n int;
begin
  v_today := (now() at time zone (select timezone from public.accounts where id = v_acc))::date;
  v_wd := extract(isodow from v_today - 2)::smallint;
  select count(*) into v_expected from generate_series(v_today - 8, v_today, '1 day') g
   where extract(isodow from g) = v_wd;

  insert into public.finance_recurring_templates (
    account_id, legal_entity_id, bank_account_id, type, amount, name,
    frequency, weekday, starts_on, materialize_from)
  values (v_acc, (select le_id from rf), (select ba_id from rf), 'expense', 500, 'Weekly',
    'weekly', v_wd, v_today - 30, v_today - 8)
  returning id into v_t;

  n := private.finance_recurring_materialize_account(v_acc);
  perform public.test_assert(n = v_expected and n >= 1,
    format('materialize inserted %s, expected %s', n, v_expected));
  perform public.test_assert(
    (select count(*) from public.finance_recurring_occurrences where template_id = v_t and status = 'pending') = v_expected,
    'occurrences are pending');
  perform public.test_assert(
    (select amount from public.finance_recurring_occurrences where template_id = v_t limit 1) = 500
    and (select name from public.finance_recurring_occurrences where template_id = v_t limit 1) = 'Weekly',
    'snapshot copied');
  perform public.test_assert(
    (select materialize_from from public.finance_recurring_templates where id = v_t) = v_today + 1,
    'materialize_from moved to tomorrow');

  perform public.test_assert(private.finance_recurring_materialize_account(v_acc) = 0, 'second call inserts 0');

  -- next_due: ближайший срок строго после сегодня
  perform public.test_assert(
    public.finance_recurring_next_due(v_t) > v_today
    and public.finance_recurring_next_due(v_t) <= v_today + 7
    and extract(isodow from public.finance_recurring_next_due(v_t)) = v_wd,
    'next_due is within a week and on the right weekday');

  -- пауза: ничего не вставляется, существующий pending остаётся
  update public.finance_recurring_templates
     set paused_at = now(), materialize_from = v_today - 8 where id = v_t;
  delete from public.finance_recurring_occurrences where template_id = v_t and due_date <> (
    select min(due_date) from public.finance_recurring_occurrences where template_id = v_t);
  perform public.test_assert(private.finance_recurring_materialize_account(v_acc) = 0, 'paused: 0 inserts');
  perform public.test_assert(
    (select count(*) from public.finance_recurring_occurrences where template_id = v_t and status = 'pending') = 1,
    'paused: existing pending stays');
  perform public.test_assert(public.finance_recurring_next_due(v_t) is null, 'paused: next_due null');

  -- архив
  update public.finance_recurring_templates set paused_at = null, archived_at = now() where id = v_t;
  perform public.test_assert(private.finance_recurring_materialize_account(v_acc) = 0, 'archived: 0 inserts');
  perform public.test_assert(public.finance_recurring_next_due(v_t) is null, 'archived: next_due null');
end $$;

-- ── 3. Удаление проведённой операции возвращает платёж в pending ──
do $$
declare
  v_acc uuid := (select account_id from rf);
  v_t uuid; v_o uuid; v_tx uuid; v_tx2 uuid;
begin
  insert into public.finance_recurring_templates (
    account_id, legal_entity_id, bank_account_id, type, amount, name,
    frequency, day_of_month, starts_on, materialize_from)
  values (v_acc, (select le_id from rf), (select ba_id from rf), 'expense', 700, 'Monthly',
    'monthly', 5, '2026-01-01', '2026-01-01')
  returning id into v_t;

  insert into public.transactions (account_id, legal_entity_id, bank_account_id, type, amount, date)
  values (v_acc, (select le_id from rf), (select ba_id from rf), 'expense', 700, now())
  returning id into v_tx;
  insert into public.transactions (account_id, legal_entity_id, bank_account_id, type, amount, date)
  values (v_acc, (select le_id from rf), (select ba_id from rf), 'expense', 700, now())
  returning id into v_tx2;

  insert into public.finance_recurring_occurrences (
    account_id, template_id, due_date, legal_entity_id, bank_account_id, type, amount, name,
    status, transaction_id, resolved_by, resolved_at)
  values (v_acc, v_t, '2026-02-05', (select le_id from rf), (select ba_id from rf), 'expense', 700, 'Monthly',
    'posted', v_tx, 'cccccccc-1111-1111-1111-cccccccccccc', now())
  returning id into v_o;

  update public.transactions set deleted_at = now() where id = v_tx;
  perform public.test_assert(
    (select status from public.finance_recurring_occurrences where id = v_o) = 'pending'
    and (select transaction_id from public.finance_recurring_occurrences where id = v_o) is null
    and (select resolved_at from public.finance_recurring_occurrences where id = v_o) is null
    and (select resolved_by from public.finance_recurring_occurrences where id = v_o) is null,
    'soft delete returns occurrence to pending');

  -- жёсткое удаление
  update public.finance_recurring_occurrences
     set status = 'posted', transaction_id = v_tx2, resolved_at = now() where id = v_o;
  delete from public.transactions where id = v_tx2;
  perform public.test_assert(
    (select status from public.finance_recurring_occurrences where id = v_o) = 'pending'
    and (select transaction_id from public.finance_recurring_occurrences where id = v_o) is null,
    'hard delete returns occurrence to pending');
end $$;

-- ── 4. Права ───────────────────────────────────────────────
do $$
begin
  perform public.test_assert(
    not has_function_privilege('anon', 'public.finance_recurring_materialize_all()', 'execute')
    and not has_function_privilege('authenticated', 'public.finance_recurring_materialize_all()', 'execute')
    and has_function_privilege('service_role', 'public.finance_recurring_materialize_all()', 'execute'),
    'materialize_all: only service_role');
  perform public.test_assert(
    not has_function_privilege('anon', 'public.finance_recurring_materialize_mine()', 'execute')
    and has_function_privilege('authenticated', 'public.finance_recurring_materialize_mine()', 'execute'),
    'materialize_mine: authenticated only');
  perform public.test_assert(
    not has_table_privilege('authenticated', 'public.finance_recurring_occurrences', 'insert')
    and not has_table_privilege('authenticated', 'public.finance_recurring_occurrences', 'delete')
    and not has_column_privilege('authenticated', 'public.finance_recurring_occurrences', 'amount', 'update')
    and has_column_privilege('authenticated', 'public.finance_recurring_occurrences', 'status', 'update'),
    'occurrences: client grants');
  perform public.test_assert(
    not has_function_privilege('anon', 'private.finance_account_today(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'private.finance_account_today(uuid)', 'execute'),
    'finance_account_today: not for anon/authenticated');
end $$;

-- ── 5. RLS: пользователь заведения A ───────────────────────
-- Контекст — через быстрый путь 237 (app.ctx_ready): права и заведение задаём
-- GUC-ами, роль — authenticated. Все юрлица разрешены, чужие заведения — нет.
do $$
declare
  v_acc uuid := (select account_id from rf);
  v_le uuid := (select le_id from rf);
  v_ba uuid := (select ba_id from rf);
  v_va uuid := (select venue_id from rf);
  v_vb uuid;
  v_ta uuid; v_tb uuid; v_tarch uuid;
  n int;
  v_failed boolean;
begin
  insert into public.venues (account_id, name, type, default_legal_entity_id)
  values (v_acc, 'Spot R2', 'cafe'::public.venue_type, v_le) returning id into v_vb;

  insert into public.finance_recurring_templates (
    account_id, legal_entity_id, venue_id, bank_account_id, type, amount, name,
    frequency, day_of_month, starts_on, materialize_from)
  values (v_acc, v_le, v_va, v_ba, 'expense', 10, 'A', 'monthly', 5, '2026-01-01', '2026-01-01')
  returning id into v_ta;
  insert into public.finance_recurring_templates (
    account_id, legal_entity_id, venue_id, bank_account_id, type, amount, name,
    frequency, day_of_month, starts_on, materialize_from)
  values (v_acc, v_le, v_vb, v_ba, 'expense', 10, 'B', 'monthly', 5, '2026-01-01', '2026-01-01')
  returning id into v_tb;
  insert into public.finance_recurring_templates (
    account_id, legal_entity_id, venue_id, bank_account_id, type, amount, name,
    frequency, day_of_month, starts_on, materialize_from, archived_at)
  values (v_acc, v_le, v_va, v_ba, 'expense', 10, 'Arch', 'monthly', 5, '2026-01-01', '2026-01-01', now())
  returning id into v_tarch;

  perform set_config('app.account_id', v_acc::text, true);
  perform set_config('app.venue_id', v_va::text, true);
  perform set_config('app.perms',
    ',finance.view_transactions,finance.create_transaction,finance.view_all_legal_entities,', true);
  perform set_config('app.ctx_ready', '1', true);
  set local role authenticated;

  -- видим своё заведение, чужое и архив (есть create_transaction) — по правилам
  perform public.test_assert(
    exists (select 1 from public.finance_recurring_templates where id = v_ta), 'venue A template visible');
  perform public.test_assert(
    not exists (select 1 from public.finance_recurring_templates where id = v_tb), 'venue B template hidden');
  perform public.test_assert(
    exists (select 1 from public.finance_recurring_templates where id = v_tarch),
    'archived visible like live');

  -- перенос шаблона в невидимое заведение B отвергается (WITH CHECK)
  v_failed := false;
  begin
    update public.finance_recurring_templates set venue_id = v_vb where id = v_ta;
  exception when others then
    v_failed := true;
  end;
  perform public.test_assert(v_failed, 'update to invisible venue B must be rejected');

  -- обычная правка своего шаблона проходит
  update public.finance_recurring_templates set name = 'A2' where id = v_ta;
  get diagnostics n = row_count;
  perform public.test_assert(n = 1, 'own venue update works');

  -- вставка в чужое заведение отвергается
  v_failed := false;
  begin
    insert into public.finance_recurring_templates (
      account_id, legal_entity_id, venue_id, bank_account_id, type, amount, name,
      frequency, day_of_month, starts_on, materialize_from)
    values (v_acc, v_le, v_vb, v_ba, 'expense', 10, 'X', 'monthly', 5, '2026-01-01', '2026-01-01');
  exception when others then
    v_failed := true;
  end;
  perform public.test_assert(v_failed, 'insert into invisible venue B must be rejected');

  -- только просмотр: живой и архивный видны, удалить нельзя без delete_transaction
  perform set_config('app.perms', ',finance.view_transactions,finance.view_all_legal_entities,', true);
  perform public.test_assert(
    exists (select 1 from public.finance_recurring_templates where id = v_ta), 'live visible with view only');
  perform public.test_assert(
    exists (select 1 from public.finance_recurring_templates where id = v_tarch),
    'archived visible with view only');

  -- удаление: create_transaction недостаточно, нужен delete_transaction
  perform set_config('app.perms',
    ',finance.view_transactions,finance.create_transaction,finance.view_all_legal_entities,', true);
  delete from public.finance_recurring_templates where id = v_tarch;
  get diagnostics n = row_count;
  perform public.test_assert(n = 0, 'delete without delete_transaction removes nothing');
  perform set_config('app.perms',
    ',finance.view_transactions,finance.delete_transaction,finance.view_all_legal_entities,', true);
  delete from public.finance_recurring_templates where id = v_tarch;
  get diagnostics n = row_count;
  perform public.test_assert(n = 1, 'delete with delete_transaction works');

  reset role;
end $$;

-- ── 6. Охрана materialize_from ─────────────────────────────
alter table public.finance_recurring_templates enable trigger finance_recurring_templates_guard;
do $$
declare
  v_acc uuid := (select account_id from rf);
  v_failed boolean := false;
  v_t uuid;
begin
  begin
    insert into public.finance_recurring_templates (
      account_id, legal_entity_id, bank_account_id, type, amount, name,
      frequency, day_of_month, starts_on, materialize_from)
    values (v_acc, (select le_id from rf), (select ba_id from rf), 'expense', 1, 'Old',
      'monthly', 5, '1900-01-01', '1900-01-01');
  exception when others then
    v_failed := true;
  end;
  perform public.test_assert(v_failed, 'materialize_from in the past must be rejected on insert');

  insert into public.finance_recurring_templates (
    account_id, legal_entity_id, bank_account_id, type, amount, name,
    frequency, day_of_month, starts_on, materialize_from)
  values (v_acc, (select le_id from rf), (select ba_id from rf), 'expense', 1, 'Ok',
    'monthly', 5, '1900-01-01', private.finance_account_today(v_acc))
  returning id into v_t;

  v_failed := false;
  begin
    update public.finance_recurring_templates set materialize_from = '1900-01-01' where id = v_t;
  exception when others then
    v_failed := true;
  end;
  perform public.test_assert(v_failed, 'materialize_from in the past must be rejected on update');

  -- порождение не уходит в глубокое прошлое при старом starts_on
  perform public.test_assert(
    (select count(*) from private.finance_recurring_due_dates(
       (select t from public.finance_recurring_templates t where id = v_t),
       private.finance_account_today(v_acc), private.finance_account_today(v_acc) + 40)) <= 2,
    'due dates bounded by requested window');
end $$;

-- ── 7. Конечный автомат ожидаемого платежа (под authenticated) ──
do $$
declare
  v_acc uuid := (select account_id from rf);
  v_le uuid := (select le_id from rf);
  v_ba uuid := (select ba_id from rf);
  v_uid uuid := 'cccccccc-1111-1111-1111-cccccccccccc';
  v_le2 uuid; v_ba2 uuid;
  v_today date := private.finance_account_today((select account_id from rf));
  v_t uuid; v_o1 uuid; v_o2 uuid; v_o3 uuid; v_o4 uuid;
  v_tx_ok uuid; v_tx_other_le uuid; v_tx_income uuid; v_tx_used uuid;
  n int;
  procedure_failed boolean;
begin
  insert into public.legal_entities (account_id, name, legal_form)
  values (v_acc, 'LE R2', 'IP'::public.legal_form_enum) returning id into v_le2;
  insert into public.bank_accounts (account_id, legal_entity_id, name, type)
  values (v_acc, v_le2, 'Касса R2', 'cash'::public.bank_account_type_enum) returning id into v_ba2;

  insert into public.finance_recurring_templates (
    account_id, legal_entity_id, bank_account_id, type, amount, name,
    frequency, day_of_month, starts_on, materialize_from)
  values (v_acc, v_le, v_ba, 'expense', 100, 'SM', 'monthly', 5, '2026-01-01', v_today + 1)
  returning id into v_t;

  insert into public.finance_recurring_occurrences (account_id, template_id, due_date, legal_entity_id,
    bank_account_id, type, amount, name)
  select v_acc, v_t, d, v_le, v_ba, 'expense', 100, 'SM'
    from unnest(array[v_today - 4, v_today - 3, v_today - 2, v_today - 1]) d;
  select id into v_o1 from public.finance_recurring_occurrences where template_id = v_t and due_date = v_today - 4;
  select id into v_o2 from public.finance_recurring_occurrences where template_id = v_t and due_date = v_today - 3;
  select id into v_o3 from public.finance_recurring_occurrences where template_id = v_t and due_date = v_today - 2;
  select id into v_o4 from public.finance_recurring_occurrences where template_id = v_t and due_date = v_today - 1;

  insert into public.transactions (account_id, legal_entity_id, bank_account_id, type, amount, date)
  values (v_acc, v_le, v_ba, 'expense', 100, now()) returning id into v_tx_ok;
  insert into public.transactions (account_id, legal_entity_id, bank_account_id, type, amount, date)
  values (v_acc, v_le2, v_ba2, 'expense', 100, now()) returning id into v_tx_other_le;
  insert into public.transactions (account_id, legal_entity_id, bank_account_id, type, amount, date)
  values (v_acc, v_le, v_ba, 'income', 100, now()) returning id into v_tx_income;
  insert into public.transactions (account_id, legal_entity_id, bank_account_id, type, amount, date)
  values (v_acc, v_le, v_ba, 'expense', 100, now()) returning id into v_tx_used;
  -- v_tx_used уже связана с другим платежом (другой шаблон-срок)
  insert into public.finance_recurring_occurrences (account_id, template_id, due_date, legal_entity_id,
    bank_account_id, type, amount, name, status, transaction_id)
  values (v_acc, v_t, v_today - 9, v_le, v_ba, 'expense', 100, 'SM', 'posted', v_tx_used);

  perform set_config('app.account_id', v_acc::text, true);
  perform set_config('app.venue_id', '', true);
  perform set_config('app.perms',
    ',finance.view_transactions,finance.create_transaction,finance.view_all_legal_entities,finance.view_all_venues,', true);
  perform set_config('app.ctx_ready', '1', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);
  set local role authenticated;

  -- прямой insert / delete закрыты правами
  procedure_failed := false;
  begin
    insert into public.finance_recurring_occurrences (account_id, template_id, due_date, legal_entity_id,
      bank_account_id, type, amount, name)
    values (v_acc, v_t, v_today - 20, v_le, v_ba, 'expense', 1, 'x');
  exception when others then procedure_failed := true; end;
  perform public.test_assert(procedure_failed, 'client insert of occurrence is denied');
  procedure_failed := false;
  begin
    delete from public.finance_recurring_occurrences where id = v_o1;
  exception when others then procedure_failed := true; end;
  perform public.test_assert(procedure_failed, 'client delete of occurrence is denied');

  -- снимок менять нельзя (нет права на колонку)
  procedure_failed := false;
  begin
    update public.finance_recurring_occurrences set amount = 1 where id = v_o1;
  exception when others then procedure_failed := true; end;
  perform public.test_assert(procedure_failed, 'changing amount is denied');

  -- проведение: чужое юрлицо, другой тип, уже занятая операция, случайный id
  procedure_failed := false;
  begin
    update public.finance_recurring_occurrences
       set status = 'posted', transaction_id = v_tx_other_le, resolved_by = v_uid, resolved_at = now()
     where id = v_o1;
  exception when others then procedure_failed := true; end;
  perform public.test_assert(procedure_failed, 'posting with other legal entity transaction raises');
  procedure_failed := false;
  begin
    update public.finance_recurring_occurrences
       set status = 'posted', transaction_id = v_tx_income, resolved_by = v_uid, resolved_at = now()
     where id = v_o1;
  exception when others then procedure_failed := true; end;
  perform public.test_assert(procedure_failed, 'posting with other type transaction raises');
  procedure_failed := false;
  begin
    update public.finance_recurring_occurrences
       set status = 'posted', transaction_id = v_tx_used, resolved_by = v_uid, resolved_at = now()
     where id = v_o1;
  exception when others then procedure_failed := true; end;
  perform public.test_assert(procedure_failed, 'posting with already linked transaction raises');
  procedure_failed := false;
  begin
    update public.finance_recurring_occurrences
       set status = 'posted', transaction_id = gen_random_uuid(), resolved_by = v_uid, resolved_at = now()
     where id = v_o1;
  exception when others then procedure_failed := true; end;
  perform public.test_assert(procedure_failed, 'posting with random transaction raises');
  procedure_failed := false;
  begin
    update public.finance_recurring_occurrences
       set status = 'posted', transaction_id = v_tx_ok, resolved_by = gen_random_uuid(), resolved_at = now()
     where id = v_o1;
  exception when others then procedure_failed := true; end;
  perform public.test_assert(procedure_failed, 'resolved_by must equal auth.uid()');

  -- верное проведение
  update public.finance_recurring_occurrences
     set status = 'posted', transaction_id = v_tx_ok, resolved_by = v_uid, resolved_at = now()
   where id = v_o1;
  get diagnostics n = row_count;
  perform public.test_assert(n = 1, 'valid post works');

  -- posted -> pending вручную нельзя
  procedure_failed := false;
  begin
    update public.finance_recurring_occurrences
       set status = 'pending', transaction_id = null, resolved_by = null, resolved_at = null
     where id = v_o1;
  exception when others then procedure_failed := true; end;
  perform public.test_assert(procedure_failed, 'client posted -> pending is denied');

  -- пропуск
  update public.finance_recurring_occurrences
     set status = 'skipped', resolved_by = v_uid, resolved_at = now() where id = v_o2;
  get diagnostics n = row_count;
  perform public.test_assert(n = 1, 'skip works');

  -- перенос: на будущее можно, на сегодня и раньше нельзя
  update public.finance_recurring_occurrences set postponed_to = v_today + 3 where id = v_o3;
  get diagnostics n = row_count;
  perform public.test_assert(n = 1, 'postpone to future works');
  procedure_failed := false;
  begin
    update public.finance_recurring_occurrences set postponed_to = v_today where id = v_o4;
  exception when others then procedure_failed := true; end;
  perform public.test_assert(procedure_failed, 'postpone to today raises');

  reset role;

  -- удаление проведённой операции возвращает платёж в pending (флаг релиза)
  update public.transactions set deleted_at = now() where id = v_tx_ok;
  perform public.test_assert(
    (select status from public.finance_recurring_occurrences where id = v_o1) = 'pending'
    and (select transaction_id from public.finance_recurring_occurrences where id = v_o1) is null,
    'release still works through the state machine');
  perform public.test_assert(
    coalesce(current_setting('app.finance_recurring_release', true), '') = '',
    'release flag is reset');
end $$;

-- ── 8. finance_recurring_post ──────────────────────────────
do $$
declare
  v_acc uuid := (select account_id from rf);
  v_le uuid := (select le_id from rf);
  v_ba uuid := (select ba_id from rf);
  v_venue uuid := (select venue_id from rf);
  v_uid uuid := 'cccccccc-1111-1111-1111-cccccccccccc';
  v_today date := private.finance_account_today((select account_id from rf));
  v_le2 uuid; v_ba2 uuid; v_ba_del uuid; v_venue_b uuid;
  v_t uuid; v_o1 uuid; v_o2 uuid; v_o3 uuid; v_o4 uuid; v_o5 uuid;
  v_tx uuid; v_tx2 uuid;
  n int;
  failed boolean;
  msg text;
begin
  insert into public.legal_entities (account_id, name, legal_form)
  values (v_acc, 'LE P2', 'IP'::public.legal_form_enum) returning id into v_le2;
  insert into public.bank_accounts (account_id, legal_entity_id, name, type)
  values (v_acc, v_le2, 'Касса P2', 'cash'::public.bank_account_type_enum) returning id into v_ba2;
  insert into public.venues (account_id, name, type, default_legal_entity_id)
  values (v_acc, 'Spot R B', 'cafe'::public.venue_type, v_le) returning id into v_venue_b;
  insert into public.bank_accounts (account_id, legal_entity_id, name, type, deleted_at)
  values (v_acc, v_le, 'Касса удалена', 'cash'::public.bank_account_type_enum, now()) returning id into v_ba_del;

  insert into public.finance_recurring_templates (
    account_id, legal_entity_id, venue_id, bank_account_id, type, amount, name,
    frequency, day_of_month, starts_on, materialize_from)
  values (v_acc, v_le, v_venue, v_ba, 'expense', 150000, 'Аренда', 'monthly', 5, '2026-01-01', v_today + 1)
  returning id into v_t;

  insert into public.finance_recurring_occurrences (account_id, template_id, due_date, legal_entity_id,
    venue_id, bank_account_id, type, amount, name)
  select v_acc, v_t, d, v_le, v_venue, v_ba, 'expense', 150000, 'Аренда'
    from unnest(array[v_today - 5, v_today - 6, v_today - 7, v_today - 8, v_today - 9]) d;
  select id into v_o1 from public.finance_recurring_occurrences where template_id = v_t and due_date = v_today - 5;
  select id into v_o2 from public.finance_recurring_occurrences where template_id = v_t and due_date = v_today - 6;
  select id into v_o3 from public.finance_recurring_occurrences where template_id = v_t and due_date = v_today - 7;
  select id into v_o4 from public.finance_recurring_occurrences where template_id = v_t and due_date = v_today - 8;
  select id into v_o5 from public.finance_recurring_occurrences where template_id = v_t and due_date = v_today - 9;

  perform set_config('app.account_id', v_acc::text, true);
  perform set_config('app.venue_id', '', true);
  perform set_config('app.perms',
    ',finance.view_transactions,finance.create_transaction,finance.view_all_legal_entities,finance.view_all_venues,', true);
  perform set_config('app.ctx_ready', '1', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);
  set local role authenticated;

  -- проведение с поправленной суммой
  v_tx := public.finance_recurring_post(v_o1, 149500.50, v_today, v_ba, null, null, v_venue, 'за месяц');
  perform public.test_assert(v_tx is not null, 'post returns transaction id');
  select count(*) into n from public.transactions where id = v_tx
    and amount = 149500.50 and type = 'expense' and source = 'manual'
    and created_by = v_uid and legal_entity_id = v_le and bank_account_id = v_ba
    and description = 'за месяц' and date = v_today::timestamptz;
  perform public.test_assert(n = 1, 'post creates the transaction with patched fields');
  perform public.test_assert(
    (select status from public.finance_recurring_occurrences where id = v_o1) = 'posted'
    and (select transaction_id from public.finance_recurring_occurrences where id = v_o1) = v_tx
    and (select resolved_by from public.finance_recurring_occurrences where id = v_o1) = v_uid
    and (select resolved_at from public.finance_recurring_occurrences where id = v_o1) is not null,
    'occurrence is posted and linked');

  -- второй вызов: исключение, операция по-прежнему одна
  failed := false;
  begin
    perform public.finance_recurring_post(v_o1, 1, v_today, v_ba, null, null, v_venue, null);
  exception when others then
    failed := true; msg := sqlerrm;
  end;
  perform public.test_assert(failed and msg = 'Платёж уже разобран', 'second post raises "Платёж уже разобран"');
  select count(*) into n from public.transactions t
   where t.account_id = v_acc and exists (
     select 1 from public.finance_recurring_occurrences o where o.id = v_o1 and o.transaction_id = t.id);
  perform public.test_assert(n = 1, 'still one transaction for the occurrence');

  -- пропущенный и перенесённый-на-будущее платежи через post не проводятся только если не pending;
  update public.finance_recurring_occurrences set status = 'skipped', resolved_by = v_uid, resolved_at = now() where id = v_o2;
  failed := false;
  begin
    perform public.finance_recurring_post(v_o2, 1, v_today, v_ba, null, null, v_venue, null);
  exception when others then failed := true; msg := sqlerrm; end;
  perform public.test_assert(failed and msg = 'Платёж уже разобран', 'skipped occurrence cannot be posted');

  -- счёт другого юрлица и удалённый счёт
  failed := false;
  begin
    perform public.finance_recurring_post(v_o3, 1, v_today, v_ba2, null, null, v_venue, null);
  exception when others then failed := true; end;
  perform public.test_assert(failed, 'bank account of another legal entity is rejected');
  failed := false;
  begin
    perform public.finance_recurring_post(v_o3, 1, v_today, v_ba_del, null, null, v_venue, null);
  exception when others then failed := true; end;
  perform public.test_assert(failed, 'deleted bank account is rejected');
  failed := false;
  begin
    perform public.finance_recurring_post(v_o3, 0, v_today, v_ba, null, null, v_venue, null);
  exception when others then failed := true; end;
  perform public.test_assert(failed, 'non-positive amount is rejected');
  perform public.test_assert(
    (select status from public.finance_recurring_occurrences where id = v_o3) = 'pending',
    'failed posts leave the occurrence pending');

  -- без права создавать операции
  perform set_config('app.perms',
    ',finance.view_transactions,finance.view_all_legal_entities,finance.view_all_venues,', true);
  failed := false;
  begin
    perform public.finance_recurring_post(v_o3, 1, v_today, v_ba, null, null, v_venue, null);
  exception when others then failed := true; end;
  perform public.test_assert(failed, 'post without finance.create_transaction fails');

  -- пользователь только своего заведения: чужой платёж не виден и не проводится
  perform set_config('app.venue_id', v_venue_b::text, true);
  perform set_config('app.perms',
    ',finance.view_transactions,finance.create_transaction,finance.view_all_legal_entities,', true);
  select count(*) into n from public.finance_recurring_occurrences where id = v_o4;
  perform public.test_assert(n = 0, 'occurrence of another venue is invisible');
  failed := false;
  begin
    perform public.finance_recurring_post(v_o4, 1, v_today, v_ba, null, null, v_venue, null);
  exception when others then failed := true; end;
  perform public.test_assert(failed, 'post of invisible occurrence raises');
  select count(*) into n from public.finance_recurring_occurrences
   where id = v_o4 and status = 'pending';
  reset role;
  perform public.test_assert(
    (select status from public.finance_recurring_occurrences where id = v_o4) = 'pending',
    'invisible occurrence stays pending');

  -- платёж без заведения виден, но подставить чужое заведение нельзя
  update public.finance_recurring_occurrences set venue_id = null where id = v_o5;
  perform set_config('app.venue_id', v_venue_b::text, true);
  set local role authenticated;
  failed := false;
  begin
    perform public.finance_recurring_post(v_o5, 1, v_today, v_ba, null, null, v_venue, null);
  exception when others then failed := true; msg := sqlerrm; end;
  perform public.test_assert(failed, 'foreign venue cannot be set by a single-venue user');
  v_tx2 := public.finance_recurring_post(v_o5, 1, v_today, v_ba, null, null, null, null);
  perform public.test_assert(v_tx2 is not null, 'venue-less occurrence can be posted by a single-venue user');
  reset role;
end $$;

-- ── 9. Охрана проведения: видимость заведения и уникальность связи ──
do $$
declare
  v_acc uuid := (select account_id from rf);
  v_le uuid := (select le_id from rf);
  v_ba uuid := (select ba_id from rf);
  v_venue uuid := (select venue_id from rf);
  v_uid uuid := 'cccccccc-1111-1111-1111-cccccccccccc';
  v_today date := private.finance_account_today((select account_id from rf));
  v_venue_b uuid; v_t uuid; v_oa uuid; v_ob uuid; v_oc uuid;
  v_tx_b uuid; v_tx_a uuid;
  failed boolean;
begin
  insert into public.venues (account_id, name, type, default_legal_entity_id)
  values (v_acc, 'Spot R B2', 'cafe'::public.venue_type, v_le) returning id into v_venue_b;
  insert into public.finance_recurring_templates (
    account_id, legal_entity_id, bank_account_id, type, amount, name,
    frequency, day_of_month, starts_on, materialize_from)
  values (v_acc, v_le, v_ba, 'expense', 10, 'G', 'monthly', 5, '2026-01-01', v_today + 1)
  returning id into v_t;
  insert into public.finance_recurring_occurrences (account_id, template_id, due_date, legal_entity_id,
    bank_account_id, type, amount, name)
  select v_acc, v_t, d, v_le, v_ba, 'expense', 10, 'G'
    from unnest(array[v_today - 11, v_today - 12, v_today - 13]) d;
  select id into v_oa from public.finance_recurring_occurrences where template_id = v_t and due_date = v_today - 11;
  select id into v_ob from public.finance_recurring_occurrences where template_id = v_t and due_date = v_today - 12;
  select id into v_oc from public.finance_recurring_occurrences where template_id = v_t and due_date = v_today - 13;
  insert into public.transactions (account_id, legal_entity_id, venue_id, bank_account_id, type, amount, date)
  values (v_acc, v_le, v_venue_b, v_ba, 'expense', 10, now()) returning id into v_tx_b;
  insert into public.transactions (account_id, legal_entity_id, venue_id, bank_account_id, type, amount, date)
  values (v_acc, v_le, v_venue, v_ba, 'expense', 10, now()) returning id into v_tx_a;

  perform set_config('app.account_id', v_acc::text, true);
  perform set_config('app.venue_id', v_venue::text, true);
  perform set_config('app.perms',
    ',finance.view_transactions,finance.create_transaction,finance.view_all_legal_entities,', true);
  perform set_config('app.ctx_ready', '1', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);
  set local role authenticated;

  -- пользователь заведения A связывает операцию заведения B
  failed := false;
  begin
    update public.finance_recurring_occurrences
       set status = 'posted', transaction_id = v_tx_b, resolved_by = v_uid, resolved_at = now()
     where id = v_oa;
  exception when others then failed := true; end;
  perform public.test_assert(failed, 'linking a transaction of an invisible venue raises');

  -- своя операция проходит; повторная связь той же операции — нет
  update public.finance_recurring_occurrences
     set status = 'posted', transaction_id = v_tx_a, resolved_by = v_uid, resolved_at = now()
   where id = v_oa;
  failed := false;
  begin
    update public.finance_recurring_occurrences
       set status = 'posted', transaction_id = v_tx_a, resolved_by = v_uid, resolved_at = now()
     where id = v_ob;
  exception when others then failed := true; end;
  perform public.test_assert(failed, 'linking an already linked transaction raises');
  reset role;

  -- сама БД не даёт связать одну операцию дважды, даже мимо триггера
  alter table public.finance_recurring_occurrences disable trigger finance_recurring_occurrences_guard;
  failed := false;
  begin
    update public.finance_recurring_occurrences
       set status = 'posted', transaction_id = v_tx_a where id = v_oc;
  exception when unique_violation then failed := true; end;
  alter table public.finance_recurring_occurrences enable trigger finance_recurring_occurrences_guard;
  perform public.test_assert(failed, 'unique index backs one transaction per occurrence');
end $$;

-- ── 10. Валюта операции — валюта счёта проведения ──────────
do $$
declare
  v_acc uuid := (select account_id from rf);
  v_le uuid := (select le_id from rf);
  v_ba uuid := (select ba_id from rf);
  v_uid uuid := 'cccccccc-1111-1111-1111-cccccccccccc';
  v_today date := private.finance_account_today((select account_id from rf));
  v_ba_usd uuid; v_t uuid; v_o uuid; v_tx uuid;
begin
  insert into public.bank_accounts (account_id, legal_entity_id, name, type, currency)
  values (v_acc, v_le, 'Счёт USD', 'checking'::public.bank_account_type_enum, 'USD') returning id into v_ba_usd;

  insert into public.finance_recurring_templates (
    account_id, legal_entity_id, bank_account_id, type, amount, name,
    frequency, day_of_month, starts_on, materialize_from)
  values (v_acc, v_le, v_ba, 'expense', 100, 'Подписка', 'monthly', 3, '2026-01-01', v_today + 1)
  returning id into v_t;
  -- Снимок платежа — в рублях (счёт шаблона), проводим на долларовый счёт.
  insert into public.finance_recurring_occurrences (account_id, template_id, due_date, legal_entity_id,
    bank_account_id, type, amount, currency, name)
  values (v_acc, v_t, v_today - 2, v_le, v_ba, 'expense', 100, 'RUB', 'Подписка')
  returning id into v_o;

  perform set_config('app.account_id', v_acc::text, true);
  perform set_config('app.venue_id', '', true);
  perform set_config('app.perms',
    ',finance.view_transactions,finance.create_transaction,finance.view_all_legal_entities,finance.view_all_venues,', true);
  perform set_config('app.ctx_ready', '1', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);
  set local role authenticated;

  v_tx := public.finance_recurring_post(v_o, 12.5, v_today, v_ba_usd, null, null, null, null);
  reset role;
  perform public.test_assert(
    (select currency from public.transactions where id = v_tx) = 'USD',
    'posting to a USD account creates a USD transaction');
  perform public.test_assert(
    (select bank_account_id from public.transactions where id = v_tx) = v_ba_usd,
    'posted transaction uses the chosen account');
end $$;

select 'finance-recurring: all tests passed' as result;

rollback;
