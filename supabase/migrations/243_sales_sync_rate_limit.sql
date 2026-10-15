-- Pause all jobs of a connection when the provider asks us to slow down.
alter table public.sales_settings add column if not exists provider_retry_at timestamptz;
alter table public.sales_sync_jobs add column if not exists priority smallint not null default 0 check(priority between 0 and 10);
create or replace function public.sales_claim_job()
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.sales_sync_jobs;
begin
 select q.* into j from public.sales_sync_jobs q
 where (q.status='queued' or (q.status='running' and q.leased_until<now()))
 and not exists (select 1 from public.sales_settings s where s.account_id=q.account_id and s.provider_retry_at>now())
 order by q.priority desc,q.created_at,q.business_date desc,q.id for update of q skip locked limit 1;
 if not found then return null;end if;
 update public.sales_sync_jobs set status='running',lease_token=gen_random_uuid(),leased_until=now()+interval '2 minutes',attempts=attempts+1 where id=j.id returning * into j;
 return to_jsonb(j);
end $$;
revoke all on function public.sales_claim_job() from public,anon,authenticated;
grant execute on function public.sales_claim_job() to service_role;

alter table public.sales_days alter column method_version set default 'quickresto-2026-10-v1';
create or replace function public.sales_commit_job(p_job_id uuid,p_token uuid,p_metrics jsonb,p_summary jsonb,p_complete boolean)
returns uuid language plpgsql security invoker set search_path='' as $$
declare j public.sales_sync_jobs; day_id uuid;
begin
 select * into j from public.sales_sync_jobs where id=p_job_id and status='running' and lease_token=p_token and leased_until>now() for update;
 if not found then raise exception 'Запуск больше не принадлежит этому обработчику';end if;
 if not exists(select 1 from public.venues where id=j.venue_id and account_id=j.account_id) then raise exception 'Заведение не принадлежит аккаунту';end if;
 perform private.sales_validate_metrics(p_metrics,true);
 insert into public.sales_days(account_id,venue_id,business_date,status,calculated,synced_at,source_summary)
 values(j.account_id,j.venue_id,j.business_date,case when p_complete then 'complete' else 'preliminary' end,p_metrics,now(),p_summary)
 on conflict(venue_id,business_date) do update set calculated=excluded.calculated,status=excluded.status,synced_at=now(),source_summary=sales_days.source_summary||excluded.source_summary,sync_error=null,method_version='quickresto-2026-10-v1',version=sales_days.version+1,updated_at=now()
 returning id into day_id;
 insert into public.sales_events(day_id,kind,changes) values(day_id,'sync',jsonb_build_object('job_id',j.id,'complete',p_complete));
 update public.sales_sync_jobs set status='success',finished_at=now(),leased_until=null where id=j.id;
 -- Keep normalized inputs for an audit; browser roles cannot read them.
 return day_id;
end $$;
revoke all on function public.sales_commit_job(uuid,uuid,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.sales_commit_job(uuid,uuid,jsonb,jsonb,boolean) to service_role;


-- These rows already came from the same Quick Resto calculation, before its tag was renamed.
update public.sales_days set method_version='quickresto-2026-10-v1'
where synced_at is not null and source_summary ? 'orders_count' and method_version in ('glide-2026-10-v1','legacy-history');
update public.permissions set description='Настройка расчёта смен и пересчёт истории' where code='sales.configure_shifts';

create index if not exists sales_settings_retry_account on public.sales_settings(account_id,provider_retry_at) where provider_retry_at is not null;
