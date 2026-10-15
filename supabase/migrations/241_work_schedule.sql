-- График работы. Все мутации проходят через проверяемый RPC, таблицы доступны только для чтения.
begin;
insert into public.permissions(code,description,module) values
('schedule.view_all','Просмотр графика всей команды','schedule_shifts'),
('schedule.shift_create','Создание смен','schedule_shifts'),
('schedule.shift_edit','Изменение смен','schedule_shifts'),
('schedule.shift_copy','Копирование смен','schedule_shifts'),
('schedule.shift_delete','Удаление смен','schedule_shifts'),
('schedule.shift_assign','Назначение сотрудников на смены','schedule_shifts'),
('schedule.shift_publish','Публикация смен','schedule_shifts'),
('schedule.template_create','Создание шаблонов смен','schedule_templates'),
('schedule.template_edit','Изменение шаблонов смен','schedule_templates'),
('schedule.template_copy','Копирование шаблонов смен','schedule_templates'),
('schedule.template_archive','Архивирование шаблонов смен','schedule_templates'),
('schedule.checklist_create','Создание чек-листов','schedule_checklists'),
('schedule.checklist_edit','Изменение чек-листов','schedule_checklists'),
('schedule.checklist_publish','Публикация чек-листов','schedule_checklists'),
('schedule.checklist_archive','Архивирование чек-листов','schedule_checklists'),
('schedule.review','Проверка выполнения чек-листов','schedule_checklists'),
('schedule.qualifications','Настройка дополнительных позиций сотрудников','schedule_shifts')
on conflict(code) do nothing;
-- Первоначально права выдаются ролям, которым уже разрешено управлять должностями;
-- дальнейшая настройка каждого разрешения выполняется в существующей карточке роли.
insert into public.role_permissions(role_id,permission_id,granted)
select distinct rp.role_id,np.id,true from public.role_permissions rp
join public.permissions op on op.id=rp.permission_id and op.code='people.manage_roles'
cross join public.permissions np where rp.granted and np.code like 'schedule.%'
on conflict(role_id,permission_id) do nothing;

