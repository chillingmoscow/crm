begin;
-- Cash facts only. No ledger, payroll or provider mutation paths.
create table public.cash_control_rules (
 id uuid primary key default gen_random_uuid(), account_id uuid not null,venue_id uuid not null,
 version integer not null check(version>0),config jsonb not null,reason text not null check(length(trim(reason)) between 1 and 1000),
 created_by uuid references public.profiles(id) on delete set null,actor_name text not null,created_at timestamptz not null default now(),
 unique(venue_id,version),foreign key(account_id,venue_id) references public.venues(account_id,id) on delete cascade
);
create index cash_control_rules_scope on public.cash_control_rules(account_id,venue_id,version desc);
create index cash_control_rules_actor on public.cash_control_rules(created_by);
create table public.cash_control_days (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,business_date date not null,
 reports jsonb not null,request jsonb not null,source_hash text not null,version integer not null default 1,
 captured_at timestamptz not null default now(),checked_at timestamptz not null default now(),
 unique(venue_id,business_date),foreign key(account_id,venue_id) references public.venues(account_id,id) on delete cascade
);
create index cash_control_days_scope on public.cash_control_days(account_id,venue_id,business_date desc);
create table public.cash_control_history (
 id uuid primary key default gen_random_uuid(),day_id uuid not null references public.cash_control_days(id) on delete cascade,
 version integer not null,reports jsonb not null,request jsonb not null,source_hash text not null,
 actor_id uuid references public.profiles(id) on delete set null,actor_name text not null default 'Система',created_at timestamptz not null default now(),unique(day_id,version)
);
create index cash_control_history_actor on public.cash_control_history(actor_id);
create table private.cash_control_jobs (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,business_date date not null,request jsonb not null,
 state text not null default 'pending' check(state in ('pending','running','ready','error')),
 phase text not null default 'first' check(phase in ('first','verify')),candidate jsonb,provider text,
 lease uuid,claimed_at timestamptz,next_retry_at timestamptz not null default now(),failures integer not null default 0,attempts integer not null default 0,
 last_error text,requested_by uuid references public.profiles(id) on delete set null,requested_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(venue_id,business_date),foreign key(account_id,venue_id) references public.venues(account_id,id) on delete cascade
);
create index cash_control_jobs_scope on private.cash_control_jobs(account_id,venue_id,business_date);
create index cash_control_jobs_due on private.cash_control_jobs(state,next_retry_at,updated_at,id);
create index cash_control_jobs_actor on private.cash_control_jobs(requested_by);
alter table public.cash_control_rules enable row level security;
alter table public.cash_control_days enable row level security;
alter table public.cash_control_history enable row level security;
alter table private.cash_control_jobs enable row level security;
revoke all on public.cash_control_rules,public.cash_control_days,public.cash_control_history,private.cash_control_jobs from public,anon,authenticated,service_role;
grant select on public.cash_control_rules,public.cash_control_days,public.cash_control_history to authenticated,service_role;
create policy cash_control_rules_read on public.cash_control_rules for select to authenticated using(account_id=(select public.get_active_account_id()) and venue_id=(select public.get_active_venue_id()) and (select public.has_permission('finance.view_transactions')) and (select public.has_permission('sales.view_shifts')));
create policy cash_control_days_read on public.cash_control_days for select to authenticated using(account_id=(select public.get_active_account_id()) and venue_id=(select public.get_active_venue_id()) and (select public.has_permission('finance.view_transactions')) and (select public.has_permission('sales.view_shifts')));
create policy cash_control_history_read on public.cash_control_history for select to authenticated using(exists(select 1 from public.cash_control_days d where d.id=day_id));
create function private.cash_control_viewer(v uuid) returns uuid language plpgsql set search_path='' as $$
declare a uuid:=public.get_active_account_id();begin
 if auth.uid() is null or a is null or not public.has_permission('finance.view_transactions') or not public.has_permission('sales.view_shifts') then raise exception 'Нет доступа к контролю кассы';end if;
 if v is distinct from public.get_active_venue_id() or not exists(select 1 from public.venues where id=v and account_id=a and archived_at is null) then raise exception 'Заведение изменилось или недоступно';end if;
 return a;
