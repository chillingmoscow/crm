-- ============================================================
-- payroll-official-employment.sql — официальное трудоустройство (383):
-- сумма месяца (полный / первый / последний), ожидаемая официальная часть,
-- команда оформления/оклада/увольнения/отмены, права.
--
-- Прогон внутри одной откатываемой транзакции (reset базы не нужен):
--   cat <(echo 'begin;') \
--       <(sed -E '/^[[:space:]]*(begin|commit);[[:space:]]*$/d' supabase/migrations/383_payroll_official_employment.sql) \
--       <(sed -E '/^[[:space:]]*begin;[[:space:]]*$/d' supabase/tests/payroll-official-employment.sql) \
--     | docker exec -i supabase_db_crm psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -
--
-- Нужны пользователи из supabase/seed.sql: owner@test.com (владелец),
-- waiter@test.com и manager@test.com (сотрудники того же заведения).
-- ============================================================

\set ON_ERROR_STOP on

begin;

-- Ожидаемая ошибка: выполнить запрос и проверить текст исключения.
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
  select set_config('request.jwt.claim.sub', p_user::text, true),
         set_config('app.ctx_ready', '0', true);
$$;

create temp table fx(key text primary key, id uuid);

-- ── Фикстуры ───────────────────────────────────────────────
do $$
declare
  owner uuid := (select id from auth.users where email = 'owner@test.com');
  waiter uuid := (select id from auth.users where email = 'waiter@test.com');
  manager uuid := (select id from auth.users where email = 'manager@test.com');
  a uuid; v uuid; v2 uuid; e uuid;
begin
  if owner is null or waiter is null or manager is null then
    raise exception 'Нет пользователей из seed.sql';
  end if;
  perform pg_temp.act_as(owner);
  a := public.get_active_account_id();
  v := public.get_active_venue_id();
  if a is null or v is null then raise exception 'У владельца нет активного заведения'; end if;

  insert into public.payroll_settings(account_id, venue_id, starts_on, quickresto_venue_id, enabled, official_from)
  values (a, v, '2026-09-01', 1, true, '2026-11-01')
  on conflict (venue_id) do update set official_from = excluded.official_from;

  insert into fx values ('owner', owner), ('waiter', waiter), ('manager', manager), ('a', a), ('v', v);

  -- Павлов — карточка зарплаты официанта; остальные без пользователя.
  insert into public.payroll_employees(account_id, venue_id, name, role_name, local_user_id)
  values (a, v, 'Павлов', 'Бармен', waiter) returning id into e;
  insert into fx values ('pavlov', e);
  insert into public.payroll_employees(account_id, venue_id, name, role_name)
  values (a, v, 'С первого числа', 'Кассир') returning id into e;
  insert into fx values ('first_day', e);
  insert into public.payroll_employees(account_id, venue_id, name, role_name)
  values (a, v, 'С последнего числа', 'Кассир') returning id into e;
  insert into fx values ('last_day', e);
  insert into public.payroll_employees(account_id, venue_id, name, role_name)
  values (a, v, 'С октября', 'Кассир') returning id into e;
  insert into fx values ('october', e);
  insert into public.payroll_employees(account_id, venue_id, name, role_name, local_user_id)
  values (a, v, 'Менеджер', 'Менеджер', manager) returning id into e;
  insert into fx values ('manager_here', e);

  -- Тот же пользователь (менеджер) в другом заведении аккаунта — уже оформлен там.
  insert into public.venues(account_id, name, type) values (a, 'Второе заведение', 'cafe') returning id into v2;
  insert into public.payroll_employees(account_id, venue_id, name, role_name, local_user_id)
  values (a, v2, 'Менеджер', 'Менеджер', manager) returning id into e;
  insert into public.payroll_official_employments(account_id, venue_id, employee_id, starts_on, position)
  values (a, v2, e, '2026-10-01', 'Управляющий');
end $$;

-- ── 1. Оформление и сумма месяца ──────────────────────────
do $$
declare
  emp uuid; r record;
