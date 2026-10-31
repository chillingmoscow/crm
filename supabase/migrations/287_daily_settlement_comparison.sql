begin;
-- Comparison inputs only. None of these functions post transactions or change balances.
create table public.finance_settlement_settings (
 id uuid primary key default gen_random_uuid(), account_id uuid not null, venue_id uuid not null,
 version integer not null check(version>0), config jsonb not null, auto_read boolean not null default false,
 reason text not null check(length(trim(reason)) between 1 and 1000),
 created_by uuid references public.profiles(id) on delete set null, actor_name text not null,
 created_at timestamptz not null default now(), unique(venue_id,version),
 foreign key(account_id,venue_id) references public.venues(account_id,id) on delete cascade
);
create index finance_settlement_settings_scope on public.finance_settlement_settings(account_id,venue_id,version desc);
create index finance_settlement_settings_actor on public.finance_settlement_settings(created_by);
create table public.finance_settlement_days (
 id uuid primary key default gen_random_uuid(), account_id uuid not null, venue_id uuid not null,
 business_date date not null, facts jsonb not null, methods jsonb not null, summary jsonb not null,
 source_hash text not null, version integer not null default 1, captured_at timestamptz not null default now(), checked_at timestamptz not null default now(),
 unique(venue_id,business_date), foreign key(account_id,venue_id) references public.venues(account_id,id) on delete cascade
);
create index finance_settlement_days_scope on public.finance_settlement_days(account_id,venue_id,business_date desc);
create table public.finance_settlement_history (
 id uuid primary key default gen_random_uuid(), day_id uuid not null references public.finance_settlement_days(id) on delete cascade,
 version integer not null, facts jsonb not null, methods jsonb not null, summary jsonb not null, source_hash text not null,
 actor_id uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(), unique(day_id,version)
);
create index finance_settlement_history_actor on public.finance_settlement_history(actor_id);
create table public.finance_settlement_jobs (
 id uuid primary key default gen_random_uuid(), account_id uuid not null, venue_id uuid not null, business_date date not null,
 request jsonb not null, state text not null default 'pending' check(state in ('pending','running','ready','error')),
 phase text not null default 'orders' check(phase in ('orders','details','payments','verify','commit')),
 cursor integer not null default 0 check(cursor>=0), payload jsonb not null default '{"orders":[],"facts":[],"methods":[]}',
 lease uuid, claimed_at timestamptz, next_retry_at timestamptz not null default now(), attempts integer not null default 0,
 failures integer not null default 0, last_error text, requested_by uuid references public.profiles(id) on delete set null,
 requested_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz,
 unique(venue_id,business_date), foreign key(account_id,venue_id) references public.venues(account_id,id) on delete cascade
);
create index finance_settlement_jobs_scope on public.finance_settlement_jobs(account_id,venue_id,business_date);
create index finance_settlement_jobs_due on public.finance_settlement_jobs(state,next_retry_at,updated_at,id);
create index finance_settlement_jobs_actor on public.finance_settlement_jobs(requested_by);

alter table public.finance_settlement_settings enable row level security;
alter table public.finance_settlement_days enable row level security;
alter table public.finance_settlement_history enable row level security;
alter table public.finance_settlement_jobs enable row level security;
revoke all on public.finance_settlement_settings,public.finance_settlement_days,public.finance_settlement_history,public.finance_settlement_jobs from public,anon,authenticated,service_role;
grant select on public.finance_settlement_settings,public.finance_settlement_days,public.finance_settlement_history to authenticated,service_role;
grant select on public.finance_settlement_jobs to service_role;
create policy finance_settlement_settings_read on public.finance_settlement_settings for select to authenticated using(account_id=(select public.get_active_account_id()) and venue_id=(select public.get_active_venue_id()) and (select public.is_account_owner(public.get_active_account_id())) and (select public.has_permission('finance.view_transactions')) and (select public.has_permission('sales.view_shifts')));
create policy finance_settlement_days_read on public.finance_settlement_days for select to authenticated using(account_id=(select public.get_active_account_id()) and venue_id=(select public.get_active_venue_id()) and (select public.is_account_owner(public.get_active_account_id())) and (select public.has_permission('finance.view_transactions')) and (select public.has_permission('sales.view_shifts')));
create policy finance_settlement_history_read on public.finance_settlement_history for select to authenticated using(exists(select 1 from public.finance_settlement_days d where d.id=day_id));

