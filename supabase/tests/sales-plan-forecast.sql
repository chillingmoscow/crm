-- ============================================================
-- sales-plan-forecast.sql — план месяца v2 (417): право «Планы продаж», план
-- оборота и доли алкоголя одной функцией, прямая запись закрыта, заморозка доли
-- только закончившегося месяца с итогами KPI, журнал цен, сезонность, KPI по доле.
--
-- Прогон (415 уже применена) в одной откатываемой транзакции:
--   cat <(echo 'begin;') \
--       <(sed -E '/^[[:space:]]*(begin|commit);[[:space:]]*$/d' supabase/migrations/417_sales_plan_forecast.sql) \
--       <(sed -E '/^[[:space:]]*begin;[[:space:]]*$/d' supabase/tests/sales-plan-forecast.sql) \
--     | docker exec -i supabase_db_crm psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -
--
-- Нужны owner@test.com («Владелец» с «Настройкой расчёта смен») и waiter@test.com.
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

do $$
declare owner uuid := (select id from auth.users where email = 'owner@test.com');
  waiter uuid := (select id from auth.users where email = 'waiter@test.com');
begin
  perform pg_temp.act_as(owner);
  insert into fx values ('owner', owner), ('waiter', waiter), ('a', public.get_active_account_id()), ('v', public.get_active_venue_id());
  delete from public.sales_month_plans where venue_id = pg_temp.fx('v') and month in ('2025-03-01', '2027-03-01');
end $$;

-- ── j. Право выдано ролям с «Настройкой расчёта смен» ─────
do $$
begin
  perform pg_temp.check(exists (select 1 from public.role_permissions rp join public.permissions p on p.id = rp.permission_id
    join public.roles r on r.id = rp.role_id where p.code = 'sales.plan' and rp.granted and r.name = 'Владелец'), 'sales.plan у владельца');
  perform pg_temp.check(public.has_permission('sales.plan'), 'has_permission(sales.plan) для владельца');
end $$;

-- ── b. План оборота и доли, журнал ────────────────────────
do $$
declare pid uuid;
begin
  pid := public.sales_month_plan_save('2027-03-01', '{"turnover": 4200000, "alcohol_share": 10.5, "forecast": {"turnover": 4180000}}');
  perform pg_temp.check((select turnover = 4200000 and alcohol_share = 10.5 and forecast->>'turnover' = '4180000' from public.sales_month_plans where sales_month_plans.id = pid), 'план оборота и доли записан');
  perform pg_temp.check(exists (select 1 from public.audit_logs where action_code = 'sales.plan.saved' and entity_id = pid), 'журнал: план сохранён');
  perform public.sales_month_plan_save('2027-03-01', '{"turnover": null, "alcohol_share": 10.5}');
  perform pg_temp.check((select turnover is null and alcohol_share = 10.5 from public.sales_month_plans where sales_month_plans.id = pid), 'только доля без оборота');
  perform public.sales_month_plan_save('2027-03-01', '{"turnover": null, "alcohol_share": null}');
  perform pg_temp.check(not exists (select 1 from public.sales_month_plans where sales_month_plans.id = pid), 'оба пусты — строки нет');
  perform pg_temp.expect_error('select public.sales_month_plan_save(''2027-03-01'', ''{"alcohol_share": 0}'')', '%от 0,1 до 100%', 'доля 0 — отказ');
end $$;

-- ── c. Прямая запись в план закрыта ───────────────────────
do $$
declare ins text;
begin
  ins := format('insert into public.sales_month_plans(account_id, venue_id, month, turnover, created_by, updated_by) values (%L, %L, %L, 1, %L, %L)',
    pg_temp.fx('a'), pg_temp.fx('v'), '2027-04-01', pg_temp.fx('owner'), pg_temp.fx('owner'));
  set local role authenticated;
  begin
    execute ins;
    raise exception 'TEST FAILED: прямая вставка плана прошла';
  exception when others then
    if sqlerrm not like '%permission denied%' and sqlerrm not like '%«Статистике»%' then raise exception 'TEST FAILED: прямая вставка: %', sqlerrm; end if;
  end;
  reset role;
  perform pg_temp.expect_error(ins, '%«Статистике»%', 'запись мимо функции даже от владельца таблицы — отказ');
  raise notice 'ok: прямая запись плана закрыта';
