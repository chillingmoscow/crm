begin;
create table public.sales_additional_sources (
 venue_id uuid primary key,account_id uuid not null,enabled boolean not null default true,
 masters_report_id integer not null check(masters_report_id>0),bar_report_id integer not null check(bar_report_id>0),cocktail_report_id integer not null check(cocktail_report_id>0),
 version integer not null default 1 check(version>0),origin jsonb not null default '{}',
 foreign key(account_id,venue_id) references public.venues(account_id,id)
);
create index sales_additional_sources_scope on public.sales_additional_sources(account_id,venue_id);
create table public.sales_additional_rules (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,valid_from date not null,
 config jsonb not null check(jsonb_typeof(config)='object'),reason text not null,created_at timestamptz not null default now(),created_by uuid references public.profiles(id),
 foreign key(account_id,venue_id) references public.venues(account_id,id)
);
create index sales_additional_rules_scope on public.sales_additional_rules(account_id,venue_id,valid_from desc,created_at desc,id);
create index sales_additional_rules_author on public.sales_additional_rules(created_by);
create table public.sales_additional_reports (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,business_date date not null,kind text not null check(kind in ('bar','masters')),
 request jsonb not null,state text not null default 'pending' check(state in ('pending','running','ready','error')),
 metrics jsonb,metrics_request jsonb,period_start timestamptz,period_end timestamptz,synced_at timestamptz,last_error text,
 lease_token uuid,claimed_at timestamptz,attempts integer not null default 0,next_retry_at timestamptz not null default now(),
 unique(venue_id,business_date,kind),unique(account_id,venue_id,id),foreign key(account_id,venue_id) references public.venues(account_id,id)
);
create index sales_additional_reports_scope on public.sales_additional_reports(account_id,venue_id,business_date desc);
create index sales_additional_reports_queue on public.sales_additional_reports(next_retry_at) where state in ('pending','running','error');
create table public.sales_additional_history (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,report_id uuid not null,
 request jsonb not null,metrics jsonb not null,created_at timestamptz not null default now(),
 foreign key(account_id,venue_id,report_id) references public.sales_additional_reports(account_id,venue_id,id)
);
create index sales_additional_history_scope on public.sales_additional_history(account_id,venue_id,report_id,created_at desc);
create table public.sales_additional_archive (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,business_date date not null,kind text not null check(kind in ('bar','masters')),
 metrics jsonb not null,origin jsonb not null,source_hash text not null check(source_hash ~ '^[0-9a-f]{64}$'),captured_at timestamptz not null,imported_by uuid not null references public.profiles(id),
 unique(venue_id,business_date,kind,captured_at),foreign key(account_id,venue_id) references public.venues(account_id,id)
);
create index sales_additional_archive_scope on public.sales_additional_archive(account_id,venue_id,business_date desc,captured_at desc);
create index sales_additional_archive_author on public.sales_additional_archive(imported_by);
do $$ declare t text;begin
 foreach t in array array['sales_additional_sources','sales_additional_rules','sales_additional_reports','sales_additional_history','sales_additional_archive'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy sales_additional_read on public.%I for select to authenticated using(account_id=(select public.get_active_account_id()) and venue_id=(select public.get_active_venue_id()) and (select public.has_permission(''sales.view_shifts'')))',t);
 end loop;
end $$;
grant select,insert,update on public.sales_additional_sources,public.sales_additional_reports to service_role;
grant select,insert on public.sales_additional_rules,public.sales_additional_history,public.sales_additional_archive to service_role;

create function private.sales_validate_additional_rules(p jsonb) returns void language plpgsql immutable set search_path='' as $$
declare g jsonb;t jsonb;k text;b text;n numeric;ids text[];branches text[];thresholds numeric[];
begin
 if p is null or jsonb_typeof(p)<>'object' or not p ?& array['bar','masters','tiers'] or p-array['bar','masters','tiers']<>'{}' then raise exception 'Проверьте правила допродаж';end if;
 foreach k in array array['bar','masters'] loop
  if jsonb_typeof(p->k)<>'array' or jsonb_array_length(p->k) not between 1 and 40 then raise exception 'Проверьте группы допродаж';end if;
  ids:='{}';branches:='{}';
  for g in select value from jsonb_array_elements(p->k) loop
   if jsonb_typeof(g)<>'object' or not g ?& array['id','label','branches','rate'] or g-array['id','label','branches','rate']<>'{}' or jsonb_typeof(g->'id')<>'string' or jsonb_typeof(g->'label')<>'string' or (g->>'id') !~ '^[a-z][a-z0-9_]{0,39}$' or g->>'id'=any(ids) or g->>'id'=any(array['date','bonus','points','revenue','quantities']) or length(trim(g->>'label')) not between 1 and 100 or jsonb_typeof(g->'rate')<>'number' or jsonb_typeof(g->'branches')<>'array' or jsonb_array_length(g->'branches') not between 1 and 40 then raise exception 'Проверьте названия и ставки допродаж';end if;
   ids:=array_append(ids,g->>'id');n:=(g->>'rate')::numeric;if n<0 or n>1000000 or n<>round(n,2) then raise exception 'Некорректная ставка допродаж';end if;
   if exists(select 1 from jsonb_array_elements(g->'branches') x where jsonb_typeof(x)<>'string') then raise exception 'Некорректная категория допродаж';end if;
   for b in select jsonb_array_elements_text(g->'branches') loop
    if length(trim(b)) not between 1 and 200 or b=any(branches) then raise exception 'Категория допродаж повторяется или не заполнена';end if;branches:=array_append(branches,b);
   end loop;
  end loop;
 end loop;
 if jsonb_typeof(p->'tiers')<>'array' or jsonb_array_length(p->'tiers') not between 1 and 20 then raise exception 'Проверьте шкалу баллов';end if;
 thresholds:='{}';
 for t in select value from jsonb_array_elements(p->'tiers') loop
  if jsonb_typeof(t)<>'object' or not t ?& array['from','rate'] or jsonb_typeof(t->'from')<>'number' or jsonb_typeof(t->'rate')<>'number' or t-array['from','rate']<>'{}' then raise exception 'Некорректная шкала баллов';end if;
  n:=(t->>'from')::numeric;if n<0 or n>1000000 or n<>round(n,2) or n=any(thresholds) then raise exception 'Некорректный порог баллов';end if;thresholds:=array_append(thresholds,n);
  n:=(t->>'rate')::numeric;if n<0 or n>1000000 or n<>round(n,2) then raise exception 'Некорректная ставка баллов';end if;
 end loop;
end $$;
revoke all on function private.sales_validate_additional_rules(jsonb) from public,anon,authenticated;
grant execute on function private.sales_validate_additional_rules(jsonb) to service_role;

create function public.sales_save_additional_rules(p_expected_venue uuid,p_version integer,p_from date,p_config jsonb,p_reason text) returns uuid
language plpgsql security definer set search_path=public,pg_catalog as $$
declare a uuid:=public.get_active_account_id();v uuid:=public.get_active_venue_id();s public.sales_additional_sources;r uuid;cutoff date;
begin
 if auth.uid() is null or not public.has_permission('sales.configure_shifts') or not public.has_permission('sales.view_shifts') then raise exception 'Нет доступа к правилам допродаж';end if;
 if v is distinct from p_expected_venue then raise exception 'Заведение изменилось. Обновите страницу';end if;
 select * into s from public.sales_additional_sources where account_id=a and venue_id=v for update;
 if not found or p_version is distinct from s.version then raise exception 'Правила изменились. Обновите страницу';end if;
 select ((now() at time zone timezone)-make_interval(hours=>day_start_hour))::date into cutoff from public.sales_settings where account_id=a and venue_id=v;
 if p_from is null or cutoff is null or p_from<=cutoff or p_from>cutoff+366 then raise exception 'Новые правила можно назначить со следующего рабочего дня';end if;
 if length(trim(p_reason)) not between 3 and 1000 then raise exception 'Укажите причину изменения';end if;
 perform private.sales_validate_additional_rules(p_config);
 insert into public.sales_additional_rules(account_id,venue_id,valid_from,config,reason,created_by) values(a,v,p_from,p_config,trim(p_reason),auth.uid()) returning id into r;
 update public.sales_additional_sources set version=version+1 where venue_id=v;
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details) values(a,v,auth.uid(),'sales.additional_rules.updated','sales_additional_rules',r,jsonb_build_object('valid_from',p_from,'reason',trim(p_reason),'config',p_config));
 return r;
