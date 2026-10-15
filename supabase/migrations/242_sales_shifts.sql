begin;
insert into public.permissions(code,description,module) values
 ('sales.view_shifts','Просмотр финансовых смен','sales'),
 ('sales.adjust_shifts','Исправление показателей смен','sales'),
 ('sales.export_shifts','Экспорт смен','sales'),
 ('sales.sync_shifts','Загрузка смен из Quick Resto','sales'),
 ('sales.configure_shifts','Настройка источников смен','sales') on conflict(code) do nothing;
insert into public.role_permissions(role_id,permission_id,granted)
select r.id,p.id,true from public.roles r cross join public.permissions p
where (r.code='owner' and p.module='sales') or (r.code='custom_manager' and p.code in ('sales.view_shifts','sales.adjust_shifts','sales.export_shifts'))
on conflict(role_id,permission_id) do nothing;

create table public.sales_settings (
 venue_id uuid primary key references public.venues(id) on delete cascade,
 account_id uuid not null references public.accounts(id) on delete cascade,
 enabled boolean not null default false,
 timezone text not null default 'Europe/Moscow', day_start_hour integer not null default 9 check(day_start_hour between 0 and 23),
 staff_group_id integer not null default 8 check(staff_group_id>0),
 tip_products jsonb not null default '{"679":-1,"680":-5,"681":-10,"682":-50,"683":-100,"3185":-500,"3186":-1000}',
 deposit_products jsonb not null default '{"1649":-1,"1648":-5,"1164":-10,"1162":-50,"1019":-100,"751":-1000,"2766":-5000}',
 parking_product_ids integer[] not null default '{1503}', hookah_report_id integer not null default 216 check(hookah_report_id>0),
 quickresto_venue_id integer check(quickresto_venue_id>0), legacy_place_id text,
 comparison_started_at timestamptz, updated_at timestamptz not null default now(),
 check(jsonb_typeof(tip_products)='object' and jsonb_typeof(deposit_products)='object')
);
create table public.sales_days (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.accounts(id) on delete cascade,
 venue_id uuid not null references public.venues(id) on delete cascade, business_date date not null,
 status text not null default 'preliminary' check(status in ('preliminary','complete','imported')),
 calculated jsonb not null default '{}', overrides jsonb not null default '{}', legacy jsonb not null default '{}',
 legacy_source_id text, note text not null default '', sync_error text, synced_at timestamptz,
 source_summary jsonb not null default '{}', method_version text not null default 'glide-2026-10-v1',
 version integer not null default 1, updated_at timestamptz not null default now(), unique(venue_id,business_date),
 check(jsonb_typeof(calculated)='object' and jsonb_typeof(overrides)='object' and jsonb_typeof(legacy)='object')
);
create unique index sales_one_enabled_venue on public.sales_settings(account_id) where enabled;
create table public.sales_events (
 id uuid primary key default gen_random_uuid(), day_id uuid not null references public.sales_days(id) on delete cascade,
 actor_id uuid references public.profiles(id) on delete set null, actor_name text,
 kind text not null check(kind in ('adjustment','sync','import')), changes jsonb not null default '{}',
 reason text not null default '', created_at timestamptz not null default now()
);
create table public.sales_sync_jobs (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.accounts(id) on delete cascade,
 venue_id uuid not null references public.sales_settings(venue_id) on delete cascade, business_date date not null,
 status text not null default 'queued' check(status in ('queued','running','success','failed')),
 phase text not null default 'orders' check(phase in ('orders','details','reports','commit')),
 cursor integer not null default 0, payload jsonb not null default '{}', error text,
 lease_token uuid, leased_until timestamptz, attempts integer not null default 0,
 created_by uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now(), finished_at timestamptz
);
create unique index sales_one_active_job on public.sales_sync_jobs(venue_id,business_date) where status in ('queued','running');
create index sales_job_claim on public.sales_sync_jobs(status,created_at);
create index sales_days_period on public.sales_days(account_id,venue_id,business_date desc);
create index sales_events_day on public.sales_events(day_id,created_at desc);
create table public.sales_sync_receipts (
 job_id uuid not null references public.sales_sync_jobs(id) on delete cascade,
 order_id bigint not null, order_data jsonb not null, detail_data jsonb, primary key(job_id,order_id)
);

