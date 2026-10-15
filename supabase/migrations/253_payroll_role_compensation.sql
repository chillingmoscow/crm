begin;
-- Role ownership is new metadata. Existing models, rule IDs and accrual snapshots stay intact.
alter table public.payroll_models add column is_role_default boolean not null default false;
create unique index payroll_role_default_unique on public.payroll_models(role_id) where is_role_default and not archived;

-- This is metadata alignment, not a changed shift fact. Do not enqueue history.
alter table public.schedule_shifts disable trigger schedule_queue_payroll;

-- Senior positions were confirmed as distinct positions. Keep the existing calculation
-- role_name (team group) so senior and ordinary staff continue sharing one headcount.
do $$
declare m public.payroll_models; target_role uuid; original_role uuid; target_name text; target_code text;
begin
 for m in select * from public.payroll_models where name in ('Старший Мастер','Старший бармен') and not archived loop
  original_role:=m.role_id;
  target_name:=case when m.name='Старший Мастер' then 'Старший кальянный мастер' else 'Старший бармен' end;
  target_code:=case when m.name='Старший Мастер' then 'payroll_senior_hookah' else 'payroll_senior_bar' end;
  select id into target_role from public.roles where venue_id=m.venue_id and code=target_code and archived_at is null;
  if target_role is null then
   insert into public.roles(name,code,venue_id,department_id,icon,icon_color)
   select target_name,target_code,m.venue_id,r.department_id,r.icon,r.icon_color from public.roles r where r.id=original_role returning id into target_role;
  end if;
  if target_role is not null then
   update public.payroll_models set role_id=target_role where id=m.id;
   update public.payroll_employees set role_id=target_role where model_id=m.id and venue_id=m.venue_id;
   -- Correct only the one-time imported plans; explicit substitutions are not rewritten.
   update public.schedule_shifts s set role_id=target_role
   where s.venue_id=m.venue_id and s.role_id=original_role and s.note like 'Однократный перенос графика.%'
    and exists(select 1 from public.payroll_employees e where e.model_id=m.id and e.venue_id=m.venue_id and (e.local_user_id=s.user_id or e.id=s.payroll_employee_id));
   insert into public.schedule_qualifications(venue_id,user_id,role_id)
   select e.venue_id,e.local_user_id,target_role from public.payroll_employees e where e.model_id=m.id and e.local_user_id is not null
   on conflict(venue_id,user_id,role_id) do nothing;
  end if;
 end loop;
end $$;
alter table public.schedule_shifts enable trigger schedule_queue_payroll;

update public.payroll_models m set is_role_default=true
where m.role_id is not null and not m.archived and
 (m.name=m.role_name or m.name='Бармен-официант' or not exists(select 1 from public.payroll_models x where x.role_id=m.role_id and x.id<>m.id and not x.archived));

alter table public.payroll_rule_versions add column change_reason text;

-- Extend the existing versioned command, preserving all other validation and actions.
do $$
declare definition text;
begin
 select pg_get_functiondef('public.payroll_command(text,jsonb)'::regprocedure) into definition;
 if position('''knowledge_amount'',''food_amount'',''cleaner_bonus'',''tips'',''experience'',''basis''' in definition)=0 then raise exception 'Unexpected payroll command contract';end if;
 definition:=replace(definition,'''knowledge_amount'',''food_amount'',''cleaner_bonus'',''tips'',''experience'',''basis''','''knowledge_amount'',''food_amount'',''cleaner_bonus'',''tips'',''experience'',''basis'',''shift_pay'',''extras_enabled''');
 definition:=replace(definition,'''tips'',''experience'') and jsonb_typeof','''tips'',''experience'',''shift_pay'',''extras_enabled'') and jsonb_typeof');
 definition:=replace(definition,'tenure_requires_exam,config,created_by)','tenure_requires_exam,config,created_by,change_reason)');
 definition:=replace(definition,'''config'',''{}''),u) returning id into x;','''config'',''{}''),u,p_input->>''reason'') returning id into x;');
 execute definition;
end $$;

