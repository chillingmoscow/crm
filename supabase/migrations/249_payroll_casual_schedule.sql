begin;
alter table public.payroll_employees add constraint payroll_employee_venue_identity unique(venue_id,id);
alter table public.payroll_models add constraint payroll_model_venue_identity unique(venue_id,id);
alter table public.payroll_employees add column casual boolean not null default false;
alter table public.schedule_shifts
 add column payroll_employee_id uuid,
 add column payroll_model_id uuid,
 add column payroll_fact_id bigint generated always as identity (start with -1 increment by -1 minvalue -9007199254740991 maxvalue -1),
 add constraint schedule_casual_assignment check (payroll_employee_id is null or (user_id is null and payroll_model_id is not null)),
 add constraint schedule_casual_employee foreign key (venue_id,payroll_employee_id) references public.payroll_employees(venue_id,id),
 add constraint schedule_casual_model foreign key (venue_id,payroll_model_id) references public.payroll_models(venue_id,id);
create unique index schedule_payroll_fact on public.schedule_shifts(payroll_fact_id);
alter table public.payroll_attendance add column source text generated always as (case when external_id<0 then 'schedule' else 'quickresto' end) stored;

create function public.schedule_payroll_options() returns jsonb language sql stable security definer set search_path='' as $$
 select case when public.has_permission('schedule.view_all') then jsonb_build_object(
 'employees',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'role_id',e.role_id,'role_name',e.role_name,'model_id',e.model_id)),'[]') from public.payroll_employees e where e.venue_id=public.get_active_venue_id() and e.casual),
 'models',case when public.has_permission('payroll.configure') then (select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'role_name',m.role_name)),'[]') from public.payroll_models m where m.venue_id=public.get_active_venue_id() and not m.archived and m.monthly_amount=0) else '[]'::jsonb end) else '{"employees":[],"models":[]}'::jsonb end;