end $$;
revoke all on function public.sales_save_additional_rules(uuid,integer,date,jsonb,text) from public,anon;
grant execute on function public.sales_save_additional_rules(uuid,integer,date,jsonb,text) to authenticated;

create function private.sales_request_additional_day(p_venue uuid,p_date date,p_force boolean default false) returns integer
language plpgsql security definer set search_path='' as $$
declare s record;r public.sales_additional_rules;k text;cutoff date;payload jsonb;n integer:=0;counted integer;
begin
 if p_date is null or extract(year from p_date) not between 2000 and 2100 then raise exception 'Проверьте дату смены';end if;
 select c.*,q.timezone,q.day_start_hour into s from public.sales_additional_sources c join public.sales_settings q on q.venue_id=c.venue_id and q.account_id=c.account_id and q.enabled where c.venue_id=p_venue and c.enabled;
 if not found then raise exception 'Источники допродаж ещё не настроены';end if;
 cutoff:=((now() at time zone s.timezone)-make_interval(hours=>s.day_start_hour))::date;
 if p_date>=cutoff then return 0;end if;
 select * into r from public.sales_additional_rules where venue_id=p_venue and account_id=s.account_id and valid_from<=p_date order by valid_from desc,created_at desc,id desc limit 1;
 if not found then return 0;end if;
 foreach k in array array['bar','masters'] loop
  payload:=jsonb_build_object('source_version',s.version,'rule_id',r.id,'rules',r.config,'timezone',s.timezone,'hour',s.day_start_hour,'report_id',case k when 'bar' then s.bar_report_id else s.masters_report_id end,'cocktail_report_id',s.cocktail_report_id,'start',(extract(epoch from ((p_date+make_time(s.day_start_hour,0,0)) at time zone s.timezone))*1000)::bigint,'end',(extract(epoch from (((p_date+1)+make_time(s.day_start_hour,0,0)) at time zone s.timezone))*1000)::bigint-1);
  insert into public.sales_additional_reports(account_id,venue_id,business_date,kind,request) values(s.account_id,p_venue,p_date,k,payload)
  on conflict(venue_id,business_date,kind) do update set request=excluded.request,state='pending',lease_token=null,claimed_at=null,attempts=0,next_retry_at=now(),last_error=null
  where p_force or public.sales_additional_reports.request<>excluded.request or (public.sales_additional_reports.state='ready' and public.sales_additional_reports.synced_at<now()-interval '12 hours');
  get diagnostics counted=row_count;n:=n+counted;
 end loop;return n;
