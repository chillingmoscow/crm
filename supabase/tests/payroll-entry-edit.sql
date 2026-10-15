-- Financial fixtures are rolled back.
begin;
do $$
declare u uuid;a uuid;v uuid;e uuid;x uuid;payload jsonb;n integer;
begin
 select id into u from auth.users where email='owner@test.com';
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 insert into public.payroll_employees(account_id,venue_id,name,role_name,opening_confirmed) values(a,v,'Edit rollback fixture','Test',true) returning id into e;
 x:=public.payroll_journal_command('create',jsonb_build_object('id',gen_random_uuid(),'request_key',gen_random_uuid(),'employee_id',e,'date','2026-09-20','kind','deduction','medium','money','amount',1000,'reason','Original fine'));
 payload:=jsonb_build_object('id',x,'amount',700,'reason','Corrected fine','expected_amount',-1000,'expected_reason','Original fine');
 perform public.payroll_update_entry(payload);
 if private.payroll_month_balance(e,'2026-09-01')<>-700 then raise exception 'Fine edit did not recalculate';end if;
 if not exists(select 1 from public.payroll_adjustment_history where adjustment_id=x and actor_id=u and action='updated' and (details->>'previous_amount')::numeric=-1000 and (details->>'amount')::numeric=-700 and details->>'previous_reason'='Original fine') then raise exception 'Missing detailed history';end if;
 if not exists(select 1 from public.audit_logs where entity_id=x and action_code='payroll.adjustment.updated' and user_id=u) then raise exception 'Missing global audit';end if;
 select count(*) into n from public.payroll_adjustment_history where adjustment_id=x;
 perform public.payroll_update_entry(payload);
 if (select count(*) from public.payroll_adjustment_history where adjustment_id=x)<>n or private.payroll_month_balance(e,'2026-09-01')<>-700 then raise exception 'Retry duplicated edit';end if;
 begin perform public.payroll_update_entry(payload||jsonb_build_object('amount',600));raise exception 'stale-accepted';exception when others then if sqlerrm='stale-accepted' then raise;end if;end;
 perform public.payroll_journal_command('delete',jsonb_build_object('id',x,'reason','Delete rollback fixture'));
 begin perform public.payroll_update_entry(payload);raise exception 'deleted-accepted';exception when others then if sqlerrm='deleted-accepted' then raise;end if;end;
 -- Adopt an imported component once and preserve the remainder of salary.
 insert into public.payroll_adjustments(account_id,venue_id,employee_id,business_date,kind,amount,reason,source_ref,approved) values(a,v,e,'2026-09-22','bonus',100,'Imported bonus','migration:edit:fixture',true) returning id into x;
 insert into public.payroll_accruals(account_id,venue_id,employee_id,business_date,period_id,components,salary,tips,status,issues,calculation_snapshot)
 select a,v,e,'2026-09-22',id,'[{"kind":"base","amount":2000,"source":"QR"},{"kind":"bonus","amount":100,"source":"migration:edit:fixture"}]',2100,0,'ready','{}','{}' from public.payroll_periods where venue_id=v and month='2026-09-01';
 payload:=jsonb_build_object('id',x,'amount',250,'reason','Corrected imported bonus','expected_amount',100,'expected_reason','Imported bonus');
 perform public.payroll_update_entry(payload);perform public.payroll_update_entry(payload);
 if private.payroll_month_balance(e,'2026-09-01')<>2250 then raise exception 'Imported bonus double counted or lost base';end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);perform set_config('app.ctx_ready','0',true);
 begin perform public.payroll_update_entry(payload);raise exception 'unauthorized-accepted';exception when others then if sqlerrm='unauthorized-accepted' then raise;end if;end;
 raise notice 'PASS: signed edits, immediate salary, history, global audit, retry, stale write, deletion, imported component, access';
end $$;
rollback;
