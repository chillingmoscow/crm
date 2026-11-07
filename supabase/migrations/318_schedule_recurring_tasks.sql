begin;

create table public.schedule_task_definitions (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.accounts(id),
 venue_id uuid not null references public.venues(id), name text not null,
 instructions text not null default '', instruction_page_id uuid references public.kb_pages(id) on delete set null, instruction_snapshot jsonb, template_id uuid references public.schedule_templates(id),
 review_mode text not null check(review_mode in ('auto','manager')), items jsonb not null,
 recurrence jsonb, starts_on date not null, enabled boolean not null default false,
 penalty_enabled boolean not null default true, fine_amount numeric check(fine_amount between 0 and 100000),
 reward_amount numeric check(reward_amount between 0 and 100000),
 equipment_groups jsonb not null default '[]', source_key text, source_url text, version integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
 constraint schedule_task_enabled_config check (not enabled or (template_id is not null and recurrence is not null and jsonb_array_length(items)>0)),
 unique(venue_id,id), unique(venue_id,source_key)
);
create table public.schedule_task_settings (
 venue_id uuid primary key references public.venues(id), account_id uuid not null references public.accounts(id),
 enabled_from date, paused boolean not null default false, legacy_stopped boolean not null default false, chat_id text,
 reminder_chat_ids jsonb not null default '[]', version integer not null default 1,
 check(enabled_from is null or legacy_stopped)
);
create table public.schedule_task_occurrences (
 id uuid primary key default gen_random_uuid(), venue_id uuid not null references public.venues(id),
 account_id uuid not null references public.accounts(id), definition_id uuid not null,
 business_date date not null, shift_id uuid references public.schedule_shifts(id) on delete set null,
 employee_id uuid references public.payroll_employees(id), user_id uuid references public.profiles(id),
 employee_name text, snapshot jsonb not null, answers jsonb not null default '{}',
 status text not null default 'blocked' check(status in ('assigned','in_progress','submitted','returned','completed','missed','blocked')),
 transferred boolean not null default false, transferred_from_id uuid references public.schedule_task_occurrences(id),
 transfer_created boolean not null default false,
 deadline_at timestamptz, submitted_at timestamptz, completed_at timestamptz,
 review_comment text not null default '', blocker text not null default '', equipment jsonb not null default '[]',
 version integer not null default 1, adjustment_id uuid references public.payroll_adjustments(id), settled_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(venue_id,definition_id) references public.schedule_task_definitions(venue_id,id),
 unique(definition_id,business_date)
);
create index schedule_task_occurrences_calendar on public.schedule_task_occurrences(venue_id,business_date);
create index schedule_task_occurrences_assignee on public.schedule_task_occurrences(user_id,business_date);
create index schedule_task_occurrences_carry on public.schedule_task_occurrences(transferred_from_id) where transferred_from_id is not null;
create table public.schedule_task_history (
 id uuid primary key default gen_random_uuid(), venue_id uuid not null references public.venues(id),
 entity_id uuid not null, actor_id uuid references public.profiles(id), action text not null,
 details jsonb not null default '{}', created_at timestamptz not null default now()
);
create index schedule_task_history_entity on public.schedule_task_history(venue_id,entity_id,created_at);

alter table public.schedule_task_definitions enable row level security;
alter table public.schedule_task_settings enable row level security;
alter table public.schedule_task_occurrences enable row level security;
alter table public.schedule_task_history enable row level security;
revoke all on public.schedule_task_definitions,public.schedule_task_settings,public.schedule_task_occurrences,public.schedule_task_history from public,anon,authenticated;
grant select on public.schedule_task_definitions,public.schedule_task_settings,public.schedule_task_occurrences,public.schedule_task_history to authenticated;
grant all on public.schedule_task_definitions,public.schedule_task_settings,public.schedule_task_occurrences,public.schedule_task_history to service_role;

create policy task_occurrences_read on public.schedule_task_occurrences for select to authenticated using (
 venue_id=(select public.get_active_venue_id()) and account_id=(select public.get_active_account_id()) and
 (user_id=(select auth.uid()) or (select public.has_permission('schedule.view_all')) or (select public.has_permission('schedule.review')) or (select public.has_permission('schedule.checklist_edit')))
);
create policy task_definitions_read on public.schedule_task_definitions for select to authenticated using (
 deleted_at is null and venue_id=(select public.get_active_venue_id()) and account_id=(select public.get_active_account_id()) and
 ((select public.has_permission('schedule.checklist_edit')) or (select public.has_permission('schedule.checklist_create')) or (select public.has_permission('schedule.view_all')) or (select public.has_permission('schedule.review')))
);
create policy task_settings_read on public.schedule_task_settings for select to authenticated using (
 venue_id=(select public.get_active_venue_id()) and account_id=(select public.get_active_account_id()) and
 ((select public.has_permission('schedule.checklist_edit')) or (select public.has_permission('schedule.view_all')))
);
create policy task_history_read on public.schedule_task_history for select to authenticated using (
 venue_id=(select public.get_active_venue_id()) and ((select public.has_permission('schedule.view_all')) or (select public.has_permission('schedule.review')) or (select public.has_permission('schedule.checklist_edit')) or
 exists(select 1 from public.schedule_task_occurrences o where o.id=entity_id and o.user_id=(select auth.uid())))
);

create function private.schedule_task_items_valid(items jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare i jsonb;
begin
 if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) not between 0 and 150 then return false;end if;
 for i in select value from jsonb_array_elements(items) loop
  if jsonb_typeof(i) is distinct from 'object' or length(trim(coalesce(i->>'title',''))) not between 1 and 300 or length(coalesce(i->>'hint',''))>2000
   or coalesce(i->>'kind','') not in ('check','photo','number','text','info') or jsonb_typeof(i->'required') is distinct from 'boolean'
   or coalesce(i->>'id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   or (select count(*) from jsonb_array_elements(items) x where x->>'id'=i->>'id')<>1
   or coalesce((i->>'max_length')::integer,2000) not between 1 and 10000
   or (i->>'min' is not null and i->>'max' is not null and (i->>'min')::numeric>(i->>'max')::numeric) then return false;end if;
 end loop;
 return true;
exception when others then return false;
end $$;
revoke all on function private.schedule_task_items_valid(jsonb) from public,anon,authenticated;

create function private.schedule_task_due(r jsonb,d date) returns boolean language plpgsql immutable set search_path='' as $$
declare anchor date; n integer; months integer;
begin
 anchor:=(r->>'anchor')::date;n:=(r->>'interval')::integer;
 if anchor is null or n is null or n not between 1 and 52 or d<anchor then return false;end if;
 if r->>'unit'='week' then return (d-anchor)%(7*n)=0;end if;
 months:=(extract(year from d)::integer-extract(year from anchor)::integer)*12+extract(month from d)::integer-extract(month from anchor)::integer;
 return r->>'unit'='month' and months%n=0 and extract(day from d)=extract(day from anchor);
end $$;
revoke all on function private.schedule_task_due(jsonb,date) from public,anon,authenticated;

-- The explicit task link shares only this page body and its registered attachments with the assignee.
create function private.schedule_task_instruction(p_page uuid,p_account uuid) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('page_id',p.id,'title',p.title,'content',p.content,'updated_at',p.updated_at,'files',
  coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'path',f.storage_path)) from public.kb_page_attachments pa join public.account_files f on f.id=pa.file_id where pa.page_id=p.id and f.account_id=p_account and (position(('kbfile://'||f.storage_path) in p.content::text)>0 or position(f.id::text in p.content::text)>0)),'[]'::jsonb))
 from public.kb_pages p where p.id=p_page and p.account_id=p_account and p.deleted_at is null