end $$;
revoke all on function private.sales_request_additional_day(uuid,date,boolean) from public,anon,authenticated;
grant execute on function private.sales_request_additional_day(uuid,date,boolean) to service_role;

create function public.sales_request_additional_month(p_month date,p_expected_venue uuid) returns integer
language plpgsql security definer set search_path=public,pg_catalog as $$
declare v uuid:=public.get_active_venue_id();d date;n integer:=0;
begin
 if auth.uid() is null or not public.has_permission('sales.sync_shifts') or not public.has_permission('sales.view_shifts') then raise exception 'Нет доступа к обновлению допродаж';end if;
 if v is distinct from p_expected_venue then raise exception 'Заведение изменилось. Обновите страницу';end if;
 if p_month is null or extract(day from p_month)<>1 or extract(year from p_month) not between 2000 and 2100 then raise exception 'Проверьте месяц';end if;
 for d in select generate_series(p_month,p_month+interval '1 month'-interval '1 day',interval '1 day')::date loop n:=n+private.sales_request_additional_day(v,d,true);end loop;
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details) values(public.get_active_account_id(),v,auth.uid(),'sales.additional.refresh_requested','sales_settings',v,jsonb_build_object('month',p_month,'reports',n));return n;
end $$;
revoke all on function public.sales_request_additional_month(date,uuid) from public,anon;
grant execute on function public.sales_request_additional_month(date,uuid) to authenticated;