create function private.finance_settlement_owner(v uuid) returns uuid language plpgsql set search_path='' as $$
declare a uuid:=public.get_active_account_id();begin
 if auth.uid() is null or a is null or not public.is_account_owner(a) or not public.has_permission('finance.view_transactions') or not public.has_permission('sales.view_shifts') then raise exception 'Сверка поступлений доступна владельцу';end if;
 if v is distinct from public.get_active_venue_id() or not exists(select 1 from public.venues where id=v and account_id=a and archived_at is null) then raise exception 'Заведение изменилось или недоступно';end if;
 return a;
end $$;
revoke all on function private.finance_settlement_owner(uuid) from public,anon,authenticated,service_role;

create function private.finance_validate_settlement(c jsonb,a uuid,v uuid) returns void language plpgsql set search_path='' as $$
declare m jsonb;p jsonb;k text;bid uuid;cid uuid;direction text;begin
 if c is null or jsonb_typeof(c)<>'object' or not(c ?& array['venueId','timezone','dayStartHour','revenueCategoryId','methods','personal']) or c-array['venueId','timezone','dayStartHour','revenueCategoryId','methods','personal']<>'{}'::jsonb or (c->>'venueId')::uuid is distinct from v or not exists(select 1 from public.sales_settings s where s.account_id=a and s.venue_id=v and s.timezone=c->>'timezone' and s.day_start_hour=(c->>'dayStartHour')::integer) then raise exception 'Проверьте заведение и рабочий день';end if;
 if jsonb_typeof(c->'methods') is distinct from 'array' or jsonb_array_length(c->'methods')>100 or (select count(*)<>count(distinct (x->>'paymentTypeId')::bigint) from jsonb_array_elements(c->'methods') x) then raise exception 'Проверьте способы оплаты';end if;
 if not exists(select 1 from public.finance_categories where id=(c->>'revenueCategoryId')::uuid and account_id=a and archived_at is null and type='income') then raise exception 'Выберите статью поступлений этого аккаунта';end if;
 for m in select value from jsonb_array_elements(c->'methods') loop
  if jsonb_typeof(m)<>'object' or not(m ?& array['paymentTypeId','bankAccountId','excluded','feePercent','feeAccounting']) or m-array['paymentTypeId','bankAccountId','excluded','feePercent','feeAccounting']<>'{}'::jsonb or jsonb_typeof(m->'paymentTypeId') is distinct from 'number' or (m->>'paymentTypeId')!~'^[1-9][0-9]*$' or (m->>'paymentTypeId')::numeric>9007199254740991 or jsonb_typeof(m->'feePercent') is distinct from 'number' or (m->>'feePercent')::numeric not between 0 and 100 or (m->>'feePercent')::numeric<>round((m->>'feePercent')::numeric,4) or coalesce(m->>'feeAccounting','') not in ('net','separate') then raise exception 'Проверьте способы оплаты и комиссии';end if;
  if m->'excluded'<>'null'::jsonb then
   if coalesce(m->>'excluded','') not in ('bonus','no_payment') or m->'bankAccountId'<>'null'::jsonb or (m->>'feePercent')::numeric<>0 then raise exception 'Исключённый способ не должен создавать поступление';end if;
  else
   bid:=(m->>'bankAccountId')::uuid;
   if bid is null or not exists(select 1 from public.bank_accounts where id=bid and account_id=a and (venue_id is null or venue_id=v) and deleted_at is null and is_active and currency='RUB') then raise exception 'Выберите действующий рублёвый счёт этого заведения';end if;
  end if;
 end loop;
 p:=c->'personal';
 if p<>'null'::jsonb then
  if jsonb_typeof(p)<>'object' or not(p ?& array['payerId','bankAccountId','incomeCategoryId','expenseCategoryId']) or p-array['payerId','bankAccountId','incomeCategoryId','expenseCategoryId']<>'{}'::jsonb or jsonb_typeof(p->'payerId') is distinct from 'number' or (p->>'payerId')!~'^[1-9][0-9]*$' or (p->>'payerId')::numeric>9007199254740991 then raise exception 'Проверьте личное потребление';end if;
  if not exists(select 1 from public.bank_accounts where id=(p->>'bankAccountId')::uuid and account_id=a and (venue_id is null or venue_id=v) and deleted_at is null and is_active and currency='RUB') then raise exception 'Выберите счёт личного потребления';end if;
  foreach k in array array['incomeCategoryId','expenseCategoryId'] loop
   direction:=case when k='incomeCategoryId' then 'income' else 'expense' end;cid:=(p->>k)::uuid;
   if not exists(select 1 from public.finance_categories where id=cid and account_id=a and archived_at is null and type::text=direction) then raise exception 'Проверьте статьи личного потребления';end if;
  end loop;
 end if;