end $$;
revoke all on function private.cash_control_viewer(uuid) from public,anon,authenticated,service_role;
create function public.cash_control_save_rules(p_venue uuid,p_version integer,p_config jsonb,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid:=private.finance_settlement_owner(p_venue);old public.cash_control_rules;rid uuid;actor text;begin
 if p_reason is null or length(trim(p_reason)) not between 1 and 1000 or p_config is null or jsonb_typeof(p_config)<>'object' or not(p_config ?& array['thresholdCents','opening','closing','autoRead','intervalMinutes']) or p_config-array['thresholdCents','opening','closing','autoRead','intervalMinutes']<>'{}' then raise exception 'Проверьте параметры контроля кассы и основание';end if;
 if jsonb_typeof(p_config->'thresholdCents') is distinct from 'number' or (p_config->>'thresholdCents')::numeric not between 0 and 10000000000 or (p_config->>'thresholdCents')::numeric<>trunc((p_config->>'thresholdCents')::numeric) or jsonb_typeof(p_config->'opening') is distinct from 'boolean' or jsonb_typeof(p_config->'closing') is distinct from 'boolean' or jsonb_typeof(p_config->'autoRead') is distinct from 'boolean' or jsonb_typeof(p_config->'intervalMinutes') is distinct from 'number' or (p_config->>'intervalMinutes')::numeric not between 15 and 1440 or (p_config->>'intervalMinutes')::numeric<>trunc((p_config->>'intervalMinutes')::numeric) then raise exception 'Проверьте порог и интервал проверки';end if;
 perform pg_advisory_xact_lock(hashtextextended('cash-control-rules:'||p_venue,0));
 select * into old from public.cash_control_rules where account_id=a and venue_id=p_venue order by version desc limit 1;
 if old.config=p_config and old.reason=trim(p_reason) and old.created_by=auth.uid() then return old.id;end if;
 if p_version is distinct from coalesce(old.version,0) then raise exception 'Правила изменились. Обновите страницу';end if;
 select coalesce(nullif(trim(concat_ws(' ',first_name,last_name)),''),'Пользователь') into actor from public.profiles where id=auth.uid();
 insert into public.cash_control_rules(account_id,venue_id,version,config,reason,created_by,actor_name) values(a,p_venue,coalesce(old.version,0)+1,p_config,trim(p_reason),auth.uid(),coalesce(actor,'Пользователь')) returning id into rid;
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details) values(a,p_venue,auth.uid(),'cash.control.rules_saved','venue',p_venue,jsonb_build_object('version',coalesce(old.version,0)+1,'reason',trim(p_reason),'config',p_config));return rid;
end $$;
revoke all on function public.cash_control_save_rules(uuid,integer,jsonb,text) from public,anon,service_role;
grant execute on function public.cash_control_save_rules(uuid,integer,jsonb,text) to authenticated;
create function private.cash_control_enqueue(a uuid,v uuid,d date,u uuid) returns uuid language plpgsql set search_path='' as $$
declare source jsonb;j private.cash_control_jobs;begin
 select jsonb_build_object('timezone',timezone,'dayStartHour',day_start_hour) into source from public.sales_settings where account_id=a and venue_id=v;
 if source is null then raise exception 'Сначала настройте источники продаж';end if;
 select * into j from private.cash_control_jobs where venue_id=v and business_date=d for update;
 if found and j.state in ('pending','running') and j.request=source then return j.id;end if;
 insert into private.cash_control_jobs(account_id,venue_id,business_date,request,requested_by) values(a,v,d,source,u)
 on conflict(venue_id,business_date) do update set request=excluded.request,requested_by=excluded.requested_by,state='pending',phase='first',candidate=null,provider=null,lease=null,claimed_at=null,next_retry_at=now(),failures=0,last_error=null,requested_at=now(),updated_at=now() returning * into j;
 return j.id;