create table public.schedule_checklists (
 id uuid primary key default gen_random_uuid(), venue_id uuid not null references public.venues(id) on delete cascade,
 name text not null check(length(trim(name)) between 1 and 160), description text not null default '', kind text not null default 'other' check(kind in ('opening','closing','other')),
 department_id uuid references public.departments(id) on delete set null, duration integer not null default 0 check(duration between 0 and 1440), priority text not null default 'medium' check(priority in ('low','medium','high')),
 published_snapshot jsonb, items jsonb not null default '[]' check(jsonb_typeof(items)='array'), published boolean not null default false, archived boolean not null default false,
 version integer not null default 1, updated_at timestamptz not null default now()
);
create table public.schedule_templates (
 id uuid primary key default gen_random_uuid(), venue_id uuid not null references public.venues(id) on delete cascade,
 name text not null check(length(trim(name)) between 1 and 160), color text not null default 'blue' check(color in ('gray','orange','yellow','green','blue','purple','pink','red')),
 start_time time not null, end_time time not null, break_minutes integer not null default 0 check(break_minutes between 0 and 1439), arrival_minutes integer not null default 0 check(arrival_minutes between 0 and 240),
 department_id uuid references public.departments(id) on delete set null, role_id uuid references public.roles(id) on delete set null, checklist_ids uuid[] not null default '{}',
 check(break_minutes < (extract(epoch from (end_time-start_time))+case when end_time<=start_time then 86400 else 0 end)/60),
 archived boolean not null default false, version integer not null default 1, updated_at timestamptz not null default now()
);
create table public.schedule_shifts (
 id uuid primary key default gen_random_uuid(), venue_id uuid not null references public.venues(id) on delete cascade,
 user_id uuid references public.profiles(id), role_id uuid references public.roles(id) on delete set null, department_id uuid references public.departments(id) on delete set null,
 template_id uuid references public.schedule_templates(id) on delete set null, title text not null check(length(trim(title)) between 1 and 160), color text not null default 'blue' check(color in ('gray','orange','yellow','green','blue','purple','pink','red')),
 starts_at timestamptz not null, ends_at timestamptz not null, break_minutes integer not null default 0 check(break_minutes>=0), arrival_minutes integer not null default 0 check(arrival_minutes between 0 and 240),
 checklist_snapshots jsonb not null default '{}', note text not null default '', checklist_ids uuid[] not null default '{}', published boolean not null default false,
 version integer not null default 1, updated_at timestamptz not null default now(),
 check(ends_at>starts_at and ends_at<=starts_at+interval '24 hours'), check(break_minutes < extract(epoch from ends_at-starts_at)/60)
);
create table public.schedule_qualifications (
 id uuid primary key default gen_random_uuid(), venue_id uuid not null references public.venues(id) on delete cascade,
 user_id uuid not null references public.profiles(id), role_id uuid not null references public.roles(id), unique(venue_id,user_id,role_id)
);
create table public.schedule_runs (
 id uuid primary key default gen_random_uuid(), venue_id uuid not null references public.venues(id) on delete cascade,
 shift_id uuid not null references public.schedule_shifts(id), checklist_id uuid not null references public.schedule_checklists(id), user_id uuid not null references public.profiles(id),
 snapshot jsonb not null, answers jsonb not null default '{}' check(jsonb_typeof(answers)='object'), status text not null default 'in_progress' check(status in ('in_progress','submitted','returned','approved')),
 review_comment text not null default '', review_notes jsonb not null default '{}' check(jsonb_typeof(review_notes)='object'), started_at timestamptz not null default now(), submitted_at timestamptz, reviewed_at timestamptz,
 version integer not null default 1, updated_at timestamptz not null default now(), unique(shift_id,checklist_id)
);
create table public.schedule_events (
 id uuid primary key default gen_random_uuid(), venue_id uuid not null references public.venues(id) on delete cascade,
 entity_id uuid not null, actor_id uuid references public.profiles(id) on delete set null, action text not null, details jsonb not null default '{}', created_at timestamptz not null default now()
);
create index on public.schedule_shifts(venue_id,starts_at);
create index on public.schedule_shifts(user_id,starts_at,ends_at);
create index on public.schedule_runs(venue_id,status);
create index on public.schedule_events(entity_id,created_at);
create index on public.schedule_checklists(venue_id);
create index on public.schedule_templates(venue_id);
create index on public.schedule_qualifications(venue_id,user_id);

alter table public.schedule_shifts enable row level security;
alter table public.schedule_templates enable row level security;
alter table public.schedule_checklists enable row level security;
alter table public.schedule_runs enable row level security;
alter table public.schedule_qualifications enable row level security;
alter table public.schedule_events enable row level security;
create policy schedule_shifts_read on public.schedule_shifts for select to authenticated using(venue_id=(select public.get_active_venue_id()) and ((select public.has_permission('schedule.view_all')) or (user_id=(select auth.uid()) and published)));
create policy schedule_templates_read on public.schedule_templates for select to authenticated using(venue_id=(select public.get_active_venue_id()) and ((select public.has_permission('schedule.view_all')) or (select public.has_permission('schedule.template_edit')) or (select public.has_permission('schedule.template_create')) or (select public.has_permission('schedule.template_copy')) or (select public.has_permission('schedule.template_archive')) or (select public.has_permission('schedule.shift_create'))));
create policy schedule_checklists_read on public.schedule_checklists for select to authenticated using(venue_id=(select public.get_active_venue_id()) and (published or (select public.has_permission('schedule.checklist_create')) or (select public.has_permission('schedule.checklist_edit')) or (select public.has_permission('schedule.checklist_publish')) or (select public.has_permission('schedule.checklist_archive'))));
create policy schedule_runs_read on public.schedule_runs for select to authenticated using(venue_id=(select public.get_active_venue_id()) and (user_id=(select auth.uid()) or (select public.has_permission('schedule.review'))));
create policy schedule_qualifications_read on public.schedule_qualifications for select to authenticated using(venue_id=(select public.get_active_venue_id()) and (user_id=(select auth.uid()) or (select public.has_permission('schedule.view_all')) or (select public.has_permission('schedule.qualifications'))));
create policy schedule_events_read on public.schedule_events for select to authenticated using(venue_id=(select public.get_active_venue_id()) and ((select public.has_permission('schedule.view_all')) or exists(select 1 from public.schedule_runs r where r.id=entity_id)));
revoke all on public.schedule_shifts,public.schedule_templates,public.schedule_checklists,public.schedule_runs,public.schedule_qualifications,public.schedule_events from anon,authenticated;
grant select on public.schedule_shifts,public.schedule_templates,public.schedule_checklists,public.schedule_runs,public.schedule_qualifications,public.schedule_events to authenticated;

