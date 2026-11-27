-- ============================================================
-- payroll-kpi.sql — KPI старших (415): одна премия на итог, повтор запроса,
-- защита премии от ручной правки, закрытый период, перенесённый остаток,
-- права, план алкоголя в строке плана месяца, условия после итогов.
--
-- Прогон внутри одной откатываемой транзакции (reset базы не нужен):
--   cat <(echo 'begin;') \
--       <(sed -E '/^[[:space:]]*(begin|commit);[[:space:]]*$/d' supabase/migrations/415_payroll_kpi.sql) \
--       <(sed -E '/^[[:space:]]*begin;[[:space:]]*$/d' supabase/tests/payroll-kpi.sql) \
--     | docker exec -i supabase_db_crm psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -
--
-- Нужны owner@test.com и waiter@test.com из supabase/seed.sql.
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

-- Сохранение итогов так, как его шлёт приложение: с версией итогов и планом, которые оно видело.
create or replace function pg_temp.save(p_key uuid, p_total numeric, p_answers jsonb default '{"inventory":true}', p_month text default '2026-11-01')
returns jsonb language sql as $$
  select public.payroll_kpi_save(jsonb_build_object(
    'request_key', p_key, 'employee_id', pg_temp.fx('senior'), 'month', p_month, 'terms_id', pg_temp.fx('terms'),
    'answers', p_answers, 'lines', '[]'::jsonb, 'total', p_total, 'reason', 'KPI за ноябрь 2026: тест',
    'expected_saved_at', (select saved_at from public.payroll_kpi_reviews where employee_id = pg_temp.fx('senior') and month = p_month::date),
    'plan_target', (select alcohol_share from public.sales_month_plans where venue_id = pg_temp.fx('v') and month = p_month::date)))
$$;

create or replace function pg_temp.kpi_rows()
returns bigint language sql as $$
  select count(*) from public.payroll_adjustments where employee_id = pg_temp.fx('senior') and origin = 'kpi'
$$;

-- ── Фикстуры ───────────────────────────────────────────────
do $$
declare
  owner uuid := (select id from auth.users where email = 'owner@test.com');
  waiter uuid := (select id from auth.users where email = 'waiter@test.com');
  a uuid; v uuid; r uuid; m uuid; e uuid; t uuid;
begin
  if owner is null or waiter is null then raise exception 'Нет пользователей из seed.sql'; end if;
  perform pg_temp.act_as(owner);
  a := public.get_active_account_id();
  v := public.get_active_venue_id();
  insert into fx values ('owner', owner), ('waiter', waiter), ('a', a), ('v', v);
  insert into public.payroll_settings(account_id, venue_id, starts_on, quickresto_venue_id, enabled)
  values (a, v, '2026-09-01', 1, true) on conflict (venue_id) do nothing;
  insert into public.roles(venue_id, name, code) values (v, 'Старший бармен тест', 'kpi_test_senior') returning id into r;
  insert into public.payroll_models(account_id, venue_id, name, role_name, basis, role_id, is_role_default)
  values (a, v, 'Старший бармен тест', 'Бармен', 'bar', r, true) returning id into m;
  -- При вставке должность модели ищется по названию; как в 253 — задаём явно.
  update public.payroll_models set role_id = r where id = m;
  insert into public.payroll_employees(account_id, venue_id, name, role_name, role_id, model_id, opening_confirmed)
  values (a, v, 'Старший Тестовый', 'Бармен', r, m, true) returning id into e;
  insert into fx values ('role', r), ('model', m), ('senior', e);
  t := public.payroll_kpi_terms_save(r, jsonb_build_object('valid_from', '2026-11-01', 'reason', 'Условия для теста',
    'items', '[{"id":"inventory","type":"done","label":"Инвентаризация","amount":7000},{"id":"seasonal","type":"each","label":"Сезонные","price":1000}]'::jsonb), null);
  insert into fx values ('terms', t), ('k1', gen_random_uuid()), ('k2', gen_random_uuid()), ('k3', gen_random_uuid());
end $$;