$$;
revoke all on function public.schedule_payroll_options() from public,anon;
grant execute on function public.schedule_payroll_options() to authenticated;
CREATE OR REPLACE FUNCTION public.schedule_command(p_action text, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
 v uuid:=public.get_active_venue_id(); u uuid:=auth.uid(); perm text; ident uuid; prev public.schedule_shifts; run public.schedule_runs;
 s public.schedule_shifts; t public.schedule_templates; c public.schedule_checklists; item jsonb; ans jsonb; tz text; start_stamp timestamptz; end_stamp timestamptz; ids uuid[]; who uuid; pos uuid; dept uuid; ver integer; pe uuid; pm uuid; ename text; pay public.payroll_employees;
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
   if exists(select 1 from public.payroll_attendance where shift_id=ident) then raise exception 'Смена уже учтена в зарплате. Оформите корректировку начисления';end if;
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
   pe:=nullif(p_input->>'payroll_employee_id','')::uuid; pm:=nullif(p_input->>'payroll_model_id','')::uuid;
   ename:=trim(coalesce(p_input->>'casual_name',''));
   if pe is not null or ename<>'' or prev.payroll_employee_id is not null then
    if not public.has_permission('schedule.shift_assign') or not public.has_permission('payroll.configure') then raise exception 'Нужны права назначения смен и настройки оплаты';end if;
    if exists(select 1 from public.payroll_source_days where venue_id=v and state='loading') then raise exception 'Дождитесь обновления зарплаты';end if;
    if exists(select 1 from public.schedule_runs where shift_id=ident) then raise exception 'Нельзя переназначить начатую смену';end if;
    if who is not null and (pe is not null or ename<>'') then raise exception 'Выберите штатного или разового сотрудника';end if;
   end if;
   if ename<>'' then
    if length(ename)>160 or pe is not null then raise exception 'Проверьте имя разового сотрудника';end if;
    select * into pay from public.payroll_employees where venue_id=v and casual and lower(name)=lower(ename);
    if found then raise exception 'Этот разовый сотрудник уже есть в списке';end if;
    if not exists(select 1 from public.payroll_models where id=pm and venue_id=v and not archived and monthly_amount=0 and role_name=(select name from public.roles where id=pos and venue_id=v)) then raise exception 'Выберите модель оплаты для выбранной позиции';end if;
    insert into public.payroll_employees(account_id,venue_id,name,role_id,role_name,model_id,casual,opening_confirmed)
    select account_id,v,ename,pos,(select name from public.roles where id=pos),pm,true,true from public.venues where id=v returning id into pe;
   end if;
   if pe is not null then
    select * into pay from public.payroll_employees where id=pe and venue_id=v and casual;
    if not found then raise exception 'Разовый сотрудник другого заведения или не найден';end if;
    pm:=coalesce(pm,pay.model_id);
    if not exists(select 1 from public.payroll_models where id=pm and venue_id=v and not archived and monthly_amount=0 and role_name=(select name from public.roles where id=pos and venue_id=v)) then raise exception 'Выберите модель оплаты для выбранной позиции';end if;
    if jsonb_array_length(coalesce(p_input->'checklist_ids','[]'))>0 then raise exception 'У разового сотрудника нет доступа к чек-листам';end if;
   else pm:=null;end if;

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
   if pe is not null then
    perform pg_advisory_xact_lock(hashtextextended(pe::text,0));
    if exists(select 1 from public.schedule_shifts where payroll_employee_id=pe and (id<>ident or ident is null or p_action='shift.copy') and starts_at<end_stamp and ends_at>start_stamp) then raise exception 'У сотрудника уже есть смена в это время';end if;
   end if;
   select coalesce(array_agg(x::uuid),'{}') into ids from jsonb_array_elements_text(coalesce(p_input->'checklist_ids','[]')) x;
   if exists(select 1 from unnest(ids) x where not exists(select 1 from public.schedule_checklists where id=x and venue_id=v and published_snapshot is not null and not archived)) then raise exception 'Можно назначать только опубликованные чек-листы заведения'; end if;
   if p_action='shift.assign' then
    update public.schedule_shifts set user_id=who,payroll_employee_id=pe,payroll_model_id=pm,version=version+1,updated_at=now() where id=ident returning * into s;
   elsif p_action in ('shift.create','shift.copy') then
    insert into public.schedule_shifts(venue_id,user_id,payroll_employee_id,payroll_model_id,role_id,department_id,template_id,title,color,starts_at,ends_at,break_minutes,arrival_minutes,note,checklist_ids)
    values(v,who,pe,pm,pos,dept,nullif(p_input->>'template_id','')::uuid,trim(p_input->>'title'),coalesce(p_input->>'color','blue'),start_stamp,end_stamp,coalesce((p_input->>'break_minutes')::integer,0),coalesce((p_input->>'arrival_minutes')::integer,0),coalesce(p_input->>'note',''),ids) returning * into s;
   else
    if exists(select 1 from public.schedule_runs where shift_id=ident) and (start_stamp<>prev.starts_at or end_stamp<>prev.ends_at or ids<>prev.checklist_ids or pos is distinct from prev.role_id) then raise exception 'В начатой смене нельзя менять время, позицию и чек-листы'; end if;
    update public.schedule_shifts set user_id=who,payroll_employee_id=pe,payroll_model_id=pm,role_id=pos,department_id=dept,template_id=nullif(p_input->>'template_id','')::uuid,title=trim(p_input->>'title'),color=coalesce(p_input->>'color','blue'),starts_at=start_stamp,ends_at=end_stamp,break_minutes=coalesce((p_input->>'break_minutes')::integer,0),arrival_minutes=coalesce((p_input->>'arrival_minutes')::integer,0),note=coalesce(p_input->>'note',''),checklist_ids=ids,checklist_snapshots=case when published and ids<>prev.checklist_ids then coalesce((select jsonb_object_agg(ck.id::text,ck.published_snapshot) from public.schedule_checklists ck where ck.id=any(ids)),'{}') else checklist_snapshots end,version=version+1,updated_at=now() where id=ident returning * into s;
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
end;$function$;


create function private.schedule_queue_payroll() returns trigger language plpgsql security definer set search_path='' as $$
declare v uuid; tz text; hr int; d date; r public.schedule_shifts;
begin
 v:=coalesce(new.venue_id,old.venue_id);
 select timezone,day_start_hour into tz,hr from public.sales_settings where venue_id=v;
 if tz is null then return coalesce(new,old);end if;
 for r in select (new).* union all select (old).* loop
  if r.id is null or r.ends_at>now() then continue;end if;
  d:=((r.starts_at at time zone tz)-make_interval(hours=>hr))::date;
  insert into public.payroll_source_days(account_id,venue_id,business_date,state)
  select account_id,v,d,'pending' from public.payroll_settings where venue_id=v and starts_on<=d
  on conflict(venue_id,business_date) do update set state='pending',error=null where payroll_source_days.state<>'loading';
 end loop;
 return coalesce(new,old);
end $$;
revoke all on function private.schedule_queue_payroll() from public,anon,authenticated;
create trigger schedule_queue_payroll after insert or update or delete on public.schedule_shifts for each row execute function private.schedule_queue_payroll();

-- Negative IDs are reserved for schedule facts. No Quick Resto identity is invented.
create function private.payroll_schedule_fact_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.external_id<0 and new.status='deviation' and new.issue='Отметка удалена в Quick Resto' then
  new.status:='ignored';new.issue:='Смена изменена в графике';
 end if;
 if new.external_id<0 and new.status='confirmed' then
  if not exists(select 1 from public.schedule_shifts s join public.payroll_employees e on e.id=s.payroll_employee_id and e.venue_id=s.venue_id
    where s.id=new.shift_id and s.venue_id=new.venue_id and s.payroll_fact_id=new.external_id and s.payroll_employee_id=new.employee_id and e.casual
    and s.published and s.ends_at<=now() and s.starts_at=new.starts_at and s.ends_at=new.ends_at) then raise exception 'Запись графика изменилась. Повторите расчёт';end if;
 end if;
 return new;
end $$;
revoke all on function private.payroll_schedule_fact_guard() from public,anon,authenticated;
create trigger payroll_schedule_fact_guard before insert or update on public.payroll_attendance for each row execute function private.payroll_schedule_fact_guard();
commit;
