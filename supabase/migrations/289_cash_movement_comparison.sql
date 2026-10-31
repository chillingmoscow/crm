begin;
-- Comparison only: no writes to ledger, balances, payroll or external providers.
create table public.cash_movement_rules (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,version integer not null check(version>0),config jsonb not null,
 reason text not null check(length(trim(reason)) between 1 and 1000),created_by uuid references public.profiles(id) on delete set null,actor_name text not null,created_at timestamptz not null default now(),
 unique(venue_id,version),foreign key(account_id,venue_id) references public.venues(account_id,id) on delete cascade
);
create index cash_movement_rules_scope on public.cash_movement_rules(account_id,venue_id,version desc);
create index cash_movement_rules_actor on public.cash_movement_rules(created_by);
create table public.cash_movement_days (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,business_date date not null,items jsonb not null,request jsonb not null,source_hash text not null,
 version integer not null default 1,captured_at timestamptz not null default now(),checked_at timestamptz not null default now(),
 unique(venue_id,business_date),foreign key(account_id,venue_id) references public.venues(account_id,id) on delete cascade
);
create index cash_movement_days_scope on public.cash_movement_days(account_id,venue_id,business_date desc);
create table public.cash_movement_history (
 id uuid primary key default gen_random_uuid(),day_id uuid not null references public.cash_movement_days(id) on delete cascade,version integer not null,items jsonb not null,request jsonb not null,source_hash text not null,
 actor_id uuid references public.profiles(id) on delete set null,actor_name text not null,created_at timestamptz not null default now(),unique(day_id,version)
);
create index cash_movement_history_actor on public.cash_movement_history(actor_id);
create table private.cash_movement_jobs (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null unique,business_date date not null,request jsonb not null,
 state text not null default 'pending' check(state in ('pending','running','ready','error')),phase text not null default 'first' check(phase in ('first','verify')),candidate jsonb,provider text,outside jsonb not null default '[]',
 lease uuid,claimed_at timestamptz,next_retry_at timestamptz not null default now(),failures integer not null default 0,attempts integer not null default 0,last_error text,
 requested_by uuid references public.profiles(id) on delete set null,requested_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(account_id,venue_id) references public.venues(account_id,id) on delete cascade
);
create index cash_movement_jobs_scope on private.cash_movement_jobs(account_id,venue_id,business_date);
create index cash_movement_jobs_due on private.cash_movement_jobs(state,next_retry_at,updated_at,id);
create index cash_movement_jobs_actor on private.cash_movement_jobs(requested_by);
alter table public.cash_movement_rules enable row level security;
alter table public.cash_movement_days enable row level security;
alter table public.cash_movement_history enable row level security;
alter table private.cash_movement_jobs enable row level security;
revoke all on public.cash_movement_rules,public.cash_movement_days,public.cash_movement_history,private.cash_movement_jobs from public,anon,authenticated,service_role;
grant select on public.cash_movement_rules,public.cash_movement_days,public.cash_movement_history to authenticated,service_role;
create policy cash_movement_rules_read on public.cash_movement_rules for select to authenticated using(account_id=(select public.get_active_account_id()) and venue_id=(select public.get_active_venue_id()) and (select public.has_permission('finance.view_transactions')) and (select public.has_permission('sales.view_shifts')));
create policy cash_movement_days_read on public.cash_movement_days for select to authenticated using(account_id=(select public.get_active_account_id()) and venue_id=(select public.get_active_venue_id()) and (select public.has_permission('finance.view_transactions')) and (select public.has_permission('sales.view_shifts')));
create policy cash_movement_history_read on public.cash_movement_history for select to authenticated using(exists(select 1 from public.cash_movement_days d where d.id=day_id));