-- ── a, b. Одна премия, повтор запроса ─────────────────────
do $$
declare first jsonb; again jsonb;
begin
  first := pg_temp.save(pg_temp.fx('k1'), 27000);
  perform pg_temp.check(pg_temp.kpi_rows() = 1
    and (select amount from public.payroll_adjustments where id = (first->>'adjustment_id')::uuid) = 27000
    and (select kind from public.payroll_adjustments where id = (first->>'adjustment_id')::uuid) = 'allowance'
    and (select business_date from public.payroll_adjustments where id = (first->>'adjustment_id')::uuid) = '2026-11-01',
    'итог 27 000 — одна премия allowance на 1-е ноября');
  again := pg_temp.save(pg_temp.fx('k1'), 27000);
  perform pg_temp.check(again->>'adjustment_id' = first->>'adjustment_id' and pg_temp.kpi_rows() = 1, 'повтор запроса — та же премия');
  perform pg_temp.expect_error(format('select pg_temp.save(%L, 1000)', pg_temp.fx('k1')), '%другие данные%', 'тот же ключ с другим итогом отклонён');
  perform pg_temp.check(exists (select 1 from public.audit_logs where action_code = 'payroll.kpi.saved' and entity_id = (first->>'review_id')::uuid), 'журнал: итог сохранён');
  insert into fx values ('adj', (first->>'adjustment_id')::uuid);
end $$;

-- ── c, d. Пересохранение меняет ту же премию, 0 — удаляет ─
do $$
begin
  perform pg_temp.save(pg_temp.fx('k2'), 37000, '{"inventory":true,"seasonal":2}');
  perform pg_temp.check(pg_temp.kpi_rows() = 1 and (select amount from public.payroll_adjustments where id = pg_temp.fx('adj')) = 37000,
    'новое сохранение — та же премия, 37 000');
  perform pg_temp.save(pg_temp.fx('k3'), 0, '{}');
  perform pg_temp.check((select deleted_at is not null from public.payroll_adjustments where id = pg_temp.fx('adj')), 'итог 0 — премия удалена');
  perform pg_temp.save(gen_random_uuid(), 7000);
  perform pg_temp.check(pg_temp.kpi_rows() = 1 and (select deleted_at is null and amount = 7000 from public.payroll_adjustments where id = pg_temp.fx('adj')),
    'снова больше нуля — та же премия восстановлена');
end $$;

-- ── n. Устаревшее окно, изменённый план, уведомление об изменённой сумме ─
do $$
begin
  perform pg_temp.expect_error(format('select public.payroll_kpi_save(%L)', jsonb_build_object(
    'request_key', gen_random_uuid(), 'employee_id', pg_temp.fx('senior'), 'month', '2026-11-01', 'terms_id', pg_temp.fx('terms'),
    'answers', '{}'::jsonb, 'lines', '[]'::jsonb, 'total', 0, 'reason', 'KPI за ноябрь 2026: из старого окна',
    'expected_saved_at', '2026-11-01T00:00:00Z')), '%только что изменили%', 'сохранение из устаревшего окна — отказ');
  perform pg_temp.expect_error(format('select public.payroll_kpi_save(%L)', jsonb_build_object(
    'request_key', gen_random_uuid(), 'employee_id', pg_temp.fx('senior'), 'month', '2026-11-01', 'terms_id', pg_temp.fx('terms'),
    'answers', '{}'::jsonb, 'lines', '[]'::jsonb, 'total', 0, 'reason', 'KPI за ноябрь 2026: другой план',
    'expected_saved_at', (select saved_at from public.payroll_kpi_reviews where employee_id = pg_temp.fx('senior') and month = '2026-11-01'),
    'plan_target', 123)), '%План продаж за месяц изменился%', 'итог по устаревшему плану — отказ');
  insert into public.organization_telegram_settings(account_id, secret, fines_notify_from) values (pg_temp.fx('a'), '{}', '2000-01-01')
  on conflict (account_id) do update set fines_notify_from = '2000-01-01';
  -- Прежнюю сумму уже отправили: изменённая сумма должна встать в очередь заново.
  insert into public.payroll_adjustment_notifications(adjustment_id, account_id, venue_id, state)
  values (pg_temp.fx('adj'), pg_temp.fx('a'), pg_temp.fx('v'), 'sent')
  on conflict (account_id, adjustment_id) do update set state = 'sent';
  perform pg_temp.save(gen_random_uuid(), 8000, '{"inventory":true,"seasonal":1}');
  perform pg_temp.check((select state = 'pending' from public.payroll_adjustment_notifications where adjustment_id = pg_temp.fx('adj')),
    'изменённая сумма — уведомление снова в очереди');
end $$;

