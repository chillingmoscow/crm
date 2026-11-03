-- Постановка удержания по недостаче в зарплатную ведомость: RPC post_inventory_deduction,
-- сторно, закрытый период, права, журнал снимков. Нужна локальная БД с seed (owner@test.com).
-- Всё откатывается в конце.
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/inventory_deduction_lines.sql
begin;

-- ── Подготовка (суперпользователь) ──────────────────────────
do $setup$
declare
  owner_u uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  a uuid := 'cccccccc-0000-0000-0000-000000000001';
  v uuid := 'dddddddd-0000-0000-0000-000000000001';
  foreign_acc uuid; foreign_venue uuid; rule_id uuid;
  e1 uuid; e2 uuid; e3 uuid; e_foreign uuid; r uuid; x uuid;
begin
  insert into public.payroll_settings(account_id, venue_id, starts_on, quickresto_venue_id)
    values (a, v, '2026-01-01', 1) on conflict do nothing;
  insert into public.payroll_employees(account_id, venue_id, name, role_name) values (a, v, 'Иван IDL QA', 'Бармен') returning id into e1;
  insert into public.payroll_employees(account_id, venue_id, name, role_name) values (a, v, 'Пётр IDL QA', 'Бармен') returning id into e2;
  insert into public.payroll_employees(account_id, venue_id, name, role_name, active) values (a, v, 'Уволенный IDL QA', 'Бармен', false) returning id into e3;

  insert into public.accounts(name, owner_id) values ('Чужой IDL QA', 'bbbbbbbb-0000-0000-0000-000000000002') returning id into foreign_acc;
  insert into public.venues(account_id, name) values (foreign_acc, 'Чужое IDL QA') returning id into foreign_venue;
  insert into public.payroll_employees(account_id, venue_id, name, role_name) values (foreign_acc, foreign_venue, 'Чужой IDL QA', 'Бармен') returning id into e_foreign;

  insert into public.stock_deduction_rules(account_id, venue_id, version, valid_from, config, reason, created_by, actor_name)
    values (a, v, 1, '2026-01-01', '{}', 'IDL QA', owner_u, 'QA') returning id into rule_id;

  -- Пользователь без права ставить удержания (только смотреть итоги).
  insert into public.roles(venue_id, name, code) values (v, 'IDL reader QA', 'idl_reader_qa') returning id into r;
  insert into public.role_permissions(role_id, permission_id, granted) select r, id, true from public.permissions where code = 'inventory.view_results';
  x := gen_random_uuid();
  insert into auth.users(id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
    values (x, 'authenticated', 'authenticated', 'idl-reader-' || x || '@qa.invalid', '{}', '{}', now(), now());
  insert into public.profiles(id, first_name, active_venue_id) values (x, 'QA', v) on conflict (id) do update set active_venue_id = v;
  insert into public.user_venue_roles(user_id, venue_id, role_id, status) values (x, v, r, 'active');
  perform set_config('test.idl_reader', x::text, true);

  perform set_config('test.idl_a', a::text, true);
  perform set_config('test.idl_v', v::text, true);
  perform set_config('test.idl_foreign_venue', foreign_venue::text, true);
  perform set_config('test.idl_rule', rule_id::text, true);
  perform set_config('test.idl_e1', e1::text, true);
  perform set_config('test.idl_e2', e2::text, true);
  perform set_config('test.idl_e3', e3::text, true);
  perform set_config('test.idl_e_foreign', e_foreign::text, true);

  -- Право заведено и выдано тем, кто может подводить итоги акта; читателю не выдано.
  if not exists (select 1 from public.permissions where code = 'inventory.post_deductions' and module = 'inventory_documents') then
    raise exception 'FAIL 0a: permission inventory.post_deductions missing';
  end if;
  if exists (
    select 1 from public.role_permissions f join public.permissions pf on pf.id = f.permission_id and pf.code = 'inventory.finalize_results'
    where f.granted and not exists (
      select 1 from public.role_permissions q join public.permissions p on p.id = q.permission_id
      where p.code = 'inventory.post_deductions' and q.role_id = f.role_id and q.granted)
  ) then
    raise exception 'FAIL 0b: a role that can finalize lacks post_deductions';
  end if;
  if exists (select 1 from public.role_permissions rp join public.permissions p on p.id = rp.permission_id
             where p.code = 'inventory.post_deductions' and rp.role_id = r) then
    raise exception 'FAIL 0c: reader got the permission';
  end if;
end $setup$;

-- Закрытый период: август. Сентябрь и октябрь открыты.
insert into public.payroll_periods(account_id, venue_id, month, status)
  values ('cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', '2026-08-01', 'closed');

-- Баланс месяца считает приватная функция ведомости; под ролью authenticated она недоступна.
create function pg_temp.idl_balance(e uuid, m date) returns numeric language sql security definer as
$$ select private.payroll_month_balance(e, m) $$;
grant execute on function pg_temp.idl_balance(uuid, date) to authenticated, service_role;

create function pg_temp.idl_period(m date, st text) returns void language sql security definer as
$$ insert into public.payroll_periods(account_id, venue_id, month, status)
   values ('cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', m, st)
   on conflict (venue_id, month) do update set status = excluded.status $$;
grant execute on function pg_temp.idl_period(date, text) to authenticated, service_role;

-- ── Серверный клиент (service_role) от имени владельца ──────
-- Под service_role сессии пользователя нет: исполнитель приходит параметром p_actor.
select set_config('request.jwt.claim.sub', '', true),
       set_config('request.jwt.claims', '{"role":"service_role"}', true),
       set_config('app.ctx_ready', '0', true);
set local role service_role;

do $test$
declare
  v uuid := current_setting('test.idl_v')::uuid;
  rule_id uuid := current_setting('test.idl_rule')::uuid;
  e1 uuid := current_setting('test.idl_e1')::uuid;
  e2 uuid := current_setting('test.idl_e2')::uuid;
  e3 uuid := current_setting('test.idl_e3')::uuid;
  e_foreign uuid := current_setting('test.idl_e_foreign')::uuid;
  foreign_venue uuid := current_setting('test.idl_foreign_venue')::uuid;
  s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); s3 uuid := gen_random_uuid();
  s4 uuid := gen_random_uuid(); s5 uuid := gen_random_uuid(); s6 uuid := gen_random_uuid();
  k1 uuid := gen_random_uuid(); k2 uuid := gen_random_uuid(); k3 uuid := gen_random_uuid();
  res jsonb; n integer; n_snap integer; row public.payroll_adjustments%rowtype;
  t0 timestamptz := '2026-11-01 10:00:00+00';
  function_ok boolean;
