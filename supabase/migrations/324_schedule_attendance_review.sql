begin;

alter table public.payroll_settings
  add column schedule_fallback_from timestamptz not null default now();

alter table public.payroll_schedule_reviews
  add column decision text check (decision in ('include', 'exclude'));

create policy payroll_schedule_review_audit on public.audit_logs as restrictive
  for select to authenticated using (
    entity_type <> 'payroll_schedule_review' or (
      account_id = (select public.get_active_account_id())
      and venue_id = (select public.get_active_venue_id())
      and (select public.has_permission('payroll.view'))
    )
  );

create or replace function public.payroll_review_schedule_shift(
  p_shift uuid, p_version integer, p_synced_at timestamptz, p_decision text, p_reason text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  account uuid;
  venue uuid;
  actor uuid;
  plan public.schedule_shifts;
  employee public.payroll_employees;
  day date;
  snapshot jsonb;
  previous public.payroll_schedule_reviews;
  saved public.payroll_schedule_reviews;
begin
  select a, v, u into account, venue, actor from private.payroll_scope('payroll.review');
  if account is null or venue is null or actor is null or not public.has_permission('schedule.view_all')
    then raise exception 'Нет доступа к проверке смен'; end if;
  if p_decision is null or p_decision not in ('include', 'exclude')
    or length(trim(coalesce(p_reason, ''))) not between 3 and 1000
    then raise exception 'Укажите решение и причину'; end if;

  perform pg_advisory_xact_lock(hashtextextended(venue::text, 0));
  select * into plan from public.schedule_shifts s where s.id = p_shift and s.venue_id = venue for update;
  if not found or plan.version is distinct from p_version or not plan.published or plan.ends_at > now()
    then raise exception 'Смена изменилась или ещё не закончилась'; end if;

  select ((plan.starts_at at time zone s.timezone) - make_interval(hours => s.day_start_hour))::date
  into day from public.sales_settings s where s.account_id = account and s.venue_id = venue;
  if day is null then raise exception 'График не подключён к расчёту зарплаты'; end if;
  perform 1 from public.payroll_source_days d
  where d.account_id = account and d.venue_id = venue and d.business_date = day and d.state = 'complete'
    and p_synced_at is not null and d.synced_at = p_synced_at
    and (d.source->'shift_attendance' ? p_shift::text or d.source->'missing_shifts' ? p_shift::text)
    and (p_decision <> 'include' or not coalesce(
      (d.source #>> array['shift_attendance', p_shift::text, 'crossBoundary'])::boolean, false
    ))
    and coalesce(
      (d.source #>> array['shift_attendance', p_shift::text, 'shiftVersion'])::integer = plan.version,
      d.synced_at >= plan.updated_at
    )
  for update;
  if not found then raise exception 'Данные выхода обновились. Откройте смену ещё раз'; end if;

  perform 1 from public.payroll_periods p
    where p.account_id = account and p.venue_id = venue and p.month = date_trunc('month', day)::date
      and p.status = 'draft' for update;
  if not found or exists (
    select 1 from public.payroll_accruals a where a.account_id = account and a.venue_id = venue and a.business_date = day
      and (a.status = 'approved'
        or exists (select 1 from public.payroll_allocations l where l.accrual_id = a.id)
        or exists (select 1 from public.payroll_payment_accruals l where l.accrual_id = a.id))
  ) then raise exception 'За этот день уже подтверждены начисления или проведены выплаты'; end if;

  select * into employee from public.payroll_employees e
  where e.account_id = account and e.venue_id = venue
    and (e.id = plan.payroll_employee_id or (plan.payroll_employee_id is null and e.local_user_id = plan.user_id));
  if not found or private.payroll_attendance_source(employee.id, day) = 'excluded'
    then raise exception 'Сотрудник не участвует в учёте выходов'; end if;

  snapshot := jsonb_build_object('user_id', plan.user_id, 'payroll_employee_id', plan.payroll_employee_id,
    'starts_at', plan.starts_at, 'ends_at', plan.ends_at);
  select * into previous from public.payroll_schedule_reviews where shift_id = plan.id;
  insert into public.payroll_schedule_reviews(account_id, venue_id, shift_id, employee_id, business_date, snapshot, decision, reason, reviewed_by)
  values (account, venue, plan.id, employee.id, day, snapshot, p_decision, trim(p_reason), actor)
  on conflict (shift_id) do update set employee_id = excluded.employee_id, business_date = excluded.business_date,
    snapshot = excluded.snapshot, decision = excluded.decision, reason = excluded.reason, reviewed_by = excluded.reviewed_by, reviewed_at = now()
  returning * into saved;

  insert into public.audit_logs(account_id, venue_id, user_id, action_code, entity_type, entity_id, details)
  values (account, venue, actor, 'payroll.schedule_attendance.reviewed', 'payroll_schedule_review', saved.id,
    jsonb_build_object('before', to_jsonb(previous), 'after', to_jsonb(saved)));
  update public.payroll_source_days d set state = 'pending', error = null
    where d.account_id = account and d.venue_id = venue and d.business_date = day;
end $$;
revoke all on function public.payroll_review_schedule_shift(uuid, integer, timestamptz, text, text) from public, anon;
grant execute on function public.payroll_review_schedule_shift(uuid, integer, timestamptz, text, text) to authenticated;

create or replace function private.payroll_schedule_fact_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.payroll_attendance_source(new.employee_id, new.business_date) = 'excluded' then
    new.status := 'ignored';
    new.issue := 'Не участвует в зарплатном учёте';
    return new;
  end if;
  if new.status = 'deviation' and new.issue = 'Отметка удалена в Quick Resto' then
    if new.external_id < 0 then
      new.status := 'ignored';
      new.issue := 'Смена изменена в графике';
    elsif private.payroll_attendance_source(new.employee_id, new.business_date) = 'schedule' then
      new.status := 'ignored';
      new.issue := 'Выход учитывается по опубликованному графику';
    end if;
  end if;
  if new.external_id < 0 and new.status = 'confirmed' and not exists (
    select 1 from public.schedule_shifts s
    join public.payroll_employees e on e.id = new.employee_id and e.account_id = new.account_id and e.venue_id = s.venue_id
    join public.sales_settings cfg on cfg.account_id = e.account_id and cfg.venue_id = e.venue_id
    join public.payroll_settings pay on pay.account_id = e.account_id and pay.venue_id = e.venue_id
    left join public.payroll_schedule_reviews r on r.shift_id = s.id and r.employee_id = e.id and r.business_date = new.business_date
      and (r.snapshot->>'user_id')::uuid is not distinct from s.user_id
      and (r.snapshot->>'payroll_employee_id')::uuid is not distinct from s.payroll_employee_id
      and (r.snapshot->>'starts_at')::timestamptz = s.starts_at and (r.snapshot->>'ends_at')::timestamptz = s.ends_at
    where s.id = new.shift_id and s.venue_id = new.venue_id and s.payroll_fact_id = new.external_id
      and s.published and s.ends_at <= now() and s.starts_at = new.starts_at and s.ends_at = new.ends_at
      and ((s.starts_at at time zone cfg.timezone) - make_interval(hours => cfg.day_start_hour))::date = new.business_date
      and not exists (
        select 1 from public.payroll_attendance previous
        where previous.venue_id = s.venue_id and previous.employee_id = e.id and previous.shift_id = s.id
          and previous.business_date < new.business_date and previous.external_id > 0
          and previous.status = 'confirmed'
          and previous.starts_at < s.ends_at and previous.ends_at > s.starts_at
      )
      and (r.id is null or r.decision is distinct from 'exclude')
      and ((s.payroll_employee_id = e.id and e.casual) or
        (s.payroll_employee_id is null and s.user_id = e.local_user_id and (
          private.payroll_attendance_source(e.id, new.business_date) = 'schedule' or r.decision = 'include' or
          (r.id is null and private.payroll_attendance_source(e.id, new.business_date) = 'quickresto'
            and (e.active or exists (
              select 1 from public.payroll_attendance previous
              where previous.venue_id = s.venue_id and previous.business_date = new.business_date
                and previous.external_id = s.payroll_fact_id and previous.employee_id = e.id
                and previous.shift_id = s.id and previous.status = 'confirmed'
                and previous.starts_at = s.starts_at and previous.ends_at = s.ends_at
            ))
            and s.starts_at >= pay.schedule_fallback_from and exists (
              select 1 from public.sales_days d where d.account_id = e.account_id and d.venue_id = e.venue_id
                and d.business_date = new.business_date and d.status = 'complete'
            ))
        )))
  ) then raise exception 'Запись графика изменилась. Повторите расчёт'; end if;
  return new;
end $$;

create function private.payroll_validate_shift_marks(p_input jsonb)
returns void language plpgsql set search_path = '' as $$
declare mark record;
begin
  for mark in select * from jsonb_each(coalesce(p_input->'source'->'shift_attendance', '{}'::jsonb)) order by key
  loop
    perform 1 from public.schedule_shifts s
      where s.id = mark.key::uuid and s.venue_id = (p_input->>'venue_id')::uuid
        and s.published and s.version = (mark.value->>'shiftVersion')::integer
      for share;
    if not found then raise exception 'Смена изменилась. Повторите расчёт зарплаты'; end if;
  end loop;
end $$;
revoke all on function private.payroll_validate_shift_marks(jsonb) from public, anon, authenticated;

-- The explicit shift decision takes precedence over a review of the individual cash-register entry.
do $$
declare
  definition text := pg_get_functiondef('public.payroll_commit_day(jsonb)'::regprocedure);
  old_status text := 'status=case when payroll_attendance.reviewed_by is not null';
  old_review text := 'case when payroll_attendance.starts_at=excluded.starts_at';
  guard text := 'not coalesce((row->>''schedule_review_override'')::boolean,false) and ';
  after_claim text := 'if not exists(select 1 from public.payroll_settings where venue_id=v and account_id=a and starts_on<=d)';
begin
  if strpos(definition, old_status) = 0 or strpos(definition, old_review) = 0 or strpos(definition, after_claim) = 0 then
    raise exception 'Не найдено правило сохранения проверки выхода';
  end if;
  definition := replace(definition, old_status, 'status=case when ' || guard || 'payroll_attendance.reviewed_by is not null');
  definition := replace(definition, old_review, 'case when ' || guard || 'payroll_attendance.starts_at=excluded.starts_at');
  definition := replace(definition, after_claim, 'perform private.payroll_validate_shift_marks(p_input);' || chr(10) || ' ' || after_claim);
  execute definition;
end $$;

notify pgrst, 'reload schema';
commit;
