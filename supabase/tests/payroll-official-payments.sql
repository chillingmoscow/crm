-- ============================================================
-- payroll-official-payments.sql — официальная выплата (384): автоматическое
-- проведение за прошлый месяц, повторы и пропущенный день, удаление выплаты,
-- «На разбор» (последний месяц, неактивный, нет счёта, нет статьи), ручное
-- проведение по карточке, пропуск, смена расчётного счёта, настройки, права.
--
-- Прогон внутри одной откатываемой транзакции (reset базы не нужен):
--   cat <(echo 'begin;') \
--       <(sed -E '/^[[:space:]]*(begin|commit);[[:space:]]*$/d' supabase/migrations/383_payroll_official_employment.sql) \
--       <(sed -E '/^[[:space:]]*(begin|commit);[[:space:]]*$/d' supabase/migrations/384_payroll_official_payments.sql) \
--       <(sed -E '/^[[:space:]]*begin;[[:space:]]*$/d' supabase/tests/payroll-official-payments.sql) \
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
    return;
  end;
  raise exception 'TEST FAILED: %: ошибки не было', p_label;
end $$;

create or replace function pg_temp.check(p_ok boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'TEST FAILED: %', p_label; end if;
end $$;

create or replace function pg_temp.act_as(p_user uuid)
returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true),
         set_config('request.jwt.claims', '', true),
         set_config('app.ctx_ready', '0', true);
$$;

-- Крон: без пользователя (service_role).
create or replace function pg_temp.run(p_now timestamptz)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.act_as(null);
  r := public.payroll_official_run(p_now);
  return r;
end $$;

create or replace function pg_temp.fx(p_key text)
returns uuid language sql as $$ select id from fx where key = p_key $$;

create or replace function pg_temp.month_row(p_employment text, p_month date)
returns public.payroll_official_months language sql as $$
  select * from public.payroll_official_months
   where employment_id = pg_temp.fx(p_employment) and month = p_month
$$;


-- ── Фикстуры ───────────────────────────────────────────────
do $$
declare
  owner uuid := (select id from auth.users where email = 'owner@test.com');
  a uuid; v uuid; le uuid; b uuid; r uuid; e uuid; emp uuid;
begin
  if owner is null then raise exception 'Нет пользователя owner@test.com из seed.sql'; end if;
  perform pg_temp.act_as(owner);
  a := public.get_active_account_id();
  v := public.get_active_venue_id();
  if a is null or v is null then raise exception 'У владельца нет активного заведения'; end if;
  if exists (select 1 from public.payroll_settings where official_from is not null) then
    raise exception 'В базе уже есть заведения с официальными выплатами — тест их затронет';
  end if;
  insert into fx values ('owner', owner), ('a', a), ('v', v);

  insert into public.legal_entities(account_id, name, legal_form)
  values (a, 'Официальные выплаты тест', 'OTHER') returning id into le;
  insert into public.bank_accounts(account_id, legal_entity_id, venue_id, name, type)
  values (a, le, v, 'Расчётный 1', 'checking') returning id into b;
  insert into fx values ('checking1', b);
  insert into public.bank_accounts(account_id, legal_entity_id, venue_id, name, type)
  values (a, le, v, 'Расчётный 2', 'checking') returning id into b;
  insert into fx values ('checking2', b);
  insert into public.bank_accounts(account_id, legal_entity_id, venue_id, name, type)
  values (a, le, v, 'Касса', 'cash') returning id into b;
  insert into fx values ('cash', b);

  insert into public.payroll_settings(account_id, venue_id, starts_on, quickresto_venue_id, enabled,
    official_from, official_bank_account_id)
  values (a, v, '2026-09-01', 1, true, '2026-11-01', pg_temp.fx('checking1'))
  on conflict (venue_id) do update
    set official_from = excluded.official_from, official_bank_account_id = excluded.official_bank_account_id;

  -- Должность со статьёй ФОТ (статья создаётся вместе с должностью).
  insert into public.roles(venue_id, name, code) values (v, 'Официальная тест', 'official_pay_test') returning id into r;
  insert into fx values ('role', r);
  insert into fx select 'category', id from public.finance_categories where payroll_role_id = r;
  if pg_temp.fx('category') is null then raise exception 'У должности нет статьи ФОТ'; end if;

  -- Полный: оформлен в октябре, ноябрь — полный месяц.
  insert into public.payroll_employees(account_id, venue_id, name, role_name, role_id)
  values (a, v, 'Полный', 'Кассир', r) returning id into e;
  insert into fx values ('full_emp', e);
  emp := public.payroll_official_command('employ', jsonb_build_object(
    'employee_id', e, 'starts_on', '2026-10-01', 'position', 'Кассир-официант', 'gross', 80000));
  insert into fx values ('full', emp);

  -- Павлов: с 03.11, первый месяц 74 666,67.
  insert into public.payroll_employees(account_id, venue_id, name, role_name, role_id)
  values (a, v, 'Павлов', 'Бармен', r) returning id into e;
  insert into fx values ('pavlov_emp', e);
  emp := public.payroll_official_command('employ', jsonb_build_object(
    'employee_id', e, 'starts_on', '2026-11-03', 'position', 'Старший бармен', 'gross', 80000));
  insert into fx values ('pavlov', emp);

  -- Уволен официально 20.11 — последний месяц.
  insert into public.payroll_employees(account_id, venue_id, name, role_name, role_id)
  values (a, v, 'Последний месяц', 'Кассир', r) returning id into e;
  insert into fx values ('final_emp', e);
  emp := public.payroll_official_command('employ', jsonb_build_object(
    'employee_id', e, 'starts_on', '2026-10-01', 'position', 'Кассир-официант', 'gross', 27500));
  perform public.payroll_official_command('end', jsonb_build_object('employment_id', emp, 'ends_on', '2026-11-20'));
  insert into fx values ('final', emp);

  -- Уволен в приложении, официальной даты нет.
  insert into public.payroll_employees(account_id, venue_id, name, role_name, role_id)
  values (a, v, 'Неактивный', 'Кассир', r) returning id into e;
  insert into fx values ('inactive_emp', e);
  emp := public.payroll_official_command('employ', jsonb_build_object(
    'employee_id', e, 'starts_on', '2026-10-01', 'position', 'Кассир-официант', 'gross', 27500));
  update public.payroll_employees set active = false where id = e;
  insert into fx values ('inactive', emp);

  -- Без должности — нет статьи расхода.
  insert into public.payroll_employees(account_id, venue_id, name, role_name)
  values (a, v, 'Без статьи', 'Кассир') returning id into e;
  insert into fx values ('nocat_emp', e);
  emp := public.payroll_official_command('employ', jsonb_build_object(
    'employee_id', e, 'starts_on', '2026-10-01', 'position', 'Кассир-официант', 'gross', 27500));
  insert into fx values ('nocat', emp);