begin
  perform pg_temp.act_as((select id from fx where key = 'owner'));

  emp := public.payroll_official_command('employ', jsonb_build_object(
    'employee_id', (select id from fx where key = 'pavlov'),
    'starts_on', '2026-11-03', 'position', 'Старший бармен', 'gross', 80000,
    'contract_number', '17', 'contract_date', '2026-11-03'));
  insert into fx values ('emp_pavlov', emp);

  perform pg_temp.check((select position = 'Старший бармен' and contract_number = '17' and ends_on is null
    and created_by = (select id from fx where key = 'owner')
    from public.payroll_official_employments where id = emp), 'период оформления сохранён');
  perform pg_temp.check((select count(*) = 1 and min(valid_from) = '2026-11-01' and min(gross) = 80000
    from public.payroll_official_salaries where employment_id = emp), 'оклад с месяца оформления');
  perform pg_temp.check(exists(select 1 from public.audit_logs where action_code = 'payroll.official_employment.created'
    and entity_type = 'payroll_official_employment' and entity_id = emp
    and user_id = (select id from fx where key = 'owner')), 'журнал: оформление');

  select * into r from private.payroll_official_gross(emp, '2026-11-01');
  perform pg_temp.check(r.kind = 'first' and r.gross = 74666.67 and r.days_paid = 28 and r.days_in_month = 30,
    'ноябрь Павлова: ' || r::text);
  select * into r from private.payroll_official_gross(emp, '2026-12-01');
  perform pg_temp.check(r.kind = 'full' and r.gross = 80000 and r.days_paid = 31 and r.days_in_month = 31,
    'декабрь Павлова: ' || r::text);
  perform pg_temp.check(not exists(select 1 from private.payroll_official_gross(emp, '2026-10-01')),
    'октябрь до оформления — нет строки');

  emp := public.payroll_official_command('employ', jsonb_build_object(
    'employee_id', (select id from fx where key = 'first_day'),
    'starts_on', '2026-11-01', 'position', 'Кассир-официант', 'gross', 27500));
  insert into fx values ('emp_first_day', emp);
  select * into r from private.payroll_official_gross(emp, '2026-11-01');
  perform pg_temp.check(r.kind = 'full' and r.gross = 27500 and r.days_paid = 30 and r.days_in_month = 30,
    'оформление 1-го — полный месяц: ' || r::text);

  emp := public.payroll_official_command('employ', jsonb_build_object(
    'employee_id', (select id from fx where key = 'last_day'),
    'starts_on', '2026-11-30', 'position', 'Кассир-официант', 'gross', 80000));
  insert into fx values ('emp_last_day', emp);
  select * into r from private.payroll_official_gross(emp, '2026-11-01');
  perform pg_temp.check(r.kind = 'first' and r.gross = 2666.67 and r.days_paid = 1 and r.days_in_month = 30,
    'оформление 30-го — первый месяц за 1 день: ' || r::text);

  emp := public.payroll_official_command('employ', jsonb_build_object(
    'employee_id', (select id from fx where key = 'october'),
    'starts_on', '2026-10-01', 'position', 'Кассир-официант', 'gross', 27500));
  insert into fx values ('emp_october', emp);
end $$;

-- ── 2. Повторное оформление ───────────────────────────────
do $$
begin
  perform pg_temp.act_as((select id from fx where key = 'owner'));
  perform pg_temp.expect_error(format($q$select public.payroll_official_command('employ', '{"employee_id":"%s","starts_on":"2026-12-01","position":"Бармен","gross":50000}')$q$,
    (select id from fx where key = 'pavlov')), '%уже оформлен%', 'второе оформление того же сотрудника');
  perform pg_temp.expect_error(format($q$select public.payroll_official_command('employ', '{"employee_id":"%s","starts_on":"2026-11-01","position":"Менеджер","gross":50000}')$q$,
    (select id from fx where key = 'manager_here')), '%уже оформлен%', 'пользователь уже оформлен в другом заведении аккаунта');
  perform pg_temp.expect_error(format($q$select public.payroll_official_command('employ', '{"employee_id":"%s","starts_on":"2026-11-01","position":"Бармен","gross":0}')$q$,
    (select id from fx where key = 'manager_here')), '%оклад%', 'нулевой оклад');
end $$;

-- ── 3. Новый оклад и увольнение ───────────────────────────
do $$
declare
  emp uuid := (select id from fx where key = 'emp_pavlov');
  r record;