end $$;

-- ── d, e. Заморозка доли: только закончившийся месяц с итогами ─
do $$
declare r uuid; m uuid; e uuid; t uuid;
begin
  insert into public.roles(venue_id, name, code) values (pg_temp.fx('v'), 'Старший бармен тест v2', 'kpi_v2_test') returning id into r;
  insert into public.payroll_settings(account_id, venue_id, starts_on, quickresto_venue_id, enabled)
  values (pg_temp.fx('a'), pg_temp.fx('v'), '2025-01-01', 1, true) on conflict (venue_id) do update set starts_on = '2025-01-01';
  insert into public.payroll_models(account_id, venue_id, name, role_name, basis, role_id, is_role_default)
  values (pg_temp.fx('a'), pg_temp.fx('v'), 'Старший бармен тест v2', 'Бармен', 'bar', r, true) returning id into m;
  update public.payroll_models set role_id = r where id = m;
  insert into public.payroll_employees(account_id, venue_id, name, role_name, model_id, opening_confirmed)
  values (pg_temp.fx('a'), pg_temp.fx('v'), 'Старший v2', 'Бармен', m, true) returning id into e;
  insert into public.payroll_kpi_terms(account_id, venue_id, role_id, valid_from, items, change_reason)
  values (pg_temp.fx('a'), pg_temp.fx('v'), r, '2026-11-01',
    '[{"id":"p","type":"plan","label":"План","amount":10000,"metric":"alcohol"},{"id":"x","type":"done","label":"X","amount":1000}]', 'тест') returning id into t;
  insert into fx values ('role', r), ('emp', e), ('terms', t);
  -- Итог за прошлый (закончившийся) месяц — напрямую, как его записала бы функция.
  insert into public.payroll_kpi_reviews(account_id, venue_id, employee_id, month, terms_id, items, answers, lines, total, request_key)
  values (pg_temp.fx('a'), pg_temp.fx('v'), e, '2026-10-01', t, '[]', '{}', '[]', 0, gen_random_uuid());
  perform set_config('app.sales_plan_write', '1', true);
  insert into public.sales_month_plans(account_id, venue_id, month, turnover, alcohol_share) values (pg_temp.fx('a'), pg_temp.fx('v'), '2026-10-01', 4000000, 10)
  on conflict (account_id, venue_id, month) do update set alcohol_share = 10, turnover = 4000000;
  perform set_config('app.sales_plan_write', '', true);
  perform pg_temp.expect_error('select public.sales_month_plan_save(''2026-10-01'', ''{"turnover": 4000000, "alcohol_share": 11}'')',
    '%долю алкоголя менять нельзя%', 'доля закончившегося месяца с итогами — отказ');
  perform public.sales_month_plan_save('2026-10-01', '{"turnover": 4100000, "alcohol_share": 10}');
  perform pg_temp.check((select turnover = 4100000 from public.sales_month_plans where venue_id = pg_temp.fx('v') and month = '2026-10-01'), 'оборот того же месяца меняется');
  -- Итог в идущем месяце долю не замораживает.
  insert into public.payroll_kpi_reviews(account_id, venue_id, employee_id, month, terms_id, items, answers, lines, total, request_key)
  values (pg_temp.fx('a'), pg_temp.fx('v'), pg_temp.fx('emp'), private.venue_current_month(pg_temp.fx('v')), pg_temp.fx('terms'), '[]', '{}', '[]', 0, gen_random_uuid());
  perform public.sales_month_plan_save(private.venue_current_month(pg_temp.fx('v')), '{"turnover": 4000000, "alcohol_share": 10}');
  perform public.sales_month_plan_save(private.venue_current_month(pg_temp.fx('v')), '{"turnover": 4000000, "alcohol_share": 11}');
  perform pg_temp.check((select alcohol_share = 11 from public.sales_month_plans where venue_id = pg_temp.fx('v') and month = private.venue_current_month(pg_temp.fx('v'))), 'доля идущего месяца с итогами меняется');
  delete from public.payroll_kpi_reviews where employee_id = pg_temp.fx('emp') and month = private.venue_current_month(pg_temp.fx('v'));
