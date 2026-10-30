-- Recruiting stages stay separate from staff shifts and payroll.
alter table public.candidate_appointments add column venue_id uuid;
alter table public.candidate_appointments add column interview_feedback jsonb not null default '{}';
alter table public.candidate_appointments add constraint candidate_interview_feedback_shape check (
  jsonb_typeof(interview_feedback)='object'
  and (interview_feedback - array['punctuality','appearance','communication','smiled']::text[])='{}'::jsonb
  and (not interview_feedback?'punctuality' or (jsonb_typeof(interview_feedback->'punctuality')='string' and interview_feedback->>'punctuality' in ('on_time','late')))
  and (not interview_feedback?'appearance' or (jsonb_typeof(interview_feedback->'appearance')='string' and length(interview_feedback->>'appearance')<=2000))
  and (not interview_feedback?'communication' or (jsonb_typeof(interview_feedback->'communication')='string' and length(interview_feedback->>'communication')<=2000))
  and (not interview_feedback?'smiled' or jsonb_typeof(interview_feedback->'smiled')='boolean')
);
-- Status transitions go through the same locked, audited RPC as appointments.
revoke update(status) on public.candidates from authenticated;
alter table public.candidate_appointments add constraint candidate_appointments_venue_fk
  foreign key(account_id,venue_id) references public.venues(account_id,id);
create index candidate_appointments_venue_calendar
  on public.candidate_appointments(account_id,venue_id,appointment_date,candidate_id);

create function public.candidate_calendar_trials() returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,'candidate_id',c.id,'full_name',c.full_name,
    'desired_position',c.desired_position,'hired_user_id',c.hired_user_id,
    'appointment_date',a.appointment_date,'starts_at',a.starts_at,
    'timezone',a.timezone,'location',a.location,'outcome',a.outcome
  ) order by a.appointment_date,a.starts_at,a.id),'[]'::jsonb)
  from public.candidate_appointments a
  join public.candidates c on c.id=a.candidate_id and c.account_id=a.account_id
  where a.venue_id=(select public.get_active_venue_id())
    and a.account_id=(select public.get_active_account_id())
    and (select public.has_permission('schedule.view_all'))
    and a.kind='trial' and a.outcome in ('scheduled','passed')
    and c.status in ('trial','hired') and c.archived_at is null;
$$;
revoke all on function public.candidate_calendar_trials() from public,anon;
grant execute on function public.candidate_calendar_trials() to authenticated;