end $$;
revoke all on function private.finance_validate_settlement(jsonb,uuid,uuid) from public,anon,authenticated,service_role;

create function public.finance_save_settlement_settings(p_venue uuid,p_version integer,p_config jsonb,p_auto_read boolean,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid:=private.finance_settlement_owner(p_venue);old public.finance_settlement_settings;rid uuid;actor text;begin
 if p_reason is null or length(trim(p_reason)) not between 1 and 1000 or p_auto_read is null or octet_length(p_config::text)>100000 then raise exception 'Укажите основание изменения';end if;
 perform pg_advisory_xact_lock(hashtextextended('finance-settlement-settings:'||p_venue,0));
 select * into old from public.finance_settlement_settings where account_id=a and venue_id=p_venue order by version desc limit 1;
 if old.config=p_config and old.auto_read=p_auto_read and old.reason=trim(p_reason) and old.created_by=auth.uid() then return old.id;end if;
 if p_version is distinct from coalesce(old.version,0) then raise exception 'Настройки изменились. Обновите страницу';end if;
 perform private.finance_validate_settlement(p_config,a,p_venue);
 select coalesce(nullif(trim(concat_ws(' ',first_name,last_name)),''),'Пользователь') into actor from public.profiles where id=auth.uid();
 insert into public.finance_settlement_settings(account_id,venue_id,version,config,auto_read,reason,created_by,actor_name) values(a,p_venue,coalesce(old.version,0)+1,p_config,p_auto_read,trim(p_reason),auth.uid(),coalesce(actor,'Пользователь')) returning id into rid;
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details) values(a,p_venue,auth.uid(),'finance.settlement.settings_saved','venue',p_venue,jsonb_build_object('version',coalesce(old.version,0)+1,'reason',trim(p_reason),'auto_read',p_auto_read));return rid;
end $$;
revoke all on function public.finance_save_settlement_settings(uuid,integer,jsonb,boolean,text) from public,anon,service_role;
grant execute on function public.finance_save_settlement_settings(uuid,integer,jsonb,boolean,text) to authenticated;

create function private.finance_enqueue_settlement(a uuid,v uuid,d date,u uuid) returns uuid language plpgsql set search_path='' as $$
declare source jsonb;j public.finance_settlement_jobs;begin
 select jsonb_build_object('timezone',timezone,'dayStartHour',day_start_hour) into source from public.sales_settings where account_id=a and venue_id=v;
 if source is null then raise exception 'Сначала настройте источники продаж';end if;
 select * into j from public.finance_settlement_jobs where venue_id=v and business_date=d for update;
 if found and j.state in ('pending','running') and j.request=source then return j.id;end if;
 insert into public.finance_settlement_jobs(account_id,venue_id,business_date,request,requested_by) values(a,v,d,source,u)
 on conflict(venue_id,business_date) do update set request=excluded.request,requested_by=excluded.requested_by,state='pending',phase='orders',cursor=0,payload='{"orders":[],"facts":[],"methods":[]}',lease=null,claimed_at=null,next_retry_at=now(),failures=0,last_error=null,updated_at=now(),completed_at=null,requested_at=now() returning * into j;
 return j.id;
