begin;
-- In-app only. No Telegram, push, ledger, balance or payroll effects.
create table private.cash_control_alert_events (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,
 day_id uuid not null references public.cash_control_days(id) on delete cascade,
 rule_id uuid not null references public.cash_control_rules(id) on delete cascade,
 provider text not null check(provider ~ '^[a-f0-9]{64}$'),report_id bigint not null check(report_id>0),kind text not null check(kind in ('open','close')),
 occurred_at timestamptz not null,expected_cents bigint not null,declared_cents bigint not null,diff_cents bigint not null,
 threshold_cents bigint not null check(threshold_cents>=0),source_version integer not null check(source_version>0),created_at timestamptz not null default now(),
 unique(venue_id,provider,report_id,kind),foreign key(account_id,venue_id) references public.venues(account_id,id) on delete cascade
);
create index cash_control_alert_day on private.cash_control_alert_events(day_id);
create index cash_control_alert_rule on private.cash_control_alert_events(rule_id);
create index cash_control_alert_scope on private.cash_control_alert_events(account_id,venue_id,created_at);
alter table private.cash_control_alert_events enable row level security;
revoke all on private.cash_control_alert_events from public,anon,authenticated,service_role;

-- Same live audience for delivery and later visibility. A fired membership is
-- excluded even if its role still has finance permission. Owners are explicit.
create function private.cash_control_finance_recipient(v uuid,u uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select u is not null and exists(
  select 1 from public.venues ve join public.accounts a on a.id=ve.account_id
  join auth.users au on au.id=u
  where ve.id=v and ve.archived_at is null and (a.owner_id=u or exists(
   select 1 from public.user_venue_roles m join public.roles r on r.id=m.role_id
   join public.role_permissions rp on rp.role_id=r.id and rp.granted
   join public.permissions p on p.id=rp.permission_id and p.code='finance.view_transactions'
   where m.user_id=u and m.venue_id=v and m.status='active' and m.fired_at is null
     and (r.venue_id=v or r.venue_id is null)
  ))
 )
$$;
revoke all on function private.cash_control_finance_recipient(uuid,uuid) from public,anon,authenticated,service_role;
create function public.cash_control_notification_visible(p_venue uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.cash_control_finance_recipient(p_venue,auth.uid())
$$;
revoke all on function public.cash_control_notification_visible(uuid) from public,anon;
grant execute on function public.cash_control_notification_visible(uuid) to authenticated;
create policy cash_control_notification_select on public.notifications as restrictive for select to authenticated
 using(type<>'finance.cash_discrepancy' or public.cash_control_notification_visible(venue_id));
create policy cash_control_notification_update on public.notifications as restrictive for update to authenticated
 using(type<>'finance.cash_discrepancy' or public.cash_control_notification_visible(venue_id))
 with check(type<>'finance.cash_discrepancy' or public.cash_control_notification_visible(venue_id));
create unique index cash_control_notification_once on public.notifications(user_id,entity_id,type)
 where entity_type='cash_control_event' and type='finance.cash_discrepancy';

-- Add a default without rewriting historical rules. Old clients remain valid;
-- optimistic version checks prevent overwriting newer enabled settings.
create or replace function public.cash_control_save_rules(p_venue uuid,p_version integer,p_config jsonb,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare a uuid:=private.finance_settlement_owner(p_venue);old public.cash_control_rules;rid uuid;actor text;c jsonb;begin
 if p_reason is null or length(trim(p_reason)) not between 1 and 1000 or p_config is null or jsonb_typeof(p_config)<>'object' or not(p_config ?& array['thresholdCents','opening','closing','autoRead','intervalMinutes']) or p_config-array['thresholdCents','opening','closing','autoRead','intervalMinutes','notifyFinance','notificationAudience']<>'{}' then raise exception 'Проверьте параметры контроля кассы и основание';end if;
 c:='{"notifyFinance":false,"notificationAudience":"owner_finance"}'::jsonb||p_config;
 if coalesce(c->>'notificationAudience','') not in ('owner','owner_finance') then raise exception 'Выберите получателей уведомления';end if;
 if jsonb_typeof(c->'thresholdCents') is distinct from 'number' or (c->>'thresholdCents')::numeric not between 0 and 10000000000 or (c->>'thresholdCents')::numeric<>trunc((c->>'thresholdCents')::numeric) or jsonb_typeof(c->'opening') is distinct from 'boolean' or jsonb_typeof(c->'closing') is distinct from 'boolean' or jsonb_typeof(c->'autoRead') is distinct from 'boolean' or jsonb_typeof(c->'notifyFinance') is distinct from 'boolean' or jsonb_typeof(c->'intervalMinutes') is distinct from 'number' or (c->>'intervalMinutes')::numeric not between 15 and 1440 or (c->>'intervalMinutes')::numeric<>trunc((c->>'intervalMinutes')::numeric) then raise exception 'Проверьте порог и интервал проверки';end if;
 perform pg_advisory_xact_lock(hashtextextended('cash-control-rules:'||p_venue,0));
 select * into old from public.cash_control_rules where account_id=a and venue_id=p_venue order by version desc limit 1;
 if ('{"notifyFinance":false,"notificationAudience":"owner_finance"}'::jsonb||old.config)=c and old.reason=trim(p_reason) and old.created_by=auth.uid() then return old.id;end if;
 if p_version is distinct from coalesce(old.version,0) then raise exception 'Правила изменились. Обновите страницу';end if;
 select coalesce(nullif(trim(concat_ws(' ',first_name,last_name)),''),'Пользователь') into actor from public.profiles where id=auth.uid();
 insert into public.cash_control_rules(account_id,venue_id,version,config,reason,created_by,actor_name) values(a,p_venue,coalesce(old.version,0)+1,c,trim(p_reason),auth.uid(),coalesce(actor,'Пользователь')) returning id into rid;
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details) values(a,p_venue,auth.uid(),'cash.control.rules_saved','venue',p_venue,jsonb_build_object('version',coalesce(old.version,0)+1,'reason',trim(p_reason),'config',c));return rid;
end $$;
revoke all on function public.cash_control_save_rules(uuid,integer,jsonb,text) from public,anon,service_role;
grant execute on function public.cash_control_save_rules(uuid,integer,jsonb,text) to authenticated;

-- Read the configured hour as well as the timezone. An unassigned NULL hour
-- previously made the future-day comparison unknown instead of rejecting it.
create or replace function public.cash_control_request(p_venue uuid,p_date date) returns uuid
language plpgsql security definer set search_path='' as $$
declare a uuid:=private.finance_settlement_owner(p_venue);tz text;h integer;rid uuid;begin
 select timezone,day_start_hour into tz,h from public.sales_settings where account_id=a and venue_id=p_venue;
 if tz is null or p_date is null or p_date<'2000-01-01' or p_date>((now() at time zone tz)-make_interval(hours=>h))::date then raise exception 'Выберите текущий или прошедший рабочий день';end if;
 perform pg_advisory_xact_lock(hashtextextended('cash-control-job:'||p_venue||':'||p_date,0));rid:=private.cash_control_enqueue(a,p_venue,p_date,auth.uid());
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details) select a,p_venue,auth.uid(),'cash.control.requested','venue',p_venue,jsonb_build_object('date',p_date,'job_id',rid) where not exists(select 1 from public.audit_logs where action_code='cash.control.requested' and details->>'job_id'=rid::text and created_at>=(select requested_at from private.cash_control_jobs where id=rid));return rid;
end $$;
revoke all on function public.cash_control_request(uuid,date) from public,anon,service_role;
grant execute on function public.cash_control_request(uuid,date) to authenticated;

-- A confirmed history insert and its deliveries commit together. There is no
-- separately retryable external send. Unique source identity survives >7 days.
create function private.cash_control_notify_confirmed() returns trigger
language plpgsql security definer set search_path='' as $$
declare d public.cash_control_days;rule public.cash_control_rules;r jsonb;k text;
 expected bigint;declared bigint;diff bigint;threshold bigint;stamp timestamptz;
event uuid;owner uuid;recipients integer;title text;body text;source_provider text;begin
 select * into d from public.cash_control_days where id=new.day_id;
 select * into rule from public.cash_control_rules where account_id=d.account_id and venue_id=d.venue_id order by version desc limit 1;
 if rule.id is null or coalesce((rule.config->>'notifyFinance')::boolean,false) is not true then return new;end if;
 if not exists(select 1 from public.sales_settings s join public.venues v on v.id=s.venue_id
  where s.account_id=d.account_id and s.venue_id=d.venue_id and v.archived_at is null
   and s.timezone=new.request->>'timezone' and s.day_start_hour=(new.request->>'dayStartHour')::integer) then return new;end if;
 select q.provider into source_provider from private.cash_control_jobs q where q.venue_id=d.venue_id and q.business_date=d.business_date and q.state='running' and q.phase='verify' and q.claimed_at>now()-interval '2 minutes';
 if source_provider is null then return new;end if;
 select owner_id into owner from public.accounts where id=d.account_id;
 threshold:=(rule.config->>'thresholdCents')::bigint;
 for r in select value from jsonb_array_elements(new.reports) loop
  if r->'incomplete' is distinct from 'false'::jsonb then continue;end if;
  foreach k in array array['open','close'] loop
   if (k='open' and not (rule.config->>'opening')::boolean) or (k='close' and (not (rule.config->>'closing')::boolean or r->>'status'<>'CLOSED')) then continue;end if;
   expected:=(r->>case when k='open' then 'openExpected' else 'closeExpected' end)::bigint;
   declared:=(r->>case when k='open' then 'openDeclared' else 'closeDeclared' end)::bigint;
   stamp:=(r->>case when k='open' then 'openedAt' else 'closedAt' end)::timestamptz;
   diff:=declared-expected;
   -- Installing/enabling rules never replays an archive of old discrepancies.
   if expected is null or declared is null or stamp is null or stamp<rule.created_at or stamp>clock_timestamp() or abs(diff)<=threshold then continue;end if;
   event:=null;
   insert into private.cash_control_alert_events(account_id,venue_id,day_id,rule_id,provider,report_id,kind,occurred_at,expected_cents,declared_cents,diff_cents,threshold_cents,source_version)
   values(d.account_id,d.venue_id,d.id,rule.id,source_provider,(r->>'id')::bigint,k,stamp,expected,declared,diff,threshold,new.version)
   on conflict(venue_id,provider,report_id,kind) do nothing returning id into event;
   if event is null then continue;end if;
   title:=case when k='open' then 'Расхождение при открытии кассы' else 'Расхождение при закрытии кассы' end;
   body:=to_char(d.business_date,'DD.MM.YYYY')||' · '||coalesce(r->>'terminal','Касса')||' · '||case when diff<0 then 'недостача ' else 'излишек ' end||replace((abs(diff)/100.0)::numeric(16,2)::text,'.',',')||' ₽. Расчёт: '||replace((expected/100.0)::numeric(16,2)::text,'.',',')||' ₽; указано: '||replace((declared/100.0)::numeric(16,2)::text,'.',',')||' ₽.';
   insert into public.notifications(user_id,venue_id,type,category,title,body,link,entity_type,entity_id,payload,pushed_at)
   select distinct u.id,d.venue_id,'finance.cash_discrepancy','finance',title,body,
    case when u.id=owner or exists(select 1 from public.user_venue_roles m join public.role_permissions rp on rp.role_id=m.role_id and rp.granted join public.permissions p on p.id=rp.permission_id and p.code='sales.view_shifts' where m.user_id=u.id and m.venue_id=d.venue_id and m.status='active' and m.fired_at is null)
     then '/sales/shifts?from='||d.business_date||'&to='||d.business_date||'&day='||d.business_date else null end,
    'cash_control_event',event,jsonb_build_object('business_date',d.business_date,'kind',k,'report_id',(r->>'id')::bigint,'diff_cents',diff,'rule_version',rule.version,'source_version',new.version),now()
   from (select owner id union select m.user_id from public.user_venue_roles m join public.role_permissions rp on rp.role_id=m.role_id and rp.granted join public.permissions p on p.id=rp.permission_id and p.code='finance.view_transactions' where m.venue_id=d.venue_id and m.status='active' and m.fired_at is null) candidates
   join auth.users u on u.id=candidates.id where private.cash_control_finance_recipient(d.venue_id,u.id) and (coalesce(rule.config->>'notificationAudience','owner_finance')='owner_finance' or u.id=owner)
   on conflict(user_id,entity_id,type) where entity_type='cash_control_event' and type='finance.cash_discrepancy' do nothing;
   get diagnostics recipients=row_count;
   insert into public.audit_logs(account_id,venue_id,action_code,entity_type,entity_id,details)
   values(d.account_id,d.venue_id,'cash.control.alert_sent','venue',d.venue_id,jsonb_build_object('date',d.business_date,'kind',k,'diffCents',diff,'recipients',recipients,'event_id',event,'rule_version',rule.version,'source_version',new.version));
  end loop;
 end loop;
 return new;
end $$;
revoke all on function private.cash_control_notify_confirmed() from public,anon,authenticated,service_role;
create trigger cash_control_confirmed_notification after insert on public.cash_control_history
 for each row execute function private.cash_control_notify_confirmed();
commit;
