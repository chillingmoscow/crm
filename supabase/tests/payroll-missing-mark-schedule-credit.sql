-- A shift credited automatically by the schedule is paid, but a missing Quick Resto mark is still a missing mark.
-- A manager's explicit "count this shift" forgives it.
begin;
do $$
declare
  u uuid; a uuid; v uuid; e uuid; role_id uuid; old_plan public.schedule_shifts; new_plan public.schedule_shifts;
  old_day constant date := '2026-09-18';
  new_day constant date := '2026-09-19';
  synced timestamptz := now();
  warning public.payroll_adjustments;
begin
  select id into u from auth.users where email = 'owner@test.com';
  if u is null then raise exception 'Требуется локальный тестовый владелец'; end if;
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('app.ctx_ready', '0', true);
  a := public.get_active_account_id(); v := public.get_active_venue_id();

  insert into public.sales_settings(venue_id, account_id, enabled) values(v, a, false)
    on conflict (venue_id) do update set timezone = 'Europe/Moscow', day_start_hour = 9;
  insert into public.payroll_settings(venue_id, account_id, starts_on, quickresto_venue_id)
    values(v, a, '2026-09-01', 1)
    on conflict (venue_id) do update set starts_on = least(payroll_settings.starts_on, excluded.starts_on);
  update public.payroll_settings set schedule_fallback_from = '2026-09-01 00:00+03' where venue_id = v;
  insert into public.payroll_periods(venue_id, account_id, month) values(v, a, '2026-09-01') on conflict (venue_id, month) do nothing;
  insert into public.sales_days(account_id, venue_id, business_date, status)
    values (a, v, old_day, 'complete'), (a, v, new_day, 'complete')
    on conflict (venue_id, business_date) do update set status = 'complete';
  insert into public.roles(venue_id, name, code) values(v, 'Missing mark role', 'missing_mark_role') returning id into role_id;
  insert into public.payroll_employees(account_id, venue_id, name, role_name, local_user_id, role_id, opening_confirmed)
    values(a, v, 'Missing mark employee', 'Test', u, role_id, true) returning id into e;
  insert into public.payroll_discipline_settings(venue_id, account_id) values(v, a) on conflict (venue_id) do nothing;
  update public.payroll_discipline_settings
    set enabled = true, missing_enabled = true, missing_amount = 500, valid_from = '2026-09-01',
        missing_mark_strict_from = '2026-09-19 00:00+03'
    where venue_id = v;

  insert into public.schedule_shifts(venue_id, user_id, role_id, title, starts_at, ends_at, published)
    values(v, u, role_id, 'Before the rule', '2026-09-18 12:00+03', '2026-09-18 23:00+03', true) returning * into old_plan;
  insert into public.schedule_shifts(venue_id, user_id, role_id, title, starts_at, ends_at, published)
    values(v, u, role_id, 'After the rule', '2026-09-19 12:00+03', '2026-09-19 23:00+03', true) returning * into new_plan;

  -- Both shifts are credited automatically by the schedule; neither has a Quick Resto mark.
  insert into public.payroll_attendance(account_id, venue_id, business_date, external_id, employee_id, starts_at, ends_at, shift_id, role_name, status)
  values (a, v, old_day, old_plan.payroll_fact_id, e, old_plan.starts_at, old_plan.ends_at, old_plan.id, 'Test', 'confirmed'),
         (a, v, new_day, new_plan.payroll_fact_id, e, new_plan.starts_at, new_plan.ends_at, new_plan.id, 'Test', 'confirmed');
  if (select count(*) from public.payroll_attendance where employee_id = e and external_id < 0 and status = 'confirmed') <> 2 then
    raise exception 'Выходы по графику не засчитаны';
  end if;

  insert into public.payroll_source_days(account_id, venue_id, business_date, state, source, synced_at)
    select a, v, d, 'pending', jsonb_build_object('shift_attendance', jsonb_build_object(plan.id,
        jsonb_build_object('state', 'scheduled', 'shiftVersion', plan.version))), synced
    from (values (old_day, old_plan.id, old_plan.version), (new_day, new_plan.id, new_plan.version)) plan(d, id, version)
    on conflict (venue_id, business_date) do update set state = 'pending', source = excluded.source, synced_at = excluded.synced_at;
  update public.payroll_source_days set state = 'complete' where venue_id = v and business_date in (old_day, new_day);

  if exists(select 1 from public.payroll_adjustments where employee_id = e and origin = 'missing_clockin' and business_date = old_day) then
    raise exception 'Смена до введения правила получила штраф задним числом';
  end if;
  select * into warning from public.payroll_adjustments where employee_id = e and origin = 'missing_clockin'
    and business_date = new_day and kind = 'warning' and reason = 'Нет отметки о смене Quick Resto' and deleted_at is null;
  if warning.id is null then
    raise exception 'Засчитанная по графику смена без отметки Quick Resto не получила предупреждение';
  end if;
  if exists(select 1 from public.payroll_adjustments where employee_id = e and origin = 'lateness') then
    raise exception 'Плановое время смены посчитано как опоздание';
  end if;

  -- The manager counts the shift explicitly: the warning is cancelled and does not come back on recalculation.
  perform public.payroll_review_schedule_shift(new_plan.id, new_plan.version, synced, 'include', 'Отметку забыл, выход подтверждён');
  if not exists(select 1 from public.payroll_adjustments where id = warning.id and deleted_at is not null
      and deleted_by = u and delete_reason = 'Выход засчитан вручную: Отметку забыл, выход подтверждён') then
    raise exception 'Ручной зачёт не снял предупреждение за отметку';
  end if;
  update public.payroll_source_days set state = 'complete' where venue_id = v and business_date = new_day;
  if exists(select 1 from public.payroll_adjustments where employee_id = e and origin = 'missing_clockin' and deleted_at is null) then
    raise exception 'Пересчёт вернул снятое предупреждение';
  end if;

  -- A real Quick Resto mark still satisfies the rule.
  insert into public.schedule_shifts(venue_id, user_id, role_id, title, starts_at, ends_at, published)
    values(v, u, role_id, 'Marked shift', '2026-09-20 12:00+03', '2026-09-20 23:00+03', true) returning * into new_plan;
  insert into public.payroll_attendance(account_id, venue_id, business_date, external_id, employee_id, starts_at, ends_at, shift_id, role_name, status)
    values (a, v, '2026-09-20', 999999992, e, new_plan.starts_at, new_plan.ends_at, new_plan.id, 'Test', 'confirmed');
  insert into public.payroll_source_days(account_id, venue_id, business_date, state) values (a, v, '2026-09-20', 'pending')
    on conflict (venue_id, business_date) do update set state = 'pending';
  update public.payroll_source_days set state = 'complete' where venue_id = v and business_date = '2026-09-20';
  if exists(select 1 from public.payroll_adjustments where employee_id = e and business_date = '2026-09-20') then
    raise exception 'Смена с отметкой Quick Resto получила штраф';
  end if;
  raise notice 'PASS: schedule credit keeps the missing-mark warning for new shifts, earlier shifts unchanged, manual credit forgives it, real mark clears it';
end $$;
rollback;
