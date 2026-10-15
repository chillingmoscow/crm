begin;
-- Audit uses the affected row's scope, including background automation without a user session.
create function private.payroll_adjustment_audit() returns trigger
language plpgsql security definer set search_path='' as $$
declare payload jsonb; before_row jsonb; after_row jsonb; action text; employee_name text; changes jsonb;
begin
 after_row:=to_jsonb(new);
 if tg_op='UPDATE' then
  before_row:=to_jsonb(old);
  if (before_row-'updated_at') is not distinct from (after_row-'updated_at') then return new;end if;
 end if;
 action:=case when tg_op='INSERT' then 'created' when old.deleted_at is null and new.deleted_at is not null then 'deleted'
  when old.deleted_at is not null and new.deleted_at is null then 'restored' else 'updated' end;
 select name into employee_name from public.payroll_employees where id=new.employee_id;
 select coalesce(jsonb_agg(jsonb_build_object('field',k,'old',before_row->k,'new',after_row->k)),'[]') into changes
 from unnest(array['employee_id','business_date','kind','amount','reason','medium','approved','deleted_at','delete_reason','external_state']) k
 where tg_op='UPDATE' and before_row->k is distinct from after_row->k;
 payload:=jsonb_build_object('employee_id',new.employee_id,'employee_name',employee_name,'kind',new.kind,'amount',new.amount,
 'medium',new.medium,'business_date',new.business_date,'reason',new.reason,'delete_reason',new.delete_reason,'origin',new.origin,'changes',changes);
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details)
 values(new.account_id,new.venue_id,auth.uid(),'payroll.adjustment.'||action,'payroll_adjustment',new.id,payload);
 return new;
end $$;
revoke all on function private.payroll_adjustment_audit() from public,anon,authenticated;
create trigger payroll_adjustment_global_audit after insert or update on public.payroll_adjustments
 for each row execute function private.payroll_adjustment_audit();

-- Comments and attachments have their own immutable history entries.
create function private.payroll_adjustment_history_audit() returns trigger
language plpgsql security definer set search_path='' as $$
declare entry public.payroll_adjustments; employee_name text;
begin
 if new.action not in ('commented','photo_added') then return new;end if;
 select * into entry from public.payroll_adjustments where id=new.adjustment_id;
 select name into employee_name from public.payroll_employees where id=new.employee_id;
 insert into public.audit_logs(id,account_id,venue_id,user_id,action_code,entity_type,entity_id,details,created_at)
 values(new.id,new.account_id,new.venue_id,new.actor_id,'payroll.adjustment.'||new.action,'payroll_adjustment',new.adjustment_id,
 new.details||jsonb_build_object('employee_id',new.employee_id,'employee_name',employee_name,'kind',entry.kind,'business_date',entry.business_date),new.created_at);
 return new;
end $$;
revoke all on function private.payroll_adjustment_history_audit() from public,anon,authenticated;
create trigger payroll_adjustment_history_global_audit after insert on public.payroll_adjustment_history
 for each row execute function private.payroll_adjustment_history_audit();

-- Preserve real historic timestamps and authors where a history entry already exists.
-- Do not invent events for imported rows whose actual authors/actions are unknown.
insert into public.audit_logs(id,account_id,venue_id,user_id,action_code,entity_type,entity_id,details,created_at)
select h.id,h.account_id,h.venue_id,h.actor_id,'payroll.adjustment.'||h.action,'payroll_adjustment',h.adjustment_id,
 jsonb_build_object('employee_id',h.employee_id,'employee_name',e.name,'kind',d.kind,'business_date',d.business_date)||h.details,h.created_at
from public.payroll_adjustment_history h join public.payroll_adjustments d on d.id=h.adjustment_id
join public.payroll_employees e on e.id=h.employee_id
on conflict(id) do nothing;

-- Access to the general event journal alone must not reveal salary details.
create policy payroll_audit_salary_access on public.audit_logs as restrictive for select to authenticated
 using(entity_type<>'payroll_adjustment' or (venue_id=public.get_active_venue_id() and public.has_permission('payroll.view')));
notify pgrst,'reload schema';
commit;