-- ── e. Ручная правка премии KPI отклоняется ───────────────
do $$
begin
  perform pg_temp.expect_error(format('select public.payroll_update_entry(%L)', jsonb_build_object(
    'id', pg_temp.fx('adj'), 'amount', 1, 'reason', 'Ручная правка', 'expected_amount', 8000,
    'expected_reason', (select reason from public.payroll_adjustments where id = pg_temp.fx('adj')))),
    '%итог KPI%', 'правка премии KPI через журнал отклонена');
  perform pg_temp.expect_error(format('select public.payroll_journal_command(''delete'', %L)', jsonb_build_object(
    'id', pg_temp.fx('adj'), 'reason', 'Удаляю руками')), '%итог KPI%', 'удаление премии KPI через журнал отклонено');
end $$;

-- ── f. Закрытый период ────────────────────────────────────
do $$
begin
  update public.payroll_periods set status = 'checked' where venue_id = pg_temp.fx('v') and month = '2026-11-01';
  perform pg_temp.expect_error(format('select pg_temp.save(%L, 5000)', gen_random_uuid()), '%Период зафиксирован%', 'закрытый период — отказ');
  update public.payroll_periods set status = 'draft' where venue_id = pg_temp.fx('v') and month = '2026-11-01';
end $$;

-- ── g. Остаток месяца уже перенесён ───────────────────────
do $$
declare p uuid;
begin
  insert into public.payroll_payout_plans(account_id, venue_id, schedule, month, payout_no, window_from, window_to, state, carried_at)
  values (pg_temp.fx('a'), pg_temp.fx('v'), 'main', '2026-11-01', 2, '2026-12-10', '2026-12-16', 'approved', now()) returning id into p;
  insert into public.payroll_payout_rows(account_id, venue_id, plan_id, employee_id, amount)
  values (pg_temp.fx('a'), pg_temp.fx('v'), p, pg_temp.fx('senior'), 0);
  perform pg_temp.expect_error(format('select pg_temp.save(%L, 5000)', gen_random_uuid()), '%ноябрь 2026 уже перенесён%декабрь 2026%', 'после переноса остатка — отказ');
  delete from public.payroll_payout_rows where plan_id = p;
  delete from public.payroll_payout_plans where id = p;
end $$;

-- ── m. Итог больше условий отклоняется ────────────────────
do $$
begin
  perform pg_temp.expect_error(format('select pg_temp.save(%L, 57000.01)', gen_random_uuid()), '%больше, чем дают условия%', 'итог больше условий — отказ');
end $$;

-- ── k. Месяц раньше ноября 2026 ───────────────────────────
do $$
begin
  perform pg_temp.expect_error(format('select pg_temp.save(%L, 5000, %L, %L)', gen_random_uuid(), '{}', '2026-10-01'),
    '%не подводятся%', 'октябрь — отказ');
end $$;

-- ── j. Условия на месяц с итогами ─────────────────────────
do $$
begin
  -- С 418 условия замораживает только закончившийся месяц с итогами.
  if '2026-11-01'::date < private.venue_current_month(pg_temp.fx('v')) then
    perform pg_temp.expect_error(format('select public.payroll_kpi_terms_save(%L, %L, %L)', pg_temp.fx('role'),
      jsonb_build_object('valid_from', '2026-11-01', 'reason', 'Меняю ноябрь', 'items', '[{"id":"x","type":"done","label":"X","amount":1}]'::jsonb),
      pg_temp.fx('terms')), '%уже подведены%', 'условия на подведённый закончившийся месяц — отказ');
  else
    perform pg_temp.check(public.payroll_kpi_terms_save(pg_temp.fx('role'),
      jsonb_build_object('valid_from', '2026-11-01', 'reason', 'Меняю ноябрь', 'items', (select items from public.payroll_kpi_terms where id = pg_temp.fx('terms'))),
      pg_temp.fx('terms')) = pg_temp.fx('terms'), 'условия идущего месяца с итогами меняются');
  end if;
  perform pg_temp.expect_error(format('select public.payroll_kpi_terms_save(%L, %L, null)', pg_temp.fx('role'),
    jsonb_build_object('valid_from', '2026-12-01', 'reason', 'Декабрь', 'items', '[{"id":"x","type":"done","label":"X","amount":1}]'::jsonb)),
    '%только что изменили%', 'устаревшая версия условий — отказ');
  perform pg_temp.check(public.payroll_kpi_terms_save(pg_temp.fx('role'),
    jsonb_build_object('valid_from', '2026-12-01', 'reason', 'Декабрь', 'items', '[{"id":"x","type":"done","label":"X","amount":1}]'::jsonb),
    pg_temp.fx('terms')) is not null, 'условия со следующего месяца сохраняются');