create function public.sales_schedule_additional_reports() returns integer language plpgsql security definer set search_path=public,pg_catalog as $$
declare s record;d date;cutoff date;n integer:=0;
begin
 for s in select c.venue_id,q.timezone,q.day_start_hour from public.sales_additional_sources c join public.sales_settings q on q.venue_id=c.venue_id and q.account_id=c.account_id and q.enabled where c.enabled loop
  cutoff:=((now() at time zone s.timezone)-make_interval(hours=>s.day_start_hour))::date;
  for d in select generate_series(cutoff-3,cutoff-1,interval '1 day')::date loop n:=n+private.sales_request_additional_day(s.venue_id,d,false);end loop;
 end loop;return n;
end $$;
revoke all on function public.sales_schedule_additional_reports() from public,anon,authenticated;
grant execute on function public.sales_schedule_additional_reports() to service_role;

create function public.sales_claim_additional_report(p_venue uuid default null) returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare r public.sales_additional_reports;token uuid:=gen_random_uuid();
begin
 select j.* into r from public.sales_additional_reports j join public.sales_additional_sources c on c.venue_id=j.venue_id and c.account_id=j.account_id and c.enabled join public.sales_settings s on s.venue_id=j.venue_id and s.account_id=j.account_id and s.enabled
 where (p_venue is null or j.venue_id=p_venue) and (s.provider_retry_at is null or s.provider_retry_at<=now()) and ((j.state in ('pending','error') and j.next_retry_at<=now()) or (j.state='running' and j.claimed_at<now()-interval '3 minutes'))
 order by j.business_date desc,j.next_retry_at,j.id for update of j skip locked limit 1;
 if not found then return null;end if;
 update public.sales_additional_reports set state='running',lease_token=token,claimed_at=now(),attempts=attempts+1,last_error=null where id=r.id;
 return jsonb_build_object('id',r.id,'account_id',r.account_id,'venue_id',r.venue_id,'date',r.business_date,'kind',r.kind,'request',r.request,'lease_token',token);
end $$;
revoke all on function public.sales_claim_additional_report(uuid) from public,anon,authenticated;
grant execute on function public.sales_claim_additional_report(uuid) to service_role;