create function private.cash_movement_validate_config(a uuid,v uuid,c jsonb) returns void language plpgsql set search_path='' as $$
declare k text;s text;part text;x jsonb;ident uuid;begin
 if c is null or jsonb_typeof(c)<>'object' or not(c ?& array['cashAccountId','safeAccountId','operatingAccountId','incomeCategoryId','taxiCategoryId','tipsCategoryId','safePattern','taxiPattern','tipsPattern','lookbackDays','intervalMinutes','autoRead','overrides']) or c-array['cashAccountId','safeAccountId','operatingAccountId','incomeCategoryId','taxiCategoryId','tipsCategoryId','safePattern','taxiPattern','tipsPattern','lookbackDays','intervalMinutes','autoRead','overrides']<>'{}' then raise exception 'Проверьте параметры инкассаций';end if;
 foreach k in array array['cashAccountId','safeAccountId','operatingAccountId'] loop
  if jsonb_typeof(c->k) is distinct from 'string' then raise exception 'Выберите счета';end if;ident:=(c->>k)::uuid;
  if not exists(select 1 from public.bank_accounts b where b.id=ident and b.account_id=a and (b.venue_id is null or b.venue_id=v) and b.is_active and b.currency='RUB' and b.deleted_at is null) then raise exception 'Счёт недоступен в заведении';end if;
 end loop;
 if (select count(distinct (c->>q)::uuid) from unnest(array['cashAccountId','safeAccountId','operatingAccountId'])q)<>3 then raise exception 'Касса, сейф и операционный счёт должны отличаться';end if;
 foreach k in array array['incomeCategoryId','taxiCategoryId','tipsCategoryId'] loop
  if jsonb_typeof(c->k) is distinct from 'string' then raise exception 'Выберите статьи';end if;
  if not exists(select 1 from public.finance_categories f where f.id=(c->>k)::uuid and f.account_id=a and f.type::text=case when k='incomeCategoryId' then 'income' else 'expense' end and f.archived_at is null) then raise exception 'Статья недоступна или не соответствует виду операции';end if;
 end loop;
 foreach k in array array['safePattern','taxiPattern','tipsPattern'] loop
  s:=c->>k;
  if jsonb_typeof(c->k) is distinct from 'string' or length(s) not between 1 and 200 or translate(regexp_replace(s,'[[:alnum:][:space:]]','','g'),'_-[]|.*','')<>'' or replace(s,'.*','') ~ '[.*]' then raise exception 'Проверьте правило распознавания комментария';end if;
  foreach part in array string_to_array(s,'|') loop if part='' or (length(part)-length(replace(part,'.*','')))/2>1 then raise exception 'Проверьте правило распознавания комментария';end if;end loop;
  perform '' ~* s;
 end loop;
 if jsonb_typeof(c->'autoRead') is distinct from 'boolean' or jsonb_typeof(c->'lookbackDays') is distinct from 'number' or (c->>'lookbackDays')::numeric not between 1 and 90 or (c->>'lookbackDays')::numeric<>trunc((c->>'lookbackDays')::numeric) or jsonb_typeof(c->'intervalMinutes') is distinct from 'number' or (c->>'intervalMinutes')::numeric not between 15 and 1440 or (c->>'intervalMinutes')::numeric<>trunc((c->>'intervalMinutes')::numeric) then raise exception 'Проверьте период и интервал чтения';end if;
 if jsonb_typeof(c->'overrides') is distinct from 'array' or jsonb_array_length(c->'overrides')>1000 or (select count(*)<>count(distinct (q->>'sourceId')::numeric) from jsonb_array_elements(c->'overrides')q) then raise exception 'Повторные или некорректные исключения';end if;
 for x in select value from jsonb_array_elements(c->'overrides') loop
  if jsonb_typeof(x)<>'object' or not(x ?& array['sourceId','date','amountCents','comment','route','reason']) or x-array['sourceId','date','amountCents','comment','route','reason']<>'{}' or jsonb_typeof(x->'sourceId') is distinct from 'number' or (x->>'sourceId')!~'^[1-9][0-9]*$' or (x->>'sourceId')::numeric>9007199254740991 or jsonb_typeof(x->'amountCents') is distinct from 'number' or (x->>'amountCents')::numeric not between 1 and 100000000000 or (x->>'amountCents')::numeric<>trunc((x->>'amountCents')::numeric) or jsonb_typeof(x->'date') is distinct from 'string' or (x->>'date')::date::text<>x->>'date' or jsonb_typeof(x->'comment') is distinct from 'string' or length(x->>'comment')>2000 or coalesce(x->>'route','') not in ('safe','operating','hold') or jsonb_typeof(x->'reason') is distinct from 'string' or length(trim(x->>'reason')) not between 1 and 1000 then raise exception 'Проверьте снимок и основание исключения';end if;
 end loop;