create or replace function public.candidate_begin_hire(p_candidate uuid,p_input jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare a uuid:=public.get_active_account_id();u uuid:=auth.uid();c public.candidates;h public.candidate_hires;v uuid:=(p_input->>'venue_id')::uuid;r uuid:=(p_input->>'role_id')::uuid;existing uuid:=nullif(p_input->>'existing_user_id','')::uuid;m uuid; ident uuid;
begin
 if u is null or a is null or not public.has_permission('people.manage_candidates') then raise exception 'Нет права принимать кандидатов';end if;
 if not private.candidate_venue_permission(u,v,'people.invite_staff') or not private.candidate_venue_permission(u,v,'people.manage_candidates') or not exists(select 1 from public.venues where id=v and account_id=a and archived_at is null) then raise exception 'Нет прав на найм в выбранном заведении';end if;
 select * into c from public.candidates where id=p_candidate and account_id=a and archived_at is null for update;
 if not found then raise exception 'Кандидат недоступен';end if;
 select * into h from public.candidate_hires where account_id=a and candidate_id=c.id;
 if found then
 if h.state<>'complete' and h.input is distinct from p_input then raise exception 'Предыдущий приём ещё не завершён. Повторите с теми же данными';end if;
 return to_jsonb(h);
 end if;
 if c.status='hired' then raise exception 'Кандидат уже принят';end if;
 if c.status<>'trial' then raise exception 'Приём на работу доступен только на этапе «Стажировка»';end if;
 if c.revision is distinct from (p_input->>'revision')::int then raise exception 'Анкета изменена. Обновите страницу';end if;
 if length(trim(p_input->>'first_name'))<1 or length(trim(p_input->>'last_name'))<1 or nullif(p_input->>'employment_date','') is null then raise exception 'Укажите имя, фамилию и дату приёма';end if;
 if p_input->>'attendance_source' not in ('schedule','quickresto') then raise exception 'Выберите источник учёта смен';end if;
 select id into m from public.payroll_models where account_id=a and venue_id=v and role_id=r and is_role_default and not archived;
 if m is null or not exists(select 1 from public.roles where id=r and venue_id=v and archived_at is null) or not exists(select 1 from public.payroll_rule_versions where model_id=m and employee_id is null and valid_from<=(p_input->>'employment_date')::date) then raise exception 'Сначала настройте оплату должности на дату приёма';end if;
 if existing is not null then raise exception 'Используйте связь с существующим сотрудником';end if;
 if existing is not null and not exists(select 1 from public.user_venue_roles uv join public.venues ve on ve.id=uv.venue_id where uv.user_id=existing and ve.account_id=a) then raise exception 'Сотрудник недоступен';end if;
 insert into public.candidate_hires(account_id,candidate_id,target_user_id,existing_user,actor_id,input) values(a,c.id,coalesce(existing,gen_random_uuid()),existing is not null,u,p_input) returning * into h;
 return to_jsonb(h);
end $$;

create or replace function public.candidate_link_staff(p_candidate uuid,p_user uuid,p_venue uuid,p_revision int) returns uuid language plpgsql security definer set search_path=public,pg_catalog as $$
declare a uuid:=public.get_active_account_id();u uuid:=auth.uid();c public.candidates;r uuid;
begin
 if u is null or a is null or not public.has_permission('people.manage_candidates') or not private.candidate_venue_permission(u,p_venue,'people.invite_staff') or not exists(select 1 from public.venues where id=p_venue and account_id=a and archived_at is null) then raise exception 'Нет права связывать кандидата с сотрудником';end if;
 select * into c from public.candidates where id=p_candidate and account_id=a and archived_at is null for update;
 if not found then raise exception 'Кандидат недоступен';end if;
 if c.hired_user_id=p_user and c.hired_venue_id=p_venue then return p_user;end if;
 if c.status<>'trial' then raise exception 'Приём на работу доступен только на этапе «Стажировка»';end if;
 if c.revision is distinct from p_revision or c.status='hired' or exists(select 1 from public.candidate_hires where candidate_id=c.id) then raise exception 'Анкета или оформление уже изменены';end if;
 select role_id into r from public.user_venue_roles where user_id=p_user and venue_id=p_venue and status='active' and fired_at is null;
 if r is null then raise exception 'Сотрудник не работает в выбранном заведении';end if;
 update public.candidates set status='hired',hired_user_id=p_user,hired_venue_id=p_venue,hired_role_id=r,hired_at=now(),hired_by=u where id=c.id;
 return p_user;
end $$;


create or replace function public.candidate_command(p_action text,p_id uuid default null,p_input jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare a uuid:=public.get_active_account_id();u uuid:=auth.uid();c public.candidates;ident uuid;r public.candidate_appointments;owner boolean;
begin
 if u is null or a is null then raise exception 'Войдите в аккаунт';end if;
 if p_action not in ('update','comment','appointment','archive','restore','delete') then raise exception 'Неизвестное действие';end if;
 if not private.candidate_access(a,true) then raise exception 'Нет права вести кандидатов';end if;
 select * into c from public.candidates where id=p_id and account_id=a for update;
 if not found then raise exception 'Кандидат недоступен';end if;
 if p_action in ('archive','restore','delete') then
 if exists(select 1 from public.candidate_hires where candidate_id=c.id and lease_until>now()) then raise exception 'Дождитесь завершения оформления сотрудника';end if;
 select owner_id=u into owner from public.accounts where id=a;
 if not coalesce(owner,false) then raise exception 'Доступно только владельцу аккаунта';end if;
 if p_action='delete' then
 if c.hired_user_id is not null or exists(select 1 from public.candidate_hires where candidate_id=c.id) then raise exception 'Анкета связана с оформлением сотрудника. Её можно архивировать';end if;
 insert into public.candidate_jobs(account_id,kind,payload) select a,'file_cleanup',jsonb_build_object('paths',jsonb_agg(storage_path)) from public.candidate_files where account_id=a and candidate_id=c.id and storage_path is not null having count(*)>0;
 delete from public.candidates where id=c.id;return '{}';
 end if;
 update public.candidates set archived_at=case when p_action='archive' then now() else null end,archived_by=case when p_action='archive' then u else null end where id=c.id;return '{}';
 end if;
 if c.archived_at is not null then raise exception 'Сначала восстановите анкету из архива';end if;
 if p_action in ('update','appointment') and exists(select 1 from public.candidate_hires where candidate_id=c.id and state<>'complete') then
   raise exception 'Сначала завершите оформление сотрудника';
 end if;
 if p_action='update' then
 if p_input?'responsible_id' then raise exception 'Назначение ответственного больше не используется';end if;
 if c.revision is distinct from (p_input->>'revision')::int then raise exception 'Анкета изменена. Обновите страницу';end if;
 if p_input ? 'status' and (p_input->>'status'='hired' or c.status='hired' and p_input->>'status'<>'hired') then raise exception 'Приём на работу доступен через кнопку «Принять на работу»';end if;
 update public.candidates set
 full_name=case when p_input?'full_name' then trim(p_input->>'full_name') else full_name end,
 phone=case when p_input?'phone' then p_input->>'phone' else phone end,
 desired_position=case when p_input?'desired_position' then p_input->>'desired_position' else desired_position end,
 age=case when p_input?'age' then nullif(p_input->>'age','')::int else age end,
 address=case when p_input?'address' then p_input->>'address' else address end,
 social=case when p_input?'social' then p_input->'social' else social end,
 education=case when p_input?'education' then p_input->>'education' else education end,
 experience=case when p_input?'experience' then p_input->>'experience' else experience end,
 plans=case when p_input?'plans' then p_input->>'plans' else plans end,
 family_status=case when p_input?'family_status' then p_input->>'family_status' else family_status end,
 drivers_license=case when p_input?'drivers_license' then p_input->>'drivers_license' else drivers_license end,
 salary_expectation=case when p_input?'salary_expectation' then p_input->>'salary_expectation' else salary_expectation end,
 status=coalesce(p_input->>'status',status) where id=c.id returning * into c;
 elsif p_action='comment' then
 insert into public.candidate_comments(account_id,candidate_id,author_id,body,source_id) values(a,c.id,u,trim(p_input->>'body'),p_input->>'request_key') on conflict(account_id,candidate_id,source_id) do nothing returning id into ident;
 if ident is not null then insert into public.candidate_events(account_id,candidate_id,actor_id,kind) values(a,c.id,u,'commented');end if;
 elsif p_action='appointment' then
 ident:=coalesce(nullif(p_input->>'id','')::uuid,gen_random_uuid());
 select * into r from public.candidate_appointments where id=ident and account_id=a and candidate_id=c.id for update;
 if found and r.revision is distinct from (p_input->>'revision')::int then raise exception 'Встреча изменена. Обновите страницу';end if;
 if r.id is null and exists(select 1 from public.candidate_appointments where id=ident) then raise exception 'Встреча недоступна';end if;
 if r.id is not null and r.kind is distinct from p_input->>'kind' then raise exception 'Тип проведённой или назначенной встречи менять нельзя';end if;
 if r.id is null and (c.status='hired' or c.status='rejected') then raise exception 'Сначала верните кандидата на рассмотрение';end if;
 if p_input->>'kind'='interview' and nullif(p_input->>'starts_at','') is null then raise exception 'Укажите время собеседования';end if;
 if p_input->>'kind'='interview' and p_input->>'outcome' in ('passed','rejected') then
   if nullif(trim(p_input->>'notes'),'') is null then raise exception 'Заполните комментарий по результатам собеседования';end if;
   if (p_input->>'starts_at')::timestamptz>now() then raise exception 'Результат можно заполнить после проведения собеседования';end if;
 end if;
 if r.id is null and p_input->>'kind'='trial' then
   if c.status not in ('interview','trial') or not coalesce((
     select previous.outcome='passed' and nullif(trim(previous.notes),'') is not null and previous.starts_at<=now()
     from public.candidate_appointments previous where previous.account_id=a and previous.candidate_id=c.id and previous.kind='interview'
     order by previous.appointment_date desc,previous.starts_at desc nulls last,previous.created_at desc,previous.id desc limit 1
   ),false) then raise exception 'Сначала заполните результат последнего собеседования: «Пройдено» и комментарий';end if;
 end if;
 if p_input->>'kind'='trial' and not exists(
   select 1 from public.venues v where v.id=nullif(p_input->>'venue_id','')::uuid and v.account_id=a and v.archived_at is null
 ) then raise exception 'Выберите доступное заведение для стажировки';end if;
 if p_input->>'timezone' not in (select name from pg_timezone_names) then raise exception 'Неизвестный часовой пояс';end if;
 if nullif(p_input->>'interviewer_id','') is not null and not exists(select 1 from public.user_venue_roles m join public.venues v on v.id=m.venue_id where m.user_id=(p_input->>'interviewer_id')::uuid and v.account_id=a and m.status='active' and m.fired_at is null) then raise exception 'Интервьюер недоступен';end if;
 insert into public.candidate_appointments(id,account_id,candidate_id,venue_id,kind,appointment_date,starts_at,timezone,location,interviewer_id,outcome,notes,interview_feedback)
 values(ident,a,c.id,case when p_input->>'kind'='trial' then nullif(p_input->>'venue_id','')::uuid else null end,p_input->>'kind',(p_input->>'appointment_date')::date,nullif(p_input->>'starts_at','')::timestamptz,p_input->>'timezone',p_input->>'location',nullif(p_input->>'interviewer_id','')::uuid,coalesce(p_input->>'outcome','scheduled'),p_input->>'notes',case when p_input->>'kind'='interview' then coalesce(p_input->'interview_feedback','{}') else '{}'::jsonb end)
 on conflict(id) do update set venue_id=excluded.venue_id,kind=excluded.kind,appointment_date=excluded.appointment_date,starts_at=excluded.starts_at,timezone=excluded.timezone,location=excluded.location,interviewer_id=excluded.interviewer_id,outcome=excluded.outcome,notes=excluded.notes,interview_feedback=excluded.interview_feedback,updated_at=now(),revision=public.candidate_appointments.revision+1
 where public.candidate_appointments.account_id=a and public.candidate_appointments.candidate_id=c.id;
 if not found then raise exception 'Встреча недоступна';end if;
 insert into public.candidate_events(account_id,candidate_id,actor_id,kind,details) values(a,c.id,u,case when r.id is null then 'appointment_created' else 'appointment_updated' end,jsonb_build_object('before',to_jsonb(r),'after',(select to_jsonb(saved) from public.candidate_appointments saved where saved.id=ident)));
 if c.hired_user_id is null then
   if p_input->>'outcome'='rejected' then
     update public.candidates set status='rejected' where id=c.id and status<>'rejected' returning * into c;
   elsif p_input->>'kind'='trial' and coalesce(p_input->>'outcome','scheduled') in ('scheduled','passed') then
     update public.candidates set status='trial' where id=c.id and status<>'trial' returning * into c;
   elsif p_input->>'kind'='interview' and coalesce(p_input->>'outcome','scheduled') in ('scheduled','passed') and (c.status in ('new','review','interview') or r.id is null) then
     update public.candidates set status='interview' where id=c.id and status<>'interview' returning * into c;
   elsif p_input->>'outcome' in ('canceled','no_show') and c.status in ('trial','interview') and not exists(
     select 1 from public.candidate_appointments current_plan where current_plan.account_id=a and current_plan.candidate_id=c.id
       and current_plan.kind=case when c.status='trial' then 'trial' else 'interview' end and current_plan.outcome in ('scheduled','passed')
   ) then
     update public.candidates set status=case when c.status='trial' then 'interview' else 'review' end where id=c.id returning * into c;
   end if;
   -- UPDATE ... RETURNING clears its target when the stage was already current.
   select * into c from public.candidates where id=p_id and account_id=a;
 end if;
 end if;return jsonb_build_object('id',coalesce(ident,c.id),'revision',c.revision,'status',c.status);
end $$;

create or replace function public.candidate_event_audit() returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
declare c public.candidates;d jsonb;code text;part text;person uuid;
begin
 if new.kind not in ('created','commented','appointment_created','appointment_updated','file_added') then return new;end if;
 select * into c from public.candidates where id=new.candidate_id and account_id=new.account_id;
 if not found then return new;end if;
 d:=new.details||jsonb_build_object('name',c.full_name,'candidate_event_id',new.id);
 if new.kind='file_added' then d:=d||jsonb_build_object('name_of_file',new.details->>'name');end if;
 if new.kind in ('appointment_created','appointment_updated') then
 foreach part in array array['before','after'] loop
 person:=nullif(d->part->>'interviewer_id','')::uuid;
 if person is not null then d:=jsonb_set(d,array[part,'interviewer_name'],to_jsonb(coalesce((select nullif(concat_ws(' ',first_name,last_name),'') from public.profiles where id=person),'Сотрудник')));end if;
 if nullif(d#>>array[part,'venue_id'],'') is not null then d:=jsonb_set(d,array[part,'venue_name'],to_jsonb(coalesce((select name from public.venues where id=(d#>>array[part,'venue_id'])::uuid),'Заведение')));end if;
 end loop;
 end if;
 code:=case new.kind when 'appointment_created' then 'candidate.appointment.created' when 'appointment_updated' then 'candidate.appointment.updated' when 'file_added' then 'candidate.file.created' else 'candidate.'||new.kind end;
 insert into public.audit_logs(account_id,user_id,action_code,entity_type,entity_id,details) values(c.account_id,new.actor_id,code,'candidate',c.id,d);
 return new;
end $$;

notify pgrst,'reload schema';
