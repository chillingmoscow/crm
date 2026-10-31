begin;
-- Installing this package does not transfer writer ownership from n8n.
create table public.finance_execution_rules (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,version integer not null check(version>0),
 enabled boolean not null default false,from_date date,settlement boolean not null default true,movements boolean not null default true,legacy_stopped boolean not null default false,
 reason text not null check(length(trim(reason)) between 1 and 1000),created_by uuid references public.profiles(id) on delete set null,actor_name text not null,created_at timestamptz not null default now(),
 unique(venue_id,version),foreign key(account_id,venue_id) references public.venues(account_id,id) on delete cascade,
 check(not enabled or (from_date is not null and legacy_stopped and (settlement or movements)))
);
create index finance_execution_rules_scope on public.finance_execution_rules(account_id,venue_id,version desc);
create index finance_execution_rules_actor on public.finance_execution_rules(created_by);
create table public.finance_execution_runs (
 id uuid primary key,account_id uuid not null,venue_id uuid not null,kind text not null check(kind in ('settlement','movements')),business_date date not null,
 source_hash text not null,rule_id uuid not null,policy_version integer not null,snapshot jsonb not null,plan jsonb not null,
 state text not null check(state in ('committed','review','error')),message text,created_count integer not null default 0,corrected_count integer not null default 0,linked_count integer not null default 0,cancelled_count integer not null default 0,
 created_at timestamptz not null default now(),foreign key(account_id,venue_id) references public.venues(account_id,id) on delete cascade
);
create index finance_execution_runs_scope on public.finance_execution_runs(account_id,venue_id,kind,business_date,created_at desc,id);
create table private.finance_execution_bindings (
 venue_id uuid not null,account_id uuid not null,kind text not null,key text not null,transaction_id uuid references public.transactions(id) on delete set null,
 original jsonb not null,baseline jsonb not null,auto_cancelled boolean not null default false,run_id uuid not null references public.finance_execution_runs(id) on delete cascade,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),primary key(venue_id,key),
 foreign key(account_id,venue_id) references public.venues(account_id,id) on delete cascade
);
create index finance_execution_bindings_transaction on private.finance_execution_bindings(transaction_id);
create index finance_execution_bindings_run on private.finance_execution_bindings(run_id);
create index finance_execution_bindings_scope on private.finance_execution_bindings(account_id,venue_id,kind);
create table private.finance_execution_jobs (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,kind text not null check(kind in ('settlement','movements')),business_date date not null,
 source_hash text not null,state text not null default 'pending' check(state in ('pending','running','done','review','error')),lease uuid,claimed_at timestamptz,
 next_retry_at timestamptz not null default now(),attempts integer not null default 0,failures integer not null default 0,last_error text,updated_at timestamptz not null default now(),
 unique(venue_id,kind,business_date),foreign key(account_id,venue_id) references public.venues(account_id,id) on delete cascade
);
create index finance_execution_jobs_due on private.finance_execution_jobs(state,next_retry_at,updated_at,id);
create index finance_execution_jobs_scope on private.finance_execution_jobs(account_id,venue_id,kind,business_date);
alter table public.finance_execution_rules enable row level security;
alter table public.finance_execution_runs enable row level security;
alter table private.finance_execution_bindings enable row level security;
alter table private.finance_execution_jobs enable row level security;
revoke all on public.finance_execution_rules,public.finance_execution_runs,private.finance_execution_bindings,private.finance_execution_jobs from public,anon,authenticated,service_role;
grant select on public.finance_execution_rules,public.finance_execution_runs to authenticated,service_role;
create policy finance_execution_rules_read on public.finance_execution_rules for select to authenticated using(account_id=(select public.get_active_account_id()) and venue_id=(select public.get_active_venue_id()) and (select public.is_account_owner(public.get_active_account_id())) and (select public.has_permission('finance.view_transactions')) and (select public.has_permission('sales.view_shifts')));
create policy finance_execution_runs_read on public.finance_execution_runs for select to authenticated using(account_id=(select public.get_active_account_id()) and venue_id=(select public.get_active_venue_id()) and (select public.is_account_owner(public.get_active_account_id())) and (select public.has_permission('finance.view_transactions')) and (select public.has_permission('sales.view_shifts')));
create policy finance_execution_audit on public.audit_logs as restrictive for select to authenticated using(action_code not like 'finance.execution.%' or (account_id=(select public.get_active_account_id()) and venue_id=(select public.get_active_venue_id()) and (select public.is_account_owner(public.get_active_account_id())) and (select public.has_permission('finance.view_transactions')) and (select public.has_permission('sales.view_shifts'))));