end $$;
revoke all on function private.cash_movement_validate_config(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.cash_movement_save_rules(p_venue uuid,p_version integer,p_config jsonb,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid:=private.finance_settlement_owner(p_venue);old public.cash_movement_rules;rid uuid;actor text;begin
 if p_reason is null or length(trim(p_reason)) not between 1 and 1000 then raise exception 'Укажите основание изменения';end if;
 perform private.cash_movement_validate_config(a,p_venue,p_config);perform pg_advisory_xact_lock(hashtextextended('cash-movement-rules:'||p_venue,0));
 select * into old from public.cash_movement_rules where venue_id=p_venue order by version desc limit 1;
 if old.config=p_config and old.reason=trim(p_reason) and old.created_by=auth.uid() then return old.id;end if;
 if p_version is distinct from coalesce(old.version,0) then raise exception 'Правила изменились. Обновите страницу';end if;
 select coalesce(nullif(trim(concat_ws(' ',first_name,last_name)),''),'Пользователь') into actor from public.profiles where id=auth.uid();
 insert into public.cash_movement_rules(account_id,venue_id,version,config,reason,created_by,actor_name) values(a,p_venue,coalesce(old.version,0)+1,p_config,trim(p_reason),auth.uid(),coalesce(actor,'Пользователь')) returning id into rid;
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details) values(a,p_venue,auth.uid(),'cash.movement.rules_saved','venue',p_venue,jsonb_build_object('version',coalesce(old.version,0)+1,'reason',trim(p_reason),'config',p_config));return rid;
end $$;
revoke all on function public.cash_movement_save_rules(uuid,integer,jsonb,text) from public,anon,service_role;
grant execute on function public.cash_movement_save_rules(uuid,integer,jsonb,text) to authenticated;
create function private.cash_movement_enqueue(a uuid,v uuid,d date,u uuid) returns uuid language plpgsql set search_path='' as $$
declare source jsonb;j private.cash_movement_jobs;tz text;h integer;days integer;begin
 select timezone,day_start_hour into tz,h from public.sales_settings where account_id=a and venue_id=v;
 if tz is null then raise exception 'Сначала настройте источники продаж';end if;
 select (config->>'lookbackDays')::integer into days from public.cash_movement_rules where venue_id=v order by version desc limit 1;days:=coalesce(days,30);
 source:=jsonb_build_object('timezone',tz,'dayStartHour',h,'from',d-days,'through',d,'since',(d-days)::text||'T00:00:00.000Z','till',((now() at time zone tz)::date+1)::text||'T00:00:00.000Z');
 select * into j from private.cash_movement_jobs where venue_id=v for update;
 if found and j.state in ('pending','running') then
  if j.request=source then return j.id;end if;raise exception 'Сверка другого периода уже идёт. Дождитесь её завершения';
 end if;
 insert into private.cash_movement_jobs(account_id,venue_id,business_date,request,requested_by) values(a,v,d,source,u)
 on conflict(venue_id) do update set business_date=excluded.business_date,request=excluded.request,requested_by=excluded.requested_by,state='pending',phase='first',candidate=null,provider=null,lease=null,claimed_at=null,next_retry_at=now(),failures=0,last_error=null,requested_at=now(),updated_at=now() returning id into j.id;return j.id;
end $$;
revoke all on function private.cash_movement_enqueue(uuid,uuid,date,uuid) from public,anon,authenticated,service_role;
create function public.cash_movement_request(p_venue uuid,p_date date) returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid:=private.finance_settlement_owner(p_venue);tz text;rid uuid;begin
 select timezone into tz from public.sales_settings where account_id=a and venue_id=p_venue;
 if tz is null or p_date is null or p_date<'2000-01-01' or p_date>=(now() at time zone tz)::date then raise exception 'Выберите завершённый кассовый день';end if;
 perform pg_advisory_xact_lock(hashtextextended('cash-movement-job:'||p_venue,0));rid:=private.cash_movement_enqueue(a,p_venue,p_date,auth.uid());
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details) select a,p_venue,auth.uid(),'cash.movement.requested','venue',p_venue,jsonb_build_object('date',p_date,'job_id',rid) where not exists(select 1 from public.audit_logs where action_code='cash.movement.requested' and details->>'job_id'=rid::text and created_at>=(select requested_at from private.cash_movement_jobs where id=rid));return rid;
end $$;
revoke all on function public.cash_movement_request(uuid,date) from public,anon,service_role;
grant execute on function public.cash_movement_request(uuid,date) to authenticated;
create function public.cash_movement_job_status(p_venue uuid,p_date date) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=private.cash_control_viewer(p_venue);j private.cash_movement_jobs;begin
 select * into j from private.cash_movement_jobs where account_id=a and venue_id=p_venue and p_date between (request->>'from')::date and business_date;
 if not found then return null;end if;return jsonb_build_object('state',j.state,'phase',j.phase,'error',j.last_error,'updatedAt',j.updated_at,'outside',coalesce((select jsonb_agg(jsonb_build_object('id',e->'id','date',e->>'date')) from jsonb_array_elements(j.outside)e),'[]'));