end $$;
revoke all on function private.finance_enqueue_settlement(uuid,uuid,date,uuid) from public,anon,authenticated,service_role;
create function public.finance_request_settlement(p_venue uuid,p_date date) returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid:=private.finance_settlement_owner(p_venue);tz text;h integer;rid uuid;begin
 select timezone,day_start_hour into tz,h from public.sales_settings where account_id=a and venue_id=p_venue;
 if tz is null or p_date is null or p_date<'2000-01-01' or p_date>=((now() at time zone tz)-make_interval(hours=>h))::date then raise exception 'Выберите завершённый рабочий день';end if;
 perform pg_advisory_xact_lock(hashtextextended('finance-settlement-job:'||p_venue||':'||p_date,0));
 rid:=private.finance_enqueue_settlement(a,p_venue,p_date,auth.uid());
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details) select a,p_venue,auth.uid(),'finance.settlement.requested','venue',p_venue,jsonb_build_object('date',p_date,'job_id',rid) where not exists(select 1 from public.audit_logs where action_code='finance.settlement.requested' and details->>'job_id'=rid::text and created_at>=(select requested_at from public.finance_settlement_jobs where id=rid));
 return rid;
end $$;
revoke all on function public.finance_request_settlement(uuid,date) from public,anon,service_role;
grant execute on function public.finance_request_settlement(uuid,date) to authenticated;

create function public.finance_settlement_job_status(p_venue uuid,p_date date) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=private.finance_settlement_owner(p_venue);j public.finance_settlement_jobs;begin
 select * into j from public.finance_settlement_jobs where account_id=a and venue_id=p_venue and business_date=p_date;
 if not found then return null;end if;
 return jsonb_build_object('id',j.id,'state',j.state,'phase',j.phase,'pass',case when j.payload ? 'reference' then 2 else 1 end,'cursor',j.cursor,'total',jsonb_array_length(coalesce(j.payload->'orders','[]')),'error',j.last_error,'updatedAt',j.updated_at);
end $$;
revoke all on function public.finance_settlement_job_status(uuid,date) from public,anon,service_role;
grant execute on function public.finance_settlement_job_status(uuid,date) to authenticated;

create function public.finance_schedule_settlements() returns integer language plpgsql security definer set search_path='' as $$
declare s record;d date;n integer:=0;begin
 for s in select c.* from (select distinct on (venue_id) * from public.finance_settlement_settings order by venue_id,version desc) c join public.venues v on v.id=c.venue_id where c.auto_read and v.archived_at is null loop
  d:=((now() at time zone (s.config->>'timezone'))-make_interval(hours=>(s.config->>'dayStartHour')::integer))::date-1;
  if not exists(select 1 from public.finance_settlement_jobs where venue_id=s.venue_id and business_date=d and (state in ('pending','running') or updated_at>now()-interval '1 day')) then
   perform pg_advisory_xact_lock(hashtextextended('finance-settlement-job:'||s.venue_id||':'||d,0));
   perform private.finance_enqueue_settlement(s.account_id,s.venue_id,d,null);n:=n+1;
  end if;
 end loop;return n;
end $$;
revoke all on function public.finance_schedule_settlements() from public,anon,authenticated;
grant execute on function public.finance_schedule_settlements() to service_role;
create function public.finance_claim_settlement_job() returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.finance_settlement_jobs;begin
 select q.* into j from public.finance_settlement_jobs q where (q.state='pending' or (q.state='running' and q.claimed_at<now()-interval '2 minutes')) and q.next_retry_at<=now() and not exists(select 1 from public.sales_settings s where s.account_id=q.account_id and s.provider_retry_at>now()) order by q.updated_at,q.id for update of q skip locked limit 1;
 if not found then return null;end if;
 update public.finance_settlement_jobs set state='running',lease=gen_random_uuid(),claimed_at=now(),attempts=attempts+1 where id=j.id returning * into j;return to_jsonb(j);
end $$;
revoke all on function public.finance_claim_settlement_job() from public,anon,authenticated;
grant execute on function public.finance_claim_settlement_job() to service_role;

