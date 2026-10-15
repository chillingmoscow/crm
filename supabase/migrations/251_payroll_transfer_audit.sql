begin;
create function private.payroll_transfer_audit() returns trigger
language plpgsql security definer set search_path='' as $$
declare employee_name text;action text;payload jsonb;
begin
 if tg_op='UPDATE' and (to_jsonb(old)-'updated_at') is not distinct from (to_jsonb(new)-'updated_at') then return new;end if;
 select name into employee_name from public.payroll_employees where id=new.employee_id;
 action:=case when tg_op='INSERT' then 'created' when old.state='posted' and new.state='cancelled' then 'cancelled' else 'updated' end;
 payload:=jsonb_build_object('employee_id',new.employee_id,'employee_name',employee_name,'from_month',new.from_month,'to_month',new.to_month,'amount',new.amount,'reason',new.reason);
 if tg_op='UPDATE' then payload:=payload||jsonb_build_object('previous',to_jsonb(old)-'input_snapshot','current',to_jsonb(new)-'input_snapshot');end if;
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details)
 values(new.account_id,new.venue_id,auth.uid(),'payroll.transfer.'||action,'payroll_transfer',new.id,payload);
 return new;
end $$;
revoke all on function private.payroll_transfer_audit() from public,anon,authenticated;
create trigger payroll_transfer_global_audit after insert or update on public.payroll_transfers for each row execute function private.payroll_transfer_audit();
-- Use existing immutable events where available, retaining their authors and timestamps.
insert into public.audit_logs(id,account_id,venue_id,user_id,action_code,entity_type,entity_id,details,created_at)
select h.id,h.account_id,h.venue_id,h.actor_id,'payroll.transfer.'||case h.action when 'transfer_created' then 'created' else 'cancelled' end,
 'payroll_transfer',t.id,jsonb_build_object('employee_id',t.employee_id,'employee_name',e.name,'from_month',t.from_month,'to_month',t.to_month,'amount',t.amount,'reason',t.reason),h.created_at
from public.payroll_events h join public.payroll_transfers t on t.id=h.entity_id join public.payroll_employees e on e.id=t.employee_id
where h.action in ('transfer_created','transfer_cancelled') on conflict(id) do nothing;
alter policy payroll_audit_salary_access on public.audit_logs
 using(entity_type not in ('payroll_adjustment','payroll_transfer') or (venue_id=public.get_active_venue_id() and public.has_permission('payroll.view')));
notify pgrst,'reload schema';
commit;
