-- Department moves already use the atomic set_role_department command, but
-- roles_audit only records title changes. Keep the assignment history too.
begin;
create or replace function private.role_department_history() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
declare a uuid; before_name text; after_name text;
begin
 if old.department_id is not distinct from new.department_id or
    new.venue_id is null or auth.uid() is null then return new; end if;
 select account_id into a from public.venues where id=new.venue_id;
 if a is distinct from public.get_active_account_id() then return new; end if;
 select name into before_name from public.departments where id=old.department_id;
 select name into after_name from public.departments where id=new.department_id;
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details)
 values(a,new.venue_id,auth.uid(),'role.department_changed','role',new.id,
  jsonb_build_object('role_name',new.name,'old_department_id',old.department_id,
   'new_department_id',new.department_id,'old_department_name',before_name,
   'new_department_name',after_name));
 return new;
end;
$$;
revoke all on function private.role_department_history() from public,anon,authenticated,service_role;
drop trigger if exists role_department_history on public.roles;
create trigger role_department_history after update of department_id on public.roles
 for each row execute function private.role_department_history();
commit;