end $$;

-- ── 0. Пропущенные месяцы (R13): учёт с октября, первый запуск 5 января ──
-- Проводится только декабрь; октябрь и ноябрь без строки месяца уходят на
-- разбор («missed_month»), задним числом ничего не проводится. Проверка
-- откатывается, остальные разделы идут от чистого состояния.
do $$
declare r jsonb; m public.payroll_official_months; n bigint;
begin
  begin
    update public.payroll_settings set official_from = '2026-10-01' where venue_id = pg_temp.fx('v');
    r := pg_temp.run('2027-01-05 06:00+00');
    perform pg_temp.check(jsonb_array_length(r) = 1 and (r->0->>'month')::date = '2026-12-01'
      and (r->0->>'posted')::int = 2 and (r->0->>'review')::int = 9 and (r->0->>'amount')::numeric = 139200
      and jsonb_array_length(r->0->'errors') = 0, 'пропущенные месяцы — итог: ' || r::text);

    -- Полный: декабрь проведён, октябрь и ноябрь — на разбор суммой.
    perform pg_temp.check((pg_temp.month_row('full', '2026-12-01')).status = 'posted', 'полный — декабрь проведён');
    m := pg_temp.month_row('full', '2026-10-01');
    perform pg_temp.check(m.status = 'review' and m.reason = 'missed_month' and m.kind = 'full' and m.gross = 80000
      and m.payment_id is null, 'полный — октябрь на разбор: ' || row_to_json(m)::text);
    m := pg_temp.month_row('full', '2026-11-01');
    perform pg_temp.check(m.status = 'review' and m.reason = 'missed_month' and m.gross = 80000, 'полный — ноябрь на разбор');
    -- Павлов с 03.11: ноябрь — первый месяц на разбор, декабрь проведён.
    m := pg_temp.month_row('pavlov', '2026-11-01');
    perform pg_temp.check(m.status = 'review' and m.reason = 'missed_month' and m.kind = 'first' and m.gross = 74666.67,
      'Павлов — ноябрь на разбор: ' || row_to_json(m)::text);
    perform pg_temp.check((pg_temp.month_row('pavlov', '2026-10-01')).id is null, 'Павлов — октября нет (не оформлен)');
    perform pg_temp.check((pg_temp.month_row('pavlov', '2026-12-01')).status = 'posted', 'Павлов — декабрь проведён');
    -- Уволен 20.11: октябрь — пропущенный, ноябрь — последний месяц, декабря нет.
    perform pg_temp.check((pg_temp.month_row('final', '2026-10-01')).reason = 'missed_month', 'уволенный — октябрь пропущен');
    m := pg_temp.month_row('final', '2026-11-01');
    perform pg_temp.check(m.status = 'review' and m.reason = 'final_month' and m.gross is null, 'уволенный — ноябрь последний');
    perform pg_temp.check((pg_temp.month_row('final', '2026-12-01')).id is null, 'уволенный — декабря нет');
    -- Неактивный: одна карточка на все месяцы (R6).
    perform pg_temp.check((select count(*) = 1 from public.payroll_official_months where employment_id = pg_temp.fx('inactive')),
      'неактивный — одна карточка');
    perform pg_temp.check((pg_temp.month_row('inactive', '2026-10-01')).reason = 'inactive', 'неактивный — карточка за октябрь');
    -- Без статьи: прошлые месяцы — пропущенные, декабрь — нет статьи.
    perform pg_temp.check((pg_temp.month_row('nocat', '2026-10-01')).reason = 'missed_month'
      and (pg_temp.month_row('nocat', '2026-11-01')).reason = 'missed_month'
      and (pg_temp.month_row('nocat', '2026-12-01')).reason = 'no_category', 'без статьи — пропущенные и нет статьи');
    perform pg_temp.check(not exists (select 1 from public.payroll_payments where official_month in ('2026-10-01', '2026-11-01')),
      'задним числом ничего не проведено');

    -- Пропущенные месяцы остаются в ожидаемой части ведомости (R14).
    perform pg_temp.act_as(pg_temp.fx('owner'));
    perform pg_temp.check(exists (select 1 from public.payroll_official_expected('2026-10-01', '2026-10-31') x
      where x.employee_id = pg_temp.fx('full_emp') and x.month = '2026-10-01' and x.gross = 80000),
      'пропущенный октябрь — в ожидаемой части');

    -- Второй запуск ничего не создаёт.
    select count(*) into n from public.payroll_official_months;
    r := pg_temp.run('2027-01-06 06:00+00');
    perform pg_temp.check(r = '[]'::jsonb, 'второй запуск — пусто: ' || r::text);
    perform pg_temp.check((select count(*) from public.payroll_official_months) = n, 'второй запуск — строк не прибавилось');
    raise exception 'rollback-missed-check';
  exception when others then
    if sqlerrm <> 'rollback-missed-check' then raise; end if;
  end;
  perform pg_temp.check(not exists (select 1 from public.payroll_official_months), 'проверка пропущенных месяцев откатилась');
