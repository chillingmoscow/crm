-- Role change from the staff card (updateStaffRole → payroll_assign_position): a date inside a checked (non-draft) payroll period is refused
-- by payroll_command('employee') via payroll_assign_position; nothing is written. Rolls back.
begin;
do $$
declare u uuid;a uuid;v uuid;m public.payroll_models;fixture uuid;rid uuid;rname text;
begin
 select id into u from auth.users where email='owner@test.com';
 if u is null then raise exception 'Local seed users required';end if;
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 -- Self-contained: a role with a default payroll model, independent of seeded payroll data.
 -- The model's role is resolved from role_name by a trigger, so the role name must be unique in the venue.
 select id,name into rid,rname from public.roles r where r.venue_id=v and r.archived_at is null
  and (select count(*) from public.roles y where y.venue_id=v and y.name=r.name and y.archived_at is null)=1
  and not exists(select 1 from public.payroll_models x where x.role_id=r.id and x.is_role_default and not x.archived) limit 1;
 if rid is null then raise exception 'A venue role without payroll conditions is required';end if;
 insert into public.payroll_models(account_id,venue_id,name,role_name,basis,role_id,is_role_default)
 values(a,v,'Role lock fixture model',rname,'none',rid,true) returning * into m;
 if m.role_id is distinct from rid then raise exception 'Fixture model not bound to the role';end if;
 insert into public.payroll_settings(account_id,venue_id,starts_on,quickresto_venue_id) values(a,v,'2026-09-01',1) on conflict do nothing;
 insert into public.payroll_employees(account_id,venue_id,name,role_name,opening_confirmed) values(a,v,'Role lock fixture','Test',true) returning id into fixture;
 insert into public.payroll_periods(account_id,venue_id,month,status) values(a,v,'2041-03-01','checked');
 begin
  perform public.payroll_assign_position(fixture,m.role_id,'2041-03-10');
  raise exception 'locked-period-role-change-accepted';
 exception when others then
  if sqlerrm='locked-period-role-change-accepted' then raise;end if;
  if sqlerrm not like '%защищен%' then raise exception 'Unexpected refusal: %',sqlerrm;end if;
 end;
 if exists(select 1 from public.payroll_employee_models where employee_id=fixture) then raise exception 'Refused role change left a history row';end if;
 if exists(select 1 from public.audit_logs where entity_id=fixture and action_code='payroll.position.assigned') then raise exception 'Refused role change audited';end if;
 -- The first day after the checked period is open.
 perform public.payroll_assign_position(fixture,m.role_id,'2041-04-01');
 if not exists(select 1 from public.payroll_employee_models where employee_id=fixture and model_id=m.id and valid_from='2041-04-01') then raise exception 'Role change after the checked period lost';end if;
raise notice 'Role change payroll lock checks passed';
end $$;
rollback;
