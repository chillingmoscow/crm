-- ============================================================
-- payroll_payout_plan.sql — план выплат (391, 392): защита от переплаты,
-- повтор выдачи по тому же ключу, частичная выдача, «Выплачено» переводом
-- без отправки в Adesk, права.
--
-- Прогон внутри одной откатываемой транзакции (reset базы не нужен):
--   cat <(echo 'begin;') \
--       <(sed -E '/^[[:space:]]*(begin|commit);[[:space:]]*$/d' supabase/migrations/391_payroll_payout_plan.sql) \
--       <(sed -E '/^[[:space:]]*(begin|commit);[[:space:]]*$/d' supabase/migrations/392_payroll_payout_auto.sql) \
--       <(sed -E '/^[[:space:]]*begin;[[:space:]]*$/d' supabase/tests/payroll_payout_plan.sql) \
--     | docker exec -i supabase_db_crm psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -
--
-- Нужен пользователь owner@test.com из supabase/seed.sql (владелец заведения).
-- ============================================================

\set ON_ERROR_STOP on

begin;

create temp table fx(key text primary key, id uuid);

create or replace function pg_temp.expect_error(p_sql text, p_pattern text, p_label text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm not ilike p_pattern then
      raise exception 'TEST FAILED: %: ожидалась ошибка «%», получено «%»', p_label, p_pattern, sqlerrm;
    end if;
    raise notice 'ok: %', p_label;
    return;
  end;
  raise exception 'TEST FAILED: %: ошибки не было', p_label;
end $$;

create or replace function pg_temp.check(p_ok boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'TEST FAILED: %', p_label; end if;
  raise notice 'ok: %', p_label;
end $$;

create or replace function pg_temp.act_as(p_user uuid)
returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true),
         set_config('request.jwt.claims', '', true),
         set_config('app.ctx_ready', '0', true);
$$;

create or replace function pg_temp.fx(p_key text)
returns uuid language sql as $$ select id from fx where key = p_key $$;

-- issued_today по умолчанию — сколько наличными уже выдано за день (как читает предпросмотр).
create or replace function pg_temp.issue(p_key text, p_plan text, p_method text, p_bank text, p_lines jsonb, p_issued numeric default null)
returns uuid language sql as $$
  select public.payroll_payout_issue(jsonb_build_object(
    'request_key', pg_temp.fx(p_key), 'plan_id', pg_temp.fx(p_plan), 'method', p_method,
    'bank_account_id', pg_temp.fx(p_bank), 'date', '2026-11-25T12:00:00+03:00', 'business_date', '2026-11-25',
    'cash', case when p_method = 'cash' then jsonb_build_object('available', 190000, 'issued_today',
      coalesce(p_issued, (select coalesce(sum(total), 0) from public.payroll_payout_issues
        where venue_id = pg_temp.fx('v') and business_date = '2026-11-25' and method = 'cash'))) end,
    'lines', p_lines))
$$;

-- ── Фикстуры ───────────────────────────────────────────────
do $$
declare
  owner uuid := (select id from auth.users where email = 'owner@test.com');
  a uuid; v uuid; le uuid; b uuid; r uuid; e uuid; p uuid;
begin
  if owner is null then raise exception 'Нет пользователя owner@test.com из seed.sql'; end if;
  perform pg_temp.act_as(owner);
  a := public.get_active_account_id();
  v := public.get_active_venue_id();
  if a is null or v is null then raise exception 'У владельца нет активного заведения'; end if;
  insert into fx values ('owner', owner), ('a', a), ('v', v),
    ('key1', gen_random_uuid()), ('key2', gen_random_uuid()), ('key3', gen_random_uuid()),
    ('key4', gen_random_uuid()), ('key5', gen_random_uuid()), ('key6', gen_random_uuid()), ('manual', gen_random_uuid());

  insert into public.legal_entities(account_id, name, legal_form)
  values (a, 'План выплат тест', 'OTHER') returning id into le;
  insert into public.bank_accounts(account_id, legal_entity_id, venue_id, name, type)
  values (a, le, v, 'Кэшбокс тест', 'cash') returning id into b;
  insert into fx values ('cashbox', b);
  insert into public.bank_accounts(account_id, legal_entity_id, venue_id, name, type)
  values (a, le, v, 'Расчётный тест', 'checking') returning id into b;
  insert into fx values ('checking', b);

  insert into public.payroll_settings(account_id, venue_id, starts_on, quickresto_venue_id, enabled)
  values (a, v, '2026-09-01', 1, true)
  on conflict (venue_id) do nothing;
  if (select starts_on from public.payroll_settings where venue_id = v) > '2026-11-01' then
    raise exception 'Учёт заведения начинается позже ноября';
  end if;

  insert into public.roles(venue_id, name, code) values (v, 'План выплат тест', 'payout_plan_test') returning id into r;
  if not exists (select 1 from public.finance_categories where payroll_role_id = r) then
    raise exception 'У должности нет статьи ФОТ';
  end if;

  insert into public.payroll_periods(account_id, venue_id, month) values (a, v, '2026-11-01')
  on conflict (venue_id, month) do nothing;
  select id into p from public.payroll_periods where venue_id = v and month = '2026-11-01';

  insert into public.payroll_employees(account_id, venue_id, name, role_name, role_id)
  values (a, v, 'Филипп Тестовый', 'Бармен', r) returning id into e;
  insert into fx values ('filipp', e);
  insert into public.payroll_accruals(account_id, venue_id, employee_id, business_date, period_id, salary, status)
  values (a, v, e, '2026-11-10', p, 30000, 'ready'), (a, v, e, '2026-11-11', p, 20000, 'ready');

  insert into public.payroll_employees(account_id, venue_id, name, role_name, role_id)
  values (a, v, 'Гамлет Тестовый', 'Менеджер', r) returning id into e;
  insert into fx values ('gamlet', e);
  insert into public.payroll_accruals(account_id, venue_id, employee_id, business_date, period_id, salary, status)
  values (a, v, e, '2026-11-12', p, 40000, 'ready');

  insert into public.payroll_employees(account_id, venue_id, name, role_name, role_id)
  values (a, v, 'Татьяна Тестовая', 'Бухгалтер', r) returning id into e;
  insert into fx values ('tanya', e);
  insert into public.payroll_accruals(account_id, venue_id, employee_id, business_date, period_id, salary, status, calculation_snapshot)
  values (a, v, e, '2026-11-01', p, 47700, 'ready', '{"kind":"monthly"}');
end $$;

-- ── 1. Настройки ───────────────────────────────────────────
do $$
begin
  perform public.payroll_payout_save_settings(jsonb_build_object(
    'min_cash', 120000, 'chat_id', '-1002495828187', 'bank_account_id', pg_temp.fx('cashbox'),
    'schedules', jsonb_build_object('transfer', jsonb_build_object('bank_account_id', pg_temp.fx('checking'))),
    'assignments', jsonb_build_array(jsonb_build_object('employee_id', pg_temp.fx('tanya'), 'schedule', 'transfer'))));
  perform pg_temp.check(
    (select payout_schedule from public.payroll_employees where id = pg_temp.fx('tanya')) = 'transfer'
    and (select schedules->'transfer'->>'bank_account_id' from public.payroll_payout_settings where venue_id = pg_temp.fx('v'))::uuid = pg_temp.fx('checking')
    and (select (schedules->'main'->>'step')::numeric from public.payroll_payout_settings where venue_id = pg_temp.fx('v')) = 5000,
    'settings saved with defaults and assignment');
  perform pg_temp.expect_error(
    format('select public.payroll_payout_save_settings(%L)', jsonb_build_object('bank_account_id', pg_temp.fx('checking'))),
    '%выберите кассу%', 'cash account must be a register');
end $$;

-- ── 2. План: защита от переплаты ───────────────────────────
do $$
declare plan uuid; again uuid;
begin
  perform pg_temp.expect_error(
    format('select public.payroll_payout_plan_save(%L)', jsonb_build_object(
      'schedule', 'main', 'month', '2026-11-01', 'payout_no', 1, 'window_from', '2026-11-25', 'window_to', '2026-12-01',
      'rows', jsonb_build_array(jsonb_build_object('employee_id', pg_temp.fx('filipp'), 'amount', 55000)))),
    '%Больше, чем сотрудник уже заработал: Филипп%', 'overpay rejected');
  perform pg_temp.expect_error(
    format('select public.payroll_payout_plan_save(%L)', jsonb_build_object(
      'schedule', 'main', 'month', '2026-11-01', 'payout_no', 1, 'window_from', '2026-11-25', 'window_to', '2026-12-01',
      'rows', jsonb_build_array(jsonb_build_object('employee_id', pg_temp.fx('tanya'), 'amount', 1000)))),
    '%в другом графике%', 'employee of another schedule rejected');

  plan := public.payroll_payout_plan_save(jsonb_build_object(
    'schedule', 'main', 'month', '2026-11-01', 'payout_no', 1, 'window_from', '2026-11-25', 'window_to', '2026-12-01',
    'rows', jsonb_build_array(jsonb_build_object('employee_id', pg_temp.fx('gamlet'), 'amount', 10000, 'pay_date', '2026-11-25'),
      jsonb_build_object('employee_id', pg_temp.fx('filipp'), 'amount', 25000,
      'pay_date', '2026-11-25', 'breakdown', jsonb_build_object('earned', 50000)))));
  insert into fx values ('main_plan', plan);
  insert into fx select 'filipp_row', id from public.payroll_payout_rows where plan_id = plan and employee_id = pg_temp.fx('filipp');
  -- Повторное сохранение черновика заменяет строки и поднимает версию.
  again := public.payroll_payout_plan_save(jsonb_build_object(
    'schedule', 'main', 'month', '2026-11-01', 'payout_no', 1, 'window_from', '2026-11-25', 'window_to', '2026-12-01',
    'rows', jsonb_build_array(jsonb_build_object('employee_id', pg_temp.fx('gamlet'), 'amount', 10000, 'pay_date', '2026-11-25'),
      jsonb_build_object('employee_id', pg_temp.fx('filipp'), 'amount', 25000, 'pay_date', '2026-11-25'))));
  perform pg_temp.check(again = plan and (select version from public.payroll_payout_plans where id = plan) = 2,
    'draft re-save keeps plan, bumps version');
  update fx set id = (select id from public.payroll_payout_rows where plan_id = plan and employee_id = pg_temp.fx('filipp')) where key = 'filipp_row';
  insert into fx select 'gamlet_row', id from public.payroll_payout_rows where plan_id = plan and employee_id = pg_temp.fx('gamlet');

  perform pg_temp.expect_error(
    format('select pg_temp.issue(%L, %L, %L, %L, %L)', 'key1', 'main_plan', 'cash', 'cashbox',
      jsonb_build_array(jsonb_build_object('row_id', pg_temp.fx('filipp_row'), 'amount', 10000))),
    '%Сначала утвердите план%', 'issue needs approved plan');
  perform public.payroll_payout_plan_state(plan, 'approved');
  perform pg_temp.expect_error(
    format('select public.payroll_payout_plan_save(%L)', jsonb_build_object(
      'schedule', 'main', 'month', '2026-11-01', 'payout_no', 1, 'window_from', '2026-11-25', 'window_to', '2026-12-01',
      'rows', '[]'::jsonb)),
    '%План уже утверждён%', 'approved plan cannot be re-saved');
end $$;

-- ── 3. Выдача: повтор по ключу, частичная, остаток ─────────
do $$
declare first uuid; again uuid; payments int;
begin
  first := pg_temp.issue('key1', 'main_plan', 'cash', 'cashbox',
    jsonb_build_array(jsonb_build_object('row_id', pg_temp.fx('filipp_row'), 'amount', 20000, 'next_pay_date', '2026-11-27')), 0);
  again := pg_temp.issue('key1', 'main_plan', 'cash', 'cashbox',
    jsonb_build_array(jsonb_build_object('row_id', pg_temp.fx('filipp_row'), 'amount', 20000, 'next_pay_date', '2026-11-27')), 0);
  select count(*) into payments from public.payroll_payments p join public.payroll_allocations x on x.payment_id = p.id
   where x.employee_id = pg_temp.fx('filipp') and p.state = 'posted';
  perform pg_temp.check(first = again and payments = 1, 'same request_key returns same issue');
  -- Повтор, пока первый запрос ещё шёл: другая отметка времени и наличные, те же строки.
  again := public.payroll_payout_issue(jsonb_build_object(
    'request_key', pg_temp.fx('key1'), 'plan_id', pg_temp.fx('main_plan'), 'method', 'cash',
    'bank_account_id', pg_temp.fx('cashbox'), 'date', '2026-11-25T12:00:07+03:00', 'business_date', '2026-11-25',
    'cash', jsonb_build_object('available', 170000, 'issued_today', 20000),
    'lines', jsonb_build_array(jsonb_build_object('row_id', pg_temp.fx('filipp_row'), 'amount', 20000, 'next_pay_date', '2026-11-27'))));
  perform pg_temp.check(first = again, 'retry with another timestamp returns the same issue');
  perform pg_temp.check(
    (select issued from public.payroll_payout_rows where id = pg_temp.fx('filipp_row')) = 20000
    and (select state from public.payroll_payout_rows where id = pg_temp.fx('filipp_row')) = 'partial'
    and (select pay_date from public.payroll_payout_rows where id = pg_temp.fx('filipp_row')) = '2026-11-27',
    'partial keeps remainder and moves the day');
  perform pg_temp.check(exists (
    select 1 from public.payroll_adesk_sync s
     where s.payment_id = ((select lines from public.payroll_payout_issues where id = first)->0->>'payment_id')::uuid),
    'cash payout is queued to Adesk as usual');
  perform pg_temp.expect_error(
    format('select pg_temp.issue(%L, %L, %L, %L, %L)', 'key1', 'main_plan', 'cash', 'cashbox',
      jsonb_build_array(jsonb_build_object('row_id', pg_temp.fx('filipp_row'), 'amount', 5000))),
    '%Ключ уже использован для другой выдачи%', 'key reused for other input');
  perform pg_temp.expect_error(
    format('select pg_temp.issue(%L, %L, %L, %L, %L, 0)', 'key2', 'main_plan', 'cash', 'cashbox',
      jsonb_build_array(jsonb_build_object('row_id', pg_temp.fx('filipp_row'), 'amount', 5000))),
    '%Наличные изменились%', 'stale cash snapshot rejected (two people issuing at once)');
  perform pg_temp.expect_error(
    format('select pg_temp.issue(%L, %L, %L, %L, %L)', 'key2', 'main_plan', 'cash', 'cashbox',
      jsonb_build_array(jsonb_build_object('row_id', pg_temp.fx('filipp_row'), 'amount', 10000))),
    '%Больше, чем осталось выдать: Филипп%', 'issued + amount ≤ row amount');
  perform pg_temp.expect_error(
    format('select pg_temp.issue(%L, %L, %L, %L, %L)', 'key2', 'main_plan', 'cash', 'checking',
      jsonb_build_array(jsonb_build_object('row_id', pg_temp.fx('filipp_row'), 'amount', 5000))),
    '%Выберите счёт выплаты%', 'cash payout only from a register');
  perform pg_temp.expect_error(
    format('select public.payroll_payout_row_update(%L, 15000, null)', pg_temp.fx('filipp_row')),
    '%Уже выдано больше%', 'row cannot go below issued');
end $$;

-- ── 4. Ручная выплата после утверждения — переплаты нет ────
do $$
begin
  perform public.payroll_record_payments(jsonb_build_object(
    'request_key', pg_temp.fx('manual'), 'bank_account_id', pg_temp.fx('cashbox'),
    'date', '2026-11-25T13:00:00+03:00', 'month', '2026-11-01',
    'recipients', jsonb_build_array(jsonb_build_object('employee_id', pg_temp.fx('filipp'), 'amount', 30000))));
  perform pg_temp.check(private.payroll_month_balance(pg_temp.fx('filipp'), '2026-11-01') = 0, 'balance is zero after manual payment');
  perform pg_temp.expect_error(
    format('select pg_temp.issue(%L, %L, %L, %L, %L)', 'key3', 'main_plan', 'cash', 'cashbox',
      jsonb_build_array(jsonb_build_object('row_id', pg_temp.fx('filipp_row'), 'amount', 5000))),
    '%Больше, чем сотрудник уже заработал: Филипп%', 'manual payment between plan and issue blocks overpay');
end $$;

-- ── 5. «Выплачено» переводом — без Adesk ───────────────────
do $$
declare plan uuid; row_id uuid; issue uuid; payment uuid;
begin
  plan := public.payroll_payout_plan_save(jsonb_build_object(
    'schedule', 'transfer', 'month', '2026-11-01', 'payout_no', 1, 'window_from', '2026-11-25', 'window_to', '2026-12-01',
    'rows', jsonb_build_array(jsonb_build_object('employee_id', pg_temp.fx('tanya'), 'amount', 23500))));
  insert into fx values ('transfer_plan', plan);
  select id into row_id from public.payroll_payout_rows where plan_id = plan;
  insert into fx values ('tanya_row', row_id);
  perform public.payroll_payout_plan_state(plan, 'approved');
  perform pg_temp.expect_error(
    format('select pg_temp.issue(%L, %L, %L, %L, %L)', 'key4', 'transfer_plan', 'cash', 'cashbox',
      jsonb_build_array(jsonb_build_object('row_id', row_id, 'amount', 23500))),
    '%Способ выдачи не совпадает%', 'transfer plan is not issued in cash');
  -- Сотрудника перевели на основной график после утверждения: по плану «Переводом» не платим.
  perform public.payroll_payout_save_settings(jsonb_build_object('bank_account_id', pg_temp.fx('cashbox'),
    'assignments', jsonb_build_array(jsonb_build_object('employee_id', pg_temp.fx('tanya'), 'schedule', 'main'))));
  perform pg_temp.expect_error(
    format('select pg_temp.issue(%L, %L, %L, %L, %L)', 'key5', 'transfer_plan', 'transfer', 'checking',
      jsonb_build_array(jsonb_build_object('row_id', row_id, 'amount', 20000))),
    '%другой график выплат%', 'employee moved off the schedule is not paid by the old plan');
  perform public.payroll_payout_save_settings(jsonb_build_object('bank_account_id', pg_temp.fx('cashbox'),
    'schedules', jsonb_build_object('transfer', jsonb_build_object('bank_account_id', pg_temp.fx('checking'))),
    'assignments', jsonb_build_array(jsonb_build_object('employee_id', pg_temp.fx('tanya'), 'schedule', 'transfer'))));
  -- Сумма урезана потолком: строка закрывается на выданном.
  issue := pg_temp.issue('key5', 'transfer_plan', 'transfer', 'checking',
    jsonb_build_array(jsonb_build_object('row_id', row_id, 'amount', 20000, 'close', true)));
  payment := ((select lines from public.payroll_payout_issues where id = issue)->0->>'payment_id')::uuid;
  insert into fx values ('tanya_payment', payment);
  perform pg_temp.check(payment is not null
    and not exists (select 1 from public.payroll_adesk_sync where payment_id = payment)
    and (select state from public.payroll_payout_rows where id = row_id) = 'issued',
    'transfer not queued to Adesk');
  perform pg_temp.check((select amount from public.payroll_payout_rows where id = row_id) = 20000,
    'capped line closes the row at the issued amount');
  perform pg_temp.check(
    (select t.bank_account_id from public.payroll_payments p join public.transactions t on t.id = p.transaction_id where p.id = payment) = pg_temp.fx('checking'),
    'transfer posted from the checking account');
  perform pg_temp.expect_error(
    format('select public.payroll_payout_row_update(%L, 23500, null)', row_id),
    '%Строка уже выдана%', 'issued row is locked');
end $$;

-- ── 5б. Удалённая выплата возвращает строку плана ──────────
do $$
begin
  perform public.payroll_cancel_payment(pg_temp.fx('tanya_payment'));
  perform pg_temp.check(
    (select issued from public.payroll_payout_rows where id = pg_temp.fx('tanya_row')) = 0
    and (select state from public.payroll_payout_rows where id = pg_temp.fx('tanya_row')) = 'planned',
    'deleted payout reopens the plan row');
  perform pg_temp.check(
    (select total from public.payroll_payout_issues where plan_id = pg_temp.fx('transfer_plan')) = 0,
    'deleted payout no longer counts in the issue total');
  -- Строку снова можно выдать.
  -- Счёт пришёл на 23 700 при плане 20 000: переводом можно больше плана, в пределах заработанного.
  perform pg_temp.issue('key6', 'transfer_plan', 'transfer', 'checking',
    jsonb_build_array(jsonb_build_object('row_id', pg_temp.fx('tanya_row'), 'amount', 23700)));
  perform pg_temp.check((select state from public.payroll_payout_rows where id = pg_temp.fx('tanya_row')) = 'issued'
    and (select amount from public.payroll_payout_rows where id = pg_temp.fx('tanya_row')) = 23700,
    'reopened row can be issued again, transfer may exceed the plan');
  perform pg_temp.check((
      select count(*) filter (where cardinality(c.conkey) = 2) = 2 and count(*) = 2
        from pg_constraint c
       where c.contype = 'f' and c.confrelid = 'public.bank_accounts'::regclass
         and c.conrelid in ('public.payroll_payout_settings'::regclass, 'public.payroll_payout_issues'::regclass)),
    'bank account FKs are composite (account_id, bank_account_id)');
end $$;

-- ── 5в. Автовыдача сервером (392): без автора, перенос дня ──
do $$
declare issue uuid; payment uuid; already numeric;
begin
  perform pg_temp.act_as(null);
  select coalesce(sum(total), 0) into already from public.payroll_payout_issues
   where venue_id = pg_temp.fx('v') and business_date = '2026-11-25' and method = 'cash';
  issue := public.payroll_payout_issue_system(pg_temp.fx('a'), pg_temp.fx('v'), jsonb_build_object(
    'request_key', gen_random_uuid(), 'plan_id', pg_temp.fx('main_plan'), 'method', 'cash',
    'bank_account_id', pg_temp.fx('cashbox'), 'date', '2026-11-25T14:00:00+03:00', 'business_date', '2026-11-25',
    'cash', jsonb_build_object('available', 100000, 'issued_today', already),
    'lines', jsonb_build_array(jsonb_build_object('row_id', pg_temp.fx('gamlet_row'), 'amount', 5000, 'next_pay_date', '2026-11-27')),
    'moves', jsonb_build_array(jsonb_build_object('row_id', pg_temp.fx('filipp_row'), 'pay_date', '2026-11-28'))));
  payment := ((select lines from public.payroll_payout_issues where id = issue)->0->>'payment_id')::uuid;
  perform pg_temp.check(
    (select created_by from public.payroll_payout_issues where id = issue) is null
    and (select created_by from public.payroll_payments where id = payment) is null
    and (select issued from public.payroll_payout_rows where id = pg_temp.fx('gamlet_row')) = 5000
    and (select pay_date from public.payroll_payout_rows where id = pg_temp.fx('gamlet_row')) = '2026-11-27',
    'system issue posts without an author');
  perform pg_temp.check((select pay_date from public.payroll_payout_rows where id = pg_temp.fx('filipp_row')) = '2026-11-28',
    'moves shift the day of rows that got nothing');
  perform pg_temp.check(
    (select moves from public.payroll_payout_issues where id = issue)
      = jsonb_build_array(jsonb_build_object('row_id', pg_temp.fx('filipp_row'), 'employee_id', pg_temp.fx('filipp'),
          'name', 'Филипп Тестовый', 'from', '2026-11-27', 'to', '2026-11-28'))
    and exists (select 1 from public.payroll_events where entity_id = pg_temp.fx('main_plan') and action = 'payout_row'
                and details->>'reason' = 'move' and details->>'row_id' = pg_temp.fx('filipp_row')::text),
    'applied moves are stored on the issue and logged');
  perform pg_temp.expect_error(
    format('select public.payroll_payout_issue_system(%L, %L, %L)', gen_random_uuid(), pg_temp.fx('v'), '{}'),
    '%не принадлежит аккаунту%', 'system issue checks venue ownership');
  -- Выключатель автовыдачи: по умолчанию выключено, включает настройщик.
  perform pg_temp.act_as(pg_temp.fx('owner'));
  perform pg_temp.check((select auto_issue from public.payroll_payout_settings where venue_id = pg_temp.fx('v')) = false,
    'auto issue is off by default');
  perform public.payroll_payout_set_auto(true);
  perform pg_temp.check((select auto_issue from public.payroll_payout_settings where venue_id = pg_temp.fx('v')) = true,
    'auto issue can be switched on');
  perform pg_temp.act_as(null);
  perform pg_temp.check(not has_function_privilege('authenticated', 'public.payroll_payout_issue_system(uuid, uuid, jsonb)', 'execute')
    and has_function_privilege('service_role', 'public.payroll_payout_issue_system(uuid, uuid, jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.payroll_official_expected_for(uuid, uuid, date, date)', 'execute')
    and has_function_privilege('service_role', 'public.payroll_official_expected_for(uuid, uuid, date, date)', 'execute')
    and not has_function_privilege('anon', 'public.payroll_payout_set_auto(boolean)', 'execute'),
    'system functions are server-only');
  perform pg_temp.act_as(pg_temp.fx('owner'));
end $$;

-- ── 6. Права ───────────────────────────────────────────────
do $$
begin
  perform pg_temp.check(not has_function_privilege('anon', 'public.payroll_payout_issue(jsonb)', 'execute')
    and has_function_privilege('authenticated', 'public.payroll_payout_issue(jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'private.payroll_payout_guard(uuid, date, numeric)', 'execute'),
    'anon cannot execute');
  perform pg_temp.check(not has_table_privilege('authenticated', 'public.payroll_payout_rows', 'update')
    and has_table_privilege('authenticated', 'public.payroll_payout_rows', 'select'),
    'rows are read-only for users');
end $$;

select 'PASS: payroll_payout_plan' as result;

rollback;
