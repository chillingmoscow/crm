begin;
-- Invoice source mirror; monetary execution is deliberately a separate command.
create table private.supply_documents(
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,qr_id bigint not null check(qr_id>0),revision integer not null default 1 check(revision>0),data jsonb not null,source_missing boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(venue_id,qr_id),foreign key(account_id,venue_id)references public.venues(account_id,id)on delete cascade
);
create index supply_documents_scope on private.supply_documents(account_id,venue_id,((data->>'invoiceDate')),id);
create table private.supply_history(
 id bigint generated always as identity primary key,document_id uuid not null references private.supply_documents(id)on delete cascade,account_id uuid not null,venue_id uuid not null,revision integer not null,action text not null,before_data jsonb,after_data jsonb,actor_name text not null default 'Quick Resto',reason text not null,created_at timestamptz not null default now(),foreign key(account_id,venue_id)references public.venues(account_id,id)on delete cascade
);
create index supply_history_document on private.supply_history(document_id,id desc);
create index supply_history_scope on private.supply_history(account_id,venue_id);
create table private.supply_sources(
 venue_id uuid primary key,account_id uuid not null,provider text not null,version integer not null,source_hash text not null,rows integer not null,checked_at timestamptz not null default now(),foreign key(account_id,venue_id)references public.venues(account_id,id)on delete cascade
);
create index supply_sources_scope on private.supply_sources(account_id,venue_id);
create table private.supply_read_rules(
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,version integer not null,config jsonb not null,actor_id uuid references public.profiles(id)on delete set null,actor_name text not null,reason text not null,created_at timestamptz not null default now(),unique(venue_id,version),foreign key(account_id,venue_id)references public.venues(account_id,id)on delete cascade
);
create index supply_rules_actor on private.supply_read_rules(actor_id);
create index supply_rules_scope on private.supply_read_rules(account_id,venue_id,version desc);
create table private.supply_jobs(
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,state text not null default 'pending'check(state in('pending','running','done','error')),phase text not null default 'grid_first'check(phase in('grid_first','financial_first','grid_verify','financial_verify')),cursor integer not null default 0 check(cursor between 0 and 30000),payload jsonb not null default '{"first":[],"second":[],"facts":[]}',request jsonb not null,lease uuid,claimed_at timestamptz,next_retry_at timestamptz not null default now(),attempts integer not null default 0,source_failures integer not null default 0 check(source_failures>=0),last_error text,created_by uuid references public.profiles(id)on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),foreign key(account_id,venue_id)references public.venues(account_id,id)on delete cascade
);
create unique index supply_jobs_live on private.supply_jobs(venue_id)where state in('pending','running');
create index supply_jobs_due on private.supply_jobs(state,next_retry_at,created_at);
create index supply_jobs_creator on private.supply_jobs(created_by);
create index supply_jobs_scope on private.supply_jobs(account_id,venue_id,created_at desc);
do $$declare t text;begin
 foreach t in array array['supply_documents','supply_history','supply_sources','supply_read_rules','supply_jobs']loop execute format('alter table private.%I enable row level security',t);execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);end loop;
end $$;
revoke all on sequence private.supply_history_id_seq from public,anon,authenticated,service_role;
create function private.supply_scope(v uuid,owner_only boolean default false)returns uuid language plpgsql set search_path=''as $$
declare a uuid:=public.get_active_account_id();begin
 if auth.uid()is null or a is null or not public.has_permission('finance.view_transactions')or(owner_only and not public.is_account_owner(a))then raise exception 'Нет доступа к поставкам';end if;
 if v is distinct from public.get_active_venue_id()or not exists(select 1 from public.venues where id=v and account_id=a and archived_at is null)then raise exception 'Заведение изменилось или недоступно';end if;
 return a;
