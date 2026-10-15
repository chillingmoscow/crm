begin;
-- Keep the per-record history as informative as the global audit trail.
create or replace function private.payroll_adjustment_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare p uuid; actor text;
begin
 if not new.managed then return new;end if;
 select coalesce(nullif(trim(concat_ws(' ',first_name,last_name)),''),'Сотрудник') into actor from public.profiles where id=auth.uid();
 insert into public.payroll_adjustment_history(account_id,venue_id,employee_id,adjustment_id,actor_id,actor_name,action,details)
 values(new.account_id,new.venue_id,new.employee_id,new.id,auth.uid(),coalesce(actor,'Система'),case when tg_op='INSERT' then 'created' when old.deleted_at is null and new.deleted_at is not null then 'deleted' else 'updated' end,
 jsonb_build_object('reason',new.reason,'amount',new.amount,'medium',new.medium,'previous_medium',case when tg_op='UPDATE' then old.medium else null end,'previous_amount',case when tg_op='UPDATE' then old.amount else null end,'previous_reason',case when tg_op='UPDATE' then old.reason else null end,'bonus_balance',new.bonus_balance_snapshot,'delete_reason',new.delete_reason));
 if new.medium='money' then
  insert into public.payroll_periods(account_id,venue_id,month) values(new.account_id,new.venue_id,date_trunc('month',new.business_date)::date) on conflict(venue_id,month) do nothing;
  select id into p from public.payroll_periods where venue_id=new.venue_id and month=date_trunc('month',new.business_date)::date;
  insert into public.payroll_accruals(account_id,venue_id,employee_id,business_date,period_id,components,salary,tips,status,issues,calculation_snapshot)
  values(new.account_id,new.venue_id,new.employee_id,new.business_date,p,'[]',0,0,'ready','{}','{"kind":"adjustment"}')
  on conflict(employee_id,business_date) do update set updated_at=now();
 end if;
 return new;
end $$;

create function public.payroll_update_entry(p_input jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare a uuid;v uuid;u uuid;r public.payroll_adjustments;n numeric;why text;
begin
 select s.a,s.v,s.u into a,v,u from private.payroll_scope('payroll.review') s;
 perform pg_advisory_xact_lock(hashtextextended(v::text,0));
 select * into r from public.payroll_adjustments where id=(p_input->>'id')::uuid and account_id=a and venue_id=v for update;
 if r.id is null or not private.payroll_read(a,v,r.employee_id) then raise exception 'Запись недоступна';end if;
 if r.deleted_at is not null then raise exception 'Удалённую запись нельзя редактировать';end if;
 if r.kind not in ('bonus','deduction','warning') then raise exception 'Измените правило расчёта этой составляющей';end if;
 if exists(select 1 from public.payroll_periods where venue_id=v and month=date_trunc('month',r.business_date)::date and status<>'draft') then raise exception 'Период зафиксирован';end if;
 why:=trim(p_input->>'reason');n:=(p_input->>'amount')::numeric;
 if n is null or n<0 or n>1000000000 or n<>round(n,2) or coalesce(length(why),0) not between 3 and 4000 or (r.kind<>'warning' and n=0) then raise exception 'Укажите корректную сумму и основание';end if;
 n:=case when r.kind='warning' then 0 when r.kind='deduction' then -n else n end;
 -- A retried save of identical content is a no-op, not another audit event.
 if r.amount=n and r.reason=why then return r.id;end if;
 if (p_input->>'expected_amount')::numeric is distinct from r.amount or p_input->>'expected_reason' is distinct from r.reason then raise exception 'Запись уже изменена. Откройте её заново, чтобы сохранить актуальные данные';end if;
 if r.medium='bonus' and r.external_state='done' and n<>r.amount then raise exception 'Бонусная операция уже проведена. Сначала оформите обратную операцию';end if;
 if not r.managed then
  if r.source_ref is null or not exists(select 1 from public.payroll_accruals c, lateral jsonb_array_elements(c.components) part
   where c.employee_id=r.employee_id and c.venue_id=v and c.business_date=r.business_date and part->>'source'=r.source_ref) then raise exception 'Не удалось связать прежнюю запись с начислением';end if;
  -- Adopt the imported component before replacing it, so it is never counted twice.
  update public.payroll_accruals c set components=(select jsonb_agg(case when part->>'source'=r.source_ref then jsonb_set(part,'{source}',to_jsonb('payroll-entry:'||r.id)) else part end) from jsonb_array_elements(c.components) part)
  where c.employee_id=r.employee_id and c.venue_id=v and c.business_date=r.business_date and exists(select 1 from jsonb_array_elements(c.components) part where part->>'source'=r.source_ref);
 end if;
 update public.payroll_adjustments set managed=true,amount=n,reason=why where id=r.id;
 return r.id;
end $$;
revoke all on function public.payroll_update_entry(jsonb) from public,anon;
grant execute on function public.payroll_update_entry(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