$$;
revoke all on function private.schedule_task_instruction(uuid,uuid) from public,anon,authenticated;

create function private.schedule_task_cancel_future(p_definition uuid,p_venue uuid,p_account uuid,p_today date,p_actor uuid,p_reason text)
returns void language sql set search_path='' as $$
   with obsolete as (
    delete from public.schedule_task_occurrences planned where planned.definition_id=p_definition and planned.venue_id=p_venue and planned.account_id=p_account
     and planned.business_date>p_today and planned.status in ('assigned','blocked') and planned.answers='{}'::jsonb
     and planned.submitted_at is null and planned.completed_at is null and planned.settled_at is null and planned.adjustment_id is null
     and not planned.transferred and planned.transferred_from_id is null
     and not exists(select 1 from public.schedule_task_occurrences child where child.transferred_from_id=planned.id)
     and not exists(select 1 from storage.objects photo where photo.bucket_id='task-evidence' and photo.name like planned.id::text||'/%')
    returning planned.*
   )
   insert into public.schedule_task_history(venue_id,entity_id,actor_id,action,details)
   select p_venue,p_definition,p_actor,'assignment.cancelled',jsonb_build_object('reason',p_reason,'occurrence_id',obsolete.id,'before',to_jsonb(obsolete)) from obsolete;

$$;
revoke all on function private.schedule_task_cancel_future(uuid,uuid,uuid,date,uuid,text) from public,anon,authenticated;

