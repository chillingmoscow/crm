-- One submitted-month cohort for daily arrivals, current stages and cumulative
-- recruiting progress. Rejection/cancellation never erase a previously reached
-- stage; repeated transitions and multiple trials still count one candidate.
create or replace function public.candidate_people_overview(p_month date default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  a uuid := public.get_active_account_id();
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
    select c.id,c.status,c.source,(c.submitted_at at time zone tz)::date as business_day
    from public.candidates c
    where c.account_id=a and c.archived_at is null
      and c.submitted_at >= (m::timestamp at time zone tz)
      and c.submitted_at < (finish::timestamp at time zone tz)
      and c.submitted_at<=now()
  ), stages as (
    select id,ordinal from (values ('new',1),('review',2),('interview',3),('trial',4),('rejected',5)) x(id,ordinal)
  ), days as (
    select d::date as business_day from generate_series(m::timestamp,least(finish-1,today)::timestamp,interval '1 day') d
  ), history as materialized (
    -- Read each visible event once, even when a newly imported cohort is badly
    -- underestimated by planner statistics. Keep RLS and the parent-row checks.
    select e.candidate_id,e.kind,e.details from public.candidate_events e
    where e.account_id=a and e.created_at<=now()
      and e.candidate_id=any(array(select c.id from cohort c))
  ), plans as materialized (
    select ap.candidate_id,ap.kind from public.candidate_appointments ap
    where ap.account_id=a and ap.created_at<=now()
      and ap.candidate_id=any(array(select c.id from cohort c))
  ), signals as materialized (
    select c.id,c.status as stage from cohort c
    union all
    select e.candidate_id,observed.stage from history e
    cross join lateral (values
      (e.details#>>'{changes,status,old}'),
      (e.details#>>'{changes,status,new}'),
      (case when e.kind in ('appointment_created','appointment_updated') then e.details#>>'{before,kind}' end),
      (case when e.kind in ('appointment_created','appointment_updated') then e.details#>>'{after,kind}' end)
    ) observed(stage)
    where observed.stage in ('review','interview','trial','hired')
    union all
    select ap.candidate_id,ap.kind from plans ap
  ), reached as materialized (
    select c.id,coalesce(max(case s.stage
      when 'review' then 1 when 'interview' then 2 when 'trial' then 3 when 'hired' then 4 else 0 end),0) as depth
    from cohort c left join signals s on s.id=c.id group by c.id
  ), steps as (
    select id,depth from (values ('received',0),('review',1),('interview',2),('trial',3),('hired',4)) x(id,depth)
  )
  select jsonb_build_object(
    'kind','candidates','scope_id',a,'month',m,'current_month',date_trunc('month',today)::date,'today',today,'timezone',tz,
    'received',(select count(*) from cohort),
    'new',(select count(*) from cohort where status='new'),
    'hired',(select count(*) from cohort where status='hired'),
    'legacy_count',(select count(*) from cohort where source='notion'),
    'stages',(select jsonb_agg(jsonb_build_object('id',stages.id,'count',(select count(*) from cohort where status=stages.id)) order by ordinal) from stages),
    'arrivals',(select jsonb_agg(jsonb_build_object('from',business_day,'to',business_day,
      'count',(select count(*) from cohort c where c.business_day=days.business_day)) order by business_day) from days),
    'funnel',(select jsonb_agg(jsonb_build_object('id',steps.id,'count',
      (select count(*) from reached r where r.depth>=steps.depth)) order by steps.depth) from steps)
  ) into result;
  return result;
end $$;
revoke all on function public.candidate_people_overview(date) from public,anon;
grant execute on function public.candidate_people_overview(date) to authenticated;
comment on function public.candidate_people_overview(date) is 'Submitted-month account cohort with daily arrivals and cumulative highest-ever reached stage from current status, immutable events and appointments. Includes hires, deduplicates people, preserves progress after rejection; imported history may be incomplete.';
notify pgrst,'reload schema';