end $$;

-- ── 1. До дня проведения — ничего (день считается по поясу аккаунта) ──
do $$
declare r jsonb;
begin
  -- 04.12 23:00 по Москве (20:00 UTC) — ещё 4-е число.
  r := pg_temp.run('2026-12-04 20:00+00');
  perform pg_temp.check(r = '[]'::jsonb, 'до 5-го ничего: ' || r::text);
  perform pg_temp.check(not exists (select 1 from public.payroll_official_months), 'до 5-го строк месяца нет');

  -- 04.12 22:00 UTC — уже 5-е по Москве: проводит (проверка откатывается).
  begin
    r := pg_temp.run('2026-12-04 22:00+00');
    perform pg_temp.check((r->0->>'posted')::int = 2, '5-е по поясу аккаунта: ' || r::text);
    perform pg_temp.check((select occurred_at = '2026-12-05 12:00'::timestamp at time zone 'Europe/Moscow'
      from public.payroll_payments where official_month = '2026-11-01' limit 1), 'дата — 5-е, 12:00 по Москве');
    raise exception 'rollback-tz-check';
  exception when others then
    if sqlerrm <> 'rollback-tz-check' then raise; end if;
  end;
  perform pg_temp.check(not exists (select 1 from public.payroll_official_months), 'проверка пояса откатилась');

  -- Учитывать с декабря: запуск 5 декабря (за ноябрь) ничего не делает.
  begin
    update public.payroll_settings set official_from = '2026-12-01' where venue_id = pg_temp.fx('v');
    r := pg_temp.run('2026-12-05 09:00+00');
    perform pg_temp.check(r = '[]'::jsonb, 'месяц раньше official_from — пропуск: ' || r::text);
    perform pg_temp.check(not exists (select 1 from public.payroll_official_months), 'месяц раньше official_from — строк нет');
    raise exception 'rollback-from-check';
  exception when others then
    if sqlerrm <> 'rollback-from-check' then raise; end if;
  end;
  perform pg_temp.check((select official_from = '2026-11-01' from public.payroll_settings where venue_id = pg_temp.fx('v')),
    'проверка official_from откатилась');
end $$;

-- ── 2. Крон пропустил 5-е, запустился 9-го — одна выплата датой 5-го ──
do $$
declare
  r jsonb; p public.payroll_payments; al public.payroll_allocations; t public.transactions;
  m public.payroll_official_months;
  pay_date timestamptz := '2026-12-05 12:00'::timestamp at time zone 'Europe/Moscow';
begin
  r := pg_temp.run('2026-12-09 07:00+00');
  perform pg_temp.check(jsonb_array_length(r) = 1
    and (r->0->>'account_id')::uuid = pg_temp.fx('a') and (r->0->>'venue_id')::uuid = pg_temp.fx('v')
    and (r->0->>'month')::date = '2026-11-01'
    and (r->0->>'posted')::int = 2 and (r->0->>'review')::int = 3
    and (r->0->>'amount')::numeric = 134559.67, 'итог запуска за ноябрь: ' || r::text);

  -- Полный месяц: на руки 69 600, закрыто 80 000.
  m := pg_temp.month_row('full', '2026-11-01');
  perform pg_temp.check(m.status = 'posted' and m.kind = 'full' and m.gross = 80000 and m.payment_id is not null
    and m.reason is null, 'полный месяц — строка проведена: ' || row_to_json(m)::text);
  select * into p from public.payroll_payments where id = m.payment_id;
  perform pg_temp.check(p.kind = 'salary' and p.state = 'posted' and p.amount = 69600 and p.official_month = '2026-11-01'
    and p.occurred_at = pay_date and p.created_by is null and p.note = 'Официальная часть за ноябрь 2026',
    'полный месяц — выплата: ' || row_to_json(p)::text);
  perform pg_temp.check((select count(*) = 1 from public.payroll_allocations where payment_id = p.id), 'одна аллокация');
  select * into al from public.payroll_allocations where payment_id = p.id;
  perform pg_temp.check(al.employee_id = pg_temp.fx('full_emp') and al.month = '2026-11-01'
    and al.amount = 69600 and al.settled_amount = 80000, 'аллокация 69 600 / 80 000: ' || row_to_json(al)::text);
  select * into t from public.transactions where id = p.transaction_id;
  perform pg_temp.check(t.amount = 69600 and t.type = 'expense' and t.bank_account_id = pg_temp.fx('checking1')
    and t.category_id = pg_temp.fx('category') and t.date = pay_date and t.deleted_at is null,
    'операция 69 600 на расчётном счёте: ' || row_to_json(t)::text);
  perform pg_temp.check(not exists (select 1 from public.payroll_adesk_sync where payment_id = p.id),
    'официальная выплата не стоит в очереди Adesk');
  perform pg_temp.check((select count(*) = 1 from public.payroll_payments x
      join public.payroll_allocations y on y.payment_id = x.id
     where y.employee_id = pg_temp.fx('full_emp') and x.official_month = '2026-11-01'),
    'за ноябрь ровно одна выплата');

  -- Первый месяц Павлова: 74 666,67 / на руки 64 959,67.
  m := pg_temp.month_row('pavlov', '2026-11-01');
  perform pg_temp.check(m.status = 'posted' and m.kind = 'first' and m.gross = 74666.67, 'Павлов — строка: ' || row_to_json(m)::text);
  select * into al from public.payroll_allocations where payment_id = m.payment_id;
  perform pg_temp.check(al.amount = 64959.67 and al.settled_amount = 74666.67, 'Павлов — 64 959,67 / 74 666,67: ' || row_to_json(al)::text);
  perform pg_temp.check((select amount = 64959.67 from public.transactions
    where id = (select transaction_id from public.payroll_payments where id = m.payment_id)), 'Павлов — операция 64 959,67');

  -- На разбор.
  m := pg_temp.month_row('final', '2026-11-01');
  perform pg_temp.check(m.status = 'review' and m.reason = 'final_month' and m.kind = 'final' and m.gross is null
    and m.payment_id is null, 'последний месяц — на разбор: ' || row_to_json(m)::text);
  m := pg_temp.month_row('inactive', '2026-11-01');
  perform pg_temp.check(m.status = 'review' and m.reason = 'inactive' and m.payment_id is null,
    'неактивный без даты увольнения — на разбор: ' || row_to_json(m)::text);
  m := pg_temp.month_row('nocat', '2026-11-01');
  perform pg_temp.check(m.status = 'review' and m.reason = 'no_category' and m.gross = 27500 and m.payment_id is null,
    'нет статьи — на разбор: ' || row_to_json(m)::text);
  perform pg_temp.check(not exists (select 1 from public.payroll_payments x join public.payroll_allocations y on y.payment_id = x.id
     where y.employee_id in (pg_temp.fx('final_emp'), pg_temp.fx('inactive_emp'), pg_temp.fx('nocat_emp'))),
    'на разборе — выплат нет');