-- Browser writes are scoped and versioned. No direct table/storage write can approve a report.
create function public.schedule_task_command(p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_catalog as $$
declare u uuid:=auth.uid();v uuid:=public.get_active_venue_id();a uuid:=public.get_active_account_id();
 ident uuid:=nullif(p_input->>'id','')::uuid;def public.schedule_task_definitions;o public.schedule_task_occurrences;
 ans jsonb;item jsonb;perm text;rec jsonb;settings public.schedule_task_settings;correct_until timestamptz;activation_date date;is_paused boolean;task_today date;instruction_page uuid;instruction jsonb;
begin
 if u is null or v is null or a is null or not exists(select 1 from public.venues where id=v and account_id=a) then raise exception 'Выберите заведение';end if;
 if p_action='definition.save' then
  perm:=case when ident is null then 'schedule.checklist_create' else 'schedule.checklist_edit' end;
  if not public.has_permission(perm) then raise exception 'Нет доступа к настройке задач';end if;
  -- Serialize definition edits with generation/settlement, so a stale worker cannot restore obsolete assignments.
  perform pg_advisory_xact_lock(hashtextextended(v::text,0));
  perform pg_advisory_xact_lock(hashtextextended('schedule-tasks:'||v::text,0));
  if ident is not null then select * into def from public.schedule_task_definitions where id=ident and venue_id=v and account_id=a and deleted_at is null for update;
   if not found or def.version is distinct from (p_input->>'version')::integer then raise exception 'Задача изменилась. Обновите страницу';end if;
  end if;
  if length(trim(coalesce(p_input->>'name',''))) not between 1 and 160 or length(coalesce(p_input->>'instructions',''))>50000
   or p_input->>'review_mode' not in ('auto','manager') or p_input->>'review_mode' is null or not private.schedule_task_items_valid(p_input->'items')
   or jsonb_typeof(p_input->'enabled') is distinct from 'boolean' or jsonb_typeof(p_input->'penalty_enabled') is distinct from 'boolean'
   or (p_input->>'fine_amount')::numeric not between 0 and 100000 or (p_input->>'reward_amount')::numeric not between 0 and 100000
   or (nullif(p_input->>'template_id','') is not null and not exists(select 1 from public.schedule_templates where id=(p_input->>'template_id')::uuid and venue_id=v and not archived)) then raise exception 'Проверьте название, чек-лист, шаблон и суммы';end if;
  instruction_page:=nullif(p_input->>'instruction_page_id','')::uuid;
  if instruction_page is not null then
   if (ident is null or instruction_page is distinct from def.instruction_page_id) and not public.has_permission('kb.view_pages') then raise exception 'Нет доступа к выбору инструкции из базы знаний';end if;
   instruction:=private.schedule_task_instruction(instruction_page,a);
   if instruction is null then raise exception 'Страница инструкции удалена или принадлежит другому аккаунту';end if;
  end if;
  rec:=nullif(p_input->'recurrence','null'::jsonb);
  if (p_input->>'enabled')::boolean and (nullif(p_input->>'template_id','') is null or rec is null or jsonb_array_length(p_input->'items')=0) then raise exception 'Для включения задачи укажите смену, повтор и чек-лист';end if;
  if ((ident is null and ((p_input->>'penalty_enabled')::boolean or coalesce((p_input->>'reward_amount')::numeric,0)>0)) or
    (ident is not null and ((p_input->>'penalty_enabled')::boolean is distinct from def.penalty_enabled or (p_input->>'fine_amount')::numeric is distinct from def.fine_amount or (p_input->>'reward_amount')::numeric is distinct from def.reward_amount)))
   and not public.has_permission('payroll.configure') then raise exception 'Нет доступа к изменению начислений';end if;
  if (p_input->>'enabled')::boolean and (ident is null or not def.enabled) and not public.has_permission('schedule.checklist_publish') then raise exception 'Нет доступа к включению задачи';end if;
  if coalesce(p_input->>'starts_on','') !~ '^\d{4}-\d{2}-\d{2}$' or not isfinite((p_input->>'starts_on')::date) then raise exception 'Проверьте дату начала';end if;
  if rec is not null and (jsonb_typeof(rec) is distinct from 'object' or coalesce(rec->>'unit','') not in ('week','month') or rec->>'interval' is null or (rec->>'interval')::integer not between 1 and 52
   or coalesce(rec->>'anchor','') !~ '^\d{4}-\d{2}-\d{2}$' or not isfinite((rec->>'anchor')::date)) then raise exception 'Проверьте периодичность';end if;
  if jsonb_typeof(coalesce(p_input->'equipment_groups','[]')) is distinct from 'array' or jsonb_array_length(coalesce(p_input->'equipment_groups','[]'))>12 then raise exception 'Проверьте группы оборудования';end if;
  for item in select value from jsonb_array_elements(coalesce(p_input->'equipment_groups','[]')) loop
   if jsonb_typeof(item) is distinct from 'array' or jsonb_array_length(item) not between 1 and 100 or exists(select 1 from jsonb_array_elements(item) x where jsonb_typeof(x)<>'number' or (x#>>'{}')::numeric<>trunc((x#>>'{}')::numeric) or (x#>>'{}')::numeric not between 1 and 999) then raise exception 'Проверьте номера оборудования';end if;
  end loop;
  if ident is null then
   if nullif(p_input->>'source_key','') is null and coalesce(p_input->>'request_key','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Нужен ключ создания задачи';end if;
   if length(coalesce(p_input->>'source_key',''))>200 then raise exception 'Неверный источник';end if;
   insert into public.schedule_task_definitions(account_id,venue_id,name,instructions,instruction_page_id,instruction_snapshot,template_id,review_mode,items,recurrence,starts_on,enabled,penalty_enabled,fine_amount,reward_amount,equipment_groups,source_key)
   values(a,v,trim(p_input->>'name'),coalesce(p_input->>'instructions',''),instruction_page,instruction,(p_input->>'template_id')::uuid,p_input->>'review_mode',p_input->'items',rec,(p_input->>'starts_on')::date,(p_input->>'enabled')::boolean,(p_input->>'penalty_enabled')::boolean,(p_input->>'fine_amount')::numeric,(p_input->>'reward_amount')::numeric,coalesce(p_input->'equipment_groups','[]'),coalesce(nullif(p_input->>'source_key',''),'manual:'||(p_input->>'request_key')))
   on conflict(venue_id,source_key) do nothing returning id into ident;
   if ident is null then select id into ident from public.schedule_task_definitions where venue_id=v and source_key=coalesce(nullif(p_input->>'source_key',''),'manual:'||(p_input->>'request_key'));return jsonb_build_object('id',ident,'existing',true);end if;
  else
   update public.schedule_task_definitions set name=trim(p_input->>'name'),instructions=coalesce(p_input->>'instructions',''),instruction_page_id=instruction_page,instruction_snapshot=instruction,template_id=(p_input->>'template_id')::uuid,review_mode=p_input->>'review_mode',items=p_input->'items',recurrence=rec,starts_on=(p_input->>'starts_on')::date,enabled=(p_input->>'enabled')::boolean,penalty_enabled=(p_input->>'penalty_enabled')::boolean,fine_amount=(p_input->>'fine_amount')::numeric,reward_amount=(p_input->>'reward_amount')::numeric,equipment_groups=coalesce(p_input->'equipment_groups','[]'),version=version+1,updated_at=now() where id=ident;
  end if;
  if def.id is not null then
   select (now() at time zone coalesce(timezone,'Europe/Moscow'))::date into task_today from public.venues where id=v;
   perform private.schedule_task_cancel_future(ident,v,a,task_today,u,'definition.updated');
  end if;
 elsif p_action='definition.delete' then
  if not public.has_permission('schedule.checklist_edit') then raise exception 'Нет доступа к удалению задач';end if;
  perform pg_advisory_xact_lock(hashtextextended(v::text,0));
  perform pg_advisory_xact_lock(hashtextextended('schedule-tasks:'||v::text,0));
  select * into def from public.schedule_task_definitions where id=ident and venue_id=v and account_id=a for update;
  if not found then raise exception 'Задача не найдена';end if;
  if def.deleted_at is not null then return jsonb_build_object('id',ident,'existing',true);end if;
  if def.version is distinct from (p_input->>'version')::integer then raise exception 'Задача изменилась. Обновите страницу';end if;
  select (now() at time zone coalesce(timezone,'Europe/Moscow'))::date into task_today from public.venues where id=v;
  update public.schedule_task_definitions set enabled=false,deleted_at=now(),updated_at=now(),version=version+1 where id=ident;
  perform private.schedule_task_cancel_future(ident,v,a,task_today,u,'definition.deleted');
  insert into public.schedule_task_history(venue_id,entity_id,actor_id,action,details)
  values(v,ident,u,'definition.deleted',jsonb_build_object('before',to_jsonb(def),'after',(select to_jsonb(d) from public.schedule_task_definitions d where d.id=ident)));
 elsif p_action='settings.save' then
  if not public.has_permission('schedule.checklist_edit') or not public.has_permission('payroll.configure') or not public.has_permission('payroll.review') then raise exception 'Нет доступа к переключению задач';end if;
  select * into settings from public.schedule_task_settings where venue_id=v and account_id=a for update;
  if settings.venue_id is not null and settings.version is distinct from (p_input->>'version')::integer then raise exception 'Настройки изменились';end if;
  activation_date:=coalesce(nullif(p_input->>'enabled_from','')::date,settings.enabled_from);
  is_paused:=coalesce((p_input->>'paused')::boolean,false) or (nullif(p_input->>'enabled_from','') is null and settings.enabled_from is not null);
  if settings.enabled_from is not null and activation_date is distinct from settings.enabled_from and exists(select 1 from public.schedule_task_occurrences where venue_id=v) then raise exception 'Дата перехода уже используется отчётами. Используйте паузу без изменения даты';end if;
  if activation_date is distinct from settings.enabled_from and activation_date < (now() at time zone coalesce((select timezone from public.venues where id=v),'Europe/Moscow'))::date then raise exception 'Переключение задним числом запрещено';end if;
  if activation_date is not null and (p_input->>'legacy_stopped')::boolean is distinct from true then raise exception 'Сначала отключите прежние начисления за задачи';end if;
  if activation_date is not null and (not exists(select 1 from public.payroll_settings where venue_id=v and account_id=a) or not exists(select 1 from public.payroll_automation_settings where venue_id=v and account_id=a and version>0)) then raise exception 'Сначала настройте зарплату и подтвердите правила задач';end if;
  if nullif(p_input->>'chat_id','') is not null and p_input->>'chat_id' !~ '^-?[0-9]{1,20}$' then raise exception 'Неверный ID чата';end if;
  if jsonb_typeof(coalesce(p_input->'reminder_chat_ids','[]')) is distinct from 'array' or jsonb_array_length(coalesce(p_input->'reminder_chat_ids','[]'))>30 or exists(select 1 from jsonb_array_elements_text(coalesce(p_input->'reminder_chat_ids','[]')) x where x !~ '^-?[0-9]{1,20}$') then raise exception 'Проверьте чаты напоминаний';end if;
  insert into public.schedule_task_settings(venue_id,account_id,enabled_from,paused,legacy_stopped,chat_id,reminder_chat_ids) values(v,a,activation_date,is_paused,coalesce((p_input->>'legacy_stopped')::boolean,false),nullif(p_input->>'chat_id',''),coalesce(p_input->'reminder_chat_ids','[]'))
  on conflict(venue_id) do update set enabled_from=excluded.enabled_from,paused=excluded.paused,legacy_stopped=excluded.legacy_stopped,chat_id=excluded.chat_id,reminder_chat_ids=excluded.reminder_chat_ids,version=schedule_task_settings.version+1;
  ident:=v;
 elsif p_action in ('run.save','run.submit','run.approve','run.return') then
  select * into o from public.schedule_task_occurrences where id=ident and venue_id=v and account_id=a for update;
  if not found or o.version is distinct from (p_input->>'version')::integer then raise exception 'Задание изменилось. Обновите страницу';end if;
  if p_action in ('run.save','run.submit') then
   if o.user_id is distinct from u or o.status not in ('assigned','in_progress','returned') or o.settled_at is not null then raise exception 'Выполнение недоступно';end if;
   if o.business_date>(now() at time zone coalesce((select timezone from public.venues where id=v),'Europe/Moscow'))::date then raise exception 'Задание доступно в день назначенной смены';end if;
   if p_action='run.submit' and o.deadline_at<=now() then raise exception 'Срок сдачи истёк. Обратитесь к управляющему';end if;
   if not exists(select 1 from public.schedule_shifts s where s.id=o.shift_id and s.published and (s.user_id=u or (s.user_id is null and exists(select 1 from public.payroll_employees e where e.id=s.payroll_employee_id and e.local_user_id=u)))) then raise exception 'Ответственный в графике изменился';end if;
   ans:=coalesce(p_input->'answers','{}');
   if jsonb_typeof(ans) is distinct from 'object' or octet_length(ans::text)>100000 or exists(select 1 from jsonb_object_keys(ans) k where not exists(select 1 from jsonb_array_elements(o.snapshot->'items') i where i->>'id'=k)) then raise exception 'Неверные ответы';end if;
   for item in select value from jsonb_array_elements(o.snapshot->'items') loop
    if p_action='run.submit' and (item->>'required')::boolean and item->>'kind'<>'info' and (not ans ? (item->>'id') or ans->(item->>'id')='null'::jsonb or length(trim(coalesce(ans->>(item->>'id'),'')))=0 or (item->>'kind'='check' and ans->>(item->>'id')<>'true')) then raise exception 'Заполните пункт: %',item->>'title';end if;
    if ans ? (item->>'id') and ans->(item->>'id')<>'null'::jsonb then
     if (item->>'kind'='check' and jsonb_typeof(ans->(item->>'id'))<>'boolean') or (item->>'kind' in ('photo','text') and jsonb_typeof(ans->(item->>'id'))<>'string') or (item->>'kind'='number' and (jsonb_typeof(ans->(item->>'id'))<>'number' or ((item->>'min') is not null and (ans->>(item->>'id'))::numeric<(item->>'min')::numeric) or ((item->>'max') is not null and (ans->>(item->>'id'))::numeric>(item->>'max')::numeric))) then raise exception 'Неверный тип или значение ответа';end if;
     if item->>'kind'='text' and length(ans->>(item->>'id'))>coalesce((item->>'max_length')::integer,2000) then raise exception 'Ответ слишком длинный';end if;
     if item->>'kind'='photo' and length(coalesce(ans->>(item->>'id'),''))>0 and not exists(select 1 from storage.objects where bucket_id='task-evidence' and name=ans->>(item->>'id') and name like o.id::text||'/'||(item->>'id')||'/%') then raise exception 'Фотография не загружена к этому пункту';end if;
    end if;
   end loop;
   update public.schedule_task_occurrences set answers=ans,status=case when p_action='run.submit' then case when snapshot->>'review_mode'='auto' then 'completed' else 'submitted' end else 'in_progress' end,submitted_at=case when p_action='run.submit' then now() else submitted_at end,completed_at=case when p_action='run.submit' and snapshot->>'review_mode'='auto' then now() else completed_at end,version=version+1,updated_at=now() where id=ident;
  else
   if not public.has_permission('schedule.review') or o.status<>'submitted' or o.user_id=u then raise exception 'Нет доступа к проверке этой задачи';end if;
   if length(coalesce(p_input->>'comment',''))>5000 or (p_action='run.return' and length(trim(coalesce(p_input->>'comment','')))=0) then raise exception 'Укажите замечания';end if;
   if p_action='run.return' then
    correct_until:=nullif(p_input->>'correct_until','')::timestamptz;
    if correct_until is null or not isfinite(correct_until) or correct_until<=now() or correct_until>now()+interval '30 days' then raise exception 'Укажите будущий срок исправления, не позже 30 дней';end if;
   end if;
   update public.schedule_task_occurrences set deadline_at=case when p_action='run.return' then correct_until else deadline_at end,status=case when p_action='run.approve' then 'completed' else 'returned' end,review_comment=coalesce(p_input->>'comment',''),completed_at=case when p_action='run.approve' then now() else null end,version=version+1,updated_at=now() where id=ident;
  end if;
 else raise exception 'Неизвестное действие';end if;
 if p_action not in ('definition.save','definition.delete') then
  insert into public.schedule_task_history(venue_id,entity_id,actor_id,action,details) values(v,ident,u,p_action,jsonb_build_object('comment',p_input->>'comment','before',case when p_action like 'run.%' then to_jsonb(o) else to_jsonb(settings) end,'after',case when p_action like 'run.%' then (select to_jsonb(r) from public.schedule_task_occurrences r where r.id=ident) else (select to_jsonb(s) from public.schedule_task_settings s where s.venue_id=v) end));
 end if;
 return jsonb_build_object('id',ident);
end $$;
revoke all on function public.schedule_task_command(text,jsonb) from public,anon;
grant execute on function public.schedule_task_command(text,jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('task-evidence','task-evidence',false,12582912,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create policy task_evidence_read on storage.objects for select to authenticated using(bucket_id='task-evidence' and exists(select 1 from public.schedule_task_occurrences o where o.id::text=(storage.foldername(name))[1]));
create policy task_evidence_insert on storage.objects for insert to authenticated with check(bucket_id='task-evidence' and exists(select 1 from public.schedule_task_occurrences o where o.id::text=(storage.foldername(name))[1] and o.user_id=(select auth.uid()) and o.status in ('assigned','in_progress','returned') and o.settled_at is null and exists(select 1 from jsonb_array_elements(o.snapshot->'items') i where i->>'id'=(storage.foldername(name))[2] and i->>'kind'='photo')));

create function private.schedule_task_instruction_file_read(p_path text) returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from public.schedule_task_occurrences o where o.account_id=(select public.get_active_account_id()) and o.venue_id=(select public.get_active_venue_id()) and o.snapshot->'instruction_snapshot'->'files' @> jsonb_build_array(jsonb_build_object('path',p_path)))
 or (((select public.has_permission('schedule.view_all')) or (select public.has_permission('schedule.checklist_edit')) or (select public.has_permission('schedule.checklist_create'))) and exists(select 1 from public.schedule_task_definitions d where d.account_id=(select public.get_active_account_id()) and d.venue_id=(select public.get_active_venue_id()) and d.instruction_snapshot->'files' @> jsonb_build_array(jsonb_build_object('path',p_path))))
$$;
revoke all on function private.schedule_task_instruction_file_read(text) from public,anon;
grant execute on function private.schedule_task_instruction_file_read(text) to authenticated;
-- Configurers with KB access can preview newer media on explicitly linked instruction pages.
create function private.schedule_task_instruction_live_file_read(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.has_permission('kb.view_pages') and
 (public.has_permission('schedule.view_all') or public.has_permission('schedule.checklist_edit') or public.has_permission('schedule.checklist_create')) and exists(
 select 1 from public.schedule_task_definitions d join public.kb_pages p on p.id=d.instruction_page_id and p.account_id=d.account_id and p.deleted_at is null
 join public.kb_page_attachments pa on pa.page_id=p.id join public.account_files f on f.id=pa.file_id and f.account_id=d.account_id
 where d.venue_id=public.get_active_venue_id() and d.account_id=public.get_active_account_id() and f.storage_path=p_path and (position(('kbfile://'||f.storage_path) in p.content::text)>0 or position(f.id::text in p.content::text)>0))
$$;
revoke all on function private.schedule_task_instruction_live_file_read(text) from public,anon;
grant execute on function private.schedule_task_instruction_live_file_read(text) to authenticated;
create policy task_instruction_files_read on storage.objects for select to authenticated using(bucket_id='account-attachments' and (private.schedule_task_instruction_file_read(name) or private.schedule_task_instruction_live_file_read(name)));

-- One plan is shared by the read-only preview and the scheduled writer.
create function private.schedule_task_plan(p_venue uuid,p_from date,p_to date) returns jsonb
language plpgsql stable set search_path='' as $$
declare def public.schedule_task_definitions;d date;tz text;cfg jsonb;result jsonb:='[]';matches integer;employee_names text;
begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>31 then raise exception 'Выберите период до 31 дня';end if;
 select coalesce(timezone,'Europe/Moscow') into tz from public.venues where id=p_venue;
 select config->'tasks' into cfg from public.payroll_automation_settings where venue_id=p_venue and version>0;
 for def in select * from public.schedule_task_definitions where venue_id=p_venue and deleted_at is null loop
  for d in select generate_series(p_from::timestamp,p_to::timestamp,interval '1 day')::date loop
   if d<def.starts_on or not private.schedule_task_due(def.recurrence,d) then continue;end if;
   select count(distinct sh.id),string_agg(distinct pe.name,', ') into matches,employee_names from public.schedule_shifts sh left join public.payroll_employees pe on pe.venue_id=p_venue and pe.active and (pe.id=sh.payroll_employee_id or (sh.payroll_employee_id is null and pe.local_user_id=sh.user_id)) where sh.venue_id=p_venue and sh.template_id=def.template_id and sh.published and (sh.starts_at at time zone tz)::date=d;
   result:=result||jsonb_build_array(jsonb_build_object('definition_id',def.id,'business_date',d,'assignment_count',matches,'employee',employee_names,'snapshot',to_jsonb(def)||jsonb_build_object('task_rules',cfg,'instruction_snapshot',case when def.instruction_page_id is not null then private.schedule_task_instruction(def.instruction_page_id,def.account_id) else def.instruction_snapshot end)));
  end loop;
 end loop;
 return result;
end $$;
revoke all on function private.schedule_task_plan(uuid,date,date) from public,anon,authenticated;

create function public.schedule_task_preview(p_from date,p_to date) returns jsonb
language plpgsql security definer set search_path=public,pg_catalog as $$
declare v uuid:=public.get_active_venue_id();result jsonb;
begin
 if auth.uid() is null or v is null or not(public.has_permission('schedule.checklist_edit') or public.has_permission('schedule.view_all')) then raise exception 'Нет доступа к предпросмотру';end if;
 result:=private.schedule_task_plan(v,p_from,p_to);
 return result;
end $$;
revoke all on function public.schedule_task_preview(date,date) from public,anon;
grant execute on function public.schedule_task_preview(date,date) to authenticated;

create function public.schedule_process_tasks() returns jsonb
language plpgsql security definer set search_path=public,pg_catalog as $$
declare settings public.schedule_task_settings;today date;tz text;entry jsonb;o public.schedule_task_occurrences;
 def public.schedule_task_definitions;s public.schedule_shifts;e public.payroll_employees;
 n integer;count_shifts integer;blocked_reason text;group_index integer;occurrence_index integer;assignment_deadline timestamptz;rules jsonb;kind text;medium text;amount numeric;
 adjustment uuid;created integer:=0;settled integer:=0;
begin
 for settings in select st.* from public.schedule_task_settings st where st.enabled_from is not null and st.legacy_stopped and not st.paused for update skip locked loop
  -- Share the venue lock with payroll approval until the journal and salary overlays are settled.
  perform pg_advisory_xact_lock(hashtextextended(settings.venue_id::text,0));
  select coalesce(timezone,'Europe/Moscow') into tz from public.venues where id=settings.venue_id and account_id=settings.account_id;
  if tz is null then continue;end if;today:=(now() at time zone tz)::date;
  if settings.enabled_from>today then continue;end if;
  -- The venue row lock serializes ticks. Only dates at/after cutover are generated.
  for entry in select value from jsonb_array_elements(private.schedule_task_plan(settings.venue_id,greatest(settings.enabled_from,today-7),today+7)) loop
   if not coalesce((entry->'snapshot'->>'enabled')::boolean,false) then continue;end if;
   insert into public.schedule_task_occurrences(venue_id,account_id,definition_id,business_date,snapshot)
   values(settings.venue_id,settings.account_id,(entry->>'definition_id')::uuid,(entry->>'business_date')::date,entry->'snapshot') on conflict(definition_id,business_date) do nothing;
   get diagnostics n=row_count;created:=created+n;
  end loop;
  -- Rebind untouched assignments when the published shift is filled or corrected.
  for o in select * from public.schedule_task_occurrences where venue_id=settings.venue_id and business_date>=settings.enabled_from and business_date between today-7 and today+7 and status in ('blocked','assigned') and answers='{}'::jsonb and settled_at is null for update loop
   select count(*) into count_shifts from public.schedule_shifts where venue_id=o.venue_id and template_id=(o.snapshot->>'template_id')::uuid and published and (starts_at at time zone tz)::date=o.business_date;
   blocked_reason:='';s:=null;e:=null;
   if count_shifts=0 then blocked_reason:='Нет опубликованной смены нужного шаблона';
   elsif count_shifts>1 then blocked_reason:='Найдено несколько смен. Уточните назначение в графике';
   else
    select * into s from public.schedule_shifts where venue_id=o.venue_id and template_id=(o.snapshot->>'template_id')::uuid and published and (starts_at at time zone tz)::date=o.business_date;
    select count(*) into n from public.payroll_employees where venue_id=o.venue_id and account_id=o.account_id and active and (id=s.payroll_employee_id or (s.payroll_employee_id is null and local_user_id=s.user_id));
    if n<>1 then blocked_reason:='Нет однозначного соответствия сотруднику ведомости';else
     select * into e from public.payroll_employees where venue_id=o.venue_id and account_id=o.account_id and active and (id=s.payroll_employee_id or (s.payroll_employee_id is null and local_user_id=s.user_id));
     if coalesce(s.user_id,e.local_user_id) is null then blocked_reason:='У сотрудника нет аккаунта для выполнения задачи';end if;
     if e.hired_on>o.business_date then blocked_reason:='Смена раньше даты приёма сотрудника';end if;
     if not exists(select 1 from public.user_venue_roles uv where uv.user_id=coalesce(s.user_id,e.local_user_id) and uv.venue_id=o.venue_id and uv.status='active') then blocked_reason:='У сотрудника нет активного доступа в заведение';end if;
    end if;
   end if;
   if nullif(o.snapshot->>'instruction_page_id','') is not null and (o.snapshot->'instruction_snapshot' is null or o.snapshot->'instruction_snapshot'='null'::jsonb) then blocked_reason:='Страница инструкции недоступна. Проверьте шаблон задачи';end if;
   assignment_deadline:=case when s.id is not null then greatest(s.ends_at,((o.business_date+1)::timestamp+interval '11 hours 30 minutes') at time zone tz) end;
   if blocked_reason='' and assignment_deadline<=now() and (o.status='blocked' or o.shift_id is distinct from s.id or o.employee_id is distinct from e.id or o.user_id is distinct from coalesce(s.user_id,e.local_user_id)) then
    blocked_reason:='Срок истёк до доступности задачи. Нужна сверка без автоматического штрафа';
   end if;
   group_index:=jsonb_array_length(coalesce(o.snapshot->'equipment_groups','[]'));
   if o.snapshot->'recurrence'->>'unit'='month' then
    occurrence_index:=((extract(year from o.business_date)::integer-extract(year from (o.snapshot->'recurrence'->>'anchor')::date)::integer)*12+extract(month from o.business_date)::integer-extract(month from (o.snapshot->'recurrence'->>'anchor')::date)::integer)/greatest((o.snapshot->'recurrence'->>'interval')::integer,1);
   else
    occurrence_index:=(o.business_date-(o.snapshot->'recurrence'->>'anchor')::date)/(7*greatest((o.snapshot->'recurrence'->>'interval')::integer,1));
   end if;
   update public.schedule_task_occurrences set shift_id=s.id,employee_id=e.id,user_id=coalesce(s.user_id,e.local_user_id),employee_name=e.name,
    deadline_at=assignment_deadline,
    status=case when blocked_reason='' then 'assigned' else 'blocked' end,blocker=blocked_reason,
    equipment=case when o.transferred then o.equipment when group_index>0 then (o.snapshot->'equipment_groups')->(occurrence_index%group_index) else '[]'::jsonb end,
    version=version+case when shift_id is distinct from s.id or employee_id is distinct from e.id or user_id is distinct from coalesce(s.user_id,e.local_user_id) or schedule_task_occurrences.blocker is distinct from blocked_reason then 1 else 0 end,updated_at=now() where id=o.id;
  end loop;
  update public.schedule_task_occurrences set status='blocked',blocker='Давнее задание после перерыва. Нужна сверка',version=version+1 where venue_id=settings.venue_id and business_date<today-7 and settled_at is null and status in ('assigned','in_progress','returned') and submitted_at is null and deadline_at<=now();
  for o in select * from public.schedule_task_occurrences where venue_id=settings.venue_id and business_date>=settings.enabled_from and settled_at is null and
   (status='completed' or (status in ('assigned','in_progress','returned') and deadline_at<=now() and (business_date>=today-7 or submitted_at is not null))) and business_date<=today for update loop
   -- A changed/cancelled shift or a closed salary month must never produce a stale charge.
   select count(*) into count_shifts from public.schedule_shifts where venue_id=o.venue_id and template_id=(o.snapshot->>'template_id')::uuid and published and (starts_at at time zone tz)::date=o.business_date;
   if count_shifts<>1 or not exists(select 1 from public.schedule_shifts current_shift where current_shift.id=o.shift_id and current_shift.venue_id=o.venue_id and current_shift.published and current_shift.template_id=(o.snapshot->>'template_id')::uuid and (current_shift.starts_at at time zone tz)::date=o.business_date and (current_shift.payroll_employee_id=o.employee_id or (current_shift.payroll_employee_id is null and current_shift.user_id=o.user_id)))
    or not exists(select 1 from public.payroll_employees where id=o.employee_id and venue_id=o.venue_id and active and (hired_on is null or hired_on<=o.business_date))
    or not exists(select 1 from public.user_venue_roles uv where uv.user_id=o.user_id and uv.venue_id=o.venue_id and uv.status='active') then
    update public.schedule_task_occurrences set blocker='Смена или сотрудник изменились. Нужна проверка',status=case when o.status='assigned' and o.answers='{}'::jsonb then 'blocked' else o.status end,version=version+case when o.blocker='Смена или сотрудник изменились. Нужна проверка' then 0 else 1 end where id=o.id;continue;
   end if;
   if exists(select 1 from public.payroll_periods where venue_id=o.venue_id and month=date_trunc('month',o.business_date)::date and status<>'draft') then
    update public.schedule_task_occurrences set blocker='Зарплатный период закрыт. Нужна сверка начисления' where id=o.id;continue;
   end if;
   rules:=o.snapshot->'task_rules';kind:=null;medium:=null;amount:=null;adjustment:=null;
   if o.status<>'completed' then
    if coalesce((o.snapshot->>'penalty_enabled')::boolean,true) then
     if rules is null or rules='null'::jsonb then update public.schedule_task_occurrences set blocker='Не подтверждены зарплатные правила задач' where id=o.id;continue;end if;
     if (rules->>'missing_enabled')::boolean then
      kind:=case when rules->>'missing_kind'='deduction' then 'deduction' else 'warning' end;
      medium:=case when kind='warning' then 'none' else 'money' end;
      amount:=case when kind='warning' then 0 else -coalesce((o.snapshot->>'fine_amount')::numeric,(rules->>'missing_amount')::numeric) end;
     end if;
    end if;
    update public.schedule_task_occurrences set status='missed',version=version+1 where id=o.id;
   elsif o.transferred and (o.snapshot->>'reward_amount')::numeric>0 then
    if rules is null or rules='null'::jsonb then update public.schedule_task_occurrences set blocker='Не подтверждены зарплатные правила задач' where id=o.id;continue;end if;
    if (rules->>'extra_reward_enabled')::boolean then kind:='bonus';medium:=rules->>'extra_reward_medium';amount:=(o.snapshot->>'reward_amount')::numeric;end if;
   end if;
   if kind is not null then
    if not exists(select 1 from public.payroll_settings where venue_id=o.venue_id and account_id=o.account_id) then
     update public.schedule_task_occurrences set blocker='Сначала настройте зарплату заведения',status=o.status where id=o.id;continue;
    end if;
    insert into public.payroll_adjustments(account_id,venue_id,employee_id,business_date,kind,medium,amount,reason,source_ref,approved,managed,origin,automation_key,rule_snapshot,external_state)
    values(o.account_id,o.venue_id,o.employee_id,o.business_date,kind,medium,amount,case when kind='bonus' then 'Выполнение перенесённой задачи «' else 'Задача «' end||(o.snapshot->>'name')||case when kind='bonus' then '»' else '» не выполнена' end,'task:'||o.id,true,true,'task','task:'||o.id||':result',o.snapshot,case when medium='bonus' then 'review' else 'not_required' end)
    on conflict(venue_id,automation_key) where automation_key is not null do nothing returning id into adjustment;
    if adjustment is null then select id into adjustment from public.payroll_adjustments where venue_id=o.venue_id and automation_key='task:'||o.id||':result';end if;
   end if;
   update public.schedule_task_occurrences set adjustment_id=adjustment,settled_at=now(),blocker='',updated_at=now() where id=o.id;
   insert into public.schedule_task_history(venue_id,entity_id,action,details) values(o.venue_id,o.id,'result.settled',jsonb_build_object('adjustment_id',adjustment,'kind',kind));settled:=settled+1;
  end loop;
  -- Carry once to an available day, including after a delayed review/correction deadline. Reuse only untouched assignments.
  for o in select * from public.schedule_task_occurrences where venue_id=settings.venue_id and business_date>=settings.enabled_from and status='missed' and not transfer_created and exists(select 1 from public.schedule_task_definitions d where d.id=definition_id and d.deleted_at is null) for update loop
   insert into public.schedule_task_occurrences(venue_id,account_id,definition_id,business_date,snapshot,transferred,transferred_from_id,equipment)
   values(o.venue_id,o.account_id,o.definition_id,greatest(o.business_date+1,today),o.snapshot,true,o.id,o.equipment)
   on conflict(definition_id,business_date) do update set transferred=true,transferred_from_id=excluded.transferred_from_id,snapshot=excluded.snapshot,equipment=excluded.equipment,version=schedule_task_occurrences.version+1
   where schedule_task_occurrences.status in ('assigned','blocked') and schedule_task_occurrences.answers='{}'::jsonb and schedule_task_occurrences.settled_at is null and (schedule_task_occurrences.transferred_from_id is null or schedule_task_occurrences.transferred_from_id=excluded.transferred_from_id)
    and not exists(select 1 from storage.objects photo where photo.bucket_id='task-evidence' and photo.name like schedule_task_occurrences.id::text||'/%');
   get diagnostics n=row_count;
   if n>0 then
    update public.schedule_task_occurrences set transfer_created=true,blocker='' where id=o.id;
   else
    update public.schedule_task_occurrences set blocker='Перенос ожидает свободного дня: текущее задание уже занято другим отчётом' where id=o.id;
   end if;
  end loop;
 end loop;
 return jsonb_build_object('created',created,'settled',settled);
end $$;
revoke all on function public.schedule_process_tasks() from public,anon,authenticated;
grant execute on function public.schedule_process_tasks() to service_role;

-- Preserve the existing loyalty executor, adding only native task results after their own cutover.
do $migration$
declare body text;
begin
 select pg_get_functiondef('public.payroll_prepare_bonus_operations()'::regprocedure) into body;
 if position('r.origin in (''lateness'',''manual'')' in body)=0 then raise exception 'Не найдена ожидаемая версия исполнителя бонусов';end if;
 body:=replace(body,'r.origin in (''lateness'',''manual'')','(r.origin in (''lateness'',''manual'') or (r.origin=''task'' and exists(select 1 from public.schedule_task_settings st where st.venue_id=r.venue_id and st.account_id=r.account_id and st.legacy_stopped and not st.paused and st.enabled_from<=r.business_date)))');
 execute body;
end $migration$;

create table public.schedule_task_messages (
 id uuid primary key default gen_random_uuid(), venue_id uuid not null references public.venues(id),
 account_id uuid not null references public.accounts(id), business_date date not null, message_key text not null,
 chat_id text not null, kind text not null check(kind in ('daily','monday','wednesday')), payload jsonb not null,
 state text not null default 'pending' check(state in ('pending','sending','done','error','review','expired')),
 attempts integer not null default 0, available_at timestamptz not null default now(),
 lease_token uuid, claimed_at timestamptz, message_id bigint, error text,
 unique(venue_id,message_key,chat_id)
);
alter table public.schedule_task_messages enable row level security;
revoke all on public.schedule_task_messages from public,anon,authenticated;
grant select on public.schedule_task_messages to authenticated;
grant all on public.schedule_task_messages to service_role;
create policy task_messages_read on public.schedule_task_messages for select to authenticated using(venue_id=(select public.get_active_venue_id()) and account_id=(select public.get_active_account_id()) and ((select public.has_permission('schedule.checklist_edit')) or (select public.has_permission('schedule.view_all'))));
create index schedule_task_messages_queue on public.schedule_task_messages(available_at) where state in ('pending','error');

create function public.schedule_claim_task_message() returns jsonb
language plpgsql security definer set search_path=public,pg_catalog as $$
declare st public.schedule_task_settings;today date;local_time timestamp;tz text;tasks jsonb;chat text;msg public.schedule_task_messages;token uuid:=gen_random_uuid();weekday integer;
begin
 update public.schedule_task_messages set state='review',error='Ответ Telegram неизвестен. Проверьте чат перед повтором' where state='sending' and claimed_at<now()-interval '3 minutes';
 for st in select s.* from public.schedule_task_settings s where s.enabled_from is not null and s.legacy_stopped and not s.paused loop
  select coalesce(timezone,'Europe/Moscow') into tz from public.venues where id=st.venue_id;
  local_time:=now() at time zone tz;today:=local_time::date;weekday:=extract(isodow from today)::integer;
  if today<st.enabled_from then continue;end if;
  if local_time::time>='12:00'::time and st.chat_id is not null then
   select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.snapshot->>'name','employee',o.employee_name,'blocked',o.blocker) order by o.snapshot->>'name'),'[]') into tasks from public.schedule_task_occurrences o where o.venue_id=st.venue_id and o.business_date=today;
   if jsonb_array_length(tasks)>0 then
    insert into public.schedule_task_messages(venue_id,account_id,business_date,message_key,chat_id,kind,payload) values(st.venue_id,st.account_id,today,'daily:'||today,st.chat_id,'daily',tasks) on conflict do nothing;
   end if;
  end if;
  if weekday in (1,3) and local_time::time>='14:00'::time then
   for chat in select jsonb_array_elements_text(st.reminder_chat_ids) loop
    insert into public.schedule_task_messages(venue_id,account_id,business_date,message_key,chat_id,kind,payload) values(st.venue_id,st.account_id,today,'schedule:'||today,chat,case when weekday=1 then 'monday' else 'wednesday' end,'{}') on conflict do nothing;
   end loop;
  end if;
 end loop;
 update public.schedule_task_messages m set state='expired' from public.venues v where v.id=m.venue_id and m.state in ('pending','error') and m.business_date<(now() at time zone coalesce(v.timezone,'Europe/Moscow'))::date;
 select m.* into msg from public.schedule_task_messages m join public.schedule_task_settings s on s.venue_id=m.venue_id and s.account_id=m.account_id where s.enabled_from is not null and s.legacy_stopped and not s.paused and m.business_date>=s.enabled_from and m.state in ('pending','error') and m.attempts<5 and m.available_at<=now() order by m.available_at,m.id for update of m skip locked limit 1;
 if msg.id is null then return null;end if;
 update public.schedule_task_messages set state='sending',lease_token=token,claimed_at=now(),attempts=attempts+1 where id=msg.id;
 return to_jsonb(msg)||jsonb_build_object('lease_token',token);
end $$;
revoke all on function public.schedule_claim_task_message() from public,anon,authenticated;
grant execute on function public.schedule_claim_task_message() to service_role;

create function public.schedule_finish_task_message(p_id uuid,p_lease uuid,p_message bigint,p_error text,p_uncertain boolean default false) returns void
language plpgsql security definer set search_path=public,pg_catalog as $$
begin
 update public.schedule_task_messages set state=case when p_message is not null then 'done' when p_uncertain then 'review' else 'error' end,message_id=p_message,error=left(p_error,500),available_at=now()+interval '5 minutes'
 where id=p_id and state='sending' and lease_token=p_lease;
end $$;
revoke all on function public.schedule_finish_task_message(uuid,uuid,bigint,text,boolean) from public,anon,authenticated;
grant execute on function public.schedule_finish_task_message(uuid,uuid,bigint,text,boolean) to service_role;

create function private.schedule_task_definition_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.schedule_task_history(venue_id,entity_id,actor_id,action,details)
 values(new.venue_id,new.id,auth.uid(),case when tg_op='INSERT' then 'definition.created' else 'definition.updated' end,jsonb_build_object('before',case when tg_op='UPDATE' then to_jsonb(old) else null end,'after',to_jsonb(new)));
 return new;
end $$;
revoke all on function private.schedule_task_definition_audit() from public,anon,authenticated;
create trigger schedule_task_definition_audit after insert or update on public.schedule_task_definitions for each row execute function private.schedule_task_definition_audit();

create function private.schedule_task_assignment_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' or old.shift_id is distinct from new.shift_id or old.employee_id is distinct from new.employee_id or old.user_id is distinct from new.user_id or (old.status in ('blocked','assigned') and new.status in ('blocked','assigned') and old.status<>new.status) then
  insert into public.schedule_task_history(venue_id,entity_id,actor_id,action,details) values(new.venue_id,new.id,auth.uid(),case when tg_op='INSERT' then 'assignment.created' else 'assignment.changed' end,jsonb_build_object('before',case when tg_op='UPDATE' then to_jsonb(old) else null end,'after',to_jsonb(new)));
 end if;
 return new;
end $$;
revoke all on function private.schedule_task_assignment_audit() from public,anon,authenticated;
create trigger schedule_task_assignment_audit after insert or update on public.schedule_task_occurrences for each row execute function private.schedule_task_assignment_audit();

-- Untouched assignments can be corrected; reports with work/results retain their shift and assignment.
create function private.schedule_task_shift_report_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare o public.schedule_task_occurrences;tz text;
begin
 if tg_op='UPDATE' then
  select coalesce(timezone,'Europe/Moscow') into tz from public.venues where id=old.venue_id;
  if new.user_id is not distinct from old.user_id and new.payroll_employee_id is not distinct from old.payroll_employee_id
   and new.template_id is not distinct from old.template_id and (new.starts_at at time zone tz)::date=(old.starts_at at time zone tz)::date then return new;end if;
 end if;
 for o in select * from public.schedule_task_occurrences where shift_id=old.id for update loop
  if o.status not in ('blocked','assigned') or o.answers<>'{}'::jsonb or o.submitted_at is not null or o.settled_at is not null
   or exists(select 1 from storage.objects photo where photo.bucket_id='task-evidence' and photo.name like o.id::text||'/%') then
   if tg_op='DELETE' then raise exception 'Нельзя удалить смену с начатым отчётом задачи';end if;
   raise exception 'Нельзя менять назначение смены с начатым отчётом задачи';
  end if;
 end loop;
 if tg_op='DELETE' then return old;end if;
 return new;
end $$;
revoke all on function private.schedule_task_shift_report_guard() from public,anon,authenticated;
create trigger schedule_task_shift_delete_guard before delete on public.schedule_shifts for each row execute function private.schedule_task_shift_report_guard();
create trigger schedule_task_shift_assignment_guard before update of user_id,payroll_employee_id,template_id,starts_at on public.schedule_shifts for each row execute function private.schedule_task_shift_report_guard();

-- Extend the submission window in the same transaction as the shift edit, including saved drafts.
-- A manager's correction deadline and a deadline already promised to the employee stay intact.
create function private.schedule_task_shift_deadline() returns trigger language plpgsql security definer set search_path='' as $$
declare o public.schedule_task_occurrences;
begin
 for o in select * from public.schedule_task_occurrences
  where shift_id=new.id and venue_id=new.venue_id and settled_at is null and submitted_at is null
   and status in ('assigned','in_progress') and deadline_at<new.ends_at for update loop
  update public.schedule_task_occurrences set deadline_at=new.ends_at,version=version+1,updated_at=now() where id=o.id;
  insert into public.schedule_task_history(venue_id,entity_id,actor_id,action,details)
  values(o.venue_id,o.id,auth.uid(),'assignment.deadline_extended',jsonb_build_object('before',to_jsonb(o),'after',(select to_jsonb(r) from public.schedule_task_occurrences r where r.id=o.id)));
 end loop;
 return new;
end $$;
revoke all on function private.schedule_task_shift_deadline() from public,anon,authenticated;
create trigger schedule_task_shift_deadline after update of ends_at on public.schedule_shifts for each row when (new.ends_at>old.ends_at) execute function private.schedule_task_shift_deadline();

create function public.schedule_retry_task_message(p_id uuid,p_evidence text) returns void
language plpgsql security definer set search_path=public,pg_catalog as $$
declare v uuid:=public.get_active_venue_id();a uuid:=public.get_active_account_id();
begin
 if auth.uid() is null or not public.has_permission('schedule.checklist_edit') then raise exception 'Нет доступа к повторной отправке';end if;
 if length(trim(coalesce(p_evidence,''))) not between 10 and 1000 then raise exception 'Подтвердите отсутствие сообщения в чате';end if;
 update public.schedule_task_messages set state='pending',attempts=0,available_at=now(),lease_token=null,claimed_at=null,error=null where id=p_id and venue_id=v and account_id=a and state in ('error','review') and message_id is null;
 if not found then raise exception 'Сообщение уже обработано или недоступно';end if;
 insert into public.schedule_task_history(venue_id,entity_id,actor_id,action,details) values(v,p_id,auth.uid(),'message.retry',jsonb_build_object('comment',p_evidence));
end $$;
revoke all on function public.schedule_retry_task_message(uuid,text) from public,anon;
grant execute on function public.schedule_retry_task_message(uuid,text) to authenticated;

commit;