create or replace function public.schedule_command(p_action text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare
 v uuid:=public.get_active_venue_id(); u uuid:=auth.uid(); perm text; ident uuid; prev public.schedule_shifts; run public.schedule_runs;
 s public.schedule_shifts; t public.schedule_templates; c public.schedule_checklists; item jsonb; ans jsonb; tz text; start_stamp timestamptz; end_stamp timestamptz; ids uuid[]; who uuid; pos uuid; dept uuid; ver integer;
begin
 if u is null or v is null or not exists(select 1 from public.user_venue_roles where user_id=u and venue_id=v and status='active') then raise exception 'Нет доступа к заведению'; end if;
 perm:=case p_action
 when 'shift.publish_many' then 'schedule.shift_publish' when 'shift.create' then 'schedule.shift_create' when 'shift.copy' then 'schedule.shift_copy' when 'shift.edit' then 'schedule.shift_edit' when 'shift.delete' then 'schedule.shift_delete' when 'shift.publish' then 'schedule.shift_publish' when 'shift.assign' then 'schedule.shift_assign'
 when 'template.create' then 'schedule.template_create' when 'template.edit' then 'schedule.template_edit' when 'template.copy' then 'schedule.template_copy' when 'template.archive' then 'schedule.template_archive'
 when 'checklist.create' then 'schedule.checklist_create' when 'checklist.edit' then 'schedule.checklist_edit' when 'checklist.publish' then 'schedule.checklist_publish' when 'checklist.archive' then 'schedule.checklist_archive'
 when 'qualification.save' then 'schedule.qualifications' when 'run.approve' then 'schedule.review' when 'run.return' then 'schedule.review'
 when 'run.start' then null when 'run.save' then null when 'run.submit' then null else 'INVALID' end;
 if perm='INVALID' then raise exception 'Неизвестное действие'; end if;
 if perm is not null and not public.has_permission(perm) then raise exception 'Недостаточно прав: %',perm; end if;
 if p_action='shift.publish_many' then
  if not public.has_permission('schedule.shift_publish') then raise exception 'Нет права публиковать смены';end if;
  if jsonb_typeof(p_input->'shifts') is distinct from 'array' or jsonb_array_length(p_input->'shifts') not between 1 and 300 then raise exception 'Выберите смены';end if;
  for item in select * from jsonb_array_elements(p_input->'shifts') loop
   perform public.schedule_command('shift.publish',item);
  end loop;
  return jsonb_build_object('id',null);
 end if;
 ident:=nullif(p_input->>'id','')::uuid;
 if p_action not in ('shift.create','template.create','checklist.create','run.start','qualification.save') and ident is null then raise exception 'Не выбрана запись';end if;
 if p_action like 'shift.%' then
  if ident is not null then select * into prev from public.schedule_shifts where id=ident and venue_id=v for update; if not found then raise exception 'Смена не найдена'; end if;
   if p_action<>'shift.copy' and coalesce((p_input->>'version')::integer,0)<>prev.version then raise exception 'Смена уже изменена. Обновите страницу'; end if;
  end if;
  if p_action='shift.delete' then
   if exists(select 1 from public.schedule_runs where shift_id=ident) then raise exception 'Нельзя удалить смену с начатым чек-листом'; end if;
   delete from public.schedule_shifts where id=ident;
  elsif p_action='shift.publish' then
   if prev.published then raise exception 'Смена уже опубликована';end if;
   if exists(select 1 from unnest(prev.checklist_ids) x where not exists(select 1 from public.schedule_checklists where id=x and venue_id=v and published_snapshot is not null and not archived)) then raise exception 'Опубликуйте назначенные чек-листы перед публикацией смены';end if;
   update public.schedule_shifts set published=true,checklist_snapshots=coalesce((select jsonb_object_agg(ck.id::text,ck.published_snapshot) from public.schedule_checklists ck where ck.id=any(prev.checklist_ids)),'{}'),version=version+1,updated_at=now() where id=ident returning * into s;
  else
   if p_action in ('shift.edit','shift.assign') and ident is null then raise exception 'Смена не выбрана'; end if;
   who:=nullif(p_input->>'user_id','')::uuid; pos:=nullif(p_input->>'role_id','')::uuid; dept:=nullif(p_input->>'department_id','')::uuid;
   if p_action='shift.assign' then pos:=prev.role_id;dept:=prev.department_id;end if;
   if (p_action in ('shift.create','shift.copy') and who is not null) or (ident is not null and who is distinct from prev.user_id) then
    if not public.has_permission('schedule.shift_assign') then raise exception 'Нет права назначать сотрудников'; end if;
    if exists(select 1 from public.schedule_runs where shift_id=ident) then raise exception 'Нельзя переназначить начатую смену'; end if;
   end if;
   if who is not null and not exists(select 1 from public.user_venue_roles where user_id=who and venue_id=v and status='active') then raise exception 'Сотрудник не работает в заведении'; end if;
   if pos is not null and not exists(select 1 from public.roles where id=pos and venue_id=v) then raise exception 'Должность из другого заведения'; end if;
   if dept is not null and not exists(select 1 from public.departments where id=dept and venue_id=v) then raise exception 'Подразделение из другого заведения'; end if;
   if pos is not null and dept is distinct from (select department_id from public.roles where id=pos) then raise exception 'Должность не входит в подразделение'; end if;
   if who is not null and pos is not null and not exists(select 1 from public.user_venue_roles where user_id=who and venue_id=v and role_id=pos and status='active') and not exists(select 1 from public.schedule_qualifications where user_id=who and venue_id=v and role_id=pos) then raise exception 'Нет допуска к выбранной позиции'; end if;
   select timezone into tz from public.venues where id=v;
   start_stamp:=((p_input->>'date')::date+(p_input->>'start_time')::time) at time zone tz;
   end_stamp:=((p_input->>'date')::date+(p_input->>'end_time')::time+case when (p_input->>'end_time')::time<=(p_input->>'start_time')::time then interval '1 day' else interval '0' end) at time zone tz;
   if p_action='shift.assign' then start_stamp:=prev.starts_at;end_stamp:=prev.ends_at;pos:=prev.role_id;dept:=prev.department_id; end if;
   if who is not null then
    perform pg_advisory_xact_lock(hashtextextended(who::text,0));
    if exists(select 1 from public.schedule_shifts where user_id=who and (id<>ident or ident is null or p_action='shift.copy') and starts_at<end_stamp and ends_at>start_stamp) then raise exception 'У сотрудника уже есть смена в это время'; end if;
   end if;
   select coalesce(array_agg(x::uuid),'{}') into ids from jsonb_array_elements_text(coalesce(p_input->'checklist_ids','[]')) x;
   if exists(select 1 from unnest(ids) x where not exists(select 1 from public.schedule_checklists where id=x and venue_id=v and published_snapshot is not null and not archived)) then raise exception 'Можно назначать только опубликованные чек-листы заведения'; end if;
   if p_action='shift.assign' then
    update public.schedule_shifts set user_id=who,version=version+1,updated_at=now() where id=ident returning * into s;
   elsif p_action in ('shift.create','shift.copy') then
    insert into public.schedule_shifts(venue_id,user_id,role_id,department_id,template_id,title,color,starts_at,ends_at,break_minutes,arrival_minutes,note,checklist_ids)
    values(v,who,pos,dept,nullif(p_input->>'template_id','')::uuid,trim(p_input->>'title'),coalesce(p_input->>'color','blue'),start_stamp,end_stamp,coalesce((p_input->>'break_minutes')::integer,0),coalesce((p_input->>'arrival_minutes')::integer,0),coalesce(p_input->>'note',''),ids) returning * into s;
   else
    if exists(select 1 from public.schedule_runs where shift_id=ident) and (start_stamp<>prev.starts_at or end_stamp<>prev.ends_at or ids<>prev.checklist_ids or pos is distinct from prev.role_id) then raise exception 'В начатой смене нельзя менять время, позицию и чек-листы'; end if;
    update public.schedule_shifts set user_id=who,role_id=pos,department_id=dept,template_id=nullif(p_input->>'template_id','')::uuid,title=trim(p_input->>'title'),color=coalesce(p_input->>'color','blue'),starts_at=start_stamp,ends_at=end_stamp,break_minutes=coalesce((p_input->>'break_minutes')::integer,0),arrival_minutes=coalesce((p_input->>'arrival_minutes')::integer,0),note=coalesce(p_input->>'note',''),checklist_ids=ids,checklist_snapshots=case when published and ids<>prev.checklist_ids then coalesce((select jsonb_object_agg(ck.id::text,ck.published_snapshot) from public.schedule_checklists ck where ck.id=any(ids)),'{}') else checklist_snapshots end,version=version+1,updated_at=now() where id=ident returning * into s;
   end if;
   ident:=s.id;
  end if;
  if s.template_id is not null and not exists(select 1 from public.schedule_templates where id=s.template_id and venue_id=v) then raise exception 'Шаблон из другого заведения'; end if;
 elsif p_action like 'template.%' then
  if ident is not null then select * into t from public.schedule_templates where id=ident and venue_id=v for update;if not found then raise exception 'Шаблон не найден';end if;
   if p_action<>'template.copy' and t.version<>coalesce((p_input->>'version')::integer,0) then raise exception 'Шаблон уже изменён';end if;
  end if;
  dept:=nullif(p_input->>'department_id','')::uuid;pos:=nullif(p_input->>'role_id','')::uuid;
  if dept is not null and not exists(select 1 from public.departments where id=dept and venue_id=v) then raise exception 'Неверное подразделение';end if;
  if pos is not null and not exists(select 1 from public.roles where id=pos and venue_id=v and department_id is not distinct from dept) then raise exception 'Неверная должность';end if;
  select coalesce(array_agg(x::uuid),'{}') into ids from jsonb_array_elements_text(coalesce(p_input->'checklist_ids','[]')) x;
  if exists(select 1 from unnest(ids) x where not exists(select 1 from public.schedule_checklists where id=x and venue_id=v and published_snapshot is not null and not archived)) then raise exception 'Неверный чек-лист';end if;
  if p_action='template.archive' then update public.schedule_templates set archived=not archived,version=version+1,updated_at=now() where id=ident;
  elsif p_action in ('template.create','template.copy') then
   insert into public.schedule_templates(venue_id,name,color,start_time,end_time,break_minutes,arrival_minutes,department_id,role_id,checklist_ids) values(v,trim(p_input->>'name'),p_input->>'color',(p_input->>'start_time')::time,(p_input->>'end_time')::time,coalesce((p_input->>'break_minutes')::integer,0),coalesce((p_input->>'arrival_minutes')::integer,0),dept,pos,ids) returning id into ident;
  else update public.schedule_templates set name=trim(p_input->>'name'),color=p_input->>'color',start_time=(p_input->>'start_time')::time,end_time=(p_input->>'end_time')::time,break_minutes=coalesce((p_input->>'break_minutes')::integer,0),arrival_minutes=coalesce((p_input->>'arrival_minutes')::integer,0),department_id=dept,role_id=pos,checklist_ids=ids,version=version+1,updated_at=now() where id=ident;end if;
 elsif p_action like 'checklist.%' then
  if ident is not null then select * into c from public.schedule_checklists where id=ident and venue_id=v for update;if not found then raise exception 'Чек-лист не найден';end if;
   if c.version<>coalesce((p_input->>'version')::integer,0) then raise exception 'Чек-лист уже изменён';end if;
  end if;
  if p_action='checklist.publish' then
   if jsonb_array_length(c.items)=0 then raise exception 'Добавьте хотя бы один пункт';end if;
   update public.schedule_checklists set published=true,published_snapshot=(to_jsonb(c)-'published_snapshot')||jsonb_build_object('published',true,'version',c.version+1),version=version+1,updated_at=now() where id=ident;
  elsif p_action='checklist.archive' then update public.schedule_checklists set archived=not archived,version=version+1,updated_at=now() where id=ident;
  else
   dept:=nullif(p_input->>'department_id','')::uuid;
   if dept is not null and not exists(select 1 from public.departments where id=dept and venue_id=v) then raise exception 'Неверное подразделение';end if;
   if jsonb_typeof(p_input->'items') is distinct from 'array' or jsonb_array_length(p_input->'items')>100 then raise exception 'Неверные пункты';end if;
   for item in select * from jsonb_array_elements(p_input->'items') loop
    if coalesce(length(trim(item->>'title')),0) not between 1 and 300 or coalesce(item->>'kind','') not in ('check','photo','number','text','info') or (item->>'id') is null or jsonb_typeof(item->'required') is distinct from 'boolean' then raise exception 'Проверьте пункты чек-листа';end if;
    perform (item->>'id')::uuid;
    if (select count(*) from jsonb_array_elements(p_input->'items') x where x->>'id'=item->>'id')<>1 then raise exception 'Повторяющиеся пункты';end if;
    if nullif(item->>'parent_id','') is not null and not exists(select 1 from jsonb_array_elements(p_input->'items') x where x->>'id'=item->>'parent_id' and x->>'id'<>item->>'id' and nullif(x->>'parent_id','') is null) then raise exception 'Допускается один уровень подпунктов';end if;
    if (item->>'min') is not null and (item->>'max') is not null and (item->>'min')::numeric>(item->>'max')::numeric then raise exception 'Минимум больше максимума';end if;
    if coalesce((item->>'max_length')::integer,500) not between 1 and 10000 then raise exception 'Неверное ограничение текста';end if;
   end loop;
   if p_action='checklist.create' then insert into public.schedule_checklists(venue_id,name,description,kind,department_id,duration,priority,items) values(v,trim(p_input->>'name'),coalesce(p_input->>'description',''),p_input->>'kind',dept,coalesce((p_input->>'duration')::integer,0),p_input->>'priority',p_input->'items') returning id into ident;
   else update public.schedule_checklists set name=trim(p_input->>'name'),description=coalesce(p_input->>'description',''),kind=p_input->>'kind',department_id=dept,duration=coalesce((p_input->>'duration')::integer,0),priority=p_input->>'priority',items=p_input->'items',published=false,version=version+1,updated_at=now() where id=ident;end if;
  end if;
 elsif p_action='qualification.save' then
  who:=(p_input->>'user_id')::uuid;pos:=(p_input->>'role_id')::uuid;
  if not exists(select 1 from public.user_venue_roles where user_id=who and venue_id=v and status='active') or not exists(select 1 from public.roles where id=pos and venue_id=v) then raise exception 'Сотрудник или должность из другого заведения';end if;
  if (p_input->>'remove')::boolean then delete from public.schedule_qualifications where user_id=who and role_id=pos and venue_id=v;
  else insert into public.schedule_qualifications(venue_id,user_id,role_id) values(v,who,pos) on conflict do nothing;end if;
  ident:=who;
 elsif p_action='run.start' then
  select * into s from public.schedule_shifts where id=(p_input->>'shift_id')::uuid and venue_id=v and user_id=u and published for update;
  if not found then raise exception 'Вам не назначена эта опубликованная смена';end if;
  select * into c from public.schedule_checklists where id=(p_input->>'checklist_id')::uuid and id=any(s.checklist_ids) and venue_id=v;
  if not found or s.checklist_snapshots->c.id::text is null then raise exception 'Чек-лист недоступен';end if;
  insert into public.schedule_runs(venue_id,shift_id,checklist_id,user_id,snapshot) values(v,s.id,c.id,u,s.checklist_snapshots->c.id::text) on conflict(shift_id,checklist_id) do nothing;
  select id into ident from public.schedule_runs where shift_id=s.id and checklist_id=c.id;
 else
  select * into run from public.schedule_runs where id=ident and venue_id=v for update;
  if not found then raise exception 'Выполнение не найдено';end if;
  if run.version<>coalesce((p_input->>'version')::integer,0) then raise exception 'Ответы уже изменены. Обновите страницу';end if;
  if p_action in ('run.save','run.submit') then
   if run.user_id<>u or run.status not in ('in_progress','returned') then raise exception 'Ответы недоступны для изменения';end if;
   ans:=coalesce(p_input->'answers',run.answers);
   if jsonb_typeof(ans)<>'object' then raise exception 'Неверные ответы';end if;
   for item in select * from jsonb_array_elements(run.snapshot->'items') loop
    if p_action='run.submit' and coalesce((item->>'required')::boolean,false) and item->>'kind'<>'info' then
     if not (ans ? (item->>'id')) or ans->(item->>'id')='null'::jsonb or length(trim(ans->>(item->>'id')))=0 or (item->>'kind'='check' and ans->>(item->>'id')<>'true') then raise exception 'Заполните обязательный пункт: %',item->>'title';end if;
    end if;
    if ans ? (item->>'id') and ans->(item->>'id')<>'null'::jsonb then
     if item->>'kind'='check' and jsonb_typeof(ans->(item->>'id'))<>'boolean' then raise exception 'Требуется подтверждение чекбоксом';end if;
     if item->>'kind' in ('text','photo') and jsonb_typeof(ans->(item->>'id'))<>'string' then raise exception 'Неверный тип ответа';end if;
    end if;
    if ans ? (item->>'id') and ans->(item->>'id')<>'null'::jsonb and ans->>(item->>'id')<>'' then
     if item->>'kind'='number' and (jsonb_typeof(ans->(item->>'id'))<>'number' or ((item->>'min') is not null and (ans->>(item->>'id'))::numeric<(item->>'min')::numeric) or ((item->>'max') is not null and (ans->>(item->>'id'))::numeric>(item->>'max')::numeric)) then raise exception 'Число вне допустимого диапазона';end if;
     if item->>'kind'='text' and length(ans->>(item->>'id'))>coalesce((item->>'max_length')::integer,500) then raise exception 'Ответ слишком длинный';end if;
     if item->>'kind'='photo' and not exists(select 1 from storage.objects where bucket_id='schedule-evidence' and name=ans->>(item->>'id') and name like ident::text||'/%') then raise exception 'Фотография не загружена';end if;
    end if;
   end loop;
   update public.schedule_runs set answers=ans,status=case when p_action='run.submit' then 'submitted' else status end,submitted_at=case when p_action='run.submit' then now() else submitted_at end,version=version+1,updated_at=now() where id=ident;
  else
   if run.status<>'submitted' then raise exception 'Выполнение ещё не отправлено';end if;
   if jsonb_typeof(coalesce(p_input->'notes','{}')) is distinct from 'object' or length(coalesce(p_input->>'comment',''))>5000 then raise exception 'Неверные замечания';end if;
   if exists(select 1 from jsonb_each(coalesce(p_input->'notes','{}')) n where jsonb_typeof(n.value)<>'string' or length(n.value #>> '{}')>2000 or not exists(select 1 from jsonb_array_elements(run.snapshot->'items') x where x->>'id'=n.key)) then raise exception 'Неверное замечание к пункту';end if;
   if p_action='run.return' and length(trim(coalesce(p_input->>'comment','')))=0 and not exists(select 1 from jsonb_each_text(coalesce(p_input->'notes','{}')) n where length(trim(n.value))>0) then raise exception 'Укажите причину возврата';end if;
   update public.schedule_runs set status=case when p_action='run.approve' then 'approved' else 'returned' end,review_comment=coalesce(p_input->>'comment',''),review_notes=coalesce(p_input->'notes','{}'),reviewed_at=now(),version=version+1,updated_at=now() where id=ident;
  end if;
 end if;
 if ident is not null and p_action<>'run.save' then insert into public.schedule_events(venue_id,entity_id,actor_id,action,details) values(v,ident,u,p_action,jsonb_build_object('comment',p_input->>'comment','notes',p_input->'notes','before',case when p_action like 'shift.%' then to_jsonb(prev) else null end,'after',case when p_action like 'shift.%' then to_jsonb(s) else null end));end if;
 return jsonb_build_object('id',ident);
end;$$;
revoke all on function public.schedule_command(text,jsonb) from public,anon;
grant execute on function public.schedule_command(text,jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('schedule-evidence','schedule-evidence',false,10485760,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create policy schedule_evidence_read on storage.objects for select to authenticated using(bucket_id='schedule-evidence' and exists(select 1 from public.schedule_runs r where r.id::text=split_part(name,'/',1)));
create policy schedule_evidence_insert on storage.objects for insert to authenticated with check(bucket_id='schedule-evidence' and exists(select 1 from public.schedule_runs r where r.id::text=split_part(name,'/',1) and r.user_id=(select auth.uid()) and r.status in ('in_progress','returned')));
commit;