end $$;
revoke all on function private.cash_control_enqueue(uuid,uuid,date,uuid) from public,anon,authenticated,service_role;
create function public.cash_control_request(p_venue uuid,p_date date) returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid:=private.finance_settlement_owner(p_venue);tz text;h integer;rid uuid;begin
 select timezone,day_start_hour into tz,h from public.sales_settings where account_id=a and venue_id=p_venue;
 if tz is null or p_date is null or p_date<'2000-01-01' or p_date>((now() at time zone tz)-make_interval(hours=>h))::date then raise exception 'Выберите текущий или прошедший рабочий день';end if;
 perform pg_advisory_xact_lock(hashtextextended('cash-control-job:'||p_venue||':'||p_date,0));rid:=private.cash_control_enqueue(a,p_venue,p_date,auth.uid());
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details) select a,p_venue,auth.uid(),'cash.control.requested','venue',p_venue,jsonb_build_object('date',p_date,'job_id',rid) where not exists(select 1 from public.audit_logs where action_code='cash.control.requested' and details->>'job_id'=rid::text and created_at>=(select requested_at from private.cash_control_jobs where id=rid));return rid;
end $$;
revoke all on function public.cash_control_request(uuid,date) from public,anon,service_role;
grant execute on function public.cash_control_request(uuid,date) to authenticated;
create function public.cash_control_job_status(p_venue uuid,p_date date) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=private.cash_control_viewer(p_venue);j private.cash_control_jobs;begin
 select * into j from private.cash_control_jobs where account_id=a and venue_id=p_venue and business_date=p_date;
 if not found then return null;end if;return jsonb_build_object('state',j.state,'phase',j.phase,'error',j.last_error,'updatedAt',j.updated_at);
end $$;
revoke all on function public.cash_control_job_status(uuid,date) from public,anon,service_role;
grant execute on function public.cash_control_job_status(uuid,date) to authenticated;
create function public.cash_control_schedule() returns integer language plpgsql security definer set search_path='' as $$
declare r record;d date;n integer:=0;today date;begin
 for r in select c.*,s.timezone,s.day_start_hour from (select distinct on (venue_id) * from public.cash_control_rules order by venue_id,version desc)c join public.sales_settings s on s.account_id=c.account_id and s.venue_id=c.venue_id join public.venues v on v.id=c.venue_id where (c.config->>'autoRead')::boolean and v.archived_at is null loop
  today:=((now() at time zone r.timezone)-make_interval(hours=>r.day_start_hour))::date;
  foreach d in array array[today-1,today] loop
   perform pg_advisory_xact_lock(hashtextextended('cash-control-job:'||r.venue_id||':'||d,0));
   if not exists(select 1 from private.cash_control_jobs where venue_id=r.venue_id and business_date=d and (state in ('pending','running') or updated_at>now()-make_interval(mins=>(r.config->>'intervalMinutes')::integer))) then perform private.cash_control_enqueue(r.account_id,r.venue_id,d,null);n:=n+1;end if;
  end loop;
 end loop;return n;
end $$;
revoke all on function public.cash_control_schedule() from public,anon,authenticated;
grant execute on function public.cash_control_schedule() to service_role;
create function public.cash_control_claim() returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.cash_control_jobs;begin
 select q.* into j from private.cash_control_jobs q where (q.state='pending' or (q.state='running' and q.claimed_at<now()-interval '2 minutes')) and q.next_retry_at<=now() and not exists(select 1 from public.sales_settings s where s.account_id=q.account_id and s.provider_retry_at>now()) order by q.updated_at,q.id for update of q skip locked limit 1;
 if not found then return null;end if;update private.cash_control_jobs set state='running',lease=gen_random_uuid(),claimed_at=now(),attempts=attempts+1 where id=j.id returning * into j;return to_jsonb(j);