create function public.finance_save_execution_rules(p_venue uuid,p_version integer,p_enabled boolean,p_from date,p_settlement boolean,p_movements boolean,p_legacy_stopped boolean,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare a uuid:=private.finance_settlement_owner(p_venue);old public.finance_execution_rules;c jsonb;rid uuid;actor text;today date;begin
 if p_enabled is null or p_settlement is null or p_movements is null or p_legacy_stopped is null or p_reason is null or length(trim(p_reason)) not between 1 and 1000 then raise exception 'Проверьте режим проведения и основание';end if;
 perform pg_advisory_xact_lock(hashtextextended('finance-execution-policy:'||p_venue,0));
 select * into old from public.finance_execution_rules where venue_id=p_venue order by version desc limit 1;
 if old.enabled=p_enabled and old.from_date is not distinct from p_from and old.settlement=p_settlement and old.movements=p_movements and old.legacy_stopped=p_legacy_stopped and old.reason=trim(p_reason) and old.created_by=auth.uid() then return old.id;end if;
 if p_version is distinct from coalesce(old.version,0) then raise exception 'Режим изменился. Обновите страницу';end if;
 if p_enabled then
  if not p_legacy_stopped or p_from is null or not(p_settlement or p_movements) then raise exception 'Сначала остановите прежние финансовые обработчики и подтвердите сверку';end if;
  select ((now() at time zone timezone)-make_interval(hours=>day_start_hour))::date into today from public.sales_settings where account_id=a and venue_id=p_venue;
  -- An ongoing period can be edited without moving its cutoff. Adding a new
  -- writer lane must still start today or later, never replay its archive.
  if today is null or (p_from<today and not coalesce(old.enabled and p_from=old.from_date and (not p_settlement or old.settlement) and (not p_movements or old.movements),false)) then raise exception 'Проведение можно начать с текущего или будущего рабочего дня';end if;
  if p_settlement then
   select config into c from public.finance_settlement_settings where venue_id=p_venue order by version desc limit 1;
   if c is null or not coalesce((select auto_read from public.finance_settlement_settings where venue_id=p_venue order by version desc limit 1),false) then raise exception 'Сначала настройте автоматическое чтение поступлений';end if;
   perform private.finance_validate_settlement(c,a,p_venue);
  end if;
  if p_movements then
   select config into c from public.cash_movement_rules where venue_id=p_venue order by version desc limit 1;
   if c is null or not coalesce((c->>'autoRead')::boolean,false) then raise exception 'Сначала настройте автоматическое чтение кассовых операций';end if;
   perform private.cash_movement_validate_config(a,p_venue,c);
  end if;
 end if;
 select coalesce(nullif(trim(concat_ws(' ',first_name,last_name)),''),'Пользователь') into actor from public.profiles where id=auth.uid();
 insert into public.finance_execution_rules(account_id,venue_id,version,enabled,from_date,settlement,movements,legacy_stopped,reason,created_by,actor_name)
 values(a,p_venue,coalesce(old.version,0)+1,p_enabled,p_from,p_settlement,p_movements,p_legacy_stopped,trim(p_reason),auth.uid(),coalesce(actor,'Пользователь')) returning id into rid;
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details) values(a,p_venue,auth.uid(),'finance.execution.rules_saved','venue',p_venue,jsonb_build_object('version',coalesce(old.version,0)+1,'enabled',p_enabled,'from',p_from,'settlement',p_settlement,'movements',p_movements,'reason',trim(p_reason)));
 return rid;
end $$;
revoke all on function public.finance_save_execution_rules(uuid,integer,boolean,date,boolean,boolean,boolean,text) from public,anon,service_role;
grant execute on function public.finance_save_execution_rules(uuid,integer,boolean,date,boolean,boolean,boolean,text) to authenticated;

-- Exactly the provider identity used by financeSource; no credentials returned.
create function private.finance_execution_provider(a uuid,v uuid) returns text language plpgsql security definer set search_path='' as $$
declare c public.integration_connections;begin
 if not exists(select 1 from public.venues where account_id=a and id=v and archived_at is null) then raise exception 'Заведение недоступно';end if;
 if exists(select 1 from public.sales_settings where account_id=a and venue_id<>v and enabled) or exists(select 1 from public.sales_settings where account_id=a and venue_id=v and quickresto_venue_id is not null) or (select count(*) from public.external_entity_links where account_id=a and provider='quickresto' and entity_type='venue')>1 or exists(select 1 from public.external_entity_links where account_id=a and provider='quickresto' and entity_type='venue' and local_id<>v) then raise exception 'Не подтверждена принадлежность подключения одному заведению';end if;
 select * into c from public.integration_connections where account_id=a and provider='quickresto' and status='active';
 if not found then raise exception 'Подключите Quick Resto';end if;
 return encode(extensions.digest(convert_to('['||to_jsonb(c.login)::text||','||coalesce(to_jsonb(c.backoffice_base_url)::text,'null')||']','UTF8'),'sha256'),'hex');
end $$;
revoke all on function private.finance_execution_provider(uuid,uuid) from public,anon,authenticated,service_role;

create function private.finance_execution_ledger(a uuid,v uuid,d date,tz text) returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb;begin
 select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]') into rows from (
  select t.id,t.venue_id as "venueId",t.source_external_id as "sourceKey",(t.date at time zone tz)::date as date,t.type,
   t.bank_account_id as "bankAccountId",t.to_bank_account_id as "toBankAccountId",t.category_id as "categoryId",(t.amount*100)::bigint as "amountCents",coalesce(t.description,'') as description,t.deleted_at is not null as deleted,false as planned,jsonb_build_object('currency',t.currency,'legal_entity_id',t.legal_entity_id,'to_legal_entity_id',t.to_legal_entity_id,'counterparty_id',t.counterparty_id,'date',to_char(t.date at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'source',t.source,'source_external_id',t.source_external_id) as raw,
   (select coalesce(jsonb_agg(i),'[]') from (
    select c.external_id i from public.payroll_payments p join public.payroll_cashbox c on c.id=p.cashbox_id and c.account_id=p.account_id where p.transaction_id=t.id and p.account_id=a and c.venue_id=v
    union select case when t.source_external_id like 'quickresto:encashment:'||v||':%' and split_part(t.source_external_id,':',4)~'^[1-9][0-9]{0,15}$' then split_part(t.source_external_id,':',4)::bigint end
   )linked where i is not null) as "sourceIds"
  from public.transactions t where t.account_id=a and t.venue_id=v and ((t.date at time zone tz)::date=d or t.source_external_id like 'qr:daily-settlement:'||v||':'||d||':%' or exists(select 1 from private.finance_execution_bindings b where b.venue_id=v and b.transaction_id=t.id and b.original->>'date'=d::text) or exists(select 1 from public.cash_movement_days cd,jsonb_array_elements(cd.items)i where cd.venue_id=v and cd.business_date=d and (position('#'||(i->>'id') in coalesce(t.description,''))>0 or t.source_external_id='quickresto:encashment:'||v||':'||(i->>'id') or t.source_external_id like 'qr:cash-movement:'||v||':'||(i->>'id')||':%'))) order by t.id limit 20001
 )q;
 if jsonb_array_length(rows)>20000 then raise exception 'Не подтверждён полный финансовый журнал';end if;return rows;