end $$;
revoke all on function private.supply_scope(uuid,boolean)from public,anon,authenticated,service_role;
create function public.supply_list(p_venue uuid,p_from date,p_to date,p_search text default '',p_paid text default '',p_provider bigint default null,p_store bigint default null,p_missing boolean default false,p_page integer default 0,p_size integer default 25,p_sort text default 'date',p_desc boolean default true)returns jsonb language plpgsql security definer set search_path=''as $$
declare a uuid:=private.supply_scope(p_venue);result jsonb;providers jsonb;stores jsonb;source private.supply_sources;j private.supply_jobs;begin
 perform pg_advisory_xact_lock_shared(hashtextextended('supply-publish:'||p_venue,0));
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>366 or length(p_search)>120 or p_paid not in('','paid','unpaid','draft','review')or p_page not between 0 and 100000 or p_size not in(25,50,100)or p_sort not in('date','number','provider','amount','paid')then raise exception 'Проверьте фильтры поставок';end if;
 with selected as(
 select d.*from private.supply_documents d where d.account_id=a and d.venue_id=p_venue and (p_missing or not d.source_missing) and(d.data->>'invoiceDate')::date between p_from and p_to and(p_search=''or position(lower(trim(p_search))in lower(coalesce(d.data->>'number','')||' '||coalesce(d.data->>'providerName','')))>0)and(p_provider is null or(d.data->>'providerId')::bigint=p_provider)and(p_store is null or(d.data->>'storeId')::bigint=p_store)and(p_paid=''or(p_paid='paid'and(d.data->>'paid')::boolean)or(p_paid='unpaid'and not(d.data->>'paid')::boolean)or(p_paid='draft'and not(d.data->>'processed')::boolean)or(p_paid='review'and jsonb_array_length(d.data->'issues')>0))
 ),ordered as(select *,row_number()over(order by
 case when not p_desc and p_sort='date'then data->>'invoiceAt'end asc nulls last,case when p_desc and p_sort='date'then data->>'invoiceAt'end desc nulls last,
 case when not p_desc and p_sort='number'then lower(data->>'number')end asc nulls last,case when p_desc and p_sort='number'then lower(data->>'number')end desc nulls last,
 case when not p_desc and p_sort='provider'then lower(data->>'providerName')end asc nulls last,case when p_desc and p_sort='provider'then lower(data->>'providerName')end desc nulls last,
 case when not p_desc and p_sort='amount'then(data->>'amountCents')::bigint end asc nulls last,case when p_desc and p_sort='amount'then(data->>'amountCents')::bigint end desc nulls last,
 case when not p_desc and p_sort='paid'then(data->>'paid')::boolean end asc nulls last,case when p_desc and p_sort='paid'then(data->>'paid')::boolean end desc nulls last,id)rn from selected)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'revision',revision,'data',data,'missing',source_missing)order by rn)from ordered where rn>p_page*p_size and rn<=(p_page+1)*p_size),'[]'::jsonb),'total',(select count(*)from selected),'amountCents',(select coalesce(sum((data->>'amountCents')::bigint),0)from selected),'paidCents',(select coalesce(sum((data->>'amountCents')::bigint),0)from selected where(data->>'paid')::boolean),'unpaidCents',(select coalesce(sum((data->>'amountCents')::bigint),0)from selected where not(data->>'paid')::boolean))into result;
 select coalesce(jsonb_agg(x order by x->>'name'),'[]')into providers from(select distinct jsonb_build_object('id',(data->>'providerId')::bigint,'name',coalesce(data->>'providerName','Поставщик №'||(data->>'providerId')))x from private.supply_documents where account_id=a and venue_id=p_venue and data->>'providerId'is not null)s;
 select coalesce(jsonb_agg(x order by x->>'name'),'[]')into stores from(select distinct jsonb_build_object('id',(data->>'storeId')::bigint,'name',data->>'storeTitle')x from private.supply_documents where account_id=a and venue_id=p_venue)s;
 select *into source from private.supply_sources where account_id=a and venue_id=p_venue;select *into j from private.supply_jobs where account_id=a and venue_id=p_venue order by created_at desc,id desc limit 1;
 return result||jsonb_build_object('venueId',p_venue,'providers',providers,'stores',stores,'canConfigure',public.is_account_owner(a),'configured',exists(select 1 from private.supply_read_rules where venue_id=p_venue),'months',coalesce((select jsonb_agg(period_key order by period_key)from(select distinct left(data->>'invoiceDate',7)as period_key from private.supply_documents where account_id=a and venue_id=p_venue and not source_missing)periods),'[]'::jsonb),'timezone',coalesce((select timezone from public.sales_settings where venue_id=p_venue),'Europe/Moscow'),'checkedAt',source.checked_at,'sourceVersion',source.version,'job',case when j.id is null then null else jsonb_build_object('state',j.state,'phase',j.phase,'cursor',j.cursor,'error',j.last_error)end);