alter table public.sales_settings enable row level security;
alter table public.sales_days enable row level security;
alter table public.sales_events enable row level security;
alter table public.sales_sync_jobs enable row level security;
alter table public.sales_sync_receipts enable row level security;
create policy sales_settings_read on public.sales_settings for select to authenticated using (
 account_id=(select public.get_active_account_id()) and venue_id=(select public.get_active_venue_id()) and (select public.has_permission('sales.view_shifts')));
create policy sales_days_read on public.sales_days for select to authenticated using (
 account_id=(select public.get_active_account_id()) and venue_id=(select public.get_active_venue_id()) and (select public.has_permission('sales.view_shifts')));
create policy sales_events_read on public.sales_events for select to authenticated using(exists(select 1 from public.sales_days d where d.id=day_id));
create policy sales_jobs_read on public.sales_sync_jobs for select to authenticated using (
 account_id=(select public.get_active_account_id()) and venue_id=(select public.get_active_venue_id()) and (select public.has_permission('sales.view_shifts')));
revoke all on public.sales_settings,public.sales_days,public.sales_events,public.sales_sync_jobs,public.sales_sync_receipts from anon,authenticated;
grant select on public.sales_settings,public.sales_days,public.sales_events to authenticated;
-- Worker payloads and raw receipts are deliberately unavailable to browser roles.
grant all on public.sales_settings,public.sales_days,public.sales_events,public.sales_sync_jobs,public.sales_sync_receipts to service_role;

