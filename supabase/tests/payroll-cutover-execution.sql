begin;
do $test$
declare u uuid;a uuid;v uuid;e uuid;r uuid;r2 uuid;today date;job jsonb;second jsonb;op_id uuid;lease uuid;refund uuid;before_count bigint;
begin
 select id into u from auth.users where email='owner@test.com';
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();today:=(now() at time zone 'Europe/Moscow')::date;
 if not exists(select 1 from public.payroll_automation_settings where venue_id=v) then raise exception 'Fixture settings required';end if;
 insert into public.payroll_employees(account_id,venue_id,name,role_name,active,quickresto_guest_id,quickresto_bonus_account_id)
 values(a,v,'Bonus cutover fixture','Бармен',true,999999001,999999002) returning id into e;
 insert into public.payroll_adjustments(account_id,venue_id,employee_id,business_date,kind,medium,amount,reason,approved,managed,origin,external_state)
 values(a,v,e,today,'deduction','bonus',-800,'Опоздание fixture',true,true,'lateness','pending') returning id into r;
 if public.payroll_prepare_bonus_operations()<>0 then raise exception 'Default policy queued a real write';end if;
 begin
 perform public.payroll_set_execution_policy(0,today,today,false);raise exception 'Legacy active accepted';
 exception when raise_exception then if sqlerrm not like 'Сначала остановите%' then raise;end if;end;
 perform public.payroll_set_execution_policy(0,today,today,true);
 -- NOW() is fixed within this transaction; ensure the newly created row is after activation.
 update public.payroll_adjustments set created_at=clock_timestamp() where id=r;
 if public.payroll_prepare_bonus_operations()<>1 then raise exception 'Eligible native entry missing';end if;
 if public.payroll_prepare_bonus_operations()<>0 then raise exception 'Duplicate queue row';end if;
 job:=public.payroll_claim_bonus_operation();op_id:=(job->>'id')::uuid;lease:=(job->>'lease_token')::uuid;
 if op_id is null then raise exception 'Queue not claimed';end if;
 begin update public.payroll_adjustments set amount=-400 where id=r;raise exception 'Racing edit accepted';exception when raise_exception then if sqlerrm not like 'Бонусная операция обрабатывается%' then raise;end if;end;
 if public.payroll_begin_bonus_send(op_id,gen_random_uuid(),1000) then raise exception 'Stale lease accepted';end if;
 if not public.payroll_begin_bonus_send(op_id,lease,1000) then raise exception 'Valid send rejected';end if;
 if public.payroll_begin_bonus_send(op_id,lease,1000) then raise exception 'Same send started twice';end if;
 perform public.payroll_finish_bonus_operation(op_id,lease,200,'provider-1',true);
 perform public.payroll_finish_bonus_operation(op_id,lease,null,null,false);
 if (select external_state from public.payroll_adjustments where id=r)<>'done' then raise exception 'Confirmed operation not settled';end if;
 refund:=public.payroll_reverse_bonus(r);
 if public.payroll_reverse_bonus(r)<>refund then raise exception 'Duplicate reverse';end if;
 job:=public.payroll_claim_bonus_operation();lease:=(job->>'lease_token')::uuid;
 if (job->>'id')::uuid<>refund then raise exception 'Refund not claimed';end if;
 if not public.payroll_begin_bonus_send(refund,lease,200) then raise exception 'Refund rejected';end if;
 perform public.payroll_finish_bonus_operation(refund,lease,1000,'provider-refund',true);
 if (select deleted_at from public.payroll_adjustments where id=r) is null then raise exception 'Refund did not cancel journal entry';end if;
 insert into public.payroll_adjustments(account_id,venue_id,employee_id,business_date,kind,medium,amount,reason,approved,managed,origin,external_state,created_at)
 values(a,v,e,today,'deduction','bonus',-800,'Недостаточно бонусов fixture',true,true,'lateness','pending',clock_timestamp()) returning id into r2;
 perform public.payroll_prepare_bonus_operations();job:=public.payroll_claim_bonus_operation();op_id:=(job->>'id')::uuid;lease:=(job->>'lease_token')::uuid;
 if public.payroll_begin_bonus_send(op_id,lease,799) then raise exception 'Partial bonus debit accepted';end if;
 if not exists(select 1 from public.payroll_adjustments where id=r2 and amount=-800 and medium='money' and external_state='not_required') then raise exception 'Not full money fallback';end if;
 insert into public.payroll_adjustments(account_id,venue_id,employee_id,business_date,kind,medium,amount,reason,approved,managed,origin,external_state,created_at)
 values(a,v,e,today,'bonus','bonus',500,'Неизвестный ответ fixture',true,true,'manual','pending',clock_timestamp()) returning id into r2;
 perform public.payroll_prepare_bonus_operations();job:=public.payroll_claim_bonus_operation();op_id:=(job->>'id')::uuid;lease:=(job->>'lease_token')::uuid;
 perform public.payroll_begin_bonus_send(op_id,lease,1000);
 update public.payroll_bonus_operations set claimed_at=now()-interval '4 minutes' where payroll_bonus_operations.id=(job->>'id')::uuid;
 second:=public.payroll_claim_bonus_operation();
 if second is not null then raise exception 'Ambiguous send was automatically reclaimed';end if;
 if (select state from public.payroll_bonus_operations o where o.id=(job->>'id')::uuid)<>'review' then raise exception 'Lost response not flagged';end if;
 begin perform public.payroll_review_bonus_operation(op_id,false,'');raise exception 'No evidence accepted';exception when raise_exception then if sqlerrm not like 'Укажите подтверждение%' then raise;end if;end;
 perform public.payroll_review_bonus_operation(op_id,true,'Подтверждено в истории QR #123');
 if (select external_state from public.payroll_adjustments where id=r2)<>'done' then raise exception 'Manual proof not applied';end if;
 if has_table_privilege('authenticated','public.payroll_bonus_operations','UPDATE') or has_function_privilege('authenticated','public.payroll_begin_bonus_send(uuid,uuid,numeric)','EXECUTE') or has_function_privilege('service_role','public.payroll_commit_automation_source_run(uuid,date,jsonb,jsonb,text,uuid,uuid)','EXECUTE') then raise exception 'Unsafe writer grants';end if;
 raise notice 'PASS: default comparison, explicit cutover, one queue row, exact lease, racing edit, refund, full money fallback, lost POST response, no automatic retry, proof and grants';
end $test$;
rollback;