end $$;
revoke all on function public.supply_list(uuid,date,date,text,text,bigint,bigint,boolean,integer,integer,text,boolean)from public,anon,service_role;
grant execute on function public.supply_list(uuid,date,date,text,text,bigint,bigint,boolean,integer,integer,text,boolean)to authenticated;
create function public.supply_detail(p_venue uuid,p_document uuid,p_before bigint default null)returns jsonb language plpgsql security definer set search_path=''as $$
declare a uuid:=private.supply_scope(p_venue);d private.supply_documents;history jsonb;begin
 perform pg_advisory_xact_lock_shared(hashtextextended('supply-publish:'||p_venue,0));
 select *into d from private.supply_documents where account_id=a and venue_id=p_venue and id=p_document;if not found then raise exception 'Накладная недоступна';end if;
 select coalesce(jsonb_agg(to_jsonb(h)order by id desc),'[]')into history from(select id,revision,action,before_data,after_data,actor_name,reason,created_at from private.supply_history where document_id=d.id and account_id=a and venue_id=p_venue and(p_before is null or id<p_before)order by id desc limit 21)h;
 return jsonb_build_object('id',d.id,'revision',d.revision,'data',d.data,'missing',d.source_missing,'history',history);
end $$;
revoke all on function public.supply_detail(uuid,uuid,bigint)from public,anon,service_role;
grant execute on function public.supply_detail(uuid,uuid,bigint)to authenticated;
create function public.supply_read_configuration(p_venue uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare a uuid:=private.supply_scope(p_venue,true);rules jsonb;begin
 select coalesce(jsonb_agg(to_jsonb(r)order by version desc),'[]')into rules from(select id,version,config,actor_name,reason,created_at from private.supply_read_rules where account_id=a and venue_id=p_venue order by version desc limit 1000)r;
 if jsonb_array_length(rules)>=1000 then raise exception 'Не подтверждена полная история настроек';end if;
 return jsonb_build_object('versions',rules);
end $$;
revoke all on function public.supply_read_configuration(uuid)from public,anon,service_role;
grant execute on function public.supply_read_configuration(uuid)to authenticated;
create function public.supply_save_read_rules(p_venue uuid,p_version integer,p_config jsonb,p_reason text)returns uuid language plpgsql security definer set search_path=''as $$
declare a uuid:=private.supply_scope(p_venue,true);old private.supply_read_rules;rid uuid;actor text;begin
 if p_config is null or jsonb_typeof(p_config)<>'object'or not(p_config?&array['autoRead','intervalMinutes','businessIds','businessNames','provider'])or p_config-array['autoRead','intervalMinutes','businessIds','businessNames','provider']<>'{}'or jsonb_typeof(p_config->'autoRead')is distinct from 'boolean'or jsonb_typeof(p_config->'intervalMinutes')is distinct from 'number'or(p_config->>'intervalMinutes')!~'^\d+$'or(p_config->>'intervalMinutes')::integer not between 15 and 1440 or jsonb_typeof(p_config->'businessIds')is distinct from 'array'or jsonb_array_length(p_config->'businessIds')not between 1 and 100 or exists(select 1 from jsonb_array_elements(p_config->'businessIds')x where jsonb_typeof(x)<>'number'or(x#>>'{}')!~'^[1-9][0-9]{0,15}$')or jsonb_typeof(p_config->'businessNames')is distinct from 'object'or p_reason is null or length(trim(p_reason))not between 1 and 1000 then raise exception 'Проверьте источник, интервал и основание';end if;
 if(select count(*)<>count(distinct x)from jsonb_array_elements(p_config->'businessIds')x)then raise exception 'Повторное заведение в источнике';end if;
 if jsonb_typeof(p_config->'provider')is distinct from 'string'or p_config->>'provider'!~'^[a-f0-9]{64}$'then raise exception 'Не подтверждено подключение источника';end if;
 select jsonb_set(p_config,'{businessIds}',jsonb_agg(value order by(value#>>'{}')::bigint))into p_config from jsonb_array_elements(p_config->'businessIds');
 if exists(select 1 from jsonb_each(p_config->'businessNames')where jsonb_typeof(value)<>'string'or length(value#>>'{}')not between 1 and 500)then raise exception 'Проверьте название заведения в источнике';end if;
 perform pg_advisory_xact_lock(hashtextextended('supply-rules:'||p_venue,0));select *into old from private.supply_read_rules where venue_id=p_venue order by version desc limit 1;
 if p_config->>'provider'is distinct from private.finance_execution_provider(a,p_venue)and not(not(p_config->>'autoRead')::boolean and old.config->>'provider'=p_config->>'provider')then raise exception 'Подключение изменилось. Откройте настройки заново';end if;
 if old.config=p_config and old.reason=trim(p_reason)and old.actor_id=auth.uid()then return old.id;end if;
 if p_version is distinct from coalesce(old.version,0)then raise exception 'Настройки изменились. Обновите страницу';end if;
 if old.id is not null and old.config->'businessIds'is distinct from p_config->'businessIds'and exists(select 1 from private.supply_sources where venue_id=p_venue)then raise exception 'Смена заведения источника требует отдельной сверки связей';end if;
 select coalesce(nullif(trim(concat_ws(' ',first_name,last_name)),''),'Владелец')into actor from public.profiles where id=auth.uid();
 insert into private.supply_read_rules(account_id,venue_id,version,config,actor_id,actor_name,reason)values(a,p_venue,coalesce(old.version,0)+1,p_config,auth.uid(),coalesce(actor,'Владелец'),trim(p_reason))returning id into rid;
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details)values(a,p_venue,auth.uid(),'finance.supply.rules_saved','venue',p_venue,jsonb_build_object('version',coalesce(old.version,0)+1,'reason',trim(p_reason)));
 return rid;
end $$;
revoke all on function public.supply_save_read_rules(uuid,integer,jsonb,text)from public,anon,service_role;
grant execute on function public.supply_save_read_rules(uuid,integer,jsonb,text)to authenticated;
create function private.supply_enqueue(a uuid,v uuid,u uuid)returns uuid language plpgsql set search_path=''as $$
declare rule private.supply_read_rules;request jsonb;j uuid;provider text;begin
 perform pg_advisory_xact_lock(hashtextextended('supply-job:'||v,0));select id into j from private.supply_jobs where account_id=a and venue_id=v and state in('pending','running')limit 1;if j is not null then return j;end if;
 select *into rule from private.supply_read_rules where account_id=a and venue_id=v order by version desc limit 1;if not found then raise exception 'Сначала выберите заведение Quick Resto в настройках поставок';end if;
 provider:=private.finance_execution_provider(a,v);if provider is distinct from rule.config->>'provider'then raise exception 'Подключение изменилось. Нужна отдельная сверка источника';end if;if provider is null then raise exception 'Не настроено подключение Quick Resto';end if;
 select jsonb_build_object('timezone',timezone,'dayStartHour',day_start_hour,'businessIds',rule.config->'businessIds','ruleId',rule.id)into request from public.sales_settings where account_id=a and venue_id=v;if request is null then raise exception 'Не настроено заведение источника';end if;
 insert into private.supply_jobs(account_id,venue_id,request,created_by,payload)values(a,v,request,u,jsonb_build_object('provider',provider,'first','[]'::jsonb,'second','[]'::jsonb,'facts','[]'::jsonb))returning id into j;return j;
end $$;
revoke all on function private.supply_enqueue(uuid,uuid,uuid)from public,anon,authenticated,service_role;
create function public.supply_request(p_venue uuid)returns uuid language plpgsql security definer set search_path=''as $$
declare a uuid:=private.supply_scope(p_venue,true);j uuid;begin
 j:=private.supply_enqueue(a,p_venue,auth.uid());if not exists(select 1 from public.audit_logs where account_id=a and venue_id=p_venue and action_code='finance.supply.read_requested'and details->>'jobId'=j::text)then insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details)values(a,p_venue,auth.uid(),'finance.supply.read_requested','venue',p_venue,jsonb_build_object('jobId',j));end if;return j;
end $$;
revoke all on function public.supply_request(uuid)from public,anon,service_role;
grant execute on function public.supply_request(uuid)to authenticated;
create function public.supply_claim()returns jsonb language plpgsql security definer set search_path=''as $$
declare j private.supply_jobs;begin
 select q.*into j from private.supply_jobs q join public.venues v on v.id=q.venue_id and v.account_id=q.account_id join public.sales_settings s on s.venue_id=q.venue_id and s.account_id=q.account_id where v.archived_at is null and(q.state='pending'or(q.state='running'and q.claimed_at<now()-interval '2 minutes'))and q.next_retry_at<=now()and(s.provider_retry_at is null or s.provider_retry_at<=now())order by q.created_at,q.id for update of q skip locked limit 1;
 if not found then return null;end if;
 update private.supply_jobs set state='running',lease=gen_random_uuid(),claimed_at=now(),attempts=attempts+1,updated_at=now()where id=j.id returning *into j;return to_jsonb(j);
end $$;
revoke all on function public.supply_claim()from public,anon,authenticated;
grant execute on function public.supply_claim()to service_role;
create function private.supply_validate_facts(f jsonb,full_facts boolean)returns void language plpgsql set search_path=''as $$
declare x jsonb;k text;keys text[]:=array['id','version','number','invoiceAt','providerId','providerName','storeId','storeTitle','processed','paid','amountCents','authorName'];begin
 if full_facts then keys:=keys||array['businessId','invoiceDate','paidAt','paidDate','accountId','accountTitle','issues'];end if;
 if f is null or jsonb_typeof(f)<>'array'or jsonb_array_length(f)>30000 or octet_length(f::text)>20000000 then raise exception 'Не подтверждён полный список поставок';end if;
 if(select count(*)<>count(distinct row_data->>'id')from jsonb_array_elements(f)row_data)then raise exception 'Повторные ID накладных';end if;
 for x in select value from jsonb_array_elements(f)loop
  if jsonb_typeof(x)<>'object'or not(x?&keys)or x-keys<>'{}'then raise exception 'Некорректные поля накладной';end if;
  foreach k in array array['id','storeId']loop if jsonb_typeof(x->k)is distinct from 'number'or(x->>k)!~'^[1-9][0-9]{0,15}$'or(x->>k)::numeric>9007199254740991 then raise exception 'Не подтверждён ID накладной/склада';end if;end loop;
  foreach k in array array['version','amountCents']loop if jsonb_typeof(x->k)is distinct from 'number'or(x->>k)!~'^\d+$'or(x->>k)::numeric>1000000000000 then raise exception 'Не подтверждена версия/сумма накладной';end if;end loop;
  foreach k in array array['number','storeTitle']loop if jsonb_typeof(x->k)is distinct from 'string'or length(trim(x->>k))not between 1 and 500 then raise exception 'Не подтверждено название накладной/склада';end if;end loop;
  foreach k in array array['providerName','authorName']loop if x->k<>'null'and(jsonb_typeof(x->k)<>'string'or length(x->>k)>500)then raise exception 'Некорректное имя в накладной';end if;end loop;
  if x->'providerId'<>'null'and(jsonb_typeof(x->'providerId')<>'number'or(x->>'providerId')!~'^[1-9][0-9]{0,15}$')then raise exception 'Не подтверждён поставщик';end if;
  if jsonb_typeof(x->'processed')is distinct from 'boolean'or jsonb_typeof(x->'paid')is distinct from 'boolean'or jsonb_typeof(x->'invoiceAt')is distinct from 'string'or x->>'invoiceAt'!~'^\d{4}-\d{2}-\d{2}T.*Z$'then raise exception 'Не подтверждены дата и состояние накладной';end if;
  perform(x->>'invoiceAt')::timestamptz;
  if full_facts then
   if jsonb_typeof(x->'businessId')is distinct from 'number'or(x->>'businessId')!~'^[1-9][0-9]{0,15}$'or jsonb_typeof(x->'invoiceDate')is distinct from 'string'or(x->>'invoiceDate')!~'^\d{4}-\d{2}-\d{2}$'then raise exception 'Не подтверждено заведение/дата поставки';end if;
   perform(x->>'invoiceDate')::date;
   if(x->'paidAt'='null')is distinct from(x->'paidDate'='null')then raise exception 'Неполная дата оплаты';end if;
   if x->'paidAt'<>'null'then if jsonb_typeof(x->'paidAt')<>'string'or(x->>'paidAt')!~'^\d{4}-\d{2}-\d{2}T.*Z$'or jsonb_typeof(x->'paidDate')<>'string'or(x->>'paidDate')!~'^\d{4}-\d{2}-\d{2}$'then raise exception 'Некорректная дата оплаты';end if;perform(x->>'paidAt')::timestamptz;perform(x->>'paidDate')::date;end if;
   if x->'accountId'<>'null'and(jsonb_typeof(x->'accountId')<>'number'or(x->>'accountId')!~'^[1-9][0-9]{0,15}$')then raise exception 'Не подтверждён счёт оплаты';end if;
   if x->'accountTitle'<>'null'and(jsonb_typeof(x->'accountTitle')<>'string'or length(x->>'accountTitle')>500)then raise exception 'Некорректное название счёта';end if;
   if jsonb_typeof(x->'issues')is distinct from 'array'or jsonb_array_length(x->'issues')>10 or exists(select 1 from jsonb_array_elements(x->'issues')issue where jsonb_typeof(issue)<>'string'or length(issue#>>'{}')>300)then raise exception 'Некорректные уточнения поставки';end if;
  end if;
 end loop;
end $$;
revoke all on function private.supply_validate_facts(jsonb,boolean)from public,anon,authenticated,service_role;
create function private.supply_header_projection(f jsonb)returns jsonb language sql immutable set search_path=''as $$select coalesce(jsonb_agg(value-array['businessId','invoiceDate','paidAt','paidDate','accountId','accountTitle','issues']order by n),'[]')from jsonb_array_elements(f)with ordinality e(value,n)$$;
revoke all on function private.supply_header_projection(jsonb)from public,anon,authenticated,service_role;
create function public.supply_save_slice(p_job uuid,p_lease uuid,p_phase text,p_cursor integer,p_payload jsonb)returns void language plpgsql security definer set search_path=''as $$
declare j private.supply_jobs;first_sorted jsonb;second_sorted jsonb;prior_sorted jsonb;key text;begin
 select *into j from private.supply_jobs where id=p_job and state='running'and lease=p_lease and claimed_at>now()-interval '2 minutes'for update;if not found then raise exception 'Чтение поставок передано другому обработчику';end if;
 if p_phase not in('grid_first','financial_first','grid_verify','financial_verify')or p_cursor not between 0 and 30000 or p_payload is null or jsonb_typeof(p_payload)<>'object'or not(p_payload?&array['first','second','facts','provider'])or p_payload-array['first','second','facts','provider']<>'{}'or p_payload->>'provider'is distinct from j.payload->>'provider'or octet_length(p_payload::text)>30000000 then raise exception 'Некорректное состояние чтения поставок';end if;
 perform private.supply_validate_facts(p_payload->'first',false);perform private.supply_validate_facts(p_payload->'second',false);perform private.supply_validate_facts(p_payload->'facts',true);
 if p_phase=j.phase and p_phase in('grid_first','grid_verify')then
  key:=case when p_phase='grid_first'then 'first'else 'second'end;
  if p_cursor<=j.cursor or p_cursor-j.cursor>500 or jsonb_array_length(p_payload->key)<>p_cursor or exists(select 1 from jsonb_array_elements(j.payload->key)with ordinality previous(value,n)where p_payload->key->(n::integer-1)is distinct from value)then raise exception 'Пропущена или изменена страница поставок';end if;
  if p_phase='grid_first'and(p_payload->'second'<>'[]'or p_payload->'facts'<>'[]')then raise exception 'Изменился первый проход';end if;
  if p_phase='grid_verify'and(p_payload->'first'is distinct from j.payload->'first'or p_payload->'facts'is distinct from j.payload->'facts')then raise exception 'Изменились исходные поставки';end if;
 elsif j.phase='grid_first'and p_phase='financial_first'and p_cursor=j.cursor and p_payload->'second'='[]'and p_payload->'facts'='[]'then
  select coalesce(jsonb_agg(e order by(e->>'id')::bigint),'[]')into prior_sorted from jsonb_array_elements(j.payload->'first')e;
  if p_payload->'first'is distinct from prior_sorted then raise exception 'Неполный первый проход поставок';end if;
 elsif j.phase='financial_first'and p_phase='grid_verify'and p_cursor=0 and p_payload->'first'=j.payload->'first'and p_payload->'second'='[]'then
  if private.supply_header_projection(p_payload->'facts')is distinct from j.payload->'first'then raise exception 'Оплаты и накладные не совпали';end if;
 elsif j.phase='grid_verify'and p_phase='financial_verify'and p_cursor=j.cursor and p_payload->'first'=j.payload->'first'and p_payload->'facts'=j.payload->'facts'then
  select coalesce(jsonb_agg(e order by(e->>'id')::bigint),'[]')into second_sorted from jsonb_array_elements(j.payload->'second')e;
  if p_payload->'second'is distinct from second_sorted or second_sorted is distinct from j.payload->'first'then raise exception 'Два прохода поставок не совпали';end if;
 else raise exception 'Некорректный переход чтения поставок';end if;
 update private.supply_jobs set phase=p_phase,cursor=p_cursor,payload=p_payload,source_failures=0,state='pending',lease=null,claimed_at=null,next_retry_at=now(),updated_at=now()where id=j.id;
end $$;
revoke all on function public.supply_save_slice(uuid,uuid,text,integer,jsonb)from public,anon,authenticated;
grant execute on function public.supply_save_slice(uuid,uuid,text,integer,jsonb)to service_role;
create function public.supply_publish(p_job uuid,p_lease uuid,p_facts jsonb,p_provider text)returns jsonb language plpgsql security definer set search_path=''as $$
declare j private.supply_jobs;s private.supply_sources;d private.supply_documents;r jsonb;hash text;version integer;created_n integer:=0;changed_n integer:=0;rule private.supply_read_rules;begin
 select *into j from private.supply_jobs where id=p_job and state='running'and phase='financial_verify'and lease=p_lease and claimed_at>now()-interval '2 minutes'for update;if not found then raise exception 'Чтение поставок передано другому обработчику';end if;
 perform pg_advisory_xact_lock(hashtextextended('supply-publish:'||j.venue_id,0));
 perform 1 from public.venues where id=j.venue_id and account_id=j.account_id and archived_at is null for share;if not found then raise exception 'Заведение недоступно';end if;
 if p_provider is distinct from j.payload->>'provider'or p_provider is distinct from private.finance_execution_provider(j.account_id,j.venue_id)then raise exception 'Подключение изменилось до сохранения поставок';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('supply-rules:'||j.venue_id,0));
 select rules.*into rule from private.supply_read_rules rules where rules.account_id=j.account_id and rules.venue_id=j.venue_id order by rules.version desc limit 1;
 if rule.id is distinct from(j.request->>'ruleId')::uuid or rule.config->'businessIds'is distinct from j.request->'businessIds'or not exists(select 1 from public.sales_settings where account_id=j.account_id and venue_id=j.venue_id and timezone=j.request->>'timezone'and day_start_hour=(j.request->>'dayStartHour')::integer)then raise exception 'Настройки источника изменились. Обновите поставки заново';end if;
 perform private.supply_validate_facts(p_facts,true);
 if p_facts is distinct from j.payload->'facts'or j.payload->'first'is distinct from j.payload->'second'or private.supply_header_projection(p_facts)is distinct from j.payload->'first'or j.cursor<>jsonb_array_length(p_facts)then raise exception 'Два полных прохода поставок/оплат не совпали';end if;
 if exists(select 1 from jsonb_array_elements(p_facts)fact where not(j.request->'businessIds'@>jsonb_build_array((fact->>'businessId')::bigint))or(fact->>'invoiceDate')::date<>((fact->>'invoiceAt')::timestamptz at time zone(j.request->>'timezone'))::date or(fact->>'paidDate')::date is distinct from((fact->>'paidAt')::timestamptz at time zone(j.request->>'timezone'))::date)then raise exception 'Не подтверждены заведение и даты поставок';end if;
 select *into s from private.supply_sources where venue_id=j.venue_id for update;
 if s.provider is not null and s.provider<>p_provider then raise exception 'Источник поставок изменился. Нужна сверка связей';end if;
 if s.rows>0 and jsonb_array_length(p_facts)=0 then raise exception 'Пустой источник требует отдельной проверки';end if;
 hash:=md5(p_facts::text);version:=coalesce(s.version,0)+case when s.source_hash is distinct from hash then 1 else 0 end;
 if s.source_hash is distinct from hash then
  for r in select value from jsonb_array_elements(p_facts)loop
   select *into d from private.supply_documents where account_id=j.account_id and venue_id=j.venue_id and qr_id=(r->>'id')::bigint for update;
   if not found then
    insert into private.supply_documents(account_id,venue_id,qr_id,data)values(j.account_id,j.venue_id,(r->>'id')::bigint,r)returning *into d;created_n:=created_n+1;
    insert into private.supply_history(document_id,account_id,venue_id,revision,action,after_data,reason)values(d.id,j.account_id,j.venue_id,d.revision,'created',r,'Первое подтверждённое чтение Quick Resto');
   elsif d.data is distinct from r or d.source_missing then
    insert into private.supply_history(document_id,account_id,venue_id,revision,action,before_data,after_data,reason)values(d.id,j.account_id,j.venue_id,d.revision+1,case when d.source_missing then 'returned'else 'updated'end,d.data||jsonb_build_object('sourceMissing',d.source_missing),r||'{"sourceMissing":false}','Обновление подтверждённого источника');
    update private.supply_documents set data=r,source_missing=false,revision=revision+1,updated_at=now()where id=d.id;changed_n:=changed_n+1;
   end if;
  end loop;
  for d in select *from private.supply_documents where account_id=j.account_id and venue_id=j.venue_id and not source_missing and qr_id not in(select(value->>'id')::bigint from jsonb_array_elements(p_facts))for update loop
   insert into private.supply_history(document_id,account_id,venue_id,revision,action,before_data,after_data,reason)values(d.id,j.account_id,j.venue_id,d.revision+1,'missing',d.data,d.data||'{"sourceMissing":true}','Накладной нет в полном подтверждённом источнике. История сохранена.');
   update private.supply_documents set source_missing=true,revision=revision+1,updated_at=now()where id=d.id;changed_n:=changed_n+1;
  end loop;
  insert into private.supply_sources(account_id,venue_id,provider,version,source_hash,rows)values(j.account_id,j.venue_id,p_provider,version,hash,jsonb_array_length(p_facts))on conflict(venue_id)do update set version=excluded.version,source_hash=excluded.source_hash,rows=excluded.rows,checked_at=now();
  insert into public.audit_logs(account_id,venue_id,action_code,entity_type,entity_id,details)values(j.account_id,j.venue_id,'finance.supply.source_updated','venue',j.venue_id,jsonb_build_object('version',version,'created',created_n,'changed',changed_n,'rows',jsonb_array_length(p_facts)));
 else update private.supply_sources set checked_at=now()where venue_id=j.venue_id;end if;
 update private.supply_jobs set state='done',lease=null,claimed_at=null,last_error=null,payload='{}',updated_at=now()where id=j.id;
 return jsonb_build_object('created',created_n,'changed',changed_n,'version',version,'rows',jsonb_array_length(p_facts));
end $$;
revoke all on function public.supply_publish(uuid,uuid,jsonb,text)from public,anon,authenticated;
grant execute on function public.supply_publish(uuid,uuid,jsonb,text)to service_role;
create function public.supply_fail(p_job uuid,p_lease uuid,p_message text,p_retry_seconds integer default null)returns void language plpgsql security definer set search_path=''as $$
declare j private.supply_jobs;begin
 select *into j from private.supply_jobs where id=p_job and state='running'and lease=p_lease and claimed_at>now()-interval '2 minutes'for update;if not found then return;end if;
 update private.supply_jobs set state=case when p_retry_seconds is not null then 'pending'else 'error'end,payload=case when p_retry_seconds is null then '{}'else payload end,lease=null,claimed_at=null,last_error=left(p_message,1000),source_failures=case when p_retry_seconds is null then source_failures else source_failures+1 end,next_retry_at=now()+make_interval(secs=>greatest(30,least(900,coalesce(p_retry_seconds,60)))),updated_at=now()where id=j.id;
 if p_retry_seconds is not null then update public.sales_settings set provider_retry_at=greatest(coalesce(provider_retry_at,now()),now()+make_interval(secs=>greatest(30,least(900,p_retry_seconds))))where account_id=j.account_id;end if;
end $$;
revoke all on function public.supply_fail(uuid,uuid,text,integer)from public,anon,authenticated;
grant execute on function public.supply_fail(uuid,uuid,text,integer)to service_role;
create function public.supply_schedule()returns integer language plpgsql security definer set search_path=''as $$
declare rule private.supply_read_rules;last_read timestamptz;begin
 for rule in select p.*from(select distinct on(venue_id)*from private.supply_read_rules order by venue_id,version desc)p join public.venues v on v.id=p.venue_id and v.account_id=p.account_id where v.archived_at is null and(p.config->>'autoRead')::boolean loop
  if exists(select 1 from private.supply_jobs where venue_id=rule.venue_id and state in('pending','running'))then continue;end if;
  select max(created_at)into last_read from private.supply_jobs where venue_id=rule.venue_id;
  if last_read is null or last_read<=now()-make_interval(mins=>(rule.config->>'intervalMinutes')::integer)then perform private.supply_enqueue(rule.account_id,rule.venue_id,null);end if;
 end loop;return(select count(*)::integer from private.supply_jobs q join public.venues v on v.id=q.venue_id and v.account_id=q.account_id join public.sales_settings s on s.venue_id=q.venue_id and s.account_id=q.account_id where v.archived_at is null and(q.state='pending'or(q.state='running'and q.claimed_at<now()-interval '2 minutes'))and q.next_retry_at<=now()and(s.provider_retry_at is null or s.provider_retry_at<=now()));
end $$;
revoke all on function public.supply_schedule()from public,anon,authenticated;
grant execute on function public.supply_schedule()to service_role;
create policy supply_audit_read on public.audit_logs as restrictive for select to authenticated using(action_code not like 'finance.supply.%'or(account_id=(select public.get_active_account_id())and venue_id=(select public.get_active_venue_id())and(select public.has_permission('finance.view_transactions'))));
alter table private.sales_worker_rotation drop constraint sales_worker_rotation_lane_check;
alter table private.sales_worker_rotation add constraint sales_worker_rotation_lane_check check(lane between 0 and 9);
create or replace function public.sales_next_worker_lane()returns integer language sql security definer set search_path=''as $$insert into private.sales_worker_rotation as rotation(id,lane)values(true,0)on conflict(id)do update set lane=(rotation.lane+1)%10 returning lane$$;
revoke all on function public.sales_next_worker_lane()from public,anon,authenticated;
grant execute on function public.sales_next_worker_lane()to service_role;
commit;