end $$;

-- ── i. План алкоголя не теряется при пустом обороте ───────
do $$
declare pid uuid;
begin
  perform set_config('app.sales_plan_write', '1', true);
  insert into public.sales_month_plans(account_id, venue_id, month, turnover, created_by, updated_by)
  values (pg_temp.fx('a'), pg_temp.fx('v'), '2027-01-01', 5000000, pg_temp.fx('owner'), pg_temp.fx('owner'))
  on conflict (account_id, venue_id, month) do update set turnover = 5000000, alcohol = null returning sales_month_plans.id into pid;
  perform set_config('app.sales_plan_write', '', true);
  perform public.sales_alcohol_plan_save('2027-01-01', jsonb_build_object('alcohol', 416000, 'suggested', 416000, 'price_increase_percent', 5));
  perform pg_temp.check((select alcohol = 416000 and price_increase_percent = 5 from public.sales_month_plans where sales_month_plans.id = pid), 'план алкоголя записан в строку месяца');
  perform public.sales_alcohol_plan_save('2027-01-01', jsonb_build_object('alcohol', null));
  perform pg_temp.check((select alcohol is null and turnover = 5000000 from public.sales_month_plans where sales_month_plans.id = pid), 'стёрт план алкоголя — оборот остался');
  perform public.sales_alcohol_plan_save('2027-02-01', jsonb_build_object('alcohol', 300000));
  perform pg_temp.check((select turnover is null and alcohol = 300000 from public.sales_month_plans where venue_id = pg_temp.fx('v') and month = '2027-02-01'), 'план алкоголя без плана оборота');
  perform public.sales_alcohol_plan_save('2027-02-01', jsonb_build_object('alcohol', null));
  perform pg_temp.check(not exists (select 1 from public.sales_month_plans where venue_id = pg_temp.fx('v') and month = '2027-02-01'), 'оба плана пусты — строки нет');
  perform pg_temp.check(exists (select 1 from public.audit_logs where action_code = 'sales.plan.alcohol_set' and entity_id = pid), 'журнал: план алкоголя');
  perform pg_temp.expect_error('select public.sales_alcohol_plan_save(''2026-11-01'', ''{"alcohol":1000}'')',
    '%уже подведены%', 'план месяца с итогами KPI не меняется');
end $$;

-- ── l. Прямая запись плана алкоголя пользователем отклоняется ─
do $$
declare upd text; ins text;
begin
  upd := format('update public.sales_month_plans set alcohol = 1 where venue_id = %L and month = %L', pg_temp.fx('v'), '2027-01-01');
  ins := format('insert into public.sales_month_plans(account_id, venue_id, month, alcohol, created_by, updated_by) values (%L, %L, %L, 5, %L, %L)',
    pg_temp.fx('a'), pg_temp.fx('v'), '2027-05-01', pg_temp.fx('owner'), pg_temp.fx('owner'));
  set local role authenticated;
  begin
    execute upd;
    raise exception 'TEST FAILED: прямая правка плана алкоголя прошла';
  exception when others then
    if sqlerrm not like '%вкладке «KPI»%' and sqlerrm not like '%«Статистике»%' and sqlerrm not like '%permission denied%' then raise exception 'TEST FAILED: прямая правка: %', sqlerrm; end if;
  end;
  begin
    execute ins;
    raise exception 'TEST FAILED: прямая вставка плана алкоголя прошла';
  exception when others then
    if sqlerrm not like '%вкладке «KPI»%' and sqlerrm not like '%«Статистике»%' and sqlerrm not like '%permission denied%' then raise exception 'TEST FAILED: прямая вставка: %', sqlerrm; end if;
  end;
  reset role;
  raise notice 'ok: прямая запись плана алкоголя — отказ';
end $$;

-- ── h. Права ──────────────────────────────────────────────
do $$
begin
  perform pg_temp.act_as(pg_temp.fx('waiter'));
  perform pg_temp.expect_error(format('select pg_temp.save(%L, 5000)', gen_random_uuid()), '%Нет доступа%', 'без права на расчёт или выплату — отказ');
  perform pg_temp.expect_error('select public.sales_alcohol_plan_save(''2027-03-01'', ''{"alcohol":1000}'')', '%Нет доступа%', 'план алкоголя без прав — отказ');
  perform pg_temp.act_as(pg_temp.fx('owner'));
end $$;

select 'payroll-kpi: all passed' as result;
rollback;