end $$;
revoke all on function public.cash_movement_job_status(uuid,date) from public,anon,service_role;
grant execute on function public.cash_movement_job_status(uuid,date) to authenticated;
create function public.cash_movement_schedule() returns integer language plpgsql security definer set search_path='' as $$
declare r record;n integer:=0;d date;begin
 for r in select c.*,s.timezone from (select distinct on (venue_id) * from public.cash_movement_rules order by venue_id,version desc)c join public.sales_settings s on s.account_id=c.account_id and s.venue_id=c.venue_id join public.venues v on v.id=c.venue_id where (c.config->>'autoRead')::boolean and v.archived_at is null loop
  d:=(now() at time zone r.timezone)::date-1;perform pg_advisory_xact_lock(hashtextextended('cash-movement-job:'||r.venue_id,0));
  if not exists(select 1 from private.cash_movement_jobs where venue_id=r.venue_id and (state in ('pending','running') or updated_at>now()-make_interval(mins=>(r.config->>'intervalMinutes')::integer))) then perform private.cash_movement_enqueue(r.account_id,r.venue_id,d,null);n:=n+1;end if;
 end loop;return n;
end $$;
revoke all on function public.cash_movement_schedule() from public,anon,authenticated;
grant execute on function public.cash_movement_schedule() to service_role;
create function public.cash_movement_claim() returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.cash_movement_jobs;begin
 select q.* into j from private.cash_movement_jobs q where (q.state='pending' or (q.state='running' and q.claimed_at<now()-interval '2 minutes')) and q.next_retry_at<=now() and not exists(select 1 from public.sales_settings s where s.account_id=q.account_id and s.provider_retry_at>now()) order by q.updated_at,q.id for update of q skip locked limit 1;
 if not found then return null;end if;update private.cash_movement_jobs set state='running',lease=gen_random_uuid(),claimed_at=now(),attempts=attempts+1 where id=j.id returning * into j;return to_jsonb(j);