begin
  perform pg_temp.act_as((select id from fx where key = 'owner'));

  perform public.payroll_official_command('salary', jsonb_build_object(
    'employment_id', emp, 'valid_from', '2027-01-01', 'gross', 90000));
  select * into r from private.payroll_official_gross(emp, '2027-01-01');
  perform pg_temp.check(r.kind = 'full' and r.gross = 90000, 'январь — новый оклад: ' || r::text);
  select * into r from private.payroll_official_gross(emp, '2026-12-01');
  perform pg_temp.check(r.gross = 80000, 'декабрь — прежний оклад: ' || r::text);
  perform pg_temp.check(exists(select 1 from public.audit_logs where action_code = 'payroll.official_salary.created'
    and entity_type = 'payroll_official_employment' and entity_id = emp), 'журнал: новый оклад');

  perform pg_temp.expect_error(format($q$select public.payroll_official_command('salary', '{"employment_id":"%s","valid_from":"2027-02-15","gross":90000}')$q$, emp),
    '%первого числа%', 'оклад не с первого числа');

  perform public.payroll_official_command('update', jsonb_build_object(
    'employment_id', emp, 'position', 'Старший бармен-кассир', 'contract_number', ''));
  perform pg_temp.check((select position = 'Старший бармен-кассир' and contract_number is null and contract_date = '2026-11-03'
    from public.payroll_official_employments where id = emp), 'исправление данных: пустое поле очищается, остальные не трогаются');
  perform pg_temp.check(exists(select 1 from public.audit_logs where action_code = 'payroll.official_employment.updated'
    and entity_id = emp), 'журнал: исправление данных');

  perform public.payroll_official_command('end', jsonb_build_object('employment_id', emp, 'ends_on', '2026-12-15'));
  select * into r from private.payroll_official_gross(emp, '2026-12-01');
  perform pg_temp.check(r.kind = 'final' and r.gross is null and r.days_paid is null and r.days_in_month = 31,
    'декабрь — месяц увольнения: ' || r::text);
  perform pg_temp.check(not exists(select 1 from private.payroll_official_gross(emp, '2027-01-01')),
    'январь после увольнения — нет строки');
  perform pg_temp.check(exists(select 1 from public.audit_logs where action_code = 'payroll.official_employment.ended'
    and entity_id = emp), 'журнал: увольнение');

  perform pg_temp.expect_error(format($q$select public.payroll_official_command('end', '{"employment_id":"%s","ends_on":"2026-11-01"}')$q$, emp),
    '%раньше даты оформления%', 'увольнение раньше оформления');

  -- После увольнения можно оформить заново — с даты позже увольнения.
  perform pg_temp.expect_error(format($q$select public.payroll_official_command('employ', '{"employee_id":"%s","starts_on":"2026-12-10","position":"Бармен","gross":50000}')$q$,
    (select id from fx where key = 'pavlov')), '%уже оформлен%', 'новое оформление пересекается с прежним периодом');
end $$;

-- ── 4. Ожидаемая официальная часть ────────────────────────
do $$
declare
  pavlov uuid := (select id from fx where key = 'pavlov');
  october uuid := (select id from fx where key = 'october');
  emp_october uuid := (select id from fx where key = 'emp_october');
  r record; n int;