begin
  -- 1. Первая постановка: две строки, снимок, правильные поля и знак.
  res := public.post_inventory_deduction('aaaaaaaa-0000-0000-0000-000000000001', v, '2026-10-01', jsonb_build_array(
      jsonb_build_object('employee_id', e1, 'amount', 1500.50, 'request_key', k1, 'reason', 'Недостача за октябрь 2026'),
      jsonb_build_object('employee_id', e2, 'amount', 700, 'request_key', k2, 'reason', 'Недостача за октябрь 2026')),
    jsonb_build_object('id', s1, 'state', 'ready', 'captured_at', t0, 'rule_version_id', rule_id,
      'shortage_total', 2200.50, 'company_total', 0, 'employees_total', 2200.50, 'payload', '{"x":1}'::jsonb));
  if (res->>'posted')::boolean is not true then raise exception 'FAIL 1a: not posted: %', res; end if;
  select count(*) into n from public.payroll_adjustments where inventory_snapshot_id = s1 and deleted_at is null;
  if n <> 2 then raise exception 'FAIL 1b: live lines = %', n; end if;
  select * into row from public.payroll_adjustments where inventory_snapshot_id = s1 and employee_id = e1;
  if row.kind <> 'inventory' or row.medium <> 'money' or row.approved is not true or row.managed is not true then
    raise exception 'FAIL 2a: kind/medium/approved/managed = %/%/%/%', row.kind, row.medium, row.approved, row.managed;
  end if;
  if row.amount <> -1500.50 then raise exception 'FAIL 2b: sign/amount = %', row.amount; end if;
  if row.request_key <> k1 or row.origin <> 'inventory_deduction' then raise exception 'FAIL 2c: key/origin'; end if;
  if row.business_date <> '2026-10-31' then raise exception 'FAIL 2d: date = %', row.business_date; end if;
  if row.deleted_at is not null or row.external_state <> 'not_required' then raise exception 'FAIL 2e: state'; end if;
  if not exists (select 1 from public.inventory_deduction_snapshots where id = s1 and venue_id = v and month = '2026-10-01'
                 and state = 'ready' and employees_total = 2200.50 and created_by = 'aaaaaaaa-0000-0000-0000-000000000001') then
    raise exception 'FAIL 2f: snapshot journal';
  end if;
  -- Расчёт ведомости видит строку (medium money, approved): иначе её молча пропустят.
  if pg_temp.idl_balance(e1, '2026-10-01') <> -1500.50 then
    raise exception 'FAIL 2g: payroll balance = %', pg_temp.idl_balance(e1, '2026-10-01');
  end if;

  -- Решение 6: начисление под строкой - заглушка {"kind":"adjustment"} без attendance_ids,
  -- ровно то, что допускает сбор снимка месяца.
  if not exists (select 1 from public.payroll_accruals where employee_id = e1 and business_date = '2026-10-31'
                 and calculation_snapshot->>'kind' = 'adjustment' and not (calculation_snapshot ? 'attendance_ids')) then
    raise exception 'FAIL 2h: accrual under the line is not an adjustment stub';
  end if;

  -- 3. Повтор того же вызова (двойной клик с теми же ключами): строк не прибавилось.
  res := public.post_inventory_deduction('aaaaaaaa-0000-0000-0000-000000000001', v, '2026-10-01', jsonb_build_array(
      jsonb_build_object('employee_id', e1, 'amount', 1500.50, 'request_key', k1, 'reason', 'Недостача за октябрь 2026'),
      jsonb_build_object('employee_id', e2, 'amount', 700, 'request_key', k2, 'reason', 'Недостача за октябрь 2026')),
    jsonb_build_object('id', s1, 'state', 'ready', 'captured_at', t0, 'rule_version_id', rule_id,
      'shortage_total', 2200.50, 'company_total', 0, 'employees_total', 2200.50, 'payload', '{"x":1}'::jsonb));
  if (res->>'replayed')::boolean is not true then raise exception 'FAIL 3a: not a replay: %', res; end if;
  select count(*) into n from public.payroll_adjustments where venue_id = v and origin = 'inventory_deduction';
  if n <> 2 then raise exception 'FAIL 3b: replay changed row count to %', n; end if;

  -- 4. Второй клик, посчитанный заново (другой id снимка, те же суммы): ничего не меняется.
  res := public.post_inventory_deduction('aaaaaaaa-0000-0000-0000-000000000001', v, '2026-10-01', jsonb_build_array(
      jsonb_build_object('employee_id', e1, 'amount', 1500.50, 'request_key', gen_random_uuid(), 'reason', 'Недостача за октябрь 2026'),
      jsonb_build_object('employee_id', e2, 'amount', 700, 'request_key', gen_random_uuid(), 'reason', 'Недостача за октябрь 2026')),
    jsonb_build_object('id', s2, 'state', 'ready', 'captured_at', t0 + interval '1 minute', 'rule_version_id', rule_id,
      'shortage_total', 2200.50, 'company_total', 0, 'employees_total', 2200.50, 'payload', '{}'::jsonb));
  if (res->>'unchanged')::boolean is not true then raise exception 'FAIL 4a: not unchanged: %', res; end if;
  select count(*) into n from public.payroll_adjustments where venue_id = v and origin = 'inventory_deduction';
  if n <> 2 then raise exception 'FAIL 4b: second click doubled the lines: %', n; end if;
  if exists (select 1 from public.inventory_deduction_snapshots where id = s2) then raise exception 'FAIL 4c: unchanged recalculation saved a snapshot'; end if;

  -- 5. Тот же request_key под другим содержимым не воскрешает и не дублирует строку.
  begin
    perform public.post_inventory_deduction('aaaaaaaa-0000-0000-0000-000000000001', v, '2026-10-01', jsonb_build_array(
        jsonb_build_object('employee_id', e1, 'amount', 999, 'request_key', k1, 'reason', 'Недостача за октябрь 2026')),
      jsonb_build_object('id', gen_random_uuid(), 'state', 'ready', 'captured_at', t0 + interval '2 minutes', 'rule_version_id', rule_id,
        'shortage_total', 999, 'company_total', 0, 'employees_total', 999, 'payload', '{}'::jsonb));
    raise exception 'FAIL 5: reused request_key accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' or sqlerrm not like '%уже использован%' then raise; end if; end;

  -- 6. Пересчёт: прежние строки сторнируются, а не правятся; живая - только новая.
  res := public.post_inventory_deduction('aaaaaaaa-0000-0000-0000-000000000001', v, '2026-10-01', jsonb_build_array(
      jsonb_build_object('employee_id', e1, 'amount', 2000, 'request_key', k3, 'reason', 'Недостача за октябрь 2026')),
    jsonb_build_object('id', s3, 'state', 'ready', 'captured_at', t0 + interval '3 minutes', 'rule_version_id', rule_id,
      'shortage_total', 2000, 'company_total', 0, 'employees_total', 2000, 'payload', '{}'::jsonb));
  if (res->>'reversed')::integer <> 2 then raise exception 'FAIL 6a: reversed = %', res->>'reversed'; end if;
  select count(*) into n from public.payroll_adjustments where venue_id = v and origin = 'inventory_deduction' and deleted_at is null;
  if n <> 1 then raise exception 'FAIL 6b: live lines after recalculation = %', n; end if;
  select count(*) into n from public.payroll_adjustments where venue_id = v and origin = 'inventory_deduction';
  if n <> 3 then raise exception 'FAIL 6c: total rows = % (old rows must stay)', n; end if;
  select * into row from public.payroll_adjustments where inventory_snapshot_id = s1 and employee_id = e1;
  if row.amount <> -1500.50 then raise exception 'FAIL 6d: old amount was edited in place: %', row.amount; end if;
  if row.deleted_at is null or row.deleted_by is distinct from 'aaaaaaaa-0000-0000-0000-000000000001'::uuid
     or length(trim(coalesce(row.delete_reason, ''))) < 3 then
    raise exception 'FAIL 6e: reversal fields: %/%/%', row.deleted_at, row.deleted_by, row.delete_reason;
  end if;
  if pg_temp.idl_balance(e1, '2026-10-01') <> -2000 or pg_temp.idl_balance(e2, '2026-10-01') <> 0 then
    raise exception 'FAIL 6f: balances after recalculation = % / %',
      pg_temp.idl_balance(e1, '2026-10-01'), pg_temp.idl_balance(e2, '2026-10-01');
  end if;

  -- 7. Устаревший расчёт (снят раньше уже поставленного) с другим содержимым отклоняется.
  begin
    perform public.post_inventory_deduction('aaaaaaaa-0000-0000-0000-000000000001', v, '2026-10-01', jsonb_build_array(
        jsonb_build_object('employee_id', e2, 'amount', 50, 'request_key', gen_random_uuid(), 'reason', 'Недостача за октябрь 2026')),
      jsonb_build_object('id', gen_random_uuid(), 'state', 'ready', 'captured_at', t0 - interval '1 hour', 'rule_version_id', rule_id,
        'shortage_total', 50, 'company_total', 0, 'employees_total', 50, 'payload', '{}'::jsonb));
    raise exception 'FAIL 7: stale snapshot accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' or sqlerrm not like '%устарел%' then raise; end if; end;

  -- 8. Неготовый месяц не пишет ничего: ни строк, ни снимка, ни сторно.
  select count(*) into n from public.payroll_adjustments where venue_id = v;
  select count(*) into n_snap from public.inventory_deduction_snapshots where venue_id = v;
  res := public.post_inventory_deduction('aaaaaaaa-0000-0000-0000-000000000001', v, '2026-10-01', jsonb_build_array(
      jsonb_build_object('employee_id', e2, 'amount', 10, 'request_key', gen_random_uuid(), 'reason', 'Недостача за октябрь 2026')),
    jsonb_build_object('id', s4, 'state', 'incomplete', 'captured_at', t0 + interval '4 minutes', 'rule_version_id', rule_id,
      'shortage_total', 10, 'company_total', 0, 'employees_total', 10, 'missing', jsonb_build_array('inventory:abc'), 'payload', '{}'::jsonb));
  if (res->>'posted')::boolean is not false or res->>'state' <> 'incomplete' or res->'missing' <> '["inventory:abc"]'::jsonb then
    raise exception 'FAIL 8a: incomplete result: %', res;
  end if;
  if (select count(*) from public.payroll_adjustments where venue_id = v) <> n
     or (select count(*) from public.inventory_deduction_snapshots where venue_id = v) <> n_snap
     or (select count(*) from public.payroll_adjustments where venue_id = v and origin = 'inventory_deduction' and deleted_at is null) <> 1 then
    raise exception 'FAIL 8b: incomplete month wrote or reversed something';
  end if;

  -- 9. Зафиксированный период: ни поставить, ни сторнировать. Тот же расчёт - без ошибки.
  perform pg_temp.idl_period('2026-10-01', 'checked');
  begin
    perform public.post_inventory_deduction('aaaaaaaa-0000-0000-0000-000000000001', v, '2026-10-01', jsonb_build_array(
        jsonb_build_object('employee_id', e1, 'amount', 2500, 'request_key', gen_random_uuid(), 'reason', 'Недостача за октябрь 2026')),
      jsonb_build_object('id', gen_random_uuid(), 'state', 'ready', 'captured_at', t0 + interval '5 minutes', 'rule_version_id', rule_id,
        'shortage_total', 2500, 'company_total', 0, 'employees_total', 2500, 'payload', '{}'::jsonb));
    raise exception 'FAIL 9a: recalculation in a locked period accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' or sqlerrm not like '%Период зафиксирован%' then raise; end if; end;
  if (select count(*) from public.payroll_adjustments where venue_id = v and origin = 'inventory_deduction' and deleted_at is null) <> 1
     or (select amount from public.payroll_adjustments where inventory_snapshot_id = s3) <> -2000 then
    raise exception 'FAIL 9b: locked period lines were touched';
  end if;
  res := public.post_inventory_deduction('aaaaaaaa-0000-0000-0000-000000000001', v, '2026-10-01', jsonb_build_array(
      jsonb_build_object('employee_id', e1, 'amount', 2000, 'request_key', gen_random_uuid(), 'reason', 'Недостача за октябрь 2026')),
    jsonb_build_object('id', gen_random_uuid(), 'state', 'ready', 'captured_at', t0 + interval '6 minutes', 'rule_version_id', rule_id,
      'shortage_total', 2000, 'company_total', 0, 'employees_total', 2000, 'payload', '{}'::jsonb));
  if (res->>'unchanged')::boolean is not true then raise exception 'FAIL 9c: identical recalculation after lock: %', res; end if;
  begin
    perform public.reverse_inventory_deduction('aaaaaaaa-0000-0000-0000-000000000001', v, '2026-10-01', 'Итоги акта переоткрыты');
    raise exception 'FAIL 9d: reversal in a locked period accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' or sqlerrm not like '%Период зафиксирован%' then raise; end if; end;

  -- 10. Месяц закрыт: строка уходит в ближайший открытый, со ссылкой на исходный; август не тронут.
  res := public.post_inventory_deduction('aaaaaaaa-0000-0000-0000-000000000001', v, '2026-08-01', jsonb_build_array(
      jsonb_build_object('employee_id', e2, 'amount', 300, 'request_key', gen_random_uuid(), 'reason', 'Недостача за август 2026')),
    jsonb_build_object('id', s5, 'state', 'ready', 'captured_at', t0, 'rule_version_id', rule_id,
      'shortage_total', 300, 'company_total', 0, 'employees_total', 300, 'payload', '{}'::jsonb));
  if (res->>'displaced')::boolean is not true or res->>'target_month' <> '2026-09-01' then
    raise exception 'FAIL 10a: displacement: %', res;
  end if;
  select * into row from public.payroll_adjustments where inventory_snapshot_id = s5;
  if date_trunc('month', row.business_date)::date <> '2026-09-01' or row.amount <> -300
     or row.rule_snapshot->>'month' <> '2026-08-01' or row.reason not like '%08.2026%' then
    raise exception 'FAIL 10b: displaced line: %/%/%/%', row.business_date, row.amount, row.rule_snapshot, row.reason;
  end if;
  if exists (select 1 from public.payroll_adjustments where venue_id = v and business_date < '2026-09-01' and origin = 'inventory_deduction') then
    raise exception 'FAIL 10c: a line was written into the closed month';
  end if;

  -- 11. Нет ни одного открытого месяца: явная ошибка, ничего не записано.
  perform pg_temp.idl_period('2026-09-01', 'closed');
  perform pg_temp.idl_period('2026-10-01', 'closed');
  perform pg_temp.idl_period(date_trunc('month', (now() at time zone 'Europe/Moscow'))::date, 'closed');
  select count(*) into n from public.payroll_adjustments where venue_id = v;
  begin
    perform public.post_inventory_deduction('aaaaaaaa-0000-0000-0000-000000000001', v, '2026-08-01', jsonb_build_array(
        jsonb_build_object('employee_id', e1, 'amount', 5, 'request_key', gen_random_uuid(), 'reason', 'Недостача за август 2026')),
      jsonb_build_object('id', gen_random_uuid(), 'state', 'ready', 'captured_at', t0 + interval '9 minutes', 'rule_version_id', rule_id,
        'shortage_total', 5, 'company_total', 0, 'employees_total', 5, 'payload', '{}'::jsonb));
    raise exception 'FAIL 11a: posted although no period is open';
  exception when raise_exception then if sqlerrm like 'FAIL%' or sqlerrm not like '%открыт%' then raise; end if; end;
  if (select count(*) from public.payroll_adjustments where venue_id = v) <> n then raise exception 'FAIL 11b: rows changed'; end if;
  perform pg_temp.idl_period('2026-09-01', 'draft');
  perform pg_temp.idl_period('2026-10-01', 'draft');
  perform pg_temp.idl_period(date_trunc('month', (now() at time zone 'Europe/Moscow'))::date, 'draft');

  -- 12. Валидация входа.
  begin perform public.post_inventory_deduction('aaaaaaaa-0000-0000-0000-000000000001', v, '2026-10-15', '[]', jsonb_build_object('id', gen_random_uuid(), 'state', 'ready', 'captured_at', t0, 'rule_version_id', rule_id, 'shortage_total', 0, 'company_total', 0, 'employees_total', 0));
    raise exception 'FAIL 12a: mid-month date accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' or sqlerrm not like '%первым числом%' then raise; end if; end;
  begin perform public.post_inventory_deduction('aaaaaaaa-0000-0000-0000-000000000001', v, '2999-01-01', '[]', jsonb_build_object('id', gen_random_uuid(), 'state', 'ready', 'captured_at', t0, 'rule_version_id', rule_id, 'shortage_total', 0, 'company_total', 0, 'employees_total', 0));
    raise exception 'FAIL 12b: future month accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' or sqlerrm not like '%ещё не наступил%' then raise; end if; end;
  begin perform public.post_inventory_deduction('aaaaaaaa-0000-0000-0000-000000000001', v, '2026-09-01', jsonb_build_array(jsonb_build_object('employee_id', e_foreign, 'amount', 5, 'request_key', gen_random_uuid(), 'reason', 'Недостача')),
      jsonb_build_object('id', gen_random_uuid(), 'state', 'ready', 'captured_at', t0, 'rule_version_id', rule_id, 'shortage_total', 5, 'company_total', 0, 'employees_total', 5));
    raise exception 'FAIL 12c: employee of another venue accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' or sqlerrm not like '%Сотрудник не найден%' then raise; end if; end;
  begin perform public.post_inventory_deduction('aaaaaaaa-0000-0000-0000-000000000001', v, '2026-09-01', jsonb_build_array(jsonb_build_object('employee_id', e1, 'amount', -5, 'request_key', gen_random_uuid(), 'reason', 'Недостача')),
      jsonb_build_object('id', gen_random_uuid(), 'state', 'ready', 'captured_at', t0, 'rule_version_id', rule_id, 'shortage_total', 5, 'company_total', 0, 'employees_total', 5));
    raise exception 'FAIL 12d: negative amount accepted (sign is applied by the RPC)';
  exception when raise_exception then if sqlerrm like 'FAIL%' or sqlerrm not like '%положительн%' then raise; end if; end;
  begin perform public.post_inventory_deduction('aaaaaaaa-0000-0000-0000-000000000001', v, '2026-09-01', jsonb_build_array(
        jsonb_build_object('employee_id', e1, 'amount', 5, 'request_key', gen_random_uuid(), 'reason', 'Недостача'),
        jsonb_build_object('employee_id', e1, 'amount', 5, 'request_key', gen_random_uuid(), 'reason', 'Недостача')),
      jsonb_build_object('id', gen_random_uuid(), 'state', 'ready', 'captured_at', t0, 'rule_version_id', rule_id, 'shortage_total', 10, 'company_total', 0, 'employees_total', 10));
    raise exception 'FAIL 12e: two lines for one employee accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' or sqlerrm not like '%дважды%' then raise; end if; end;
  begin perform public.post_inventory_deduction('aaaaaaaa-0000-0000-0000-000000000001', v, '2026-09-01', jsonb_build_array(jsonb_build_object('employee_id', e1, 'amount', 5, 'request_key', gen_random_uuid(), 'reason', 'Недостача')),
      jsonb_build_object('id', gen_random_uuid(), 'state', 'ready', 'captured_at', t0, 'rule_version_id', rule_id, 'shortage_total', 5, 'company_total', 0, 'employees_total', 6));
    raise exception 'FAIL 12f: lines not matching the total accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' or sqlerrm not like '%не сходится%' then raise; end if; end;

  -- 13. Уволенный сотрудник: строка ставится и помечена, а не молча теряется.
  res := public.post_inventory_deduction('aaaaaaaa-0000-0000-0000-000000000001', v, '2026-09-01', jsonb_build_array(
      jsonb_build_object('employee_id', e3, 'amount', 120, 'request_key', gen_random_uuid(), 'reason', 'Недостача за сентябрь 2026')),
    jsonb_build_object('id', s6, 'state', 'ready', 'captured_at', t0, 'rule_version_id', rule_id,
      'shortage_total', 120, 'company_total', 0, 'employees_total', 120, 'payload', '{}'::jsonb));
  if jsonb_array_length(res->'inactive') <> 1 or (res->'inactive'->0->>'employee_id')::uuid <> e3 then raise exception 'FAIL 13a: inactive list: %', res->'inactive'; end if;
  if not exists (select 1 from public.payroll_adjustments where inventory_snapshot_id = s6 and employee_id = e3
                 and deleted_at is null and amount = -120 and rule_snapshot->>'inactive' = 'true') then
    raise exception 'FAIL 13b: dismissed employee line missing or unmarked';
  end if;

  -- 14. Нулевой итог: прежние строки сторнируются, снимок записан, новых строк нет.
  res := public.post_inventory_deduction('aaaaaaaa-0000-0000-0000-000000000001', v, '2026-09-01', '[]',
    jsonb_build_object('id', gen_random_uuid(), 'state', 'ready', 'captured_at', t0 + interval '10 minutes', 'rule_version_id', rule_id,
      'shortage_total', 0, 'company_total', 0, 'employees_total', 0, 'payload', '{}'::jsonb));
  if (res->>'reversed')::integer <> 1 or (res->>'posted')::boolean is not true then raise exception 'FAIL 14a: %', res; end if;
  if exists (select 1 from public.payroll_adjustments a join public.inventory_deduction_snapshots s on s.id = a.inventory_snapshot_id
             where s.venue_id = v and s.month = '2026-09-01' and a.deleted_at is null) then
    raise exception 'FAIL 14b: live lines remain after a zero total';
  end if;

  -- 15. Сторно по переоткрытию акта и отметка снимка.
  res := public.post_inventory_deduction('aaaaaaaa-0000-0000-0000-000000000001', v, '2026-09-01', jsonb_build_array(
      jsonb_build_object('employee_id', e1, 'amount', 80, 'request_key', gen_random_uuid(), 'reason', 'Недостача за сентябрь 2026')),
    jsonb_build_object('id', gen_random_uuid(), 'state', 'ready', 'captured_at', t0 + interval '11 minutes', 'rule_version_id', rule_id,
      'shortage_total', 80, 'company_total', 0, 'employees_total', 80, 'payload', '{}'::jsonb));
  res := public.reverse_inventory_deduction('aaaaaaaa-0000-0000-0000-000000000001', v, '2026-09-01', 'Итоги акта переоткрыты');
  if (res->>'reversed')::integer <> 1 then raise exception 'FAIL 15a: %', res; end if;
  if (select count(*) from public.inventory_deduction_snapshots where venue_id = v and month = '2026-09-01' and reversed_at is not null) < 1 then
    raise exception 'FAIL 15b: snapshot not marked reversed';
  end if;
  begin perform public.reverse_inventory_deduction('aaaaaaaa-0000-0000-0000-000000000001', v, '2026-09-01', 'x'); raise exception 'FAIL 15c: short reason accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' or sqlerrm not like '%причин%' then raise; end if; end;

  -- 16. Другое заведение (владелец там не состоит) и прямые записи.
  begin perform public.post_inventory_deduction('aaaaaaaa-0000-0000-0000-000000000001', foreign_venue, '2026-09-01', '[]', jsonb_build_object('id', gen_random_uuid(), 'state', 'ready', 'captured_at', t0, 'rule_version_id', rule_id, 'shortage_total', 0, 'company_total', 0, 'employees_total', 0));
    raise exception 'FAIL 16a: foreign venue accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' or sqlerrm not like '%Нет права%' then raise; end if; end;
  begin insert into public.inventory_deduction_snapshots(id, account_id, venue_id, month, rule_version_id, captured_at, state, shortage_total, company_total, employees_total, snapshot)
      values (gen_random_uuid(), current_setting('test.idl_a')::uuid, v, '2026-09-01', rule_id, now(), 'ready', 0, 0, 0, '{}');
    raise exception 'FAIL 16b: direct insert into the snapshot journal accepted';
  exception when insufficient_privilege then null; end;
  -- Границы доступа к функциям: записывающие - только service_role, проверка права - и сессии.
  if has_function_privilege('anon', 'public.post_inventory_deduction(uuid,uuid,date,jsonb,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.post_inventory_deduction(uuid,uuid,date,jsonb,jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.post_inventory_deduction(uuid,uuid,date,jsonb,jsonb)', 'execute') then
    raise exception 'FAIL 16c: post_inventory_deduction must be executable by service_role only';
  end if;
  if has_function_privilege('anon', 'public.reverse_inventory_deduction(uuid,uuid,date,text)', 'execute')
     or has_function_privilege('authenticated', 'public.reverse_inventory_deduction(uuid,uuid,date,text)', 'execute')
     or not has_function_privilege('service_role', 'public.reverse_inventory_deduction(uuid,uuid,date,text)', 'execute') then
    raise exception 'FAIL 16d: reverse_inventory_deduction must be executable by service_role only';
  end if;
  if has_function_privilege('anon', 'public.can_post_inventory_deduction(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.can_post_inventory_deduction(uuid)', 'execute') then
    raise exception 'FAIL 16e: can_post_inventory_deduction must be a session-only read helper';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'private' and p.proname like 'inventory_deduction%'
               and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))) then
    raise exception 'FAIL 16f: a private deduction helper is reachable from a browser role';
  end if;

  -- 18. Исполнитель записан везде, где раньше читался auth.uid(): строка, история, аудит, сторно.
  -- (В этой сессии auth.uid() пуст, как у серверного клиента.)
  if (select auth.uid()) is not null then raise exception 'FAIL 18a: test session must have no auth.uid()'; end if;
  select * into row from public.payroll_adjustments where inventory_snapshot_id = s6 and employee_id = e3;
  if row.created_by is distinct from 'aaaaaaaa-0000-0000-0000-000000000001'::uuid
     or row.approved_by is distinct from 'aaaaaaaa-0000-0000-0000-000000000001'::uuid then
    raise exception 'FAIL 18b: created_by/approved_by = %/%', row.created_by, row.approved_by;
  end if;
  if exists (select 1 from public.payroll_adjustment_history h where h.adjustment_id = row.id and h.actor_id is distinct from 'aaaaaaaa-0000-0000-0000-000000000001'::uuid)
     or not exists (select 1 from public.payroll_adjustment_history h where h.adjustment_id = row.id and h.action = 'created') then
    raise exception 'FAIL 18c: journal history lost the actor';
  end if;
  if exists (select 1 from public.audit_logs l where l.entity_id = row.id and l.action_code like 'payroll.adjustment.%' and l.user_id is distinct from 'aaaaaaaa-0000-0000-0000-000000000001'::uuid)
     or not exists (select 1 from public.audit_logs l where l.entity_id = row.id and l.action_code = 'payroll.adjustment.created') then
    raise exception 'FAIL 18d: payroll audit lost the actor';
  end if;
  if exists (select 1 from public.audit_logs l where l.action_code like 'stock.deductions.%' and l.venue_id = v and l.user_id is null) then
    raise exception 'FAIL 18e: a deduction audit event has no actor';
  end if;
  if exists (select 1 from public.payroll_adjustments x where x.venue_id = v and x.origin = 'inventory_deduction'
             and x.deleted_at is not null and x.deleted_by is distinct from 'aaaaaaaa-0000-0000-0000-000000000001'::uuid) then
    raise exception 'FAIL 18f: a reversal has no actor';
  end if;
  -- Подставленный на время записи исполнитель не протекает наружу.
  if (select auth.uid()) is not null then raise exception 'FAIL 18g: acting user leaked out of the RPC'; end if;

  -- 19. Исполнитель проверяется самим RPC: пустой, несуществующий и без права - отказ.
  begin perform public.post_inventory_deduction(null, v, '2026-09-01', '[]', jsonb_build_object('id', gen_random_uuid(), 'state', 'ready', 'captured_at', t0, 'rule_version_id', rule_id, 'shortage_total', 0, 'company_total', 0, 'employees_total', 0));
    raise exception 'FAIL 19a: null actor accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' or sqlerrm not like '%Нет права%' then raise; end if; end;
  begin perform public.post_inventory_deduction(gen_random_uuid(), v, '2026-09-01', '[]', jsonb_build_object('id', gen_random_uuid(), 'state', 'ready', 'captured_at', t0, 'rule_version_id', rule_id, 'shortage_total', 0, 'company_total', 0, 'employees_total', 0));
    raise exception 'FAIL 19b: unknown actor accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' or sqlerrm not like '%Нет права%' then raise; end if; end;
  begin perform public.reverse_inventory_deduction(null, v, '2026-09-01', 'Без исполнителя');
    raise exception 'FAIL 19c: reversal without an actor accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' or sqlerrm not like '%Нет права%' then raise; end if; end;

  -- 20. Правила выключены: сторно прежних строк тем же механизмом, повтор ничего не меняет.
  res := public.post_inventory_deduction('aaaaaaaa-0000-0000-0000-000000000001', v, '2026-09-01', jsonb_build_array(
      jsonb_build_object('employee_id', e1, 'amount', 40, 'request_key', gen_random_uuid(), 'reason', 'Недостача за сентябрь 2026')),
    jsonb_build_object('id', gen_random_uuid(), 'state', 'ready', 'captured_at', t0 + interval '20 minutes', 'rule_version_id', rule_id,
      'shortage_total', 40, 'company_total', 0, 'employees_total', 40, 'payload', '{}'::jsonb));
  res := public.reverse_inventory_deduction('aaaaaaaa-0000-0000-0000-000000000001', v, '2026-09-01', 'Пересчёт удержания по недостаче за 09.2026: правила удержаний выключены');
  if (res->>'reversed')::integer <> 1 then raise exception 'FAIL 20a: disabled reversal: %', res; end if;
  if exists (select 1 from public.payroll_adjustments a join public.inventory_deduction_snapshots sn on sn.id = a.inventory_snapshot_id
             where sn.venue_id = v and sn.month = '2026-09-01' and a.deleted_at is null) then
    raise exception 'FAIL 20b: lines still live after the rules were switched off';
  end if;
  if not exists (select 1 from public.payroll_adjustments a join public.inventory_deduction_snapshots sn on sn.id = a.inventory_snapshot_id
                 where sn.venue_id = v and sn.month = '2026-09-01' and a.delete_reason like '%правила удержаний выключены%' and a.amount = -40) then
    raise exception 'FAIL 20c: reversal lost its reason or edited the amount';
  end if;
  res := public.reverse_inventory_deduction('aaaaaaaa-0000-0000-0000-000000000001', v, '2026-09-01', 'Пересчёт удержания по недостаче за 09.2026: правила удержаний выключены');
  if (res->>'reversed')::integer <> 0 then raise exception 'FAIL 20d: repeat reversed again: %', res; end if;
  -- ...а в зафиксированном периоде выключенные правила не вскрывают его.
  res := public.post_inventory_deduction('aaaaaaaa-0000-0000-0000-000000000001', v, '2026-09-01', jsonb_build_array(
      jsonb_build_object('employee_id', e1, 'amount', 41, 'request_key', gen_random_uuid(), 'reason', 'Недостача за сентябрь 2026')),
    jsonb_build_object('id', gen_random_uuid(), 'state', 'ready', 'captured_at', t0 + interval '21 minutes', 'rule_version_id', rule_id,
      'shortage_total', 41, 'company_total', 0, 'employees_total', 41, 'payload', '{}'::jsonb));
  perform pg_temp.idl_period('2026-09-01', 'closed');
  begin perform public.reverse_inventory_deduction('aaaaaaaa-0000-0000-0000-000000000001', v, '2026-09-01', 'Пересчёт удержания по недостаче за 09.2026: правила удержаний выключены');
    raise exception 'FAIL 20e: disabled reversal reached into a closed period';
  exception when raise_exception then if sqlerrm like 'FAIL%' or sqlerrm not like '%Период зафиксирован%' then raise; end if; end;
  if not exists (select 1 from public.payroll_adjustments a join public.inventory_deduction_snapshots sn on sn.id = a.inventory_snapshot_id
                 where sn.venue_id = v and sn.month = '2026-09-01' and a.deleted_at is null and a.amount = -41) then
    raise exception 'FAIL 20f: closed-period line was touched';
  end if;