create or replace function private.sales_validate_metrics(p_values jsonb,p_allow_null boolean default false)
returns void language plpgsql immutable set search_path='' as $$
declare k text; v jsonb; n numeric;
begin
 if jsonb_typeof(p_values)<>'object' then raise exception 'Некорректные показатели'; end if;
 for k,v in select * from jsonb_each(p_values) loop
  if k not in ('turnover','hookah','bar','tips','service','tips_total','parking','taxi','checks','staff_checks','deposits') then raise exception 'Неизвестный показатель: %',k; end if;
  if v='null'::jsonb and p_allow_null then continue; end if;
  if jsonb_typeof(v)<>'number' then raise exception 'Показатель должен быть числом'; end if;
  n:=(v#>>'{}')::numeric;
  if abs(n)>1000000000000 or round(n,2)<>n then raise exception 'Некорректная сумма'; end if;
  if k='checks' and (n<0 or trunc(n)<>n) then raise exception 'Количество чеков должно быть целым'; end if;
 end loop;
end $$;
revoke all on function private.sales_validate_metrics(jsonb,boolean) from public;
grant execute on function private.sales_validate_metrics(jsonb,boolean) to service_role;
grant usage on schema private to service_role;

create or replace function private.sales_effective(p_calculated jsonb,p_overrides jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare m jsonb:=p_calculated||p_overrides;
begin
 if not p_overrides ? 'bar' then m:=m||jsonb_build_object('bar',(m->>'turnover')::numeric-(m->>'hookah')::numeric);end if;
 if not p_overrides ? 'tips_total' and m->>'tips' is not null and m->>'service' is not null then
  m:=m||jsonb_build_object('tips_total',(m->>'tips')::numeric+(m->>'service')::numeric);
 end if;
 return m;
end $$;
revoke all on function private.sales_effective(jsonb,jsonb) from public,anon,authenticated;

create or replace function private.sales_adjust(p_day_id uuid,p_version integer,p_changes jsonb,p_reason text,p_note text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.sales_days; k text; v jsonb; before_metrics jsonb; after_metrics jsonb; log_changes jsonb:='{}'; display_name text;
begin
 if auth.uid() is null or not public.has_permission('sales.adjust_shifts') or not public.has_permission('sales.view_shifts') then raise exception 'Нет доступа'; end if;
 select * into d from public.sales_days where id=p_day_id and account_id=public.get_active_account_id() and venue_id=public.get_active_venue_id() for update;
 if not found then raise exception 'Смена недоступна'; end if;
 if d.version<>p_version then raise exception 'Смена изменилась. Обновите данные перед сохранением'; end if;
 if length(trim(p_reason)) not between 3 and 1000 or (p_note is not null and length(p_note)>5000) then raise exception 'Укажите причину изменения'; end if;
 perform private.sales_validate_metrics(p_changes,true);
 before_metrics:=private.sales_effective(d.calculated,d.overrides);
 for k,v in select * from jsonb_each(p_changes) loop
  if v='null'::jsonb then d.overrides:=d.overrides-k; else d.overrides:=jsonb_set(d.overrides,array[k],v); end if;
 end loop;
 after_metrics:=private.sales_effective(d.calculated,d.overrides);
 for k,v in select * from jsonb_each(p_changes) loop
  log_changes:=log_changes||jsonb_build_object(k,jsonb_build_object('before',coalesce(before_metrics->k,'null'),'after',coalesce(after_metrics->k,'null'),'reset',v='null'::jsonb));
 end loop;
 foreach k in array array['bar','tips_total'] loop
  if not p_changes ? k and before_metrics->k is distinct from after_metrics->k then
   log_changes:=log_changes||jsonb_build_object(k,jsonb_build_object('before',before_metrics->k,'after',after_metrics->k,'derived',true));
  end if;
 end loop;
 if p_note is not null and p_note<>d.note then log_changes:=log_changes||jsonb_build_object('note',jsonb_build_object('before',d.note,'after',p_note));end if;
 if log_changes='{}' then raise exception 'Нет изменений'; end if;
 update public.sales_days set overrides=d.overrides,note=coalesce(p_note,d.note),version=version+1,updated_at=now() where id=d.id returning * into d;
 select concat_ws(' ',first_name,last_name) into display_name from public.profiles where id=auth.uid();
 insert into public.sales_events(day_id,actor_id,actor_name,kind,changes,reason) values(d.id,auth.uid(),display_name,'adjustment',log_changes,trim(p_reason));
 return to_jsonb(d);
end $$;
revoke all on function private.sales_adjust(uuid,integer,jsonb,text,text) from public;
grant usage on schema private to authenticated;
grant execute on function private.sales_adjust(uuid,integer,jsonb,text,text) to authenticated;
create or replace function public.sales_adjust(p_day_id uuid,p_version integer,p_changes jsonb,p_reason text,p_note text default null)
returns jsonb language sql security invoker set search_path='' as $$ select private.sales_adjust(p_day_id,p_version,p_changes,p_reason,p_note) $$;
revoke all on function public.sales_adjust(uuid,integer,jsonb,text,text) from public,anon;
grant execute on function public.sales_adjust(uuid,integer,jsonb,text,text) to authenticated;

create or replace function public.sales_claim_job()
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.sales_sync_jobs;
begin
 select * into j from public.sales_sync_jobs where status='queued' or (status='running' and leased_until<now()) order by created_at for update skip locked limit 1;
 if not found then return null;end if;
 update public.sales_sync_jobs set status='running',lease_token=gen_random_uuid(),leased_until=now()+interval '2 minutes',attempts=attempts+1 where id=j.id returning * into j;
 return to_jsonb(j);
end $$;
revoke all on function public.sales_claim_job() from public,anon,authenticated;
grant execute on function public.sales_claim_job() to service_role;

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
 on conflict(venue_id,business_date) do update set calculated=excluded.calculated,status=excluded.status,synced_at=now(),source_summary=sales_days.source_summary||excluded.source_summary,sync_error=null,version=sales_days.version+1,updated_at=now()
 returning id into day_id;
 insert into public.sales_events(day_id,kind,changes) values(day_id,'sync',jsonb_build_object('job_id',j.id,'complete',p_complete));
 update public.sales_sync_jobs set status='success',finished_at=now(),leased_until=null where id=j.id;
 -- Keep normalized inputs for an audit; browser roles cannot read them.
 return day_id;
end $$;
revoke all on function public.sales_commit_job(uuid,uuid,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.sales_commit_job(uuid,uuid,jsonb,jsonb,boolean) to service_role;

create or replace function public.sales_import_history(p_venue_id uuid,p_account_id uuid,p_rows jsonb)
returns integer language plpgsql security invoker set search_path='' as $$
declare r jsonb; d uuid; total integer:=0;
begin
 if not exists(select 1 from public.venues where id=p_venue_id and account_id=p_account_id) then raise exception 'Заведение не принадлежит аккаунту';end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>500 then raise exception 'Импортируйте не более 500 строк за запрос';end if;
 for r in select * from jsonb_array_elements(p_rows) loop
  perform private.sales_validate_metrics(r->'metrics',true);
  select id into d from public.sales_days where venue_id=p_venue_id and business_date=(r->>'date')::date and legacy=r->'metrics'
   and legacy_source_id is not distinct from r->>'source_id'
   and (r->'original' is null or r->'original'='null' or source_summary->'legacy'=r->'original');
  if found then total:=total+1;continue;end if;
  insert into public.sales_days(account_id,venue_id,business_date,status,calculated,legacy,legacy_source_id,note,method_version,source_summary)
  values(p_account_id,p_venue_id,(r->>'date')::date,'imported',r->'metrics',r->'metrics',r->>'source_id',coalesce(r->>'note',''),'legacy-history',jsonb_build_object('legacy',r->'original'))
  on conflict(venue_id,business_date) do update set legacy=excluded.legacy,legacy_source_id=excluded.legacy_source_id,
   source_summary=sales_days.source_summary||case when r->'original' is not null and r->'original'<>'null' then jsonb_build_object('legacy',r->'original') else '{}'::jsonb end,
   version=sales_days.version+1,updated_at=now()
  returning id into d;
  insert into public.sales_events(day_id,kind,changes) values(d,'import',jsonb_build_object('source_id',r->>'source_id'));
  total:=total+1;
 end loop;
 return total;
end $$;
revoke all on function public.sales_import_history(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sales_import_history(uuid,uuid,jsonb) to service_role;

-- Stable role code, never a translated display name. Also covers new venues.
create function private.sales_manager_permissions() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.code in ('owner','custom_manager') then
  insert into public.role_permissions(role_id,permission_id,granted) select new.id,id,true from public.permissions where
   (new.code='owner' and module='sales') or (new.code='custom_manager' and code in ('sales.view_shifts','sales.adjust_shifts','sales.export_shifts')) on conflict(role_id,permission_id) do nothing;
 end if;
 return new;
end $$;
revoke all on function private.sales_manager_permissions() from public;
create trigger sales_default_manager_permissions after insert on public.roles for each row execute function private.sales_manager_permissions();

create or replace function public.sales_save_slice(p_job_id uuid,p_token uuid,p_patch jsonb,p_receipts jsonb default '[]')
returns void language plpgsql security invoker set search_path='' as $$
declare j public.sales_sync_jobs; r jsonb;
begin
 select * into j from public.sales_sync_jobs where id=p_job_id and status='running' and lease_token=p_token and leased_until>now() for update;
 if not found then raise exception 'Запуск уже передан другому обработчику';end if;
 for r in select * from jsonb_array_elements(p_receipts) loop
  insert into public.sales_sync_receipts(job_id,order_id,order_data,detail_data) values(j.id,(r->>'order_id')::bigint,r->'order_data',r->'detail_data')
  on conflict(job_id,order_id) do update set detail_data=coalesce(excluded.detail_data,sales_sync_receipts.detail_data);
 end loop;
 update public.sales_sync_jobs set phase=coalesce(p_patch->>'phase',phase),cursor=coalesce((p_patch->>'cursor')::integer,cursor),
  payload=coalesce(p_patch->'payload',payload)-'failures',status='queued',lease_token=null,leased_until=null,error=null where id=j.id;
end $$;
revoke all on function public.sales_save_slice(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.sales_save_slice(uuid,uuid,jsonb,jsonb) to service_role;
commit;