end $$;
revoke all on function private.finance_execution_ledger(uuid,uuid,date,text) from public,anon,authenticated,service_role;

create function private.finance_execution_snapshot(a uuid,v uuid,k text,d date) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.sales_settings;p public.finance_execution_rules;provider_hash text;source jsonb;rule jsonb;aliases jsonb;ledger jsonb;pinned uuid;pinned_provider text;override_rule public.cash_movement_rules;begin
 if k not in ('settlement','movements') or d is null then raise exception 'Выберите источник и рабочий день';end if;
 select * into s from public.sales_settings where account_id=a and venue_id=v;
 if not found or not s.enabled then raise exception 'Источники продаж не настроены или выключены';end if;
 provider_hash:=private.finance_execution_provider(a,v);
 select * into p from public.finance_execution_rules where venue_id=v order by version desc limit 1;
 select rule_id,snapshot->>'provider' into pinned,pinned_provider from public.finance_execution_runs where venue_id=v and kind=k and business_date=d and state='committed' order by created_at,id limit 1;
 if pinned is not null and pinned_provider is distinct from provider_hash then raise exception 'Подключение изменилось после проведения дня. Сначала подтвердите сверку';end if;
 if k='settlement' then
  select jsonb_build_object('id',id,'version',version,'hash',source_hash,'facts',facts,'request',summary->'source') into source from public.finance_settlement_days where account_id=a and venue_id=v and business_date=d and summary->>'provider'=provider_hash and summary->'double_checked'='true'::jsonb and source_hash=md5(jsonb_build_object('facts',facts,'methods',methods,'source',summary->'source','provider',provider_hash)::text);
  select jsonb_build_object('id',id,'version',version,'config',config) into rule from public.finance_settlement_settings where account_id=a and venue_id=v and (pinned is null or id=pinned) order by version desc limit 1;
  if source is not null and rule is not null then perform private.finance_validate_settlement(rule->'config',a,v);end if;
 else
  select jsonb_build_object('id',id,'version',version,'hash',source_hash,'items',items,'request',jsonb_build_object('timezone',request->>'timezone','dayStartHour',(request->>'dayStartHour')::integer)) into source from public.cash_movement_days where account_id=a and venue_id=v and business_date=d and source_hash=md5(jsonb_build_object('items',items,'timezone',request->>'timezone','provider',provider_hash)::text);
  select * into override_rule from public.cash_movement_rules where account_id=a and venue_id=v order by version desc limit 1;
  select jsonb_build_object('id',id,'version',version,'config',config||jsonb_build_object('overrides',override_rule.config->'overrides'),'overrideRuleId',override_rule.id) into rule from public.cash_movement_rules where account_id=a and venue_id=v and (pinned is null or id=pinned) order by version desc limit 1;
  if source is not null and rule is not null then perform private.cash_movement_validate_config(a,v,rule->'config');end if;
 end if;
 if source is null or rule is null then raise exception 'Нужны подтверждённые финансовые факты и сохранённые правила';end if;
 if k='movements' then
  if exists(select 1 from public.cash_movement_days cd,jsonb_array_elements(cd.items)i where cd.venue_id=v and cd.source_hash=md5(jsonb_build_object('items',cd.items,'timezone',cd.request->>'timezone','provider',provider_hash)::text) group by i->>'id' having count(distinct cd.business_date)>1) then raise exception 'Кассовый номер найден в нескольких днях. Сначала сверяйте исходные смены';end if;
  source:=source||jsonb_build_object('locations',coalesce((select jsonb_object_agg(i->>'id',cd.business_date) from public.cash_movement_days cd,jsonb_array_elements(cd.items)i where cd.venue_id=v and cd.source_hash=md5(jsonb_build_object('items',cd.items,'timezone',cd.request->>'timezone','provider',provider_hash)::text)),'{}'));
 end if;
 if source->'request' is distinct from jsonb_build_object('timezone',s.timezone,'dayStartHour',s.day_start_hour) then raise exception 'Изменились источники или граница рабочего дня';end if;
 ledger:=private.finance_execution_ledger(a,v,d,s.timezone);
 select coalesce(jsonb_agg(jsonb_build_object('key',b.key,'original',b.original,'transactionIds',jsonb_build_array(b.transaction_id),'baseline',jsonb_build_array(b.baseline),'autoCancelled',b.auto_cancelled) order by b.key),'[]') into aliases from private.finance_execution_bindings b where b.account_id=a and b.venue_id=v and b.kind=k and b.original->>'date'=d::text;
 return jsonb_build_object('accountId',a,'venueId',v,'date',d,'kind',k,'source',source,'rule',rule,'policy',to_jsonb(p),'provider',provider_hash,'timezone',s.timezone,'dayStartHour',s.day_start_hour,'ledger',ledger,'aliases',aliases);
end $$;
revoke all on function private.finance_execution_snapshot(uuid,uuid,text,date) from public,anon,authenticated,service_role;

