begin;
-- Saved report IDs belong to a venue's Quick Resto setup. Never assume that the
-- CHILLING IDs identify equivalent reports in another customer's connection.
create table public.sales_statistics_sources (
 venue_id uuid primary key references public.venues(id),account_id uuid not null references public.accounts(id),
 enabled boolean not null default true,alcohol_report_id integer not null check(alcohol_report_id>0),
 regular_guests_report_id integer not null check(regular_guests_report_id>0),average_check_report_id integer not null check(average_check_report_id>0),
 version integer not null default 1 check(version>0),origin jsonb not null default '{}',updated_at timestamptz not null default now(),
 foreign key(account_id,venue_id) references public.venues(account_id,id)
);
create table public.sales_month_reports (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,
 month date not null check(extract(day from month)=1),kind text not null check(kind in ('alcohol','regular_guests','average_check')),
 request jsonb not null,state text not null default 'pending' check(state in ('pending','running','ready','error')),
 lease_token uuid,claimed_at timestamptz,attempts integer not null default 0,next_retry_at timestamptz not null default now(),last_error text,
 metrics jsonb,period_start timestamptz,period_end timestamptz,through_date date,synced_at timestamptz,
 unique(venue_id,month,kind),foreign key(account_id,venue_id) references public.venues(account_id,id)
);
create index sales_month_reports_claim on public.sales_month_reports(next_retry_at) where state in ('pending','running','error');
create table public.sales_month_report_history (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,
 report_id uuid not null references public.sales_month_reports(id),request jsonb not null,metrics jsonb not null,created_at timestamptz not null default now(),
 foreign key(account_id,venue_id) references public.venues(account_id,id)
);
do $$ declare t text;begin
 foreach t in array array['sales_statistics_sources','sales_month_reports','sales_month_report_history'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy sales_statistics_read on public.%I for select to authenticated using(account_id=public.get_active_account_id() and venue_id=public.get_active_venue_id() and public.has_permission(''sales.view_shifts''))',t);
 end loop;
end $$;

create function private.sales_request_month_reports(p_venue uuid,p_month date,p_force boolean default false) returns integer
language plpgsql security definer set search_path='' as $$
declare s record;cutoff date;last_day date;start_ms bigint;end_ms bigint;report_kind text;report_id integer;payload jsonb;n integer:=0;
begin
 if p_month is null or extract(day from p_month)<>1 or extract(year from p_month) not between 2000 and 2100 then raise exception 'Проверьте месяц';end if;
 select c.*,q.timezone,q.day_start_hour into s from public.sales_statistics_sources c
 join public.sales_settings q on q.venue_id=c.venue_id and q.account_id=c.account_id and q.enabled where c.venue_id=p_venue and c.enabled;
 if not found then raise exception 'Источники месячной статистики ещё не настроены';end if;
 cutoff:=((now() at time zone s.timezone)-make_interval(hours=>s.day_start_hour))::date;
 last_day:=least((p_month+interval '1 month')::date,cutoff);
 if last_day<=p_month then return 0;end if;
 start_ms:=(extract(epoch from ((p_month+make_time(s.day_start_hour,0,0)) at time zone s.timezone))*1000)::bigint;
 end_ms:=(extract(epoch from ((last_day+make_time(s.day_start_hour,0,0)) at time zone s.timezone))*1000)::bigint-1;
 foreach report_kind in array array['alcohol','regular_guests','average_check'] loop
  report_id:=case report_kind when 'alcohol' then s.alcohol_report_id when 'regular_guests' then s.regular_guests_report_id else s.average_check_report_id end;
  payload:=jsonb_build_object('report_id',report_id,'source_version',s.version,'timezone',s.timezone,'hour',s.day_start_hour,'start',start_ms,'end',end_ms,'through_date',last_day-1);
  insert into public.sales_month_reports(account_id,venue_id,month,kind,request) values(s.account_id,p_venue,p_month,report_kind,payload)
  on conflict(venue_id,month,kind) do update set request=excluded.request,state='pending',lease_token=null,claimed_at=null,attempts=0,next_retry_at=now(),last_error=null
  where p_force or public.sales_month_reports.request is distinct from excluded.request;
  if found then n:=n+1;end if;
 end loop;
 return n;
end $$;
revoke all on function private.sales_request_month_reports(uuid,date,boolean) from public,anon,authenticated;

create function public.sales_request_month_reports(p_month date,p_expected_venue uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare a uuid;v uuid;n integer;
begin
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 if auth.uid() is null or a is null or v is null or not public.has_permission('sales.sync_shifts') then raise exception 'Нет доступа к обновлению статистики';end if;
 if p_expected_venue is distinct from v then raise exception 'Заведение изменилось. Обновите страницу';end if;
 if not exists(select 1 from public.venues where id=v and account_id=a) then raise exception 'Заведение недоступно';end if;
 n:=private.sales_request_month_reports(v,p_month,true);
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details)
 values(a,v,auth.uid(),'sales.statistics.refresh_requested','venue',v,jsonb_build_object('month',p_month,'reports',n));
 return n;
end $$;
revoke all on function public.sales_request_month_reports(date,uuid) from public,anon;
grant execute on function public.sales_request_month_reports(date,uuid) to authenticated;

create function public.sales_schedule_month_reports() returns integer
language plpgsql security definer set search_path='' as $$
declare s record;m date;n integer:=0;
begin
 for s in select c.venue_id,q.timezone,q.day_start_hour from public.sales_statistics_sources c join public.sales_settings q on q.venue_id=c.venue_id and q.account_id=c.account_id and q.enabled where c.enabled loop
  m:=date_trunc('month',((now() at time zone s.timezone)-make_interval(hours=>s.day_start_hour)))::date;
  n:=n+private.sales_request_month_reports(s.venue_id,m,false);
  n:=n+private.sales_request_month_reports(s.venue_id,(m-interval '1 month')::date,false);
 end loop;
 return n;
end $$;
revoke all on function public.sales_schedule_month_reports() from public,anon,authenticated;
grant execute on function public.sales_schedule_month_reports() to service_role;

create function public.sales_claim_month_report(p_venue uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.sales_month_reports;token uuid:=gen_random_uuid();
begin
 select j.* into r from public.sales_month_reports j
 join public.sales_statistics_sources c on c.venue_id=j.venue_id and c.account_id=j.account_id and c.enabled
 join public.sales_settings s on s.venue_id=j.venue_id and s.account_id=j.account_id and s.enabled
 where (s.provider_retry_at is null or s.provider_retry_at<=now())
 and (p_venue is null or j.venue_id=p_venue)
 and ((j.state in ('pending','error') and j.next_retry_at<=now()) or (j.state='running' and j.claimed_at<now()-interval '3 minutes'))
 order by j.month desc,j.next_retry_at,j.id for update of j skip locked limit 1;
 if r.id is null then return null;end if;
 update public.sales_month_reports set state='running',lease_token=token,claimed_at=now(),attempts=attempts+1,last_error=null where id=r.id;
 return jsonb_build_object('id',r.id,'account_id',r.account_id,'venue_id',r.venue_id,'month',r.month,'kind',r.kind,'request',r.request,'lease_token',token);
end $$;
revoke all on function public.sales_claim_month_report(uuid) from public,anon,authenticated;
grant execute on function public.sales_claim_month_report(uuid) to service_role;

create function public.sales_commit_month_report(p_id uuid,p_lease uuid,p_metrics jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.sales_month_reports;s record;k text;n numeric;
begin
 select * into r from public.sales_month_reports where id=p_id for update;
 if r.id is null or p_lease is distinct from r.lease_token then return false;end if;
 if r.state='ready' then return r.metrics is not distinct from p_metrics;end if;
 if r.state<>'running' then return false;end if;
 select c.*,q.timezone,q.day_start_hour into s from public.sales_statistics_sources c join public.sales_settings q on q.venue_id=c.venue_id and q.account_id=c.account_id and q.enabled where c.venue_id=r.venue_id and c.enabled;
 if not found or s.version is distinct from (r.request->>'source_version')::integer
 or s.timezone is distinct from r.request->>'timezone' or s.day_start_hour is distinct from (r.request->>'hour')::integer
 or (case r.kind when 'alcohol' then s.alcohol_report_id when 'regular_guests' then s.regular_guests_report_id else s.average_check_report_id end) is distinct from (r.request->>'report_id')::integer then
  update public.sales_month_reports set state='error',last_error='Источники изменились. Нужен новый запрос.',next_retry_at=now()+interval '1 day' where id=r.id;return false;
 end if;
 if p_metrics is null or jsonb_typeof(p_metrics)<>'object' or (case r.kind when 'alcohol' then not(p_metrics ? 'revenue') or p_metrics-array['revenue']<>'{}'::jsonb when 'regular_guests' then not(p_metrics ?& array['revenue','guests']) or p_metrics-array['revenue','guests']<>'{}'::jsonb else not(p_metrics ? 'average') or p_metrics-array['average']<>'{}'::jsonb end) then raise exception 'Неверный результат отчёта';end if;
 for k in select jsonb_object_keys(p_metrics) loop
  if jsonb_typeof(p_metrics->k)<>'number' then raise exception 'Неизвестный показатель не равен нулю';end if;
  n:=(p_metrics->>k)::numeric;
  if abs(n)>1000000000000 or n<>round(n,2) or (k='guests' and (n<0 or n<>trunc(n))) then raise exception 'Некорректный показатель';end if;
 end loop;
 update public.sales_month_reports set metrics=p_metrics,period_start=to_timestamp((r.request->>'start')::bigint/1000.0),period_end=to_timestamp((r.request->>'end')::bigint/1000.0),through_date=(r.request->>'through_date')::date,synced_at=now(),state='ready',last_error=null where id=r.id;
 insert into public.sales_month_report_history(account_id,venue_id,report_id,request,metrics) values(r.account_id,r.venue_id,r.id,r.request,p_metrics);
 return true;
end $$;
revoke all on function public.sales_commit_month_report(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sales_commit_month_report(uuid,uuid,jsonb) to service_role;

create function public.sales_fail_month_report(p_id uuid,p_lease uuid,p_error text,p_retry_ms integer default null) returns void
language plpgsql security definer set search_path='' as $$
declare r public.sales_month_reports;
begin
 select * into r from public.sales_month_reports where id=p_id and lease_token=p_lease and state='running' for update;
 if r.id is null then return;end if;
 update public.sales_month_reports set state='error',last_error=left(p_error,300),next_retry_at=now()+make_interval(secs=>coalesce(least(900,greatest(30,p_retry_ms/1000)),least(3600,60*power(2,least(attempts,6))::integer))) where id=r.id;
 if p_retry_ms is not null then update public.sales_settings set provider_retry_at=greatest(coalesce(provider_retry_at,now()),now()+make_interval(secs=>least(900,greatest(30,p_retry_ms/1000)))) where account_id=r.account_id;end if;
end $$;
revoke all on function public.sales_fail_month_report(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.sales_fail_month_report(uuid,uuid,text,integer) to service_role;
notify pgrst,'reload schema';
commit;