end $$;

-- ── 3. Повторный запуск — ничего ──────────────────────────
do $$
declare r jsonb; n bigint := (select count(*) from public.payroll_payments where official_month is not null);
begin
  r := pg_temp.run('2026-12-09 08:00+00');
  perform pg_temp.check(r = '[]'::jsonb, 'повторный запуск: ' || r::text);
  r := pg_temp.run('2026-12-20 08:00+00');
  perform pg_temp.check(r = '[]'::jsonb, 'запуск 20-го: ' || r::text);
  perform pg_temp.check((select count(*) from public.payroll_payments where official_month is not null) = n,
    'повторные запуски не создают выплат');
end $$;

-- ── 4. Выплату удалили — крон не проводит её снова ────────
do $$
declare r jsonb; p uuid := (pg_temp.month_row('full', '2026-11-01')).payment_id;
begin
  perform pg_temp.act_as(pg_temp.fx('owner'));
  perform public.payroll_cancel_payment(p);
  perform pg_temp.check((select state = 'cancelled' from public.payroll_payments where id = p), 'выплата отменена');
  r := pg_temp.run('2026-12-10 08:00+00');
  perform pg_temp.check(r = '[]'::jsonb, 'run after cancel posts nothing: ' || r::text);
  perform pg_temp.check((pg_temp.month_row('full', '2026-11-01')).status = 'posted'
    and (pg_temp.month_row('full', '2026-11-01')).payment_id = p, 'строка месяца осталась после удаления');
  perform pg_temp.check(not exists (select 1 from public.payroll_payments x join public.payroll_allocations y on y.payment_id = x.id
     where y.employee_id = pg_temp.fx('full_emp') and x.state = 'posted'), 'новой выплаты нет');
end $$;

-- ── 5. Ручное проведение ──────────────────────────────────
do $$
declare
  p uuid; old_p uuid := (pg_temp.month_row('full', '2026-11-01')).payment_id;
  m public.payroll_official_months; al public.payroll_allocations;