create function public.finance_schedule_execution() returns integer language plpgsql security definer set search_path='' as $$
declare r record;n integer:=0;begin
 for r in
  with policies as(select distinct on(venue_id) * from public.finance_execution_rules order by venue_id,version desc),sources as(
   select account_id,venue_id,'settlement'::text kind,business_date,source_hash from public.finance_settlement_days
   union all select account_id,venue_id,'movements',business_date,source_hash from public.cash_movement_days
  )select s.* from sources s join policies p on p.venue_id=s.venue_id and p.account_id=s.account_id join public.venues v on v.id=s.venue_id
   where p.enabled and p.legacy_stopped and s.business_date>=p.from_date and v.archived_at is null and case when s.kind='settlement' then p.settlement else p.movements end
 loop
  insert into private.finance_execution_jobs(account_id,venue_id,kind,business_date,source_hash) values(r.account_id,r.venue_id,r.kind,r.business_date,r.source_hash)
  on conflict(venue_id,kind,business_date) do update set source_hash=excluded.source_hash,state='pending',lease=null,claimed_at=null,failures=0,last_error=null,next_retry_at=now(),updated_at=now()
   where finance_execution_jobs.source_hash<>excluded.source_hash and (finance_execution_jobs.state<>'running' or finance_execution_jobs.claimed_at<now()-interval '2 minutes');
  if found then n:=n+1;end if;
 end loop;return n;
end $$;
revoke all on function public.finance_schedule_execution() from public,anon,authenticated;
grant execute on function public.finance_schedule_execution() to service_role;
create function public.finance_claim_execution() returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.finance_execution_jobs;begin
 select q.* into j from private.finance_execution_jobs q where (q.state='pending' or(q.state='running' and q.claimed_at<now()-interval '2 minutes')) and q.next_retry_at<=now() order by q.updated_at,q.id for update skip locked limit 1;
 if not found then return null;end if;
 update private.finance_execution_jobs set state='running',lease=gen_random_uuid(),claimed_at=now(),attempts=attempts+1 where id=j.id returning * into j;return to_jsonb(j);
