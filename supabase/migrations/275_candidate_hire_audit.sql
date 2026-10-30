-- One canonical completed hire event, attributed to the manager.
create or replace function public.candidate_finish_hire(p_hire uuid) returns uuid language plpgsql security definer set search_path=public,pg_catalog as $$
declare h public.candidate_hires;c public.candidates;v uuid;r uuid;d date;m uuid;emp uuid;membership public.user_venue_roles;label text;
begin
 select * into h from public.candidate_hires where id=p_hire for update;
 if not found then raise exception 'Операция найма не найдена';end if;
 if h.state='complete' then return h.target_user_id;end if;
 v:=(h.input->>'venue_id')::uuid;r:=(h.input->>'role_id')::uuid;d:=(h.input->>'employment_date')::date;
 select * into c from public.candidates where id=h.candidate_id and account_id=h.account_id for update;
 if h.provisioning#>>'{employee,state}' is distinct from 'done' or h.provisioning#>>'{guest,state}' is distinct from 'done' or h.provisioning#>>'{bonus,state}' is distinct from 'done' or not exists(select 1 from public.staff_door_codes where hire_id=h.id) then raise exception 'Завершите создание в Quick Resto и выдачу кода замка';end if;
 if c.archived_at is not null or c.hired_user_id is not null then raise exception 'Состояние анкеты изменилось';end if;
 if not private.candidate_venue_permission(h.actor_id,v,'people.invite_staff') or not private.candidate_venue_permission(h.actor_id,v,'people.manage_candidates') then raise exception 'Права на найм изменились';end if;
 select pm.id,ro.name into m,label from public.payroll_models pm join public.roles ro on ro.id=pm.role_id where pm.account_id=h.account_id and pm.venue_id=v and pm.role_id=r and pm.is_role_default and not pm.archived and ro.archived_at is null;
 if m is null or not exists(select 1 from public.payroll_rule_versions where model_id=m and employee_id is null and valid_from<=d) then raise exception 'Условия оплаты изменились';end if;
 if not exists(select 1 from auth.users where id=h.target_user_id) then raise exception 'Учётная запись ещё не создана';end if;
 if not h.existing_user then
 update public.profiles set first_name=trim(h.input->>'first_name'),last_name=trim(h.input->>'last_name'),phone=c.phone,address=c.address where id=h.target_user_id;
 end if;
 select * into membership from public.user_venue_roles where user_id=h.target_user_id and venue_id=v for update;
 if found and (membership.status<>'active' or membership.fired_at is not null or membership.role_id<>r) then raise exception 'У сотрудника уже есть история работы в заведении. Используйте его карточку';end if;
 insert into public.user_venue_roles(user_id,venue_id,role_id,status,invited_by) values(h.target_user_id,v,r,'active',h.actor_id) on conflict(user_id,venue_id) do nothing;
 insert into public.staff_account_details(account_id,user_id,employment_date) values(h.account_id,h.target_user_id,d) on conflict(account_id,user_id) do nothing;
 insert into public.payroll_employees(account_id,venue_id,name,local_user_id,role_name,role_id,model_id,hired_on,opening_confirmed)
 values(h.account_id,v,trim(h.input->>'first_name')||' '||trim(h.input->>'last_name'),h.target_user_id,label,r,m,d,true)
 on conflict(venue_id,local_user_id) where local_user_id is not null do nothing returning id into emp;
 if emp is not null then
 update public.payroll_employees set quickresto_id=(h.provisioning#>>'{employee,id}')::bigint,quickresto_guest_id=(h.provisioning#>>'{guest,id}')::bigint,quickresto_bonus_account_id=(h.provisioning#>>'{bonus,id}')::bigint where id=emp;
 insert into public.payroll_employee_models(account_id,venue_id,employee_id,model_id,valid_from,created_by) values(h.account_id,v,emp,m,d,h.actor_id);
 insert into public.payroll_attendance_rules(account_id,venue_id,employee_id,source,valid_from,reason,created_by) values(h.account_id,v,emp,h.input->>'attendance_source',d,'Приём из кандидатов',h.actor_id);
 end if;
 insert into public.schedule_qualifications(venue_id,user_id,role_id) values(v,h.target_user_id,r) on conflict do nothing;
 update public.candidates set status='hired',hired_user_id=h.target_user_id,hired_venue_id=v,hired_role_id=r,hired_at=now(),hired_by=h.actor_id where id=c.id;
 update public.candidate_events set actor_id=h.actor_id where candidate_id=c.id and kind='hired' and actor_id is null;
 update public.staff_door_codes set user_id=h.target_user_id where hire_id=h.id;
 update public.user_venue_roles set terminal_pin=h.provisioning#>>'{employee,pin}' where user_id=h.target_user_id and venue_id=v and h.provisioning#>>'{employee,pin}' is not null;
 if exists(select 1 from public.external_entity_links where account_id=h.account_id and provider='quickresto' and entity_type='staff' and external_id=h.provisioning#>>'{employee,id}' and local_id<>h.target_user_id) then raise exception 'Сотрудник Quick Resto уже связан с другой карточкой';end if;
 insert into public.external_entity_links(account_id,provider,entity_type,external_id,local_table,local_id) values(h.account_id,'quickresto','staff',h.provisioning#>>'{employee,id}','profiles',h.target_user_id) on conflict do nothing;
 update public.candidate_hires set state='complete',lease_until=null,error=null where id=h.id;
 -- Membership INSERT has already emitted staff.hired. Promote that same event
 -- to the completed candidate hire and use the initiating manager as actor.
 update public.audit_logs set user_id=h.actor_id,action_code='candidate.hired',
 details=details||jsonb_build_object('candidate_id',c.id,'name',c.full_name,'role_name',label,'employment_date',d)
 where account_id=h.account_id and entity_id=h.target_user_id and action_code='staff.hired'
 and created_at>=h.created_at and details->>'uvr_id'=(select id::text from public.user_venue_roles where user_id=h.target_user_id and venue_id=v);
 if not found then
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details) values(h.account_id,v,h.actor_id,'candidate.hired','staff',h.target_user_id,jsonb_build_object('candidate_id',c.id,'name',c.full_name,'role_name',label,'employment_date',d));
 end if;
 return h.target_user_id;
end $$;
revoke all on function public.candidate_finish_hire(uuid) from public,anon,authenticated;
grant execute on function public.candidate_finish_hire(uuid) to service_role;