create function public.payroll_save_role_rule(p_role_id uuid,p_input jsonb,p_expected_rule_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;v uuid;u uuid;m public.payroll_models;latest uuid;result jsonb; role_label text;
begin
 select s.a,s.v,s.u into a,v,u from private.payroll_scope('payroll.configure') s;
 perform pg_advisory_xact_lock(hashtextextended(v::text,0));
 select name into role_label from public.roles where id=p_role_id and venue_id=v and archived_at is null;
 if role_label is null then raise exception 'Должность недоступна';end if;
 select * into m from public.payroll_models where role_id=p_role_id and account_id=a and venue_id=v and is_role_default and not archived for update;
 if m.id is null then
  if exists(select 1 from public.payroll_models where role_id=p_role_id and not archived) then raise exception 'Сначала выберите базовые условия должности';end if;
  insert into public.payroll_models(account_id,venue_id,name,role_name,basis,monthly_amount,tips,experience,knowledge_amount,food_amount,cleaner_bonus)
  values(a,v,role_label,role_label,'none',0,false,false,0,0,0) returning * into m;
  update public.payroll_models set role_id=p_role_id,is_role_default=true where id=m.id;
 end if;
 select id into latest from public.payroll_rule_versions where model_id=m.id and employee_id is null order by valid_from desc,created_at desc,id desc limit 1;
 if latest is distinct from p_expected_rule_id then raise exception 'Условия изменились. Обновите страницу перед сохранением';end if;
 if p_input->>'valid_from' is null or p_input->>'reason' is null or length(trim(p_input->>'reason'))<3 then raise exception 'Укажите дату и причину изменения условий';end if;
 if p_input->>'monthly_amount' is null or (p_input->>'monthly_amount')::numeric<0 or (p_input->>'monthly_amount')::numeric>1000000000 then raise exception 'Некорректный оклад';end if;
 if (p_input->>'monthly_amount')::numeric is distinct from coalesce((select monthly_amount from public.payroll_rule_versions where id=latest),m.monthly_amount) and extract(day from (p_input->>'valid_from')::date)<>1 then raise exception 'Оклад задаётся с первого числа месяца';end if;
 result:=public.payroll_command('rule',(p_input-'model_id'-'employee_id')||jsonb_build_object('model_id',m.id));
 return result;
end $$;
revoke all on function public.payroll_save_role_rule(uuid,jsonb,uuid) from public,anon;
grant execute on function public.payroll_save_role_rule(uuid,jsonb,uuid) to authenticated;

create function public.payroll_assign_position(p_employee_id uuid,p_role_id uuid,p_valid_from date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;v uuid;u uuid;m uuid; e public.payroll_employees; result jsonb; role_label text;
begin
 select s.a,s.v,s.u into a,v,u from private.payroll_scope('payroll.configure') s;
 perform pg_advisory_xact_lock(hashtextextended(v::text,0));
 if not exists(select 1 from public.roles where id=p_role_id and venue_id=v and archived_at is null) then raise exception 'Должность недоступна';end if;
 if not exists(select 1 from public.payroll_employees where id=p_employee_id and account_id=a and venue_id=v) then raise exception 'Сотрудник недоступен';end if;
 select id into m from public.payroll_models where role_id=p_role_id and account_id=a and venue_id=v and is_role_default and not archived;
 if m is null then raise exception 'Сначала настройте оплату должности';end if;
 select * into e from public.payroll_employees where id=p_employee_id;
 result:=public.payroll_command('employee',jsonb_build_object('id',p_employee_id,'model_id',m,'valid_from',p_valid_from));
 if e.local_user_id is not null then
  insert into public.schedule_qualifications(venue_id,user_id,role_id) values(v,e.local_user_id,p_role_id) on conflict do nothing;
 end if;
 select name into role_label from public.roles where id=p_role_id;
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details)
 values(a,v,u,'payroll.position.assigned','payroll_position',e.id,jsonb_build_object('employee_name',e.name,'role_id',p_role_id,'role_name',role_label,'valid_from',p_valid_from,'before_model_id',e.model_id,'model_id',m));
 return result;
end $$;
revoke all on function public.payroll_assign_position(uuid,uuid,date) from public,anon;
grant execute on function public.payroll_assign_position(uuid,uuid,date) to authenticated;

create function private.payroll_rule_audit() returns trigger language plpgsql security definer set search_path='' as $$
declare m public.payroll_models; role_label text; old_rule jsonb;
begin
 select * into m from public.payroll_models where id=new.model_id;
 select name into role_label from public.roles where id=m.role_id;
 select to_jsonb(r) into old_rule from public.payroll_rule_versions r where r.model_id=new.model_id and r.id<>new.id and r.employee_id is not distinct from new.employee_id order by r.valid_from desc,r.created_at desc,r.id desc limit 1;
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details)
 values(new.account_id,new.venue_id,new.created_by,'payroll.rule.created','payroll_rule',new.id,
 jsonb_build_object('role_id',m.role_id,'role_name',coalesce(role_label,m.role_name),'valid_from',new.valid_from,'before',old_rule,'after',to_jsonb(new)));
 return new;
end $$;
revoke all on function private.payroll_rule_audit() from public,anon,authenticated;
create trigger payroll_rule_global_audit after insert on public.payroll_rule_versions for each row execute function private.payroll_rule_audit();
create policy payroll_rule_audit_access on public.audit_logs as restrictive for select to authenticated
 using(entity_type not in ('payroll_rule','payroll_position') or (venue_id=public.get_active_venue_id() and public.has_permission('payroll.configure')));

notify pgrst,'reload schema';
commit;