end $test$;

-- ── Браузерная сессия: прямой вызов закрыт ──────────────────
-- Владелец ИМЕЕТ право ставить удержания, но писать суммы руками через PostgREST не может:
-- у authenticated нет execute на записывающие функции.
reset role;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true),
       set_config('request.jwt.claims', '{"role":"authenticated","sub":"aaaaaaaa-0000-0000-0000-000000000001"}', true),
       set_config('app.ctx_ready', '0', true);
set local role authenticated;
do $test$
declare
  v uuid := current_setting('test.idl_v')::uuid;
  rule_id uuid := current_setting('test.idl_rule')::uuid;
  e1 uuid := current_setting('test.idl_e1')::uuid;
begin
  if not public.can_post_inventory_deduction(v) then raise exception 'FAIL 21a: owner must pass the session check'; end if;
  -- Реальный вызов без EXECUTE здесь не делаем: локальный PostgreSQL 17.6 в таком случае падает
  -- с signal 11 вместо отказа (см. миграцию 240), а прод (15.8) отвечает "permission denied".
  -- Закрытую дверь фиксирует сама таблица прав: у браузерной роли нет EXECUTE ни на одну
  -- записывающую функцию, поэтому подделанные суммы туда не доехать.
  if has_function_privilege('public.post_inventory_deduction(uuid,uuid,date,jsonb,jsonb)', 'execute') then
    raise exception 'FAIL 21b: the signed-in role can execute post_inventory_deduction (hand-written amounts would be accepted)';
  end if;
  if has_function_privilege('public.reverse_inventory_deduction(uuid,uuid,date,text)', 'execute') then
    raise exception 'FAIL 21c: the signed-in role can execute reverse_inventory_deduction';
  end if;
  if current_user <> 'authenticated' then raise exception 'FAIL 21d: expected the authenticated role'; end if;
