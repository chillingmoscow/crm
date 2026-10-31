begin;
-- A source mirror and a resumable reader; no money, payroll or provider mutations.
create table public.stock_writeoff_sources(
 account_id uuid not null,venue_id uuid primary key,enabled boolean not null default true,config jsonb not null,origin jsonb not null default '{}',version integer not null default 1 check(version>0),next_sync_at timestamptz not null default now(),created_at timestamptz not null default now(),
 foreign key(account_id,venue_id) references public.venues(account_id,id)
);
create table public.stock_writeoff_documents(
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,external_id bigint not null check(external_id>0),business_date date not null,
 payload jsonb not null check(jsonb_typeof(payload)='object'),source_hash text not null,version integer not null default 1,missing_at timestamptz,captured_at timestamptz not null default now(),last_seen_at timestamptz not null default now(),
 unique(account_id,venue_id,id),unique(venue_id,external_id),foreign key(account_id,venue_id) references public.venues(account_id,id)
);
create index stock_writeoff_documents_scope on public.stock_writeoff_documents(account_id,venue_id,business_date desc,id);
create table public.stock_writeoff_history(
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,document_id uuid not null,action text not null check(action in ('imported','updated','source_removed','source_restored')),before_payload jsonb,after_payload jsonb,actor_id uuid references public.profiles(id),created_at timestamptz not null default now(),
 foreign key(account_id,venue_id,document_id) references public.stock_writeoff_documents(account_id,venue_id,id)
);
create index stock_writeoff_history_scope on public.stock_writeoff_history(account_id,venue_id,document_id,created_at,id);
create index stock_writeoff_history_actor on public.stock_writeoff_history(actor_id);
create table public.stock_writeoff_jobs(
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,month date not null check(extract(day from month)=1),request jsonb not null,state text not null default 'pending' check(state in ('pending','running','ready','error')),
 source_ids jsonb,staged jsonb not null default '[]',cursor integer not null default 0,lease uuid,claimed_at timestamptz,next_retry_at timestamptz not null default now(),attempts integer not null default 0,last_error text,requested_by uuid references public.profiles(id),completed_at timestamptz,updated_at timestamptz not null default now(),
 unique(venue_id,month),foreign key(account_id,venue_id) references public.venues(account_id,id)
);
create index stock_writeoff_jobs_due on public.stock_writeoff_jobs(state,next_retry_at,updated_at,id);
create index stock_writeoff_jobs_actor on public.stock_writeoff_jobs(requested_by);
create table public.stock_writeoff_archive(
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,business_date date not null,legacy_ref text not null,name text not null,quantity text,total numeric,correspondent text not null,kind text not null,document_number text,document_url text,category text,deleted boolean not null default false,delete_reason text,period_total_raw numeric,issues jsonb not null default '[]',origin jsonb not null,source_hash text not null,captured_at timestamptz not null,imported_at timestamptz not null default now(),imported_by uuid not null references public.profiles(id),
 unique(venue_id,legacy_ref,captured_at),foreign key(account_id,venue_id) references public.venues(account_id,id)
);
create index stock_writeoff_archive_scope on public.stock_writeoff_archive(account_id,venue_id,business_date desc,captured_at desc,id);
create index stock_writeoff_archive_actor on public.stock_writeoff_archive(imported_by);
create function private.stock_validate_source() returns trigger language plpgsql set search_path=public,pg_catalog as $$
declare cfg jsonb:=new.config;k text;begin
 if cfg is null or jsonb_typeof(cfg)<>'object' or not (cfg ?& array['storeIds','timezone','personalOperatorIds','teamReasons','masterReasons']) or (cfg-array['storeIds','timezone','personalOperatorIds','teamReasons','masterReasons','personalFinance'])<>'{}'::jsonb or not exists(select 1 from pg_timezone_names where name=cfg->>'timezone') then raise exception 'Проверьте источник списаний';end if;
 foreach k in array array['storeIds','personalOperatorIds'] loop
  if jsonb_typeof(cfg->k)<>'array' or jsonb_array_length(cfg->k)>50 or (k='storeIds' and jsonb_array_length(cfg->k)=0) or (select count(*)<>count(distinct v) from jsonb_array_elements(cfg->k) v) or exists(select 1 from jsonb_array_elements(cfg->k) v where jsonb_typeof(v)<>'number' or v::text!~'^[1-9][0-9]*$') then raise exception 'Проверьте склады и сотрудников личного потребления';end if;
 end loop;
 foreach k in array array['teamReasons','masterReasons'] loop
  if jsonb_typeof(cfg->k)<>'array' or jsonb_array_length(cfg->k)>100 or exists(select 1 from jsonb_array_elements(cfg->k) v where jsonb_typeof(v)<>'string' or length(trim(v#>>'{}')) not between 1 and 200) or (select count(*)<>count(distinct lower(trim(v))) from jsonb_array_elements_text(cfg->k) v) then raise exception 'Проверьте причины списаний';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements_text(cfg->'teamReasons') a join jsonb_array_elements_text(cfg->'masterReasons') b on lower(trim(a))=lower(trim(b))) then raise exception 'Причина указана в двух группах';end if;
 if cfg ? 'personalFinance' and (jsonb_typeof(cfg->'personalFinance')<>'object' or not ((cfg->'personalFinance') ?& array['legacyBankId','incomeCategoryId','expenseCategoryId']) or ((cfg->'personalFinance')-array['legacyBankId','incomeCategoryId','expenseCategoryId'])<>'{}'::jsonb or exists(select 1 from jsonb_each(cfg->'personalFinance') e where jsonb_typeof(e.value)<>'number' or e.value::text!~'^[1-9][0-9]*$')) then raise exception 'Проверьте финансовое отражение личного потребления';end if;
 perform pg_advisory_xact_lock(hashtextextended('stock-source:'||new.account_id,0));
 if new.enabled and exists(select 1 from public.stock_writeoff_sources s where s.account_id=new.account_id and s.venue_id<>new.venue_id and s.enabled and exists(select 1 from jsonb_array_elements(s.config->'storeIds') a join jsonb_array_elements(cfg->'storeIds') b on a=b)) then raise exception 'Склад уже привязан к другому заведению';end if;
 if tg_op='UPDATE' and new.config is distinct from old.config then new.version:=old.version+1;end if;
 return new;
end $$;
revoke all on function private.stock_validate_source() from public,anon,authenticated;
create trigger stock_writeoff_source_guard before insert or update on public.stock_writeoff_sources for each row execute function private.stock_validate_source();
do $$ declare t text;begin
 foreach t in array array['stock_writeoff_sources','stock_writeoff_documents','stock_writeoff_history','stock_writeoff_jobs','stock_writeoff_archive'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  if t<>'stock_writeoff_jobs' then
   execute format('grant select on public.%I to authenticated',t);
   execute format('create policy stock_writeoff_read on public.%I for select to authenticated using(account_id=(select public.get_active_account_id()) and venue_id=(select public.get_active_venue_id()) and (select public.has_permission(''inventory.view_results'')))',t);
  end if;
 end loop;
end $$;
grant select,insert,update on public.stock_writeoff_sources,public.stock_writeoff_documents,public.stock_writeoff_jobs to service_role;
grant select,insert on public.stock_writeoff_history,public.stock_writeoff_archive to service_role;

create function private.stock_enqueue_writeoffs(p_venue uuid,p_month date,p_force boolean,p_actor uuid) returns boolean language plpgsql security definer set search_path=public,pg_catalog as $$
declare s public.stock_writeoff_sources;j public.stock_writeoff_jobs;req jsonb;
begin
 select * into s from public.stock_writeoff_sources where venue_id=p_venue and enabled;
 if not found then return false;end if;
 if p_month<>date_trunc('month',p_month)::date or extract(year from p_month) not between 2000 and 2100 or p_month>date_trunc('month',now() at time zone (s.config->>'timezone'))::date then raise exception 'Проверьте месяц списаний';end if;
 req:=jsonb_build_object('version',s.version,'config',s.config);
 select * into j from public.stock_writeoff_jobs where venue_id=p_venue and month=p_month for update;
 if found and j.request=req and (j.state in ('pending','running') or (not p_force and j.state='ready')) then return false;end if;
 insert into public.stock_writeoff_jobs(account_id,venue_id,month,request,requested_by) values(s.account_id,p_venue,p_month,req,p_actor)
 on conflict(venue_id,month) do update set request=excluded.request,requested_by=excluded.requested_by,state='pending',source_ids=null,staged='[]',cursor=0,lease=null,claimed_at=null,next_retry_at=now(),attempts=0,last_error=null,completed_at=null,updated_at=now();return true;
end $$;
revoke all on function private.stock_enqueue_writeoffs(uuid,date,boolean,uuid) from public,anon,authenticated;

create function public.stock_request_writeoff_month(p_expected_venue uuid,p_month date) returns boolean language plpgsql security definer set search_path=public,pg_catalog as $$
declare v uuid:=public.get_active_venue_id();a uuid:=public.get_active_account_id();done boolean;begin
 if auth.uid() is null or a is null or not public.has_permission('inventory.view_results') or not public.has_permission('inventory.sync_quickresto') then raise exception 'Нет доступа к обновлению списаний';end if;
 if v is distinct from p_expected_venue then raise exception 'Заведение изменилось. Обновите страницу';end if;
 if not exists(select 1 from public.stock_writeoff_sources where account_id=a and venue_id=v and enabled) then raise exception 'Источник списаний не настроен';end if;
 done:=private.stock_enqueue_writeoffs(v,p_month,true,auth.uid());
 if done then insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details) values(a,v,auth.uid(),'stock.writeoffs.refresh_requested','stock_writeoff_source',v,jsonb_build_object('month',p_month));end if;return done;
end $$;
revoke all on function public.stock_request_writeoff_month(uuid,date) from public,anon;
grant execute on function public.stock_request_writeoff_month(uuid,date) to authenticated;

create function public.stock_schedule_writeoffs() returns integer language plpgsql security definer set search_path=public,pg_catalog as $$
declare s public.stock_writeoff_sources;local_day date;n integer:=0;begin
 for s in select z.* from public.stock_writeoff_sources z join public.venues v on v.id=z.venue_id and v.account_id=z.account_id where z.enabled and z.next_sync_at<=now() and v.archived_at is null for update of z skip locked loop
  local_day:=(now() at time zone (s.config->>'timezone'))::date;
  if private.stock_enqueue_writeoffs(s.venue_id,date_trunc('month',local_day)::date,true,null) then n:=n+1;end if;
  if extract(day from local_day)<=3 and private.stock_enqueue_writeoffs(s.venue_id,(date_trunc('month',local_day)-interval '1 month')::date,true,null) then n:=n+1;end if;
  update public.stock_writeoff_sources set next_sync_at=((local_day+1)::timestamp+interval '9 hours') at time zone (s.config->>'timezone') where venue_id=s.venue_id;
 end loop;return n;
end $$;
revoke all on function public.stock_schedule_writeoffs() from public,anon,authenticated;
grant execute on function public.stock_schedule_writeoffs() to service_role;

create function public.stock_claim_writeoff_job(p_venue uuid default null) returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare j public.stock_writeoff_jobs;s public.stock_writeoff_sources;begin
 select x.* into j from public.stock_writeoff_jobs x join public.stock_writeoff_sources src on src.venue_id=x.venue_id and src.account_id=x.account_id join public.venues v on v.id=src.venue_id and v.archived_at is null
 where src.enabled and (p_venue is null or x.venue_id=p_venue) and ((x.state in ('pending','error') and x.next_retry_at<=now()) or (x.state='running' and x.claimed_at<now()-interval '2 minutes')) order by x.updated_at,x.id for update of x skip locked limit 1;
 if not found then return null;end if;
 select * into s from public.stock_writeoff_sources where venue_id=j.venue_id;
 if j.request is distinct from jsonb_build_object('version',s.version,'config',s.config) then
  update public.stock_writeoff_jobs set request=jsonb_build_object('version',s.version,'config',s.config),source_ids=null,staged='[]',cursor=0,attempts=0 where id=j.id;
 end if;
 update public.stock_writeoff_jobs set state='running',lease=gen_random_uuid(),claimed_at=now(),updated_at=now() where id=j.id returning * into j;
 return jsonb_build_object('id',j.id,'account_id',j.account_id,'venue_id',j.venue_id,'month',j.month,'request',j.request,'source_ids',j.source_ids,'cursor',j.cursor,'lease',j.lease);
end $$;
revoke all on function public.stock_claim_writeoff_job(uuid) from public,anon,authenticated;
grant execute on function public.stock_claim_writeoff_job(uuid) to service_role;

create function private.stock_validate_writeoff_payload(d jsonb,config jsonb,month date) returns void language plpgsql set search_path=public,pg_catalog as $$
declare line jsonb;k text;begin
 if d is null or jsonb_typeof(d) is distinct from 'object' or not (d ?& array['id','number','date','invoiceAt','processed','storeId','storeName','reasonId','reason','customerType','operatorId','operatorName','kind','total','legacyTotal','lines','issues','providerUpdatedAt']) or (d-array['id','number','date','invoiceAt','processed','storeId','storeName','reasonId','reason','customerType','operatorId','operatorName','kind','total','legacyTotal','lines','issues','providerUpdatedAt'])<>'{}'::jsonb then raise exception 'Некорректные данные списания';end if;
 foreach k in array array['id','storeId'] loop
  if jsonb_typeof(d->k) is distinct from 'number' or (d->>k)!~'^[1-9][0-9]*$' or (d->>k)::numeric>9007199254740991 then raise exception 'Некорректный ID списания';end if;
 end loop;
 foreach k in array array['number','date','invoiceAt','storeName','kind'] loop
  if jsonb_typeof(d->k) is distinct from 'string' or length(d->>k) not between 1 and 300 then raise exception 'Некорректное поле списания';end if;
 end loop;
 if jsonb_typeof(d->'customerType') is distinct from 'string' or length(d->>'customerType')>40 then raise exception 'Некорректный тип получателя списания';end if;
 if (d->>'date')::date<month or (d->>'date')::date>=(month+interval '1 month')::date or not (config->'storeIds' @> (d->'storeId')) or jsonb_typeof(d->'processed') is distinct from 'boolean' or jsonb_typeof(d->'lines') is distinct from 'array' or jsonb_typeof(d->'issues') is distinct from 'array' or d->>'kind' not in ('personal','employee','team','masters','business','unknown') or ((d->>'invoiceAt')::timestamptz at time zone (config->>'timezone'))::date<>(d->>'date')::date then raise exception 'Некорректные данные списания';end if;
 foreach k in array array['total','legacyTotal'] loop
  if jsonb_typeof(d->k) not in ('number','null') or (jsonb_typeof(d->k)='number' and abs((d->>k)::numeric)>1000000000000) then raise exception 'Некорректная сумма списания';end if;
 end loop;
 foreach k in array array['reasonId','operatorId'] loop
  if jsonb_typeof(d->k) not in ('number','null') or (jsonb_typeof(d->k)='number' and ((d->>k)!~'^[1-9][0-9]*$' or (d->>k)::numeric>9007199254740991)) then raise exception 'Некорректный ID списания';end if;
 end loop;
 foreach k in array array['reason','operatorName','providerUpdatedAt'] loop
  if jsonb_typeof(d->k) not in ('string','null') or length(d->>k)>600 then raise exception 'Некорректное поле списания';end if;
 end loop;
 if jsonb_array_length(d->'issues')>100 or exists(select 1 from jsonb_array_elements(d->'issues') v where jsonb_typeof(v)<>'string' or length(v#>>'{}')>600) or jsonb_array_length(d->'lines')>10000 or (select count(*)<>count(distinct l->>'id') from jsonb_array_elements(d->'lines') l) then raise exception 'Повтор или неполные позиции списания';end if;
 for line in select value from jsonb_array_elements(d->'lines') loop
  if jsonb_typeof(line) is distinct from 'object' or not (line ?& array['id','productId','name','categories','unit','quantity','amount','legacyAmount']) or (line-array['id','productId','name','categories','unit','quantity','amount','legacyAmount'])<>'{}'::jsonb or jsonb_typeof(line->'id') is distinct from 'number' or (line->>'id')!~'^[1-9][0-9]*$' or (line->>'id')::numeric>9007199254740991 or jsonb_typeof(line->'categories') is distinct from 'array' or jsonb_array_length(line->'categories')>16 or exists(select 1 from jsonb_array_elements(line->'categories') v where jsonb_typeof(v)<>'string' or length(v#>>'{}')>300) or jsonb_typeof(line->'name') is distinct from 'string' or length(line->>'name') not between 1 and 300 or jsonb_typeof(line->'unit') not in ('string','null') or length(line->>'unit')>300 then raise exception 'Некорректная позиция списания';end if;
  foreach k in array array['quantity','amount','legacyAmount'] loop
   if jsonb_typeof(line->k) not in ('number','null') or (jsonb_typeof(line->k)='number' and abs((line->>k)::numeric)>1000000000000) then raise exception 'Некорректная сумма позиции';end if;
  end loop;
  if jsonb_typeof(line->'productId') not in ('number','null') or (jsonb_typeof(line->'productId')='number' and ((line->>'productId')!~'^[1-9][0-9]*$' or (line->>'productId')::numeric>9007199254740991)) then raise exception 'Некорректный ID товара';end if;
 end loop;
end $$;
revoke all on function private.stock_validate_writeoff_payload(jsonb,jsonb,date) from public,anon,authenticated;

create function public.stock_checkpoint_writeoff_job(p_id uuid,p_lease uuid,p_ids jsonb default null,p_document jsonb default null) returns boolean language plpgsql security definer set search_path=public,pg_catalog as $$
declare j public.stock_writeoff_jobs;s public.stock_writeoff_sources;d jsonb;old public.stock_writeoff_documents;x uuid;h text;event text;n integer:=0;begin
 select * into j from public.stock_writeoff_jobs where id=p_id;
 if not found then return false;end if;
 -- Keep the same source -> job lock order as the scheduler.
 select * into s from public.stock_writeoff_sources where venue_id=j.venue_id and account_id=j.account_id for share;
 select * into j from public.stock_writeoff_jobs where id=p_id for update;
 if not found or j.state<>'running' or j.lease is distinct from p_lease then return false;end if;
 if s.venue_id is null or not s.enabled or j.request is distinct from jsonb_build_object('version',s.version,'config',s.config) then update public.stock_writeoff_jobs set state='pending',lease=null,claimed_at=null,updated_at=now() where id=j.id;return false;end if;
 if j.source_ids is null then
  if p_ids is null or p_document is not null or jsonb_typeof(p_ids)<>'array' or jsonb_array_length(p_ids)>=5000 or (select count(*)<>count(distinct value) from jsonb_array_elements(p_ids)) or exists(select 1 from jsonb_array_elements(p_ids) v where jsonb_typeof(v)<>'number' or v::text!~'^[1-9][0-9]*$') then raise exception 'Не удалось подтвердить список актов';end if;
  j.source_ids:=p_ids;
 else
  if p_ids is not null or p_document is null or (p_document->>'id')::bigint is distinct from (j.source_ids->>j.cursor)::bigint then raise exception 'Позиция очереди изменилась';end if;
  perform private.stock_validate_writeoff_payload(p_document,j.request->'config',j.month);
  j.staged:=j.staged||jsonb_build_array(p_document);j.cursor:=j.cursor+1;
 end if;
 if j.cursor=jsonb_array_length(j.source_ids) then
  for d in select value from jsonb_array_elements(j.staged) loop
   h:=encode(extensions.digest(d::text,'sha256'),'hex');select * into old from public.stock_writeoff_documents where venue_id=j.venue_id and external_id=(d->>'id')::bigint for update;
   if found and old.source_hash=h and old.missing_at is null then update public.stock_writeoff_documents set last_seen_at=now() where id=old.id;continue;end if;
   if not found then
    insert into public.stock_writeoff_documents(account_id,venue_id,external_id,business_date,payload,source_hash) values(j.account_id,j.venue_id,(d->>'id')::bigint,(d->>'date')::date,d,h) returning id into x;event:='imported';
   else
    x:=old.id;event:=case when old.missing_at is null then 'updated' else 'source_restored' end;
    update public.stock_writeoff_documents set business_date=(d->>'date')::date,payload=d,source_hash=h,version=version+1,missing_at=null,captured_at=now(),last_seen_at=now() where id=x;
   end if;
   insert into public.stock_writeoff_history(account_id,venue_id,document_id,action,before_payload,after_payload,actor_id) values(j.account_id,j.venue_id,x,event,old.payload,d,j.requested_by);n:=n+1;
  end loop;
  for old in select * from public.stock_writeoff_documents where account_id=j.account_id and venue_id=j.venue_id and business_date>=j.month and business_date<(j.month+interval '1 month')::date and missing_at is null and not exists(select 1 from jsonb_array_elements_text(j.source_ids) i where i::bigint=external_id) for update loop
   update public.stock_writeoff_documents set missing_at=now(),version=version+1,captured_at=now() where id=old.id;
   insert into public.stock_writeoff_history(account_id,venue_id,document_id,action,before_payload,actor_id) values(j.account_id,j.venue_id,old.id,'source_removed',old.payload,j.requested_by);n:=n+1;
  end loop;
  if n>0 then insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details) values(j.account_id,j.venue_id,j.requested_by,'stock.writeoffs.synced','stock_writeoff_source',j.venue_id,jsonb_build_object('month',j.month,'documents',jsonb_array_length(j.staged),'changed',n));end if;
  update public.stock_writeoff_jobs set state='ready',lease=null,claimed_at=null,source_ids=j.source_ids,staged='[]',cursor=j.cursor,last_error=null,completed_at=now(),updated_at=now() where id=j.id;
 else update public.stock_writeoff_jobs set state='pending',lease=null,claimed_at=null,source_ids=j.source_ids,staged=j.staged,cursor=j.cursor,last_error=null,attempts=0,next_retry_at=now(),updated_at=now() where id=j.id;end if;return true;
end $$;
revoke all on function public.stock_checkpoint_writeoff_job(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.stock_checkpoint_writeoff_job(uuid,uuid,jsonb,jsonb) to service_role;

create function public.stock_fail_writeoff_job(p_id uuid,p_lease uuid,p_error text,p_retry_ms integer default null,p_rescan boolean default false) returns void language plpgsql security definer set search_path=public,pg_catalog as $$ begin
 update public.stock_writeoff_jobs set state='error',lease=null,claimed_at=null,source_ids=case when p_rescan then null else source_ids end,staged=case when p_rescan then '[]'::jsonb else staged end,cursor=case when p_rescan then 0 else cursor end,attempts=attempts+1,last_error=left(p_error,500),next_retry_at=now()+make_interval(secs=>greatest(30,least(900,coalesce(p_retry_ms/1000,30*power(2,least(attempts,5))::integer)))),updated_at=now() where id=p_id and state='running' and lease=p_lease;
end $$;
revoke all on function public.stock_fail_writeoff_job(uuid,uuid,text,integer,boolean) from public,anon,authenticated;
grant execute on function public.stock_fail_writeoff_job(uuid,uuid,text,integer,boolean) to service_role;

-- Deliberately exclude request staging from the reader-facing status RPC.
create function public.stock_writeoff_job_status(p_expected_venue uuid) returns table(id uuid,month date,state text,cursor integer,total integer,last_error text,completed_at timestamptz) language plpgsql security definer set search_path=public,pg_catalog as $$ begin
 if auth.uid() is null or public.get_active_venue_id() is distinct from p_expected_venue or not public.has_permission('inventory.view_results') then raise exception 'Нет доступа к списаниям';end if;
 return query select j.id,j.month,j.state,j.cursor,case when j.source_ids is null then null else jsonb_array_length(j.source_ids) end,j.last_error,j.completed_at from public.stock_writeoff_jobs j where j.venue_id=p_expected_venue and j.account_id=public.get_active_account_id() order by j.month desc;
end $$;
revoke all on function public.stock_writeoff_job_status(uuid) from public,anon;
grant execute on function public.stock_writeoff_job_status(uuid) to authenticated;
create policy stock_writeoff_audit_read on public.audit_logs as restrictive for select to authenticated using(action_code not like 'stock.writeoffs.%' or (account_id=(select public.get_active_account_id()) and venue_id=(select public.get_active_venue_id()) and (select public.has_permission('inventory.view_results'))));
-- Shared cron rotation, independent of wall-clock cadence and worker process.
create table private.sales_worker_rotation(id boolean primary key default true check(id),lane integer not null check(lane between 0 and 3));
alter table private.sales_worker_rotation enable row level security;
revoke all on private.sales_worker_rotation from public,anon,authenticated,service_role;
create function public.sales_next_worker_lane() returns integer language sql security definer set search_path=public,pg_catalog as $$
 insert into private.sales_worker_rotation(id,lane) values(true,0)
 on conflict(id) do update set lane=(sales_worker_rotation.lane+1)%4 returning lane;
$$;
revoke all on function public.sales_next_worker_lane() from public,anon,authenticated;
grant execute on function public.sales_next_worker_lane() to service_role;
commit;