end $$;
revoke all on function public.cash_movement_claim() from public,anon,authenticated;
grant execute on function public.cash_movement_claim() to service_role;
create function public.cash_movement_save_read(p_job uuid,p_lease uuid,p_items jsonb,p_provider text) returns integer language plpgsql security definer set search_path='' as $$
declare j private.cash_movement_jobs;old public.cash_movement_days;rid uuid;h text;n integer;count_days integer:=0;actor text;d date;x jsonb;k text;day_items jsonb;outside_items jsonb;begin
 select * into j from private.cash_movement_jobs where id=p_job and state='running' and lease=p_lease and claimed_at>now()-interval '2 minutes' for update;
 if not found then raise exception 'Чтение передано другому обработчику';end if;
 if p_provider is null or p_provider!~'^[a-f0-9]{64}$' or (j.provider is not null and j.provider<>p_provider) then raise exception 'Подключение изменилось. Запустите чтение заново';end if;
 if not exists(select 1 from public.sales_settings s join public.venues v on v.id=s.venue_id where s.account_id=j.account_id and s.venue_id=j.venue_id and v.archived_at is null and s.timezone=j.request->>'timezone' and s.day_start_hour=(j.request->>'dayStartHour')::integer) then raise exception 'Источники продаж изменились';end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>10000 or octet_length(p_items::text)>10000000 or (select count(*)<>count(distinct entry->>'id') from jsonb_array_elements(p_items)entry) then raise exception 'Не подтверждён полный список кассовых операций';end if;
 for x in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(x)<>'object' or not(x ?& array['id','date','amountCents','type','shiftId','openedAt','occurredAt','arrivedAt','comment']) or x-array['id','date','amountCents','type','shiftId','openedAt','occurredAt','arrivedAt','comment']<>'{}' or jsonb_typeof(x->'id') is distinct from 'number' or (x->>'id')!~'^[1-9][0-9]*$' or (x->>'id')::numeric>9007199254740991 or jsonb_typeof(x->'shiftId') is distinct from 'number' or (x->>'shiftId')!~'^[1-9][0-9]*$' or (x->>'shiftId')::numeric>9007199254740991 or coalesce(x->>'type','') not in ('cashIn','cashOut') or jsonb_typeof(x->'amountCents') is distinct from 'number' or (x->>'amountCents')::numeric not between 1 and 100000000000 or (x->>'amountCents')::numeric<>trunc((x->>'amountCents')::numeric) or jsonb_typeof(x->'comment') is distinct from 'string' or length(x->>'comment')>2000 then raise exception 'Некорректная кассовая операция';end if;
  foreach k in array array['openedAt','occurredAt','arrivedAt'] loop if jsonb_typeof(x->k) is distinct from 'string' or (x->>k)!~'(Z|[+-][0-9]{2}:[0-9]{2})$' or not isfinite((x->>k)::timestamptz) then raise exception 'Не подтверждено время кассовой операции';end if;end loop;
  if jsonb_typeof(x->'date') is distinct from 'string' or (x->>'date')::date::text<>x->>'date' or (x->>'date')::date not between '2000-01-01'::date and j.business_date or ((x->>'openedAt')::timestamptz at time zone (j.request->>'timezone'))::date<>(x->>'date')::date or not isfinite((x->>'occurredAt')::timestamptz) or not isfinite((x->>'arrivedAt')::timestamptz) then raise exception 'Не совпадает дата кассовой смены';end if;
 end loop;
 if j.phase='first' then update private.cash_movement_jobs set candidate=p_items,provider=p_provider,phase='verify',state='pending',lease=null,claimed_at=null,last_error=null,updated_at=now() where id=j.id;return null;end if;
 if j.candidate is distinct from p_items then raise exception 'Кассовые операции изменились во время чтения';end if;
 if not exists(select 1 from jsonb_array_elements(p_items)e where (e->>'date')::date>=(j.request->>'from')::date) and exists(select 1 from public.cash_movement_days cd where cd.venue_id=j.venue_id and cd.business_date between (j.request->>'from')::date and j.business_date and cd.items<>'[]'::jsonb) then raise exception 'Источник вернул пустой список вместо прежних операций. Требуется проверка';end if;
 actor:=coalesce((select nullif(trim(concat_ws(' ',first_name,last_name)),'') from public.profiles where id=j.requested_by),case when j.requested_by is null then 'Система' else 'Пользователь' end);
 for d in select generate_series((j.request->>'from')::date,j.business_date,interval '1 day')::date loop
  select coalesce(jsonb_agg(e order by (e->>'id')::bigint),'[]') into day_items from jsonb_array_elements(p_items)e where e->>'date'=d::text;
  h:=md5(jsonb_build_object('items',day_items,'timezone',j.request->>'timezone','provider',p_provider)::text);
  select * into old from public.cash_movement_days where venue_id=j.venue_id and business_date=d for update;
  if old.source_hash=h then update public.cash_movement_days set checked_at=now() where id=old.id;
  else
   n:=coalesce(old.version,0)+1;insert into public.cash_movement_days(account_id,venue_id,business_date,items,request,source_hash,version) values(j.account_id,j.venue_id,d,day_items,j.request,h,n)
   on conflict(venue_id,business_date) do update set items=excluded.items,request=excluded.request,source_hash=excluded.source_hash,version=excluded.version,captured_at=now(),checked_at=now() returning id into rid;
   insert into public.cash_movement_history(day_id,version,items,request,source_hash,actor_id,actor_name) values(rid,n,day_items,j.request,h,j.requested_by,actor);count_days:=count_days+1;
  end if;
 end loop;
 select coalesce(jsonb_agg(e order by (e->>'id')::bigint),'[]') into outside_items from jsonb_array_elements(p_items)e where (e->>'date')::date<(j.request->>'from')::date;
 if count_days>0 or outside_items is distinct from j.outside then insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details) values(j.account_id,j.venue_id,j.requested_by,'cash.movement.synced','venue',j.venue_id,jsonb_build_object('from',j.request->>'from','through',j.business_date,'days',count_days,'operations',jsonb_array_length(p_items),'outside',coalesce((select jsonb_agg(jsonb_build_object('id',e->'id','date',e->>'date')) from jsonb_array_elements(outside_items)e),'[]')));end if;
 update private.cash_movement_jobs set state='ready',outside=outside_items,candidate=null,lease=null,claimed_at=null,last_error=null,failures=0,updated_at=now() where id=j.id;return count_days;