end $test$;

-- ── Серверный клиент, исполнитель без права ─────────────────
reset role;
select set_config('request.jwt.claim.sub', '', true),
       set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $test$
declare
  v uuid := current_setting('test.idl_v')::uuid;
  rule_id uuid := current_setting('test.idl_rule')::uuid;
  e1 uuid := current_setting('test.idl_e1')::uuid;
  reader uuid := current_setting('test.idl_reader')::uuid;
begin
  begin
    perform public.post_inventory_deduction(reader, v, '2026-10-01', jsonb_build_array(
        jsonb_build_object('employee_id', e1, 'amount', 5, 'request_key', gen_random_uuid(), 'reason', 'Недостача за октябрь 2026')),
      jsonb_build_object('id', gen_random_uuid(), 'state', 'ready', 'captured_at', now(), 'rule_version_id', rule_id,
        'shortage_total', 5, 'company_total', 0, 'employees_total', 5, 'payload', '{}'::jsonb));
    raise exception 'FAIL 17a: actor without the permission posted a deduction';
  exception when raise_exception then if sqlerrm like 'FAIL%' or sqlerrm not like '%Нет права%' then raise; end if; end;
  begin perform public.reverse_inventory_deduction(reader, v, '2026-09-01', 'Без права');
    raise exception 'FAIL 17b: actor without the permission reversed';
  exception when raise_exception then if sqlerrm like 'FAIL%' or sqlerrm not like '%Нет права%' then raise; end if; end;
end $test$;
reset role;
do $test$
begin
  if exists (select 1 from public.payroll_adjustments where origin = 'inventory_deduction' and reason like '%сентябрь%' and amount = -5) then
    raise exception 'FAIL 17d: the denied call left a row';
  end if;
  raise notice 'PASS: inventory deduction lines (idempotency, sign, reversal, locked period, displacement, incomplete, actor, closed browser door, disabled rules)';
end $test$;
rollback;