begin
  perform pg_temp.act_as(pg_temp.fx('owner'));

  -- Удалённую можно провести заново вручную — строка становится «разобрано».
  p := public.payroll_record_official_payment(jsonb_build_object(
    'employment_id', pg_temp.fx('full'), 'month', '2026-11-01', 'gross', 80000, 'net', 69600,
    'bank_account_id', pg_temp.fx('checking1'), 'date', '2026-12-10 12:00+03'));
  perform pg_temp.check(p is not null and p <> old_p, 'повторное проведение — новая выплата');
  m := pg_temp.month_row('full', '2026-11-01');
  perform pg_temp.check(m.status = 'resolved' and m.payment_id = p and m.resolved_by = pg_temp.fx('owner')
    and m.resolved_at is not null, 'строка — разобрано, новая выплата: ' || row_to_json(m)::text);
  perform pg_temp.check((select state = 'posted' and official_month = '2026-11-01' and created_by = pg_temp.fx('owner')
    from public.payroll_payments where id = p), 'выплата проведена пользователем');
  perform pg_temp.check(exists (select 1 from public.audit_logs where action_code = 'payroll.official_payment.created'
    and entity_type = 'payroll_official_month' and entity_id = m.id and user_id = pg_temp.fx('owner')),
    'журнал: официальная выплата');

  -- Уже есть проведённая — второй раз нельзя.
  perform pg_temp.expect_error(format($q$select public.payroll_record_official_payment('{"employment_id":"%s","month":"2026-11-01","gross":80000,"net":69600,"bank_account_id":"%s","date":"2026-12-10T12:00:00+03:00"}')$q$,
    pg_temp.fx('full'), pg_temp.fx('checking1')), '%уже проведена%', 'вторая выплата за месяц');
  perform pg_temp.expect_error(format($q$select public.payroll_record_official_payment('{"employment_id":"%s","month":"2026-11-01","gross":80000,"net":69600,"bank_account_id":"%s","date":"2026-12-10T12:00:00+03:00"}')$q$,
    pg_temp.fx('pavlov'), pg_temp.fx('checking1')), '%уже проведена%', 'вторая выплата Павлову за ноябрь');

  -- Карточка «последний месяц» — сумму указывают вручную.
  perform pg_temp.expect_error(format($q$select public.payroll_record_official_payment('{"employment_id":"%s","month":"2026-11-01","gross":15000,"net":13050,"bank_account_id":"%s","date":"2026-12-10T12:00:00+03:00"}')$q$,
    pg_temp.fx('final'), pg_temp.fx('cash')), '%расчётного счёта%', 'официальная выплата из кассы');
  perform pg_temp.expect_error(format($q$select public.payroll_record_official_payment('{"employment_id":"%s","month":"2026-11-01","gross":15000,"net":16000,"bank_account_id":"%s","date":"2026-12-10T12:00:00+03:00"}')$q$,
    pg_temp.fx('final'), pg_temp.fx('checking1')), '%на руки больше%', 'на руки больше оклада');
  perform pg_temp.expect_error(format($q$select public.payroll_record_official_payment('{"employment_id":"%s","month":"2026-12-01","gross":15000,"net":13050,"bank_account_id":"%s","date":"2026-12-10T12:00:00+03:00"}')$q$,
    pg_temp.fx('final'), pg_temp.fx('checking1')), '%не оформлен официально%', 'месяц после увольнения');
  p := public.payroll_record_official_payment(jsonb_build_object(
    'employment_id', pg_temp.fx('final'), 'month', '2026-11-01', 'gross', 15000, 'net', 13050,
    'bank_account_id', pg_temp.fx('checking2'), 'date', '2026-12-10 12:00+03'));
  m := pg_temp.month_row('final', '2026-11-01');
  perform pg_temp.check(m.status = 'resolved' and m.payment_id = p and m.gross = 15000 and m.reason = 'final_month',
    'карточка «последний месяц» разобрана: ' || row_to_json(m)::text);
  select * into al from public.payroll_allocations where payment_id = p;
  perform pg_temp.check(al.amount = 13050 and al.settled_amount = 15000 and al.employee_id = pg_temp.fx('final_emp'),
    'ручная выплата 13 050 / 15 000');
  perform pg_temp.check(exists (select 1 from public.audit_logs where action_code = 'payroll.official_month.resolved'
    and entity_type = 'payroll_official_month' and entity_id = m.id), 'журнал: карточка разобрана');
  perform pg_temp.check(not exists (select 1 from public.payroll_adesk_sync where payment_id = p), 'ручная официальная — не в Adesk');

  -- Нет статьи — понятная ошибка.
  perform pg_temp.expect_error(format($q$select public.payroll_record_official_payment('{"employment_id":"%s","month":"2026-11-01","gross":27500,"net":23925,"bank_account_id":"%s","date":"2026-12-10T12:00:00+03:00"}')$q$,
    pg_temp.fx('nocat'), pg_temp.fx('checking1')), '%должность%', 'нет должности — нет статьи');
end $$;

-- ── 6. Обычные выплаты — прежняя проверка округления ─────
do $$
begin
  perform pg_temp.act_as(pg_temp.fx('owner'));
  perform pg_temp.expect_error(format($q$select public.payroll_post_payment('{"request_key":"%s","kind":"salary","bank_account_id":"%s","category_id":"%s","date":"2026-12-10T12:00:00+03:00","amount":100,"allocations":[{"employee_id":"%s","month":"2026-11-01","amount":100,"settled_amount":120}]}')$q$,
    gen_random_uuid(), pg_temp.fx('checking1'), pg_temp.fx('category'), pg_temp.fx('full_emp')),
    'Округление доступно только для чаевых', 'обычная выплата с settled ≠ amount');
  -- Официальную часть обычной выплатой провести нельзя: 1 ₽ не закроет оклад 80 000.
  perform pg_temp.expect_error(format($q$select public.payroll_post_payment('{"request_key":"%s","kind":"salary","bank_account_id":"%s","category_id":"%s","date":"2026-12-10T12:00:00+03:00","amount":1,"official_month":"2026-12-01","allocations":[{"employee_id":"%s","month":"2026-12-01","amount":1,"settled_amount":80000}]}')$q$,
    gen_random_uuid(), pg_temp.fx('checking1'), pg_temp.fx('category'), pg_temp.fx('full_emp')),
    '%Официальная часть проводится отдельно%', 'обычная выплата с official_month');
  perform pg_temp.expect_error(format($q$select public.payroll_post_payment('{"request_key":"%s","kind":"salary","bank_account_id":"%s","category_id":"%s","date":"2026-12-10T12:00:00+03:00","amount":1,"official_month":"","allocations":[{"employee_id":"%s","month":"2026-12-01","amount":1,"settled_amount":1}]}')$q$,
    gen_random_uuid(), pg_temp.fx('checking1'), pg_temp.fx('category'), pg_temp.fx('full_emp')),
    '%Официальная часть проводится отдельно%', 'обычная выплата с пустым official_month');
  -- Вторая действующая официальная выплата за месяц — отказ любым путём.
  perform pg_temp.expect_error(format($q$select private.payroll_post_payment_scoped('{"request_key":"%s","kind":"salary","official_month":"2026-11-01","bank_account_id":"%s","category_id":"%s","date":"2026-12-10T12:00:00+03:00","amount":69600,"allocations":[{"employee_id":"%s","month":"2026-11-01","amount":69600,"settled_amount":80000}]}', '%s', '%s', '%s')$q$,
    gen_random_uuid(), pg_temp.fx('checking1'), pg_temp.fx('category'), pg_temp.fx('full_emp'),
    pg_temp.fx('a'), pg_temp.fx('v'), pg_temp.fx('owner')), '%уже проведена%', 'вторая официальная выплата в общем проведении');
  perform pg_temp.expect_error(format('select private.payroll_official_post(%L, %L, %L, %L, %L, 74666.67, 64959.67, %L, %L)',
    pg_temp.fx('a'), pg_temp.fx('v'), pg_temp.fx('owner'), pg_temp.fx('pavlov'), '2026-11-01',
    pg_temp.fx('checking1'), '2026-12-10 12:00+03'), '%уже проведена%', 'вторая официальная выплата Павлову напрямую');
  -- Официальная — одна аллокация и закрыто не меньше выданного.
  perform pg_temp.expect_error(format($q$select private.payroll_post_payment_scoped('{"request_key":"%s","kind":"salary","official_month":"2026-12-01","bank_account_id":"%s","category_id":"%s","date":"2026-12-10T12:00:00+03:00","amount":100,"allocations":[{"employee_id":"%s","month":"2026-12-01","amount":100,"settled_amount":90}]}', '%s', '%s', '%s')$q$,
    gen_random_uuid(), pg_temp.fx('checking1'), pg_temp.fx('category'), pg_temp.fx('full_emp'),
    pg_temp.fx('a'), pg_temp.fx('v'), pg_temp.fx('owner')), '%Оклад с налогом%', 'официальная: закрыто меньше выданного');
  perform pg_temp.expect_error(format($q$select private.payroll_post_payment_scoped('{"request_key":"%s","kind":"salary","official_month":"2026-12-01","bank_account_id":"%s","category_id":"%s","date":"2026-12-10T12:00:00+03:00","amount":200,"allocations":[{"employee_id":"%s","month":"2026-12-01","amount":100,"settled_amount":120},{"employee_id":"%s","month":"2026-12-01","amount":100,"settled_amount":120}]}', '%s', '%s', '%s')$q$,
    gen_random_uuid(), pg_temp.fx('checking1'), pg_temp.fx('category'), pg_temp.fx('full_emp'), pg_temp.fx('pavlov_emp'),
    pg_temp.fx('a'), pg_temp.fx('v'), pg_temp.fx('owner')), '%одному сотруднику%', 'официальная: две аллокации');
  perform pg_temp.expect_error(format($q$select private.payroll_post_payment_scoped('{"request_key":"%s","kind":"advance","official_month":"2026-12-01","bank_account_id":"%s","category_id":"%s","date":"2026-12-10T12:00:00+03:00","amount":100,"allocations":[{"employee_id":"%s","month":"2026-12-01","amount":100,"settled_amount":120}]}', '%s', '%s', '%s')$q$,
    gen_random_uuid(), pg_temp.fx('checking1'), pg_temp.fx('category'), pg_temp.fx('full_emp'),
    pg_temp.fx('a'), pg_temp.fx('v'), pg_temp.fx('owner')), '%зарплат%', 'официальная: только зарплата');