end $$;
revoke all on function public.cash_control_claim() from public,anon,authenticated;
grant execute on function public.cash_control_claim() to service_role;
create function private.cash_control_validate_reports(r jsonb,j private.cash_control_jobs) returns void language plpgsql set search_path='' as $$
declare x jsonb;k text;n numeric;stamp timestamptz;begin
 if r is null or jsonb_typeof(r)<>'array' or jsonb_array_length(r)>10000 or octet_length(r::text)>10000000 or (select count(*)<>count(distinct entry->>'id') from jsonb_array_elements(r)entry) then raise exception 'Не подтверждён полный набор кассовых отчётов';end if;
 for x in select value from jsonb_array_elements(r) loop
  if jsonb_typeof(x)<>'object' or not(x ?& array['id','shiftNumber','openedAt','closedAt','terminalId','terminal','cashier','status','incomplete','openExpected','openDeclared','closeExpected','closeDeclared']) or x-array['id','shiftNumber','openedAt','closedAt','terminalId','terminal','cashier','status','incomplete','openExpected','openDeclared','closeExpected','closeDeclared']<>'{}' or jsonb_typeof(x->'id') is distinct from 'number' or (x->>'id')!~'^[1-9][0-9]*$' or (x->>'id')::numeric>9007199254740991 or coalesce(x->>'status','') not in ('OPENED','CLOSED') or jsonb_typeof(x->'incomplete') is distinct from 'boolean' then raise exception 'Некорректный кассовый отчёт';end if;
  foreach k in array array['terminalId','terminal','cashier','openedAt'] loop if jsonb_typeof(x->k) is distinct from 'string' or length(x->>k)>300 then raise exception 'Некорректные поля кассового отчёта';end if;end loop;
  stamp:=(x->>'openedAt')::timestamptz;
  if stamp<((j.business_date+make_time((j.request->>'dayStartHour')::integer,0,0)) at time zone (j.request->>'timezone')) or stamp>=(((j.business_date+1)+make_time((j.request->>'dayStartHour')::integer,0,0)) at time zone (j.request->>'timezone')) then raise exception 'Кассовая смена за пределами рабочего дня';end if;
  foreach k in array array['openExpected','openDeclared','closeExpected','closeDeclared'] loop
   if x->k<>'null'::jsonb then n:=(x->>k)::numeric;if jsonb_typeof(x->k) is distinct from 'number' or abs(n)>100000000000 or n<>trunc(n) then raise exception 'Некорректная сумма кассового отчёта';end if;end if;
  end loop;
  if x->>'status'='OPENED' and (x->'closeExpected'<>'null' or x->'closeDeclared'<>'null') then raise exception 'Открытая касса не имеет подтверждённого остатка закрытия';end if;
 end loop;
