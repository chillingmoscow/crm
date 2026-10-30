-- Shared appointment scheduling from the list and candidate profile.
create or replace function public.candidate_command(p_action text,p_id uuid default null,p_input jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare a uuid:=public.get_active_account_id();u uuid:=auth.uid();c public.candidates;ident uuid;r public.candidate_appointments;owner boolean;meeting_venue uuid;meeting_timezone text;meeting_location text;
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
 if p_input?'status' and p_input->>'status' in ('interview','trial') and p_input->>'status' is distinct from c.status then
   raise exception 'Для этого этапа назначьте встречу с датой';
 end if;
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
 if r.id is null and c.status='hired' then raise exception 'Кандидат уже принят на работу';end if;
 if p_input->>'kind'='interview' and nullif(p_input->>'starts_at','') is null then raise exception 'Укажите время собеседования';end if;
 if p_input->>'kind'='interview' and p_input->>'outcome' in ('passed','rejected') then
   if nullif(trim(p_input->>'notes'),'') is null then raise exception 'Заполните комментарий по результатам собеседования';end if;
   if (p_input->>'starts_at')::timestamptz>now() then raise exception 'Результат можно заполнить после проведения собеседования';end if;
 end if;
 if r.id is null and p_input->>'kind'='trial' then
   if not coalesce((
     select previous.outcome='passed' and nullif(trim(previous.notes),'') is not null and previous.starts_at<=now()
     from public.candidate_appointments previous where previous.account_id=a and previous.candidate_id=c.id and previous.kind='interview'
     order by previous.appointment_date desc,previous.starts_at desc nulls last,previous.created_at desc,previous.id desc limit 1
   ),false) then raise exception 'Сначала заполните результат последнего собеседования: «Пройдено» и комментарий';end if;
 end if;
 meeting_venue:=case when p_input?'venue_id' then nullif(p_input->>'venue_id','')::uuid else r.venue_id end;
 if meeting_venue is not null and not exists(select 1 from public.venues v where v.id=meeting_venue and v.account_id=a and v.archived_at is null) then
   raise exception 'Выберите доступное заведение для встречи';
 end if;
 if p_input->>'kind'='trial' and meeting_venue is null then raise exception 'Выберите заведение для стажировки';end if;
 if p_input->>'kind'='interview' and r.id is null and meeting_venue is null and coalesce(p_input->>'location','') !~* '^https?://[^[:space:]]+$' then
   raise exception 'Выберите заведение или добавьте ссылку на встречу';
 end if;
 select v.timezone,v.name into meeting_timezone,meeting_location from public.venues v where v.id=meeting_venue;
 meeting_timezone:=coalesce(meeting_timezone,nullif(p_input->>'timezone',''),'Europe/Moscow');
 meeting_location:=coalesce(meeting_location,p_input->>'location');
 if meeting_timezone not in (select name from pg_timezone_names) then raise exception 'Неизвестный часовой пояс';end if;
 if nullif(p_input->>'interviewer_id','') is not null and not (
   exists(select 1 from public.accounts ac where ac.id=a and ac.owner_id=(p_input->>'interviewer_id')::uuid)
   or exists(select 1 from public.user_venue_roles m join public.venues v on v.id=m.venue_id where m.user_id=(p_input->>'interviewer_id')::uuid and v.account_id=a and m.status='active' and m.fired_at is null)
 ) then raise exception 'Интервьюер недоступен';end if;
 insert into public.candidate_appointments(id,account_id,candidate_id,venue_id,kind,appointment_date,starts_at,timezone,location,interviewer_id,outcome,notes,interview_feedback)
 values(ident,a,c.id,meeting_venue,p_input->>'kind',(p_input->>'appointment_date')::date,nullif(p_input->>'starts_at','')::timestamptz,meeting_timezone,meeting_location,nullif(p_input->>'interviewer_id','')::uuid,coalesce(p_input->>'outcome','scheduled'),p_input->>'notes',case when p_input->>'kind'='interview' then coalesce(p_input->'interview_feedback','{}') else '{}'::jsonb end)
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

create or replace function public.candidate_hiring_options() returns jsonb language sql stable security definer set search_path=public,pg_catalog as $$
 select case when private.candidate_access(public.get_active_account_id(),false) then jsonb_build_object(
 'active_venue_id',(select active_venue_id from public.profiles where id=auth.uid()),
 'positions',coalesce((select jsonb_agg(x.desired_position order by x.desired_position) from (select distinct desired_position from public.candidates where account_id=public.get_active_account_id() and archived_at is null and status<>'hired' and nullif(trim(desired_position),'') is not null) x),'[]'),
 'venues',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'timezone',v.timezone,'can_hire',private.candidate_venue_permission(auth.uid(),v.id,'people.invite_staff') and private.candidate_venue_permission(auth.uid(),v.id,'people.manage_candidates'),'can_create_role',private.candidate_venue_permission(auth.uid(),v.id,'people.manage_roles') and private.candidate_venue_permission(auth.uid(),v.id,'payroll.configure'))) from public.venues v where v.account_id=public.get_active_account_id() and v.archived_at is null),'[]'),
 'roles',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'venue_id',r.venue_id,'model_id',m.id,'quickresto_role_id',coalesce(m.quickresto_role_id,(select l.external_id::bigint from public.external_entity_links l where l.account_id=v.account_id and l.provider='quickresto' and l.entity_type='role' and l.local_id=r.id and l.external_id~'^[0-9]+$' limit 1)),'rules',coalesce((select jsonb_agg(jsonb_build_object('valid_from',rv.valid_from,'monthly_amount',rv.monthly_amount,'rates',rv.rates,'config',rv.config) order by rv.valid_from desc,rv.created_at desc,rv.id desc) from public.payroll_rule_versions rv where rv.model_id=m.id and rv.employee_id is null),'[]'))) from public.roles r join public.venues v on v.id=r.venue_id left join public.payroll_models m on m.role_id=r.id and m.is_role_default and not m.archived where v.account_id=public.get_active_account_id() and v.archived_at is null and r.archived_at is null and (private.candidate_venue_permission(auth.uid(),v.id,'people.manage_candidates') or private.candidate_venue_permission(auth.uid(),v.id,'payroll.configure'))),'[]'),
 'staff',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',concat_ws(' ',p.first_name,p.last_name),'venue_id',v.id,'role_id',uv.role_id)) from public.profiles p join public.user_venue_roles uv on uv.user_id=p.id join public.venues v on v.id=uv.venue_id where v.account_id=public.get_active_account_id() and uv.status='active' and uv.fired_at is null),'[]'),
 'members',coalesce((select jsonb_agg(x order by x.name,x.id) from (
   select p.id,coalesce(nullif(concat_ws(' ',p.first_name,p.last_name),''),'Пользователь CRM') as name
   from public.profiles p where p.id in (
     select ac.owner_id from public.accounts ac where ac.id=public.get_active_account_id()
     union
     select uv.user_id from public.user_venue_roles uv join public.venues v on v.id=uv.venue_id
       where v.account_id=public.get_active_account_id() and uv.status='active' and uv.fired_at is null
   )
 ) x),'[]')
 ) else null end;
$$;

notify pgrst,'reload schema';