end $$;

-- ── 7. Пропуск карточки ───────────────────────────────────
do $$
declare m public.payroll_official_months := pg_temp.month_row('nocat', '2026-11-01');
begin
  perform pg_temp.act_as(pg_temp.fx('owner'));
  perform public.payroll_official_skip(m.id);
  m := pg_temp.month_row('nocat', '2026-11-01');
  perform pg_temp.check(m.status = 'skipped' and m.resolved_by = pg_temp.fx('owner') and m.resolved_at is not null,
    'карточка пропущена: ' || row_to_json(m)::text);
  perform pg_temp.check(exists (select 1 from public.audit_logs where action_code = 'payroll.official_month.skipped'
    and entity_type = 'payroll_official_month' and entity_id = m.id), 'журнал: пропуск');
  perform pg_temp.expect_error(format('select public.payroll_official_skip(%L)', m.id), '%уже разобрана%', 'повторный пропуск');
  perform pg_temp.expect_error(format('select public.payroll_official_skip(%L)', (pg_temp.month_row('pavlov', '2026-11-01')).id),
    '%уже разобрана%', 'пропуск проведённой');
end $$;

-- ── 8. Смена расчётного счёта ─────────────────────────────
do $$
declare
  old_p public.payroll_payments; new_p public.payroll_payments; ids uuid[];
  old_al public.payroll_allocations; new_al public.payroll_allocations; t public.transactions;
begin
  perform pg_temp.act_as(pg_temp.fx('owner'));
  select * into old_p from public.payroll_payments where id = (pg_temp.month_row('pavlov', '2026-11-01')).payment_id;
  select * into old_al from public.payroll_allocations where payment_id = old_p.id;

  perform pg_temp.expect_error(format($q$select public.payroll_official_change_account('{"payment_ids":["%s"],"bank_account_id":"%s"}')$q$,
    old_p.id, pg_temp.fx('cash')), '%расчётн%', 'смена на кассу');

  ids := public.payroll_official_change_account(jsonb_build_object(
    'payment_ids', jsonb_build_array(old_p.id), 'bank_account_id', pg_temp.fx('checking2')));
  perform pg_temp.check(cardinality(ids) = 1 and ids[1] <> old_p.id, 'новая выплата');
  perform pg_temp.check((select state = 'cancelled' from public.payroll_payments where id = old_p.id), 'старая выплата отменена');
  perform pg_temp.check((select deleted_at is not null from public.transactions where id = old_p.transaction_id),
    'старая операция удалена');
  select * into new_p from public.payroll_payments where id = ids[1];
  select * into new_al from public.payroll_allocations where payment_id = new_p.id;
  select * into t from public.transactions where id = new_p.transaction_id;
  perform pg_temp.check(new_p.state = 'posted' and new_p.amount = old_p.amount and new_p.occurred_at = old_p.occurred_at
    and new_p.official_month = old_p.official_month and new_p.kind = 'salary', 'новая выплата — те же суммы и дата');
  perform pg_temp.check(new_al.employee_id = old_al.employee_id and new_al.month = old_al.month
    and new_al.amount = old_al.amount and new_al.settled_amount = old_al.settled_amount, 'аллокация та же');
  perform pg_temp.check(t.bank_account_id = pg_temp.fx('checking2') and t.amount = 64959.67 and t.deleted_at is null
    and t.date = old_p.occurred_at, 'операция на новом счёте: ' || row_to_json(t)::text);
  perform pg_temp.check((pg_temp.month_row('pavlov', '2026-11-01')).payment_id = new_p.id
    and (pg_temp.month_row('pavlov', '2026-11-01')).status = 'posted', 'payment_id переставлен');
  perform pg_temp.check(exists (select 1 from public.audit_logs where action_code = 'payroll.official_payment.account_changed'
    and user_id = pg_temp.fx('owner') and (details->>'bank_account_id')::uuid = pg_temp.fx('checking2')),
    'журнал: смена счёта');
  perform pg_temp.check(not exists (select 1 from public.payroll_adesk_sync where payment_id = new_p.id), 'новая — не в Adesk');

  -- Отменённую сменить нельзя.
  perform pg_temp.expect_error(format($q$select public.payroll_official_change_account('{"payment_ids":["%s"],"bank_account_id":"%s"}')$q$,
    old_p.id, pg_temp.fx('checking1')), '%недоступна%', 'смена счёта у отменённой');
