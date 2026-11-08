-- Local test database with the standard owner and a test venue.
begin;
do $$
declare
  actor uuid := (select id from auth.users where email = 'owner@test.com');
  venue uuid;
  account uuid;
  shift uuid := gen_random_uuid();
  employee uuid := gen_random_uuid();
  lease uuid := gen_random_uuid();
  day constant date := '2025-02-06';
  plan public.schedule_shifts;
  mark jsonb;
  source jsonb;
  input jsonb;
  fact jsonb;
  synced timestamptz := now();
begin
  if actor is null then raise exception 'Требуется локальный тестовый владелец'; end if;
  perform set_config('request.jwt.claim.sub', actor::text, true);
  perform set_config('app.ctx_ready', '0', true);
  venue := public.get_active_venue_id();
  select account_id into strict account from public.venues where id = venue;
  insert into public.sales_settings(venue_id, account_id, enabled) values(venue, account, false)
    on conflict (venue_id) do update set timezone = 'Europe/Moscow', day_start_hour = 9;
  insert into public.payroll_settings(venue_id, account_id, starts_on, quickresto_venue_id)
    values(venue, account, '2025-02-01', 1)
    on conflict (venue_id) do update set starts_on = least(payroll_settings.starts_on, excluded.starts_on);
  insert into public.payroll_periods(venue_id, account_id, month) values(venue, account, '2025-02-01');
  insert into public.payroll_employees(id, account_id, venue_id, name, role_name, local_user_id)
    values(employee, account, venue, 'Тест проверки выхода', 'Тест', actor);
  insert into public.schedule_shifts(id, venue_id, user_id, title, starts_at, ends_at, published)
    values(shift, venue, actor, 'Тест проверки выхода', '2025-02-06 13:00+03', '2025-02-06 19:00+03', true)
    returning * into plan;

  mark := jsonb_build_object('state', 'missing', 'shiftVersion', plan.version);
  source := jsonb_build_object('shift_attendance', jsonb_build_object(shift, mark));
  insert into public.payroll_source_days(venue_id, account_id, business_date, state, source, synced_at)
    values(venue, account, day, 'complete', source, synced)
    on conflict (venue_id, business_date) do update set state = 'complete', source = excluded.source, synced_at = excluded.synced_at;

  begin
    perform public.payroll_review_schedule_shift(shift, plan.version, synced - interval '1 second', 'include', 'Тест старой сверки');
    raise exception 'Принято решение по старой сверке';
  exception when others then
    if sqlerrm <> 'Данные выхода обновились. Откройте смену ещё раз' then raise; end if;
  end;

  perform public.payroll_review_schedule_shift(shift, plan.version, synced, 'include', 'Выход подтверждён');
  if not exists(select 1 from public.payroll_source_days where venue_id = venue and business_date = day and state = 'pending')
    or not exists(select 1 from public.payroll_schedule_reviews where shift_id = shift and decision = 'include' and reviewed_by = actor)
    then raise exception 'Решение не сохранилось или день не поставлен в очередь'; end if;

  update public.payroll_source_days set state = 'loading', lease_token = lease where venue_id = venue and business_date = day;
  input := jsonb_build_object('account_id', account, 'venue_id', venue, 'date', day, 'lease_token', lease,
    'cashbox', '[]'::jsonb, 'attendance', '[]'::jsonb, 'accruals', '[]'::jsonb);
  begin
    perform public.payroll_commit_day(input || jsonb_build_object('source', jsonb_build_object(
      'shift_attendance', jsonb_build_object(shift, mark || jsonb_build_object('shiftVersion', plan.version + 1)))));
    raise exception 'Сохранён результат для другой версии смены';
  exception when others then
    if sqlerrm <> 'Смена изменилась. Повторите расчёт зарплаты' then raise; end if;
  end;

  fact := jsonb_build_object('external_id', plan.payroll_fact_id, 'employee_id', employee, 'starts_at', plan.starts_at,
    'ends_at', plan.ends_at, 'shift_id', shift, 'role_name', 'Тест', 'status', 'confirmed');
  perform public.payroll_commit_day(input || jsonb_build_object(
    'source', source, 'attendance', jsonb_build_array(fact),
    'accruals', jsonb_build_array(jsonb_build_object('employee_id', employee, 'salary', 1500, 'tips', 500,
      'components', '[]'::jsonb, 'issues', '[]'::jsonb, 'status', 'ready', 'calculation_snapshot', '{}'::jsonb))));
  if not exists(select 1 from public.payroll_attendance a where a.shift_id = shift and a.status = 'confirmed' and a.source = 'schedule')
    or not exists(select 1 from public.payroll_accruals where employee_id = employee and business_date = day and salary = 1500 and tips = 500)
    then raise exception 'Выход не засчитан'; end if;

  insert into public.payroll_attendance(account_id, venue_id, business_date, external_id,
    employee_id, starts_at, ends_at, shift_id, role_name, status, reviewed_by)
  values(account, venue, day - 1, 900000000000 - plan.payroll_fact_id, employee,
    plan.starts_at - interval '5 hours', plan.ends_at, shift, 'Тест', 'confirmed', actor);
  begin
    update public.payroll_source_days set state = 'loading', lease_token = lease where venue_id = venue and business_date = day;
    perform public.payroll_commit_day(input || jsonb_build_object('source', source, 'attendance', jsonb_build_array(fact)));
    raise exception 'Одна смена засчитана дважды';
  exception when others then
    if sqlerrm <> 'Запись графика изменилась. Повторите расчёт' then raise; end if;
  end;
  delete from public.payroll_attendance where venue_id = venue and external_id = 900000000000 - plan.payroll_fact_id;

  select synced_at into synced from public.payroll_source_days where venue_id = venue and business_date = day;
  perform public.payroll_review_schedule_shift(shift, plan.version, synced, 'exclude', 'Выход отменён после проверки');
  update public.payroll_source_days set state = 'loading', lease_token = lease where venue_id = venue and business_date = day;
  perform public.payroll_commit_day(input || jsonb_build_object('source', source));
  if not exists(select 1 from public.payroll_attendance where shift_id = shift and status = 'ignored')
    or exists(select 1 from public.payroll_accruals where employee_id = employee and business_date = day)
    then raise exception 'Исключённый выход попал в начисления'; end if;

  insert into public.payroll_attendance_rules(account_id, venue_id, employee_id, valid_from, source, reason)
    values(account, venue, employee, day, 'excluded', 'Исключён из учёта');
  insert into public.payroll_attendance(account_id, venue_id, business_date, external_id, employee_id,
    starts_at, ends_at, role_name, status)
  values(account, venue, day, 900000000000 - plan.payroll_fact_id, employee, plan.starts_at, null, 'Тест', 'open');
  if not exists(select 1 from public.payroll_attendance where venue_id = venue
    and external_id = 900000000000 - plan.payroll_fact_id and status = 'ignored')
    then raise exception 'Незакрытая отметка исключённого сотрудника заблокировала учёт'; end if;
end $$;
rollback;