end $$;

-- ── i, h. Условия KPI переведены на долю; итог сверяет план по доле ─
do $$
begin
  perform pg_temp.check(not exists (
    select 1 from public.payroll_kpi_terms t, jsonb_array_elements(t.items) i
    where i->>'type' = 'plan' and i->>'metric' is distinct from 'alcohol_share' and t.id <> pg_temp.fx('terms')),
    'условия KPI, бывшие до миграции, — на доле алкоголя');
  perform pg_temp.expect_error(format('select public.payroll_kpi_save(%L)', jsonb_build_object(
    'request_key', gen_random_uuid(), 'employee_id', pg_temp.fx('emp'), 'month', to_char(private.venue_current_month(pg_temp.fx('v')), 'YYYY-MM-DD'),
    'terms_id', pg_temp.fx('terms'), 'answers', '{}'::jsonb, 'lines', '[]'::jsonb, 'total', 0, 'reason', 'KPI тест',
    'plan_target', 99)), '%План продаж за месяц изменился%', 'итог по устаревшей доле — отказ');
end $$;

-- ── f. Цены ───────────────────────────────────────────────
do $$
declare pid uuid;
begin
  pid := public.sales_price_change_save('{"date": "2026-12-01", "percent": 5, "note": "Бар +8%, в среднем по чеку +5%"}');
  perform pg_temp.check(exists (select 1 from public.sales_price_changes where sales_price_changes.id = pid and percent = 5), 'изменение цен записано');
  perform pg_temp.expect_error('select public.sales_price_change_save(''{"date": "2026-12-01", "percent": 0}'')', '%не ноль%', 'ноль процентов — отказ');
  perform pg_temp.check(public.sales_price_change_delete(pid), 'изменение цен удалено');
  perform pg_temp.check(exists (select 1 from public.audit_logs where action_code = 'sales.price_change.deleted' and entity_id = pid), 'журнал: удаление цен');
end $$;

-- ── g. Сезонность ─────────────────────────────────────────
do $$
begin
  perform pg_temp.expect_error('select public.sales_seasonality_save(''[1,1,1,1,1,1,1,1,1,1,1]'')', '%12 положительных%', '11 чисел — отказ');
  perform pg_temp.expect_error('select public.sales_seasonality_save(''[1,1,1,1,1,1,1,1,1,1,1,0]'')', '%12 положительных%', 'ноль — отказ');
  perform public.sales_seasonality_save('[0.85,1,1.02,0.98,0.92,0.88,0.87,0.9,0.95,1.05,1.12,1.18]');
  perform pg_temp.check(exists (select 1 from public.sales_seasonality where venue_id = pg_temp.fx('v')), 'сезонность сохранена');
  perform public.sales_seasonality_save(null);
  perform pg_temp.check(not exists (select 1 from public.sales_seasonality where venue_id = pg_temp.fx('v')), 'сброс к отраслевой');
end $$;

-- ── a. Без права — отказ ──────────────────────────────────
do $$
begin
  perform pg_temp.act_as(pg_temp.fx('waiter'));
  perform pg_temp.expect_error('select public.sales_month_plan_save(''2027-05-01'', ''{"turnover": 1}'')', '%Нет доступа%', 'план без права — отказ');
  perform pg_temp.expect_error('select public.sales_price_change_save(''{"date": "2026-12-01", "percent": 5}'')', '%Нет доступа%', 'цены без права — отказ');
  perform pg_temp.act_as(pg_temp.fx('owner'));
end $$;

select 'sales-plan-forecast: all passed' as result;
rollback;