end $$;

-- ── 9. Настройки официальной выплаты ─────────────────────
do $$
begin
  perform pg_temp.act_as(pg_temp.fx('owner'));
  perform pg_temp.expect_error($q$select public.payroll_command('settings', '{"official_pay_day":29}')$q$,
    '%с 1 по 28%', 'день проведения 29');
  perform pg_temp.expect_error($q$select public.payroll_command('settings', '{"official_from":"2026-11-15"}')$q$,
    '%первого числа%', 'начало не с 1-го');
  perform pg_temp.expect_error(format($q$select public.payroll_command('settings', '{"official_bank_account_id":"%s"}')$q$,
    pg_temp.fx('cash')), '%расчётный счёт%', 'касса как счёт по умолчанию');
  perform pg_temp.expect_error($q$select public.payroll_command('settings', '{"official_from":"2026-08-01"}')$q$,
    '%раньше начала расчёта%', 'официальные выплаты раньше начала расчёта зарплаты');

  perform public.payroll_command('settings', jsonb_build_object('official_pay_day', 6, 'official_bank_account_id', pg_temp.fx('checking2')));
  perform pg_temp.check((select official_pay_day = 6 and official_bank_account_id = pg_temp.fx('checking2') and official_from = '2026-11-01'
    from public.payroll_settings where venue_id = pg_temp.fx('v')), 'настройки сохранены, остальное не тронуто');
  perform public.payroll_command('settings', jsonb_build_object('official_pay_day', 5, 'official_bank_account_id', null));
  perform pg_temp.check((select official_pay_day = 5 and official_bank_account_id is null
    from public.payroll_settings where venue_id = pg_temp.fx('v')), 'счёт по умолчанию снят');

  -- Финансовые поля — только с правом проведения выплат.
  perform set_config('app.account_id', pg_temp.fx('a')::text, true);
  perform set_config('app.venue_id', pg_temp.fx('v')::text, true);
  perform set_config('app.perms', ',payroll.configure,', true);
  perform set_config('app.ctx_ready', '1', true);
  perform pg_temp.expect_error($q$select public.payroll_command('settings', '{"official_pay_day":7}')$q$,
    '%права проведения выплат%', 'настройки без payroll.pay');
  perform public.payroll_command('settings', jsonb_build_object('official_pay_day', 5));
  perform set_config('app.perms', ',payroll.pay,', true);
  perform pg_temp.expect_error(format($q$select public.payroll_record_official_payment('{"employment_id":"%s","month":"2026-11-01","gross":1,"net":1,"bank_account_id":"%s","date":"2026-12-10T12:00:00+03:00"}')$q$,
    pg_temp.fx('inactive'), pg_temp.fx('checking1')), '%финансовым операциям%', 'ручная выплата без finance.create_transaction');
  perform pg_temp.expect_error(format('select public.payroll_official_skip(%L)', (pg_temp.month_row('inactive', '2026-11-01')).id),
    '%финансовым операциям%', 'пропуск без finance.create_transaction');
  -- Смена счёта удаляет операцию — нужно ещё и право на удаление (как отмена выплаты).
  perform set_config('app.perms', ',payroll.pay,finance.create_transaction,', true);
  perform pg_temp.expect_error(format($q$select public.payroll_official_change_account('{"payment_ids":["%s"],"bank_account_id":"%s"}')$q$,
    (pg_temp.month_row('full', '2026-11-01')).payment_id, pg_temp.fx('checking2')),
    '%отмене финансовой операции%', 'смена счёта без finance.delete_transaction');
  perform pg_temp.act_as(pg_temp.fx('owner'));
end $$;