begin
  perform pg_temp.act_as((select id from fx where key = 'owner'));

  select count(*) into n from public.payroll_official_expected('2026-10-01', '2027-01-31') x where x.employee_id = pavlov;
  perform pg_temp.check(n = 2, 'Павлов: ноябрь и декабрь, без января — ' || n);
  select * into r from public.payroll_official_expected('2026-10-01', '2027-01-31') x where x.employee_id = pavlov and x.month = '2026-11-01';
  perform pg_temp.check(r.kind = 'first' and r.gross = 74666.67 and r.days_paid = 28 and r.days_in_month = 30
    and r.employment_id = (select id from fx where key = 'emp_pavlov'), 'Павлов, ноябрь: ' || r::text);
  select * into r from public.payroll_official_expected('2026-10-01', '2027-01-31') x where x.employee_id = pavlov and x.month = '2026-12-01';
  perform pg_temp.check(r.kind = 'final' and r.gross is null, 'Павлов, декабрь: ' || r::text);

  -- Оформлен с октября, но учёт с ноября: октябрь не попадает.
  perform pg_temp.check(not exists(select 1 from public.payroll_official_expected('2026-10-01', '2026-11-30') x
    where x.employee_id = october and x.month = '2026-10-01'), 'октябрь до official_from не попадает');
  perform pg_temp.check(exists(select 1 from public.payroll_official_expected('2026-10-01', '2026-11-30') x
    where x.employee_id = october and x.month = '2026-11-01' and x.kind = 'full' and x.gross = 27500), 'ноябрь с октябрьским оформлением — полный');

  -- Строка месяца: проведено — не ожидается; на разборе с известной суммой — ожидается;
  -- на разборе без суммы (увольнение) — не ожидается.
  insert into public.payroll_official_months(account_id, venue_id, employment_id, employee_id, month, kind, gross, status)
  values ((select id from fx where key = 'a'), (select id from fx where key = 'v'), emp_october, october, '2026-11-01', 'full', 27500, 'posted');
  perform pg_temp.check(not exists(select 1 from public.payroll_official_expected('2026-11-01', '2026-11-30') x where x.employee_id = october),
    'проведённый месяц не ожидается');
  update public.payroll_official_months set status = 'review', reason = 'no_bank_account' where employment_id = emp_october;
  perform pg_temp.check(exists(select 1 from public.payroll_official_expected('2026-11-01', '2026-11-30') x where x.employee_id = october and x.gross = 27500),
    'на разборе без счёта — ожидается');
  update public.payroll_official_months set reason = 'no_category' where employment_id = emp_october;
  perform pg_temp.check(exists(select 1 from public.payroll_official_expected('2026-11-01', '2026-11-30') x where x.employee_id = october),
    'на разборе без статьи — ожидается');
  update public.payroll_official_months set kind = 'final', gross = null, reason = 'final_month' where employment_id = emp_october;
  perform pg_temp.check(not exists(select 1 from public.payroll_official_expected('2026-11-01', '2026-11-30') x where x.employee_id = october),
    'на разборе из-за увольнения — не ожидается');
  update public.payroll_official_months set status = 'skipped', reason = null where employment_id = emp_october;
  perform pg_temp.check(not exists(select 1 from public.payroll_official_expected('2026-11-01', '2026-11-30') x where x.employee_id = october),
    'пропущенный месяц не ожидается');

  -- Неактивный в зарплате без даты увольнения — «последний месяц», сумма неизвестна (R3).
  update public.payroll_employees set active = false where id = (select id from fx where key = 'first_day');
  select * into r from private.payroll_official_gross((select id from fx where key = 'emp_first_day'), '2026-12-01');
  perform pg_temp.check(r.kind = 'final' and r.gross is null, 'неактивный без даты увольнения: ' || r::text);
  update public.payroll_employees set active = true where id = (select id from fx where key = 'first_day');

  perform pg_temp.check(not exists(select 1 from public.payroll_official_expected('2026-10-01', '2027-01-31') x
    where x.employee_id not in (select employee_id from public.payroll_official_employments where venue_id = (select id from fx where key = 'v'))),
    'только своё заведение');
end $$;

-- ── 5. Права ──────────────────────────────────────────────
do $$
declare
  waiter uuid := (select id from fx where key = 'waiter');
  n int; ok_e boolean; ok_s boolean; ok_m boolean; ok_l boolean; ok_any boolean; denied boolean;