end $$;
revoke all on function public.finance_claim_execution() from public,anon,authenticated;
grant execute on function public.finance_claim_execution() to service_role;
create function public.finance_execution_source(p_job uuid,p_lease uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.finance_execution_jobs;p public.finance_execution_rules;begin
 select * into j from private.finance_execution_jobs where id=p_job and state='running' and lease=p_lease and claimed_at>now()-interval '2 minutes';
 if not found then raise exception 'Проведение передано другому обработчику';end if;
 select * into p from public.finance_execution_rules where venue_id=j.venue_id order by version desc limit 1;
 if p.id is null or not p.enabled or not p.legacy_stopped or j.business_date<p.from_date or not(case when j.kind='settlement' then p.settlement else p.movements end) then
  update private.finance_execution_jobs set state='done',lease=null,claimed_at=null,last_error=null,updated_at=now() where id=j.id;return null;
 end if;
 return private.finance_execution_snapshot(j.account_id,j.venue_id,j.kind,j.business_date);
end $$;
revoke all on function public.finance_execution_source(uuid,uuid) from public,anon,authenticated;
grant execute on function public.finance_execution_source(uuid,uuid) to service_role;

create function private.finance_execution_transaction_json(t public.transactions,tz text) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',t.id,'venueId',t.venue_id,'sourceKey',t.source_external_id,'date',(t.date at time zone tz)::date,'type',t.type,'bankAccountId',t.bank_account_id,'toBankAccountId',t.to_bank_account_id,'categoryId',t.category_id,'amountCents',(t.amount*100)::bigint,'description',coalesce(t.description,''),'deleted',t.deleted_at is not null,'planned',false,'sourceIds','[]'::jsonb,'raw',jsonb_build_object('currency',t.currency,'legal_entity_id',t.legal_entity_id,'to_legal_entity_id',t.to_legal_entity_id,'counterparty_id',t.counterparty_id,'date',to_char(t.date at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'source',t.source,'source_external_id',t.source_external_id))
$$;
revoke all on function private.finance_execution_transaction_json(public.transactions,text) from public,anon,authenticated,service_role;

create function public.finance_apply_execution(p_job uuid,p_lease uuid,p_request uuid,p_snapshot jsonb,p_plan jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j private.finance_execution_jobs;p public.finance_execution_rules;existing public.finance_execution_runs;
 fresh jsonb;c jsonb;bound private.finance_execution_bindings;old_tx public.transactions;new_tx public.transactions;
 bank public.bank_accounts;dest public.bank_accounts;effect_key text;mode text;tid uuid;ids jsonb;stamp timestamptz;diffs jsonb;field text;prefix text;cfg jsonb;expected_cents numeric;
 created_n integer:=0;corrected_n integer:=0;linked_n integer:=0;cancelled_n integer:=0;action text;error_message text;baseline jsonb;begin
 select * into existing from public.finance_execution_runs where id=p_request;
 if found then
  if existing.snapshot is distinct from p_snapshot or existing.plan is distinct from p_plan then raise exception 'Запрос уже использован с другими данными';end if;
  return jsonb_build_object('id',existing.id,'state',existing.state,'message',existing.message);
 end if;
 if p_request is null then raise exception 'Не указан номер запроса';end if;
 perform pg_advisory_xact_lock(hashtextextended('finance-execution-policy:'||(p_snapshot->>'venueId'),0));
 select * into j from private.finance_execution_jobs where id=p_job and state='running' and lease=p_lease and claimed_at>now()-interval '2 minutes' for update;
 if not found then raise exception 'Проведение передано другому обработчику';end if;
 select * into p from public.finance_execution_rules where venue_id=j.venue_id order by version desc limit 1;
 if p.id is null or not p.enabled or not p.legacy_stopped or j.business_date<p.from_date or not(case when j.kind='settlement' then p.settlement else p.movements end) then
  update private.finance_execution_jobs set state='done',lease=null,claimed_at=null,last_error=null,updated_at=now() where id=j.id;return jsonb_build_object('state','disabled');
 end if;
 -- Serialize the short financial commit with every ordinary ledger writer.
 -- A stale UI form / bank import cannot slip between comparison and INSERT.
 perform set_config('lock_timeout','5s',true);
 lock table public.transactions in share row exclusive mode;
 perform pg_advisory_xact_lock(hashtextextended(case when j.kind='settlement' then 'finance-settlement-settings:' else 'cash-movement-rules:' end||j.venue_id,0));
 perform 1 from public.venues where id=j.venue_id and account_id=j.account_id and archived_at is null for share;
 if not found then raise exception 'Заведение недоступно';end if;
 perform 1 from public.sales_settings where account_id=j.account_id and venue_id=j.venue_id for share;
 perform 1 from public.integration_connections where account_id=j.account_id and provider='quickresto' for share;
 if j.kind='settlement' then perform 1 from public.finance_settlement_days where venue_id=j.venue_id and business_date=j.business_date for share;
 else perform 1 from public.cash_movement_days where venue_id=j.venue_id and business_date=j.business_date for share;end if;
 fresh:=private.finance_execution_snapshot(j.account_id,j.venue_id,j.kind,j.business_date);
 if p_snapshot is distinct from fresh or fresh->'source'->>'hash'<>j.source_hash then
  update private.finance_execution_jobs set state='pending',source_hash=fresh->'source'->>'hash',lease=null,claimed_at=null,next_retry_at=now()+interval '15 seconds',updated_at=now(),last_error='Снимок изменился до проведения' where id=j.id;
  return jsonb_build_object('state','stale');
 end if;
 if p_plan is null or jsonb_typeof(p_plan)<>'object' or not(p_plan ?& array['commands','blockers']) or p_plan-array['commands','blockers']<>'{}' or jsonb_typeof(p_plan->'commands') is distinct from 'array' or jsonb_array_length(p_plan->'commands')>5000 or jsonb_typeof(p_plan->'blockers') is distinct from 'array' or octet_length(p_plan::text)>10000000 then raise exception 'Некорректный план проведения';end if;
 insert into public.finance_execution_runs(id,account_id,venue_id,kind,business_date,source_hash,rule_id,policy_version,snapshot,plan,state)
 values(p_request,j.account_id,j.venue_id,j.kind,j.business_date,j.source_hash,(fresh->'rule'->>'id')::uuid,p.version,fresh,p_plan,'review');
 if jsonb_array_length(p_plan->'blockers')>0 then
  select left(string_agg(value,'; '),1000) into error_message from jsonb_array_elements_text(p_plan->'blockers');
  update public.finance_execution_runs set message=error_message where id=p_request;
  update private.finance_execution_jobs set state='review',last_error=error_message,lease=null,claimed_at=null,updated_at=now() where id=j.id;
  return jsonb_build_object('id',p_request,'state','review','message',error_message);
 end if;
 begin
  if (select count(*)<>count(distinct value->>'key') from jsonb_array_elements(p_plan->'commands')) then raise exception 'Повторный ключ финансового эффекта';end if;
  -- Acquire every involved account in stable order, before balance triggers run.
  perform 1 from public.bank_accounts where id in(select (value->>'bankAccountId')::uuid from jsonb_array_elements(p_plan->'commands') union select (value->>'toBankAccountId')::uuid from jsonb_array_elements(p_plan->'commands') where value->>'toBankAccountId' is not null) order by id for update;
  perform 1 from public.finance_categories where id in(select (value->>'categoryId')::uuid from jsonb_array_elements(p_plan->'commands') where value->>'categoryId' is not null) order by id for share;
  for c in select value from jsonb_array_elements(p_plan->'commands') loop
   if jsonb_typeof(c)<>'object' or not(c ?& array['key','date','type','bankAccountId','toBankAccountId','categoryId','amountCents','description','sourceIds','mode','transactionIds']) or c-array['key','date','type','bankAccountId','toBankAccountId','categoryId','amountCents','description','sourceIds','mode','transactionIds']<>'{}' then raise exception 'Некорректные поля финансового эффекта';end if;
   effect_key:=c->>'key';mode:=c->>'mode';ids:=c->'transactionIds';
   if c->>'date'<>j.business_date::text or (j.kind='settlement' and effect_key not like 'qr:daily-settlement:'||j.venue_id||':'||j.business_date||':%') or(j.kind='movements' and effect_key not like 'qr:cash-movement:'||j.venue_id||':%') or mode not in ('create','link','update','restore','cancel','cancelled') or c->>'type' not in ('income','expense','transfer') or jsonb_typeof(c->'amountCents') is distinct from 'number' or (c->>'amountCents')::numeric not between 1 and 100000000000 or (c->>'amountCents')::numeric<>trunc((c->>'amountCents')::numeric) or jsonb_typeof(c->'description') is distinct from 'string' or length(c->>'description')>4000 or jsonb_typeof(ids) is distinct from 'array' or jsonb_array_length(ids)<>(case when mode='create' then 0 else 1 end) then raise exception 'Проверьте ключ, сумму и связь финансового эффекта';end if;
   if jsonb_typeof(c->'sourceIds') is distinct from 'array' or (select count(*)<>count(distinct value::text) from jsonb_array_elements(c->'sourceIds')) then raise exception 'Повторные номера кассового источника';end if;
   cfg:=fresh->'rule'->'config';
   if j.kind='settlement' then
    prefix:='qr:daily-settlement:'||j.venue_id||':'||j.business_date||':';
    if jsonb_array_length(c->'sourceIds')<>0 or (
     (effect_key=prefix||'revenue:'||(c->>'bankAccountId') and c->>'type'='income' and c->>'categoryId'=cfg->>'revenueCategoryId' and exists(select 1 from jsonb_array_elements(cfg->'methods')m where m->>'bankAccountId'=c->>'bankAccountId' and m->'excluded'='null'::jsonb))
     or(effect_key=prefix||'personal:'||(c->>'type') and c->>'type' in ('income','expense') and c->>'bankAccountId'=cfg->'personal'->>'bankAccountId' and c->>'categoryId'=cfg->'personal'->>case when c->>'type'='income' then 'incomeCategoryId' else 'expenseCategoryId' end)
    ) is distinct from true then raise exception 'Эффект не соответствует настройкам поступлений';end if;
   else
    prefix:='qr:cash-movement:'||j.venue_id||':';
    if (
     (jsonb_array_length(c->'sourceIds')=1 and effect_key=prefix||(c->'sourceIds'->>0)||':transfer' and c->>'type'='transfer' and c->>'bankAccountId'=cfg->>'cashAccountId' and c->>'toBankAccountId' in(cfg->>'safeAccountId',cfg->>'operatingAccountId'))
     or(jsonb_array_length(c->'sourceIds')=1 and effect_key=prefix||(c->'sourceIds'->>0)||':income' and c->>'type'='income' and c->>'bankAccountId'=cfg->>'cashAccountId' and c->>'categoryId'=cfg->>'incomeCategoryId')
     or(jsonb_array_length(c->'sourceIds')=1 and effect_key=prefix||(c->'sourceIds'->>0)||':tips' and c->>'type'='expense' and c->>'bankAccountId'=cfg->>'operatingAccountId' and c->>'categoryId'=cfg->>'tipsCategoryId')
     or(effect_key=prefix||'taxi:'||j.business_date||':part:'||(select string_agg(value,'-' order by value::bigint) from jsonb_array_elements_text(c->'sourceIds')) and c->>'type'='expense' and c->>'bankAccountId'=cfg->>'operatingAccountId' and c->>'categoryId'=cfg->>'taxiCategoryId')
    ) is distinct from true then raise exception 'Эффект не соответствует настройкам кассовых операций';end if;
    if mode not in ('cancel','cancelled') then
     if jsonb_array_length(c->'sourceIds')=0 or exists(select 1 from jsonb_array_elements_text(c->'sourceIds')i where i!~'^[1-9][0-9]*$' or not exists(select 1 from jsonb_array_elements(fresh->'source'->'items')s where s->>'id'=i)) then raise exception 'Не подтверждены исходные кассовые номера';end if;
     select sum((s->>'amountCents')::numeric) into expected_cents from jsonb_array_elements(fresh->'source'->'items')s where s->>'id' in(select jsonb_array_elements_text(c->'sourceIds'));
     if expected_cents is distinct from(c->>'amountCents')::numeric then raise exception 'Сумма не совпадает с кассовым источником';end if;
    end if;
   end if;
   select * into bound from private.finance_execution_bindings where venue_id=j.venue_id and finance_execution_bindings.key=effect_key;
   if mode='create' and bound.key is not null then raise exception 'Ранее учтённый эффект нельзя создать повторно';end if;
   tid:=(ids->>0)::uuid;
   if mode<>'create' then
    select * into old_tx from public.transactions where id=tid and account_id=j.account_id and venue_id=j.venue_id for update;
    if not found or old_tx.currency<>'RUB' then raise exception 'Связанная финансовая операция недоступна или имеет другую валюту';end if;
    if bound.key is not null then
     baseline:=private.finance_execution_transaction_json(old_tx,fresh->>'timezone');
     if bound.transaction_id is distinct from tid or (baseline-array['sourceKey','sourceIds','planned']) is distinct from(bound.baseline-array['sourceKey','sourceIds','planned']) then raise exception 'Сохранена ручная правка связанной операции';end if;
    elsif mode in ('update','restore','cancel') then raise exception 'Автокоррекция требует ранее подтверждённой связи';end if;
   end if;
   select * into bank from public.bank_accounts where id=(c->>'bankAccountId')::uuid and account_id=j.account_id and (venue_id is null or venue_id=j.venue_id) and deleted_at is null and is_active and currency='RUB';
   if not found then raise exception 'Счёт недоступен в заведении';end if;
   dest:=null;
   if c->>'type'='transfer' then
    if c->>'categoryId' is not null or c->>'toBankAccountId' is null or c->>'toBankAccountId'=c->>'bankAccountId' then raise exception 'Проверьте счета перевода';end if;
    select * into dest from public.bank_accounts where id=(c->>'toBankAccountId')::uuid and account_id=j.account_id and (venue_id is null or venue_id=j.venue_id) and deleted_at is null and is_active and currency='RUB';
    if not found then raise exception 'Счёт назначения недоступен';end if;
   elsif c->>'toBankAccountId' is not null or not exists(select 1 from public.finance_categories where id=(c->>'categoryId')::uuid and account_id=j.account_id and archived_at is null and type::text=c->>'type') then raise exception 'Статья недоступна или не соответствует операции';end if;
   stamp:=(j.business_date+time '12:00') at time zone(fresh->>'timezone');
   if mode in ('update','restore') and (old_tx.date at time zone(fresh->>'timezone'))::date=j.business_date then stamp:=old_tx.date;end if;
   if mode in ('create','update','restore') and ((bank.balance_anchor_at is not null and stamp<bank.balance_anchor_at) or(dest.balance_anchor_at is not null and stamp<dest.balance_anchor_at)) then raise exception 'Дата раньше контрольного остатка счёта. Сначала сверяйте перенос';end if;
   if mode in ('link','cancel','cancelled') and ((old_tx.date at time zone(fresh->>'timezone'))::date<>j.business_date or old_tx.type::text<>c->>'type' or old_tx.amount*100<>(c->>'amountCents')::numeric or old_tx.bank_account_id<>bank.id or old_tx.to_bank_account_id is distinct from dest.id or old_tx.category_id is distinct from(c->>'categoryId')::uuid) then raise exception 'Изменились параметры связываемой операции';end if;
   new_tx:=null;action:=null;
   if mode='create' then
    if exists(select 1 from public.transactions where account_id=j.account_id and source_external_id=effect_key) then raise exception 'Ключ источника уже занят финансовой операцией';end if;
    insert into public.transactions(account_id,venue_id,legal_entity_id,bank_account_id,to_bank_account_id,to_legal_entity_id,type,amount,currency,category_id,date,description,source,source_external_id)
    values(j.account_id,j.venue_id,bank.legal_entity_id,bank.id,dest.id,dest.legal_entity_id,(c->>'type')::public.transaction_type_enum,(c->>'amountCents')::numeric/100,'RUB',(c->>'categoryId')::uuid,stamp,c->>'description','quickresto',effect_key) returning * into new_tx;
    created_n:=created_n+1;action:='created';
   elsif mode in ('update','restore') then
    if (mode='restore' and (not bound.auto_cancelled or old_tx.deleted_at is null)) or(mode='update' and old_tx.deleted_at is not null) then raise exception 'Нельзя автоматически восстановить ручную отмену';end if;
    update public.transactions set legal_entity_id=bank.legal_entity_id,bank_account_id=bank.id,to_bank_account_id=dest.id,to_legal_entity_id=dest.legal_entity_id,type=(c->>'type')::public.transaction_type_enum,amount=(c->>'amountCents')::numeric/100,category_id=(c->>'categoryId')::uuid,date=stamp,description=c->>'description',deleted_at=null,deleted_by=null,updated_at=now(),updated_by=null where id=tid returning * into new_tx;
    corrected_n:=corrected_n+1;action:=case when mode='restore' then 'restored' else 'updated' end;
   elsif mode='cancel' then
    if old_tx.deleted_at is not null then raise exception 'Ручная отмена уже сохранена';end if;
    update public.transactions set deleted_at=now(),deleted_by=null,updated_at=now(),updated_by=null where id=tid returning * into new_tx;
    cancelled_n:=cancelled_n+1;action:='deleted';
   else
    if (mode='cancelled') is distinct from(old_tx.deleted_at is not null) then raise exception 'Изменилось состояние связанной операции';end if;
    new_tx:=old_tx;if bound.key is null then linked_n:=linked_n+1;end if;
   end if;
   if action is not null then
    diffs:='[]';
    if mode<>'create' then foreach field in array array['amount','date','bank_account_id','to_bank_account_id','category_id','description','deleted_at'] loop
     if to_jsonb(old_tx)->field is distinct from to_jsonb(new_tx)->field then diffs:=diffs||jsonb_build_array(jsonb_build_object('field',field,'old',to_jsonb(old_tx)->field,'new',to_jsonb(new_tx)->field));end if;
    end loop;end if;
    insert into public.audit_logs(account_id,venue_id,action_code,entity_type,entity_id,details)
    values(j.account_id,j.venue_id,'finance.transaction.'||action,'transaction',new_tx.id,to_jsonb(new_tx)||jsonb_build_object('changes',diffs,'run_id',p_request,'reason','Обновление подтверждённых данных Quick Resto','source_hash',j.source_hash));
   end if;
   insert into private.finance_execution_bindings(account_id,venue_id,kind,key,transaction_id,original,baseline,auto_cancelled,run_id)
   values(j.account_id,j.venue_id,j.kind,effect_key,new_tx.id,c,private.finance_execution_transaction_json(new_tx,fresh->>'timezone'),mode='cancel',p_request)
   on conflict(venue_id,key) do update set original=excluded.original,baseline=excluded.baseline,auto_cancelled=case when mode='cancelled' then finance_execution_bindings.auto_cancelled else excluded.auto_cancelled end,run_id=excluded.run_id,updated_at=now();
  end loop;
  update public.finance_execution_runs set state='committed',created_count=created_n,corrected_count=corrected_n,linked_count=linked_n,cancelled_count=cancelled_n where id=p_request;
  update private.finance_execution_jobs set state='done',lease=null,claimed_at=null,last_error=null,failures=0,updated_at=now() where id=j.id;
  insert into public.audit_logs(account_id,venue_id,action_code,entity_type,entity_id,details) values(j.account_id,j.venue_id,'finance.execution.committed','venue',j.venue_id,jsonb_build_object('run_id',p_request,'date',j.business_date,'kind',j.kind,'created',created_n,'corrected',corrected_n,'linked',linked_n,'cancelled',cancelled_n));
 exception when others then
  error_message:=left(sqlerrm,1000);
  update public.finance_execution_runs set state='error',message=error_message where id=p_request;
  update private.finance_execution_jobs set state='error',lease=null,claimed_at=null,last_error=error_message,updated_at=now() where id=j.id;
  return jsonb_build_object('id',p_request,'state','error','message',error_message);
 end;
 return jsonb_build_object('id',p_request,'state','committed','created',created_n,'corrected',corrected_n,'linked',linked_n,'cancelled',cancelled_n);
end $$;
revoke all on function public.finance_apply_execution(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.finance_apply_execution(uuid,uuid,uuid,jsonb,jsonb) to service_role;

create function public.finance_fail_execution(p_job uuid,p_lease uuid,p_message text) returns void language plpgsql security definer set search_path='' as $$
declare j private.finance_execution_jobs;begin
 select * into j from private.finance_execution_jobs where id=p_job and state='running' and lease=p_lease and claimed_at>now()-interval '2 minutes' for update;
 if not found then return;end if;
 update private.finance_execution_jobs set state=case when failures+1>=3 then 'error' else 'pending' end,failures=failures+1,last_error=left(p_message,1000),lease=null,claimed_at=null,next_retry_at=now()+interval '1 minute',updated_at=now() where id=j.id;
end $$;
revoke all on function public.finance_fail_execution(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.finance_fail_execution(uuid,uuid,text) to service_role;
create function public.finance_execution_result(p_request uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',id,'state',state,'message',message) from public.finance_execution_runs where id=p_request
$$;
revoke all on function public.finance_execution_result(uuid) from public,anon,authenticated;
grant execute on function public.finance_execution_result(uuid) to service_role;

-- Read-only comparisons must use the same rules as the posted day. Only the
-- rule identifier is exposed; financial snapshots remain owner-only.
create function public.finance_execution_day_rule(p_venue uuid,p_date date,p_kind text) returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid:=private.cash_control_viewer(p_venue);rid uuid;begin
 if p_date is null or p_kind not in ('settlement','movements') then raise exception 'Выберите источник и рабочий день';end if;
 select rule_id into rid from public.finance_execution_runs where account_id=a and venue_id=p_venue and business_date=p_date and kind=p_kind and state='committed' order by created_at,id limit 1;
 return rid;
end $$;
revoke all on function public.finance_execution_day_rule(uuid,date,text) from public,anon,service_role;
grant execute on function public.finance_execution_day_rule(uuid,date,text) to authenticated;

create function public.finance_execution_status(p_venue uuid,p_date date) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=private.finance_settlement_owner(p_venue);rows jsonb;tz text;begin
 select timezone into tz from public.sales_settings where account_id=a and venue_id=p_venue;
 select coalesce(jsonb_agg(jsonb_build_object('kind',j.kind,'state',case when conflict.found then 'review' else j.state end,'message',case when conflict.found then 'Сохранена ручная правка связанной операции. Проверьте расхождение.' else j.last_error end,'updatedAt',j.updated_at) order by j.kind),'[]') into rows
 from private.finance_execution_jobs j cross join lateral (
  select exists(select 1 from private.finance_execution_bindings b left join public.transactions t on t.id=b.transaction_id
   where b.account_id=a and b.venue_id=p_venue and b.kind=j.kind and b.original->>'date'=p_date::text
    and (t.id is null or (private.finance_execution_transaction_json(t,tz)-array['sourceKey','sourceIds','planned']) is distinct from (b.baseline-array['sourceKey','sourceIds','planned']))) as found
 )conflict where j.account_id=a and j.venue_id=p_venue and j.business_date=p_date;
 return rows;
end $$;
revoke all on function public.finance_execution_status(uuid,date) from public,anon,service_role;
grant execute on function public.finance_execution_status(uuid,date) to authenticated;
create function public.finance_retry_execution(p_venue uuid,p_date date,p_kind text) returns void language plpgsql security definer set search_path='' as $$
declare a uuid:=private.finance_settlement_owner(p_venue);p public.finance_execution_rules;s jsonb;j private.finance_execution_jobs;begin
 if p_kind not in ('settlement','movements') or p_date is null then raise exception 'Выберите источник и день';end if;
 perform pg_advisory_xact_lock(hashtextextended('finance-execution-policy:'||p_venue,0));
 select * into p from public.finance_execution_rules where venue_id=p_venue order by version desc limit 1;
 if p.id is null or not p.enabled or not p.legacy_stopped or p_date<p.from_date or not(case when p_kind='settlement' then p.settlement else p.movements end) then raise exception 'Автоматическое проведение не включено для этого дня';end if;
 select * into j from private.finance_execution_jobs where venue_id=p_venue and kind=p_kind and business_date=p_date for update;
 if found and j.state in ('pending','running') then raise exception 'Проведение уже запущено';end if;
 s:=private.finance_execution_snapshot(a,p_venue,p_kind,p_date);
 insert into private.finance_execution_jobs(account_id,venue_id,kind,business_date,source_hash) values(a,p_venue,p_kind,p_date,s->'source'->>'hash')
 on conflict(venue_id,kind,business_date) do update set source_hash=excluded.source_hash,state='pending',lease=null,claimed_at=null,failures=0,last_error=null,next_retry_at=now(),updated_at=now();
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details) values(a,p_venue,auth.uid(),'finance.execution.requested','venue',p_venue,jsonb_build_object('date',p_date,'kind',p_kind));
end $$;
revoke all on function public.finance_retry_execution(uuid,date,text) from public,anon,service_role;
grant execute on function public.finance_retry_execution(uuid,date,text) to authenticated;

-- Existing transaction audit also records human edits of source-owned rows.
do $$ declare definition text;needle text;begin
 definition:=pg_get_functiondef('public.transactions_audit_trigger()'::regprocedure);
 needle:='and not exists(select 1 from public.payroll_payments p where p.transaction_id=NEW.id)';
 if position(needle in definition)=0 then raise exception 'Inspect transaction audit before applying native finance';end if;
 execute replace(definition,needle,needle||' and not exists(select 1 from private.finance_execution_bindings b where b.transaction_id=NEW.id)');
end $$;
alter table private.sales_worker_rotation drop constraint sales_worker_rotation_lane_check;
alter table private.sales_worker_rotation add constraint sales_worker_rotation_lane_check check(lane between 0 and 7);
create or replace function public.sales_next_worker_lane() returns integer language sql security definer set search_path='' as $$
 insert into private.sales_worker_rotation as rotation(id,lane) values(true,0) on conflict(id) do update set lane=(rotation.lane+1)%8 returning lane;
$$;
revoke all on function public.sales_next_worker_lane() from public,anon,authenticated;
grant execute on function public.sales_next_worker_lane() to service_role;
commit;
