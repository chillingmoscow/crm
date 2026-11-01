-- Atomic, read-only aggregates. Never use membership.created_at as a hiring date.
-- Staff dismissal history is aggregated privately so viewing the team does not
-- require (or grant) access to the underlying general audit journal.
-- PostgreSQL 15 (the self-hosted production version) has no pg_input_is_valid.
-- Keep malformed legacy event dates from breaking the entire overview.
create or replace function private.people_overview_event_time(p_value text,p_fallback timestamptz)
returns timestamptz language plpgsql stable security invoker set search_path = '' as $$
begin
  return coalesce(nullif(p_value,'')::timestamptz,p_fallback);
exception when invalid_datetime_format or datetime_field_overflow then
  return p_fallback;
end $$;
revoke all on function private.people_overview_event_time(text,timestamptz) from public,anon,authenticated;

create or replace function private.staff_people_overview(p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v uuid := public.get_active_venue_id();
  a uuid := public.get_active_account_id();
  tz text; today date; m date; finish date; result jsonb;
begin
  if auth.uid() is null or a is null or not public.has_permission('people.view_staff') then
    raise exception 'Нет доступа к обзору сотрудников';
  end if;
  select coalesce(venue.timezone,'Europe/Moscow') into tz from public.venues venue
  where venue.id=v and venue.account_id=a and venue.archived_at is null;
  if tz is null then raise exception 'Заведение недоступно';end if;
  today := (now() at time zone tz)::date;
  m := coalesce(p_month,date_trunc('month',today)::date);
  if m <> date_trunc('month',m)::date or m < date '2000-01-01' or m > date_trunc('month',today)::date then
    raise exception 'Выберите прошедший или текущий месяц';
  end if;
  finish := (m + interval '1 month')::date;
  with members as materialized (
    select u.user_id,u.status,u.fired_at,hr.employment_date
    from public.user_venue_roles u
    left join public.staff_account_details hr on hr.user_id=u.user_id and hr.account_id=a
    where u.venue_id=v and u.status in ('active','fired')
  ), current_staff as (
    select distinct user_id,employment_date from members where status='active' and fired_at is null
  ), dated as (
    select user_id,employment_date,today-employment_date days
    from current_staff where employment_date is not null and employment_date<=today
  ), starts as (
    select distinct user_id,employment_date as business_day from members
    where employment_date is not null and employment_date<=today
  ), dismissal_days as (
    select user_id,(fired_at at time zone tz)::date as business_day from members where fired_at is not null
    union
    select l.entity_id,(private.people_overview_event_time(l.details->>'fired_at',l.created_at) at time zone tz)::date
    from public.audit_logs l where l.account_id=a and l.venue_id=v
      and l.entity_type='staff' and l.action_code='staff.fired'
  ), months as (
    select d::date as month_start from generate_series(m-interval '2 months',m,interval '1 month') d
  )
  select jsonb_build_object(
    'kind','staff','scope_id',v,'month',m,'current_month',date_trunc('month',today)::date,'today',today,'timezone',tz,
    'working',(select count(*) from current_staff),
    'hired',(select count(distinct user_id) from starts where business_day>=m and business_day<finish),
    'dated_staff',(select count(*) from dated),
    'average_days',(select round(avg(days),2) from dated),
    'tenure',jsonb_build_array(
      jsonb_build_object('id','under_month','count',(select count(*) from dated where employment_date>today-interval '1 month')),
      jsonb_build_object('id','one_three','count',(select count(*) from dated where employment_date<=today-interval '1 month' and employment_date>today-interval '3 months')),
      jsonb_build_object('id','three_twelve','count',(select count(*) from dated where employment_date<=today-interval '3 months' and employment_date>today-interval '1 year')),
      jsonb_build_object('id','over_year','count',(select count(*) from dated where employment_date<=today-interval '1 year'))),
    'movement',(select jsonb_agg(jsonb_build_object('month',months.month_start,
      'hired',(select count(distinct user_id) from starts where business_day>=months.month_start and business_day<months.month_start+interval '1 month'),
      'fired',(select count(distinct user_id) from dismissal_days where business_day>=months.month_start and business_day<months.month_start+interval '1 month' and business_day<=today)) order by months.month_start) from months)
  ) into result;
  return result;
end $$;
revoke all on function private.staff_people_overview(date) from public,anon;
grant execute on function private.staff_people_overview(date) to authenticated;
create or replace function public.staff_people_overview(p_month date default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.staff_people_overview(p_month);
$$;
revoke all on function public.staff_people_overview(date) from public,anon;
grant execute on function public.staff_people_overview(date) to authenticated;

create or replace function public.candidate_people_overview(p_month date default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  a uuid := public.get_active_account_id();
  -- Same recruiting business zone as the incoming Tilda form and candidate date filter.
  tz text := 'Europe/Moscow';
  today date; m date; finish date; result jsonb;
begin
  if auth.uid() is null or a is null or not private.candidate_access(a,false) then
    raise exception 'Нет доступа к обзору кандидатов';
  end if;
  today := (now() at time zone tz)::date;
  m := coalesce(p_month,date_trunc('month',today)::date);
  if m <> date_trunc('month',m)::date or m < date '2000-01-01' or m > date_trunc('month',today)::date then
    raise exception 'Выберите прошедший или текущий месяц';
  end if;
  finish := (m+interval '1 month')::date;
  with cohort as materialized (
    select c.id,c.status,(c.submitted_at at time zone tz)::date as business_day from public.candidates c
    where c.account_id=a and c.archived_at is null
      and c.submitted_at >= (m::timestamp at time zone tz)
      and c.submitted_at < (finish::timestamp at time zone tz)
      and c.submitted_at<=now()
  ), stages as (
    select id,ordinal from (values ('new',1),('review',2),('interview',3),('trial',4),('rejected',5)) x(id,ordinal)
  ), weeks as (
    select greatest(d::date,m) start_day,least((d+interval '1 week')::date,finish) end_day
    from generate_series(date_trunc('week',m::timestamp),finish-interval '1 day',interval '1 week') d
  )
  select jsonb_build_object(
    'kind','candidates','scope_id',a,'month',m,'current_month',date_trunc('month',today)::date,'today',today,'timezone',tz,
    'received',(select count(*) from cohort),
    'new',(select count(*) from cohort where status='new'),
    'hired',(select count(*) from cohort where status='hired'),
    'stages',(select jsonb_agg(jsonb_build_object('id',stages.id,'count',(select count(*) from cohort where status=stages.id)) order by ordinal) from stages),
    'arrivals',(select jsonb_agg(jsonb_build_object('from',start_day,'to',end_day-1,
      'count',(select count(*) from cohort where business_day>=start_day and business_day<end_day)) order by start_day) from weeks)
  ) into result;
  return result;
end $$;
revoke all on function public.candidate_people_overview(date) from public,anon;
grant execute on function public.candidate_people_overview(date) to authenticated;
comment on function public.staff_people_overview(date) is 'Team overview for the active venue, gated by people.view_staff. Raw hiring dates and scoped dismissal history, counts only.';
comment on function public.candidate_people_overview(date) is 'Account recruiting cohort by submitted month, including hires; same candidate permissions and RLS, no list pagination.';
notify pgrst,'reload schema';
