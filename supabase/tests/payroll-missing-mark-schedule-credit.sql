-- A shift credited by the schedule is paid, but a missing Quick Resto mark is still a missing mark.
begin;
do $$
declare
  u uuid; a uuid; v uuid; e uuid; role_id uuid; old_plan public.schedule_shifts; new_plan public.schedule_shifts;
  old_day constant date := '2026-09-18';
  new_day constant date := '2026-09-19';
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

  -- Both shifts are credited by the schedule after a manager's decision; neither has a Quick Resto mark.
  insert into public.payroll_schedule_reviews(account_id, venue_id, shift_id, employee_id, business_date, snapshot, decision, reason, reviewed_by)
  select a, v, plan.id, e, plan_day, jsonb_build_object('user_id', u, 'payroll_employee_id', null,
      'starts_at', plan.starts_at, 'ends_at', plan.ends_at), 'include', 'Выход подтверждён', u
  from (values (old_plan.id, old_plan.starts_at, old_plan.ends_at, old_day),
               (new_plan.id, new_plan.starts_at, new_plan.ends_at, new_day)) plan(id, starts_at, ends_at, plan_day);
  insert into public.payroll_attendance(account_id, venue_id, business_date, external_id, employee_id, starts_at, ends_at, shift_id, role_name, status)
  values (a, v, old_day, old_plan.payroll_fact_id, e, old_plan.starts_at, old_plan.ends_at, old_plan.id, 'Test', 'confirmed'),
         (a, v, new_day, new_plan.payroll_fact_id, e, new_plan.starts_at, new_plan.ends_at, new_plan.id, 'Test', 'confirmed');
  if (select count(*) from public.payroll_attendance where employee_id = e and external_id < 0 and status = 'confirmed') <> 2 then
    raise exception 'Выходы по графику не засчитаны';
  end if;

  insert into public.payroll_source_days(account_id, venue_id, business_date, state)
    values (a, v, old_day, 'pending'), (a, v, new_day, 'pending')
    on conflict (venue_id, business_date) do update set state = 'pending';
  update public.payroll_source_days set state = 'complete' where venue_id = v and business_date in (old_day, new_day);

  if exists(select 1 from public.payroll_adjustments where employee_id = e and origin = 'missing_clockin' and business_date = old_day) then
    raise exception 'Смена до введения правила получила штраф задним числом';
  end if;
  if not exists(select 1 from public.payroll_adjustments where employee_id = e and origin = 'missing_clockin'
      and business_date = new_day and kind = 'warning' and reason = 'Нет отметки о смене Quick Resto') then
    raise exception 'Засчитанная по графику смена без отметки Quick Resto не получила предупреждение';
  end if;
  if exists(select 1 from public.payroll_adjustments where employee_id = e and origin = 'lateness') then
    raise exception 'Плановое время смены посчитано как опоздание';
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
  raise notice 'PASS: schedule credit keeps the missing-mark warning for new shifts, earlier shifts unchanged, real mark clears it';
end $$;
rollback;