end $$;
revoke all on function public.cash_movement_save_read(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.cash_movement_save_read(uuid,uuid,jsonb,text) to service_role;
create function public.cash_movement_fail(p_job uuid,p_lease uuid,p_message text,p_retry_seconds integer default null) returns void language plpgsql security definer set search_path='' as $$
declare j private.cash_movement_jobs;secs integer:=greatest(30,least(coalesce(p_retry_seconds,60),900));begin
 select * into j from private.cash_movement_jobs where id=p_job and lease=p_lease and state='running' and claimed_at>now()-interval '2 minutes' for update;if not found then return;end if;
 if p_retry_seconds is not null then update public.sales_settings set provider_retry_at=greatest(coalesce(provider_retry_at,now()),now()+make_interval(secs=>secs)) where account_id=j.account_id;end if;
 update private.cash_movement_jobs set state=case when p_retry_seconds is null and failures+1>=3 then 'error' else 'pending' end,failures=failures+case when p_retry_seconds is null then 1 else 0 end,phase=case when p_retry_seconds is null then 'first' else phase end,candidate=case when p_retry_seconds is null then null else candidate end,provider=case when p_retry_seconds is null then null else provider end,lease=null,claimed_at=null,last_error=left(coalesce(p_message,'Не удалось прочитать кассовые операции'),1000),next_retry_at=now()+make_interval(secs=>secs),updated_at=now() where id=j.id;
end $$;
revoke all on function public.cash_movement_fail(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.cash_movement_fail(uuid,uuid,text,integer) to service_role;
create function public.cash_movement_transactions(p_venue uuid,p_date date) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=private.cash_control_viewer(p_venue);tz text;rows jsonb;begin
 select timezone into tz from public.sales_settings where account_id=a and venue_id=p_venue;
 select coalesce(jsonb_agg(to_jsonb(q)),'[]') into rows from (
  select t.id,t.venue_id as "venueId",t.source_external_id as "sourceKey",
   (select coalesce(jsonb_agg(ident),'[]') from (
    select c.external_id ident from public.payroll_payments pp join public.payroll_cashbox c on c.id=pp.cashbox_id and c.account_id=pp.account_id where pp.transaction_id=t.id and pp.account_id=a and c.venue_id=p_venue
    union select case when t.source_external_id like 'quickresto:encashment:'||p_venue||':%' and split_part(t.source_external_id,':',4)~'^[1-9][0-9]{0,15}$' then split_part(t.source_external_id,':',4)::bigint end
   )linked where ident is not null) as "sourceIds",(t.date at time zone tz)::date as date,t.type,t.bank_account_id as "bankAccountId",t.to_bank_account_id as "toBankAccountId",t.category_id as "categoryId",(t.amount*100)::bigint as "amountCents",coalesce(t.description,'') as description,t.deleted_at is not null as deleted,false as planned
  from public.transactions t where t.account_id=a and t.venue_id=p_venue and ((t.date at time zone tz)::date=p_date or t.source_external_id like 'qr:cash-movement:'||p_venue||':%' or t.source_external_id like 'quickresto:encashment:'||p_venue||':%' or exists(select 1 from public.payroll_payments pp join public.payroll_cashbox c on c.id=pp.cashbox_id and c.account_id=pp.account_id where pp.transaction_id=t.id and pp.account_id=a and c.venue_id=p_venue and c.business_date=p_date) or exists(select 1 from public.cash_movement_days d,jsonb_array_elements(d.items)i where d.venue_id=p_venue and d.business_date=p_date and position('#'||(i->>'id') in coalesce(t.description,''))>0)) order by t.id limit 20001
 )q;
 if jsonb_array_length(rows)>20000 then raise exception 'Не удалось полностью прочитать журнал операций';end if;return rows;
end $$;
revoke all on function public.cash_movement_transactions(uuid,date) from public,anon,service_role;
grant execute on function public.cash_movement_transactions(uuid,date) to authenticated;
create policy cash_movement_audit on public.audit_logs as restrictive for select to authenticated using(action_code not like 'cash.movement.%' or (account_id=(select public.get_active_account_id()) and venue_id=(select public.get_active_venue_id()) and (select public.has_permission('finance.view_transactions')) and (select public.has_permission('sales.view_shifts'))));
alter table private.sales_worker_rotation drop constraint sales_worker_rotation_lane_check;
alter table private.sales_worker_rotation add constraint sales_worker_rotation_lane_check check(lane between 0 and 6);
create or replace function public.sales_next_worker_lane() returns integer language sql security definer set search_path='' as $$
 insert into private.sales_worker_rotation as rotation(id,lane) values(true,0) on conflict(id) do update set lane=(rotation.lane+1)%7 returning lane;
$$;
revoke all on function public.sales_next_worker_lane() from public,anon,authenticated;
grant execute on function public.sales_next_worker_lane() to service_role;
commit;