end $$;
revoke all on function private.cash_control_validate_reports(jsonb,private.cash_control_jobs) from public,anon,authenticated,service_role;
create function public.cash_control_save_read(p_job uuid,p_lease uuid,p_reports jsonb,p_provider text) returns uuid language plpgsql security definer set search_path='' as $$
declare j private.cash_control_jobs;old public.cash_control_days;rid uuid;h text;n integer;actor text;begin
 select * into j from private.cash_control_jobs where id=p_job and state='running' and lease=p_lease and claimed_at>now()-interval '2 minutes' for update;
 if not found then raise exception 'Чтение передано другому обработчику';end if;
 if p_provider is null or p_provider!~'^[a-f0-9]{64}$' or (j.provider is not null and j.provider<>p_provider) then raise exception 'Подключение изменилось. Запустите чтение заново';end if;
 if not exists(select 1 from public.sales_settings s join public.venues v on v.id=s.venue_id where s.account_id=j.account_id and s.venue_id=j.venue_id and v.archived_at is null and jsonb_build_object('timezone',s.timezone,'dayStartHour',s.day_start_hour)=j.request) then raise exception 'Граница рабочего дня изменилась';end if;
 perform private.cash_control_validate_reports(p_reports,j);
 if j.phase='first' then
  update private.cash_control_jobs set candidate=p_reports,provider=p_provider,phase='verify',state='pending',lease=null,claimed_at=null,failures=0,last_error=null,updated_at=now() where id=j.id;return null;
 end if;
 if j.candidate is distinct from p_reports then raise exception 'Кассовые отчёты изменились во время чтения';end if;
 h:=md5(jsonb_build_object('reports',p_reports,'source',j.request,'provider',p_provider)::text);
 select * into old from public.cash_control_days where account_id=j.account_id and venue_id=j.venue_id and business_date=j.business_date for update;
 if old.source_hash=h then update public.cash_control_days set checked_at=now() where id=old.id;rid:=old.id;
 else
  n:=coalesce(old.version,0)+1;
  insert into public.cash_control_days(account_id,venue_id,business_date,reports,request,source_hash,version) values(j.account_id,j.venue_id,j.business_date,p_reports,j.request,h,n)
  on conflict(venue_id,business_date) do update set reports=excluded.reports,request=excluded.request,source_hash=excluded.source_hash,version=excluded.version,captured_at=now(),checked_at=now() returning id into rid;
  actor:=coalesce((select nullif(trim(concat_ws(' ',first_name,last_name)),'') from public.profiles where id=j.requested_by),case when j.requested_by is null then 'Система' else 'Пользователь' end);
  insert into public.cash_control_history(day_id,version,reports,request,source_hash,actor_id,actor_name) values(rid,n,p_reports,j.request,h,j.requested_by,actor);
  insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details) values(j.account_id,j.venue_id,j.requested_by,'cash.control.synced','venue',j.venue_id,jsonb_build_object('date',j.business_date,'version',n,'reports',jsonb_array_length(p_reports)));
 end if;
 update private.cash_control_jobs set state='ready',candidate=null,lease=null,claimed_at=null,last_error=null,failures=0,updated_at=now() where id=j.id;return rid;
end $$;
revoke all on function public.cash_control_save_read(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.cash_control_save_read(uuid,uuid,jsonb,text) to service_role;
create function public.cash_control_fail(p_job uuid,p_lease uuid,p_message text,p_retry_seconds integer default null) returns void language plpgsql security definer set search_path='' as $$
declare j private.cash_control_jobs;n integer;delay integer;begin
 select * into j from private.cash_control_jobs where id=p_job and state='running' and lease=p_lease and claimed_at>now()-interval '2 minutes' for update;
 if not found then return;end if;
 n:=j.failures+case when p_retry_seconds is null then 1 else 0 end;delay:=case when p_retry_seconds is null then 30 else greatest(30,least(900,p_retry_seconds)) end;
 update private.cash_control_jobs set state=case when n>=3 then 'error' else 'pending' end,phase=case when p_retry_seconds is null then 'first' else phase end,candidate=case when p_retry_seconds is null then null else candidate end,failures=n,lease=null,claimed_at=null,last_error=left(p_message,1000),next_retry_at=now()+make_interval(secs=>delay),updated_at=now() where id=j.id;
 if p_retry_seconds is not null then update public.sales_settings set provider_retry_at=greatest(coalesce(provider_retry_at,now()),now()+make_interval(secs=>delay)) where account_id=j.account_id;end if;
end $$;
revoke all on function public.cash_control_fail(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.cash_control_fail(uuid,uuid,text,integer) to service_role;
create policy cash_control_audit on public.audit_logs as restrictive for select to authenticated using(action_code not like 'cash.control.%' or (account_id=(select public.get_active_account_id()) and venue_id=(select public.get_active_venue_id()) and (select public.has_permission('finance.view_transactions')) and (select public.has_permission('sales.view_shifts'))));
alter table private.sales_worker_rotation drop constraint sales_worker_rotation_lane_check;
alter table private.sales_worker_rotation add constraint sales_worker_rotation_lane_check check(lane between 0 and 5);
create or replace function public.sales_next_worker_lane() returns integer language sql security definer set search_path='' as $$
 insert into private.sales_worker_rotation as rotation(id,lane) values(true,0) on conflict(id) do update set lane=(rotation.lane+1)%6 returning lane;
$$;
revoke all on function public.sales_next_worker_lane() from public,anon,authenticated;
grant execute on function public.sales_next_worker_lane() to service_role;
commit;