begin
  -- Общий журнал официанту открыт (org.view_audit), зарплатный — нет.
  insert into public.role_permissions(role_id, permission_id, granted)
  select uvr.role_id, p.id, true
    from public.user_venue_roles uvr, public.permissions p
   where uvr.user_id = waiter and uvr.venue_id = (select id from fx where key = 'v') and p.code = 'org.view_audit'
  on conflict (role_id, permission_id) do update set granted = true;
  insert into public.audit_logs(account_id, venue_id, action_code, entity_type)
  values ((select id from fx where key = 'a'), (select id from fx where key = 'v'), 'test.sanity.created', 'test_sanity');

  perform pg_temp.act_as(waiter);
  perform pg_temp.check(not public.has_permission('payroll.configure') and not public.has_permission('payroll.view'),
    'у официанта нет прав на зарплату');
  perform pg_temp.expect_error(format($q$select public.payroll_official_command('employ', '{"employee_id":"%s","starts_on":"2026-11-01","position":"Бармен","gross":50000}')$q$,
    (select id from fx where key = 'manager_here')), '%Нет доступа%', 'оформление без payroll.configure');
  perform pg_temp.expect_error(format($q$select public.payroll_official_command('end', '{"employment_id":"%s","ends_on":"2026-12-31"}')$q$,
    (select id from fx where key = 'emp_first_day')), '%Нет доступа%', 'увольнение без payroll.configure');

  -- Сотрудник видит только свою ожидаемую часть.
  select count(*) into n from public.payroll_official_expected('2026-10-01', '2027-01-31');
  perform pg_temp.check(n = 2 and not exists(select 1 from public.payroll_official_expected('2026-10-01', '2027-01-31') x
    where x.employee_id <> (select id from fx where key = 'pavlov')), 'сотрудник видит только себя: ' || n);
  -- Таблицы — только с правом просмотра зарплаты (проверки — после reset role:
  -- временные функции теста роли authenticated не видны).
  set local role authenticated;
  ok_e := not exists(select 1 from public.payroll_official_employments);
  ok_s := not exists(select 1 from public.payroll_official_salaries);
  ok_m := not exists(select 1 from public.payroll_official_months);
  ok_l := not exists(select 1 from public.audit_logs where entity_type = 'payroll_official_employment');
  ok_any := exists(select 1 from public.audit_logs where entity_type = 'test_sanity');
  reset role;
  perform pg_temp.check(ok_any, 'официант видит общий журнал');
  perform pg_temp.check(ok_e, 'таблица периодов закрыта без payroll.view');
  perform pg_temp.check(ok_s, 'таблица окладов закрыта без payroll.view');
  perform pg_temp.check(ok_m, 'таблица месяцев закрыта без payroll.view');
  perform pg_temp.check(ok_l, 'журнал оформления закрыт без payroll.view');

  perform pg_temp.act_as(gen_random_uuid());
  perform pg_temp.check(not exists(select 1 from public.payroll_official_expected('2026-10-01', '2027-01-31')),
    'без заведения — пусто, без ошибки');

  perform pg_temp.act_as((select id from fx where key = 'owner'));
  set local role authenticated;
  select count(*) into n from public.payroll_official_employments;
  ok_l := exists(select 1 from public.audit_logs where entity_type = 'payroll_official_employment');
  begin
    insert into public.payroll_official_months(account_id, venue_id, employment_id, employee_id, month, kind, status)
    select account_id, venue_id, id, employee_id, '2027-01-01', 'full', 'posted' from public.payroll_official_employments limit 1;
    denied := false;
  exception when insufficient_privilege then
    denied := true;
  end;
  reset role;
  perform pg_temp.check(n >= 4, 'владелец видит периоды: ' || n);
  perform pg_temp.check(ok_l, 'владелец видит журнал оформления');
  perform pg_temp.check(denied, 'запись в таблицы — только через функции');
end $$;

-- ── 6. Отмена оформления ──────────────────────────────────
do $$
declare
  a uuid := (select id from fx where key = 'a');
  v uuid := (select id from fx where key = 'v');
  emp uuid := (select id from fx where key = 'emp_last_day');
  p uuid;
begin
  perform pg_temp.act_as((select id from fx where key = 'owner'));

  perform public.payroll_official_command('cancel', jsonb_build_object('employment_id', emp));
  perform pg_temp.check((select archived_at is not null and archived_by = (select id from fx where key = 'owner')
    from public.payroll_official_employments where id = emp), 'отмена — в архив');
  perform pg_temp.check(not exists(select 1 from public.payroll_official_expected('2026-11-01', '2026-12-31') x
    where x.employment_id = emp), 'отменённое оформление не ожидается');
  perform pg_temp.check(exists(select 1 from public.audit_logs where action_code = 'payroll.official_employment.cancelled'
    and entity_id = emp), 'журнал: отмена');
  perform pg_temp.expect_error(format($q$select public.payroll_official_command('end', '{"employment_id":"%s","ends_on":"2026-12-31"}')$q$, emp),
    '%не найден%', 'отменённое оформление не меняется');

  -- Отменённое не мешает оформить заново.
  perform public.payroll_official_command('employ', jsonb_build_object(
    'employee_id', (select id from fx where key = 'last_day'),
    'starts_on', '2026-12-01', 'position', 'Кассир-официант', 'gross', 30000));

  -- С проведённой официальной выплатой отменить нельзя.
  emp := (select id from fx where key = 'emp_first_day');
  insert into public.payroll_payments(account_id, venue_id, request_key, kind, amount, occurred_at, official_month)
  values (a, v, gen_random_uuid(), 'salary', 23925, '2026-12-05 12:00+03', '2026-11-01') returning id into p;
  insert into public.payroll_allocations(account_id, venue_id, payment_id, employee_id, month, amount, settled_amount)
  values (a, v, p, (select id from fx where key = 'first_day'), '2026-11-01', 23925, 27500);
  perform pg_temp.expect_error(format($q$select public.payroll_official_command('cancel', '{"employment_id":"%s"}')$q$, emp),
    '%официальные выплаты%', 'отмена при проведённой выплате');
  -- Удалённая выплата отмене не мешает.
  update public.payroll_payments set state = 'cancelled' where id = p;
  perform public.payroll_official_command('cancel', jsonb_build_object('employment_id', emp));
end $$;

select 'PASS: payroll-official-employment' as result;

rollback;