create function public.sales_commit_additional_report(p_id uuid,p_lease uuid,p_metrics jsonb) returns boolean language plpgsql security definer set search_path=public,pg_catalog as $$
declare r public.sales_additional_reports;s record;rule_id uuid;k text;val jsonb;n numeric;
begin
 select * into r from public.sales_additional_reports where id=p_id for update;
 if not found or p_lease is distinct from r.lease_token then return false;end if;
 if r.state='ready' then return r.metrics is not distinct from p_metrics;end if;if r.state<>'running' then return false;end if;
 select c.*,q.timezone,q.day_start_hour into s from public.sales_additional_sources c join public.sales_settings q on q.venue_id=c.venue_id and q.account_id=c.account_id and q.enabled where c.venue_id=r.venue_id and c.enabled;
 select id into rule_id from public.sales_additional_rules where venue_id=r.venue_id and account_id=r.account_id and valid_from<=r.business_date order by valid_from desc,created_at desc,id desc limit 1;
 if s.version is distinct from (r.request->>'source_version')::integer or s.timezone is distinct from r.request->>'timezone' or s.day_start_hour is distinct from (r.request->>'hour')::integer or rule_id is distinct from (r.request->>'rule_id')::uuid or (case r.kind when 'bar' then s.bar_report_id else s.masters_report_id end) is distinct from (r.request->>'report_id')::integer or s.cocktail_report_id is distinct from (r.request->>'cocktail_report_id')::integer then
  update public.sales_additional_reports set state='error',last_error='Источники изменились. Нужен новый запрос.',next_retry_at=now()+interval '1 day' where id=r.id;return false;
 end if;
 if p_metrics is null or jsonb_typeof(p_metrics)<>'object' or not p_metrics ?& array['revenue','primeCost','bonus','points','quantities'] or p_metrics-array['revenue','primeCost','bonus','points','quantities']<>'{}' or jsonb_typeof(p_metrics->'quantities')<>'object' then raise exception 'Некорректный результат допродаж';end if;
 foreach k in array array['revenue','primeCost','bonus','points'] loop
  val:=p_metrics->k;if k='points' and val='null' then continue;end if;
  if jsonb_typeof(val)<>'number' then raise exception 'Отсутствующий показатель не равен нулю';end if;
  n:=(val#>>'{}')::numeric;if abs(n)>1e12 or n<>round(n,case when k='points' then 8 else 2 end) then raise exception 'Некорректный показатель допродаж';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(r.request->'rules'->r.kind) g where not (p_metrics->'quantities') ? (g->>'id')) then raise exception 'Неполный набор групп допродаж';end if;
 for k,val in select * from jsonb_each(p_metrics->'quantities') loop
  if not exists(select 1 from jsonb_array_elements(r.request->'rules'->r.kind) g where g->>'id'=k) then raise exception 'Неизвестная группа допродаж';end if;
  if val='null' then continue;end if;if jsonb_typeof(val)<>'number' then raise exception 'Некорректное количество допродаж';end if;
  n:=(val#>>'{}')::numeric;if abs(n)>1e12 or n<>round(n,8) then raise exception 'Некорректное количество допродаж';end if;
 end loop;
 update public.sales_additional_reports set metrics=p_metrics,metrics_request=r.request,period_start=to_timestamp((r.request->>'start')::bigint/1000.0),period_end=to_timestamp((r.request->>'end')::bigint/1000.0),synced_at=now(),state='ready',last_error=null where id=r.id;
 insert into public.sales_additional_history(account_id,venue_id,report_id,request,metrics) values(r.account_id,r.venue_id,r.id,r.request,p_metrics);return true;
end $$;
revoke all on function public.sales_commit_additional_report(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sales_commit_additional_report(uuid,uuid,jsonb) to service_role;

create function public.sales_fail_additional_report(p_id uuid,p_lease uuid,p_error text,p_retry_ms integer default null) returns void language plpgsql security definer set search_path=public,pg_catalog as $$
declare r public.sales_additional_reports;
begin
 select * into r from public.sales_additional_reports where id=p_id and lease_token=p_lease and state='running' for update;if not found then return;end if;
 update public.sales_additional_reports set state='error',last_error=left(p_error,300),next_retry_at=now()+make_interval(secs=>coalesce(least(900,greatest(30,p_retry_ms/1000)),least(3600,60*power(2,least(attempts,6))::integer))) where id=r.id;
 if p_retry_ms is not null then update public.sales_settings set provider_retry_at=greatest(coalesce(provider_retry_at,now()),now()+make_interval(secs=>least(900,greatest(30,p_retry_ms/1000)))) where account_id=r.account_id;end if;
end $$;
revoke all on function public.sales_fail_additional_report(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.sales_fail_additional_report(uuid,uuid,text,integer) to service_role;
commit;
