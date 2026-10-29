begin;
-- This queue only creates comparison runs. It cannot select a financial/native mode.
create table public.payroll_automation_jobs (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null references public.venues(id),
 business_date date not null,fingerprint text not null,
 state text not null default 'pending' check(state in ('pending','running','done','error','superseded','review')),
 lease_token uuid,claimed_at timestamptz,attempts integer not null default 0,
 next_retry_at timestamptz not null default now(),last_error text,run_id uuid references public.payroll_automation_runs(id),
 created_at timestamptz not null default now(),finished_at timestamptz,
 unique(venue_id,business_date,fingerprint)
);
create index payroll_automation_job_claim on public.payroll_automation_jobs(next_retry_at,created_at) where state in ('pending','running','error');
alter table public.payroll_automation_jobs enable row level security;
revoke all on public.payroll_automation_jobs from public,anon,authenticated;
grant select on public.payroll_automation_jobs to authenticated;
grant all on public.payroll_automation_jobs to service_role;
create policy payroll_automation_job_read on public.payroll_automation_jobs for select to authenticated
 using(account_id=public.get_active_account_id() and venue_id=public.get_active_venue_id() and public.has_permission('payroll.configure'));

create function public.payroll_schedule_automation_comparisons() returns integer
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 with sources as materialized (
  select s.venue_id,s.account_id,coalesce(v.timezone,'Europe/Moscow') tz,
   (now() at time zone coalesce(v.timezone,'Europe/Moscow'))::date today,
   case when (now() at time zone coalesce(v.timezone,'Europe/Moscow'))::time>='08:15'::time then 0 else 1 end before_run,
   (select min(h.updated_at at time zone coalesce(v.timezone,'Europe/Moscow'))::date from public.payroll_automation_settings_history h where h.venue_id=s.venue_id) first_saved,
   md5(public.payroll_automation_snapshot(s.venue_id)::text) fingerprint
  from public.payroll_automation_settings s join public.venues v on v.id=s.venue_id and v.account_id=s.account_id
  join public.payroll_settings p on p.venue_id=s.venue_id and p.account_id=s.account_id and p.enabled
  where s.version>0
 )
 insert into public.payroll_automation_jobs(account_id,venue_id,business_date,fingerprint)
 select s.account_id,s.venue_id,d::date,s.fingerprint from sources s
 cross join lateral generate_series(greatest(s.first_saved,s.today-s.before_run-6),s.today-s.before_run,'1 day'::interval) d
 where s.first_saved is not null
 on conflict(venue_id,business_date,fingerprint) do nothing;
 get diagnostics n=row_count;return n;
end $$;
revoke all on function public.payroll_schedule_automation_comparisons() from public,anon,authenticated;
grant execute on function public.payroll_schedule_automation_comparisons() to service_role;

create function public.payroll_claim_automation_comparison() returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.payroll_automation_jobs;token uuid:=gen_random_uuid();
begin
 update public.payroll_automation_jobs j set state='review',finished_at=now(),last_error='Сверка не завершилась за семь дней. Нужна отдельная проверка архивной даты.'
 from public.venues v where v.id=j.venue_id and j.business_date<(now() at time zone coalesce(v.timezone,'Europe/Moscow'))::date-7
 and (j.state in ('pending','error') or (j.state='running' and j.claimed_at<now()-interval '3 minutes'));
 select * into job from public.payroll_automation_jobs
 where (state in ('pending','error') and next_retry_at<=now()) or (state='running' and claimed_at<now()-interval '3 minutes')
 order by business_date desc,created_at desc,id for update skip locked limit 1;
 if job.id is null then return null;end if;
 update public.payroll_automation_jobs set state='running',lease_token=token,claimed_at=now(),attempts=attempts+1,last_error=null where id=job.id;
 return jsonb_build_object('id',job.id,'venue_id',job.venue_id,'business_date',job.business_date,'lease_token',token);
end $$;
revoke all on function public.payroll_claim_automation_comparison() from public,anon,authenticated;
grant execute on function public.payroll_claim_automation_comparison() to service_role;

create function public.payroll_commit_scheduled_automation(p_job uuid,p_lease uuid,p_snapshot jsonb,p_plan jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare job public.payroll_automation_jobs;result uuid;live jsonb;
begin
 select * into job from public.payroll_automation_jobs where id=p_job for update;
 if job.id is null or p_lease is distinct from job.lease_token then raise exception 'Запуск уже передан другому обработчику';end if;
 if job.state='done' then return job.run_id;end if;
 if job.state<>'running' then raise exception 'Запуск недоступен';end if;
 perform pg_advisory_xact_lock(hashtextextended('payroll-automation:'||job.venue_id::text,0));
 live:=public.payroll_automation_snapshot(job.venue_id);
 -- JSON transport can normalize 3000.00 to 3000. Compare values semantically;
 -- the queued fingerprint belongs to the database representation, not HTTP text.
 if md5(live::text) is distinct from job.fingerprint or p_snapshot is distinct from live then
  update public.payroll_automation_jobs set state='superseded',finished_at=now() where id=job.id;
  return null;
 end if;
 -- Both the result and job completion commit together, including after an HTTP timeout.
 result:=public.payroll_commit_automation_run(job.venue_id,job.business_date,p_snapshot,p_plan,'comparison',null,null);
 update public.payroll_automation_jobs set state='done',run_id=result,finished_at=now(),last_error=null where id=job.id;
 return result;
end $$;
revoke all on function public.payroll_commit_scheduled_automation(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.payroll_commit_scheduled_automation(uuid,uuid,jsonb,jsonb) to service_role;

create function public.payroll_fail_automation_comparison(p_job uuid,p_lease uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 update public.payroll_automation_jobs set state='error',last_error='Не удалось завершить сверку. Запуск повторится автоматически.',
 next_retry_at=now()+make_interval(secs=>least(3600,60*power(2,least(attempts,6))::integer))
 where id=p_job and lease_token=p_lease and state='running';
end $$;
revoke all on function public.payroll_fail_automation_comparison(uuid,uuid) from public,anon,authenticated;
grant execute on function public.payroll_fail_automation_comparison(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