-- ── 10. Без расчётного счёта — на разбор; неактивный — одна карточка ──
do $$
declare r jsonb; m public.payroll_official_months; p uuid;
begin
  r := pg_temp.run('2027-01-05 06:00+00');
  perform pg_temp.check(jsonb_array_length(r) = 1 and (r->0->>'month')::date = '2026-12-01'
    and (r->0->>'posted')::int = 0 and (r->0->>'review')::int = 3 and (r->0->>'amount')::numeric = 0,
    'декабрь без счёта: ' || r::text);
  m := pg_temp.month_row('full', '2026-12-01');
  perform pg_temp.check(m.status = 'review' and m.reason = 'no_bank_account' and m.gross = 80000, 'нет счёта — на разбор: ' || row_to_json(m)::text);
  perform pg_temp.check((pg_temp.month_row('pavlov', '2026-12-01')).reason = 'no_bank_account', 'Павлов — нет счёта');
  perform pg_temp.check((pg_temp.month_row('nocat', '2026-12-01')).reason = 'no_bank_account', 'без статьи — сначала нет счёта');
  perform pg_temp.check((pg_temp.month_row('final', '2026-12-01')).id is null, 'уволенный в ноябре — декабря нет');
  perform pg_temp.check((pg_temp.month_row('inactive', '2026-12-01')).id is null, 'неактивный — вторая карточка не создана');
  perform pg_temp.check(not exists (select 1 from public.payroll_payments where official_month = '2026-12-01'), 'выплат за декабрь нет');

  -- Карточку «нет счёта» разбирают вручную.
  perform pg_temp.act_as(pg_temp.fx('owner'));
  p := public.payroll_record_official_payment(jsonb_build_object(
    'employment_id', pg_temp.fx('pavlov'), 'month', '2026-12-01', 'gross', 80000, 'net', 69600,
    'bank_account_id', pg_temp.fx('checking1'), 'date', '2027-01-05 12:00+03'));
  m := pg_temp.month_row('pavlov', '2026-12-01');
  perform pg_temp.check(m.status = 'resolved' and m.payment_id = p and m.reason = 'no_bank_account',
    'карточка «нет счёта» разобрана: ' || row_to_json(m)::text);

  -- Следующий месяц: неактивный по-прежнему одной карточкой (ноябрьской).
  r := pg_temp.run('2027-02-05 06:00+00');
  perform pg_temp.check((pg_temp.month_row('inactive', '2027-01-01')).id is null, 'неактивный — январской карточки нет');
  perform pg_temp.check((select count(*) = 1 from public.payroll_official_months
    where employment_id = pg_temp.fx('inactive') and status = 'review'), 'у неактивного одна открытая карточка');
  perform pg_temp.check(jsonb_array_length(r) = 1 and (r->0->>'review')::int = 3, 'январь без счёта: ' || r::text);
end $$;

-- ── 11. Ошибка одного периода не мешает остальным ────────
do $$
declare r jsonb; e uuid; emp uuid; p public.payroll_payments;
begin
  perform pg_temp.act_as(pg_temp.fx('owner'));
  perform public.payroll_command('settings', jsonb_build_object('official_bank_account_id', pg_temp.fx('checking1')));
  insert into public.payroll_employees(account_id, venue_id, name, role_name, role_id)
  values (pg_temp.fx('a'), pg_temp.fx('v'), 'Сломанный оклад', 'Кассир', pg_temp.fx('role')) returning id into e;
  emp := public.payroll_official_command('employ', jsonb_build_object(
    'employee_id', e, 'starts_on', '2027-02-01', 'position', 'Кассир-официант', 'gross', 50000));
  insert into fx values ('broken', emp);
  -- Оклад вне допустимого для выплаты: проведение этого периода падает.
  update public.payroll_official_salaries set gross = 2000000000 where employment_id = emp;

  r := pg_temp.run('2027-03-05 06:00+00');
  perform pg_temp.check(jsonb_array_length(r) = 1 and (r->0->>'month')::date = '2027-02-01'
    and (r->0->>'posted')::int = 2 and (r->0->>'review')::int = 1 and (r->0->>'amount')::numeric = 139200
    and jsonb_array_length(r->0->'errors') = 1
    and (r->0->'errors'->0->>'employment_id')::uuid = emp
    and r->0->'errors'->0->>'message' = 'Некорректная выплата', 'ошибка одного периода в итоге: ' || r::text);
  perform pg_temp.check((pg_temp.month_row('broken', '2027-02-01')).id is null, 'у сломанного периода строки месяца нет');
  perform pg_temp.check(not exists (select 1 from public.payroll_allocations where employee_id = e), 'у сломанного выплаты нет');
  select * into p from public.payroll_payments where id = (pg_temp.month_row('full', '2027-02-01')).payment_id;
  perform pg_temp.check(p.state = 'posted' and p.amount = 69600, 'остальные проведены');
  perform pg_temp.check((pg_temp.month_row('pavlov', '2027-02-01')).status = 'posted', 'Павлов за февраль проведён');
  perform pg_temp.check((pg_temp.month_row('nocat', '2027-02-01')).reason = 'no_category', 'без статьи — на разбор');

  -- Следующий запуск пробует сломанный период снова и снова сообщает об ошибке.
  r := pg_temp.run('2027-03-06 06:00+00');
  perform pg_temp.check(jsonb_array_length(r) = 1 and (r->0->>'posted')::int = 0 and (r->0->>'review')::int = 0
    and jsonb_array_length(r->0->'errors') = 1, 'повтор — только ошибка: ' || r::text);
end $$;

-- ── 12. Права на крон ─────────────────────────────────────
do $$
begin
  perform pg_temp.check(not has_function_privilege('authenticated', 'public.payroll_official_run(timestamptz)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.payroll_official_run(timestamptz)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.payroll_official_run(timestamptz)', 'EXECUTE'),
    'крон — только service_role');
  perform pg_temp.check(not has_function_privilege('authenticated', 'private.payroll_official_post(uuid, uuid, uuid, uuid, date, numeric, numeric, uuid, timestamptz)', 'EXECUTE'),
    'проведение — только сервер');
  perform pg_temp.check(has_function_privilege('authenticated', 'public.payroll_record_official_payment(jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.payroll_record_official_payment(jsonb)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.payroll_official_skip(uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.payroll_official_change_account(jsonb)', 'EXECUTE'),
    'пользовательские функции — authenticated');
end $$;

select 'PASS: payroll-official-payments' as result;

rollback;