create function public.finance_save_settlement_slice(p_job uuid,p_lease uuid,p_phase text,p_cursor integer,p_payload jsonb) returns void language plpgsql security definer set search_path='' as $$
declare j public.finance_settlement_jobs;begin
 select * into j from public.finance_settlement_jobs where id=p_job and state='running' and lease=p_lease and claimed_at>now()-interval '2 minutes' for update;
 if not found then raise exception 'Чтение уже передано другому обработчику';end if;
 if p_phase not in ('orders','details','payments','verify','commit') or p_cursor<0 or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>10000000 then raise exception 'Некорректный результат чтения';end if;
 if not exists(select 1 from public.sales_settings s where s.account_id=j.account_id and s.venue_id=j.venue_id and jsonb_build_object('timezone',s.timezone,'dayStartHour',s.day_start_hour)=j.request) then raise exception 'Источники смен изменились. Запустите чтение заново';end if;
 update public.finance_settlement_jobs set phase=p_phase,cursor=p_cursor,payload=p_payload,state='pending',lease=null,claimed_at=null,failures=0,last_error=null,updated_at=now() where id=j.id;
end $$;
revoke all on function public.finance_save_settlement_slice(uuid,uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.finance_save_settlement_slice(uuid,uuid,text,integer,jsonb) to service_role;
create function public.finance_publish_settlement(p_job uuid,p_lease uuid,p_facts jsonb,p_methods jsonb,p_summary jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare j public.finance_settlement_jobs;old public.finance_settlement_days;rid uuid;h text;n integer;begin
 select * into j from public.finance_settlement_jobs where id=p_job and state='running' and lease=p_lease and phase='commit' and claimed_at>now()-interval '2 minutes' for update;
 if not found then raise exception 'Чтение больше не принадлежит обработчику';end if;
 if not exists(select 1 from public.venues where id=j.venue_id and account_id=j.account_id and archived_at is null) or not exists(select 1 from public.sales_settings s where s.account_id=j.account_id and s.venue_id=j.venue_id and jsonb_build_object('timezone',s.timezone,'dayStartHour',s.day_start_hour)=j.request) then raise exception 'Источники смен изменились';end if;
 if jsonb_typeof(p_facts) is distinct from 'array' or jsonb_array_length(p_facts)>10000 or jsonb_array_length(p_facts)<>jsonb_array_length(j.payload->'orders') or jsonb_typeof(p_methods) is distinct from 'array' or jsonb_typeof(p_summary) is distinct from 'object' or octet_length(p_facts::text)>10000000 then raise exception 'Не подтверждён полный набор чеков';end if;
 if j.payload->'reference' is distinct from p_facts or j.payload->'facts' is distinct from p_facts or j.payload->'methods' is distinct from p_methods or p_summary->'double_checked' is distinct from 'true'::jsonb then raise exception 'Двойная проверка не завершена';end if;
 h:=md5(jsonb_build_object('facts',p_facts,'methods',p_methods,'source',j.request,'provider',j.payload->'provider')::text);
 select * into old from public.finance_settlement_days where venue_id=j.venue_id and business_date=j.business_date for update;
 if old.source_hash=h then update public.finance_settlement_days set checked_at=now() where id=old.id;rid:=old.id;
 else
  n:=coalesce(old.version,0)+1;
  insert into public.finance_settlement_days(account_id,venue_id,business_date,facts,methods,summary,source_hash,version) values(j.account_id,j.venue_id,j.business_date,p_facts,p_methods,p_summary||jsonb_build_object('source',j.request,'provider',j.payload->'provider'),h,n)
  on conflict(venue_id,business_date) do update set facts=excluded.facts,methods=excluded.methods,summary=excluded.summary,source_hash=excluded.source_hash,version=excluded.version,captured_at=now(),checked_at=now() returning id into rid;
  insert into public.finance_settlement_history(day_id,version,facts,methods,summary,source_hash,actor_id) select rid,n,p_facts,p_methods,summary,h,j.requested_by from public.finance_settlement_days where id=rid;
  insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details) values(j.account_id,j.venue_id,j.requested_by,'finance.settlement.synced','venue',j.venue_id,jsonb_build_object('date',j.business_date,'version',n,'receipts',jsonb_array_length(p_facts)));
 end if;
 update public.finance_settlement_jobs set state='ready',lease=null,claimed_at=null,last_error=null,completed_at=now(),updated_at=now() where id=j.id;return rid;
end $$;
revoke all on function public.finance_publish_settlement(uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.finance_publish_settlement(uuid,uuid,jsonb,jsonb,jsonb) to service_role;
create function public.finance_fail_settlement(p_job uuid,p_lease uuid,p_message text,p_retry_seconds integer default null) returns void language plpgsql security definer set search_path='' as $$
declare j public.finance_settlement_jobs;n integer;delay integer;begin
 select * into j from public.finance_settlement_jobs where id=p_job and state='running' and lease=p_lease and claimed_at>now()-interval '2 minutes' for update;
 if not found then return;end if;
 n:=j.failures+case when p_retry_seconds is null then 1 else 0 end;delay:=case when p_retry_seconds is null then 30 else greatest(30,least(900,p_retry_seconds)) end;
 update public.finance_settlement_jobs set state=case when n>=3 then 'error' else 'pending' end,failures=n,lease=null,claimed_at=null,last_error=left(p_message,1000),next_retry_at=now()+make_interval(secs=>delay),updated_at=now() where id=j.id;
 if p_retry_seconds is not null then update public.sales_settings set provider_retry_at=greatest(coalesce(provider_retry_at,now()),now()+make_interval(secs=>delay)) where account_id=j.account_id;end if;
end $$;
revoke all on function public.finance_fail_settlement(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.finance_fail_settlement(uuid,uuid,text,integer) to service_role;

-- One statement sees one complete ledger snapshot, including cancelled native
-- source keys moved to a different accounting date. No paging races or truncation.
create function public.finance_settlement_transactions(p_venue uuid,p_date date) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=private.finance_settlement_owner(p_venue);tz text;r jsonb;begin
 if p_date is null then raise exception 'Выберите рабочий день';end if;
 select timezone into tz from public.sales_settings where account_id=a and venue_id=p_venue;
 if tz is null then raise exception 'Сначала настройте источники продаж';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') into r from (
  select id,venue_id as "venueId",case when source_external_id like 'qr:daily-settlement:%' then source_external_id else null end as "sourceKey",(date at time zone tz)::date as date,bank_account_id as "bankAccountId",category_id as "categoryId",type,amount,description,deleted_at is not null as deleted,false as planned
  from public.transactions where account_id=a and venue_id=p_venue and ((date at time zone tz)::date=p_date or source_external_id like 'qr:daily-settlement:'||p_venue||':'||p_date||':%') order by id limit 20001
 ) x;
 if jsonb_array_length(r)>20000 then raise exception 'Слишком много операций за день. Сверка остановлена без усечения';end if;
 return r;
end $$;
revoke all on function public.finance_settlement_transactions(uuid,date) from public,anon,service_role;
grant execute on function public.finance_settlement_transactions(uuid,date) to authenticated;

create policy finance_settlement_audit on public.audit_logs as restrictive for select to authenticated using(action_code not like 'finance.settlement.%' or (account_id=(select public.get_active_account_id()) and venue_id=(select public.get_active_venue_id()) and (select public.is_account_owner(public.get_active_account_id())) and (select public.has_permission('finance.view_transactions')) and (select public.has_permission('sales.view_shifts'))));
alter table private.sales_worker_rotation drop constraint sales_worker_rotation_lane_check;
alter table private.sales_worker_rotation add constraint sales_worker_rotation_lane_check check(lane between 0 and 4);
create or replace function public.sales_next_worker_lane() returns integer language sql security definer set search_path='' as $$
 insert into private.sales_worker_rotation as rotation(id,lane) values(true,0) on conflict(id) do update set lane=(rotation.lane+1)%5 returning lane;
$$;
revoke all on function public.sales_next_worker_lane() from public,anon,authenticated;
grant execute on function public.sales_next_worker_lane() to service_role;
commit;
