-- Isolated monetary and audit regression, no retained operations.
begin;
do $$
declare u uuid;a uuid;v uuid;e uuid;x uuid;p jsonb;n integer;
begin
 select id into u from auth.users where email='owner@test.com';
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 insert into public.payroll_employees(account_id,venue_id,name,role_name,opening_confirmed) values(a,v,'Allowance rollback fixture','Test',true) returning id into e;
 p:=jsonb_build_object('id',gen_random_uuid(),'request_key',gen_random_uuid(),'employee_id',e,'date','2026-09-01','kind','allowance','medium','money','amount',20000,'reason','Monthly KPI');
 x:=public.payroll_journal_command('create',p);perform public.payroll_journal_command('create',p);
 if private.payroll_month_balance(e,'2026-09-01')<>20000 then raise exception 'Allowance not counted once';end if;
 if not exists(select 1 from public.payroll_accruals c,lateral jsonb_array_elements(c.components) part where c.employee_id=e and part->>'kind'='allowance' and (part->>'amount')::numeric=20000) then raise exception 'Lost allowance classification';end if;
 if exists(select 1 from public.payroll_accruals c,lateral jsonb_array_elements(c.components) part where c.employee_id=e and part->>'kind'='bonus') then raise exception 'Allowance classified as bonus';end if;
 perform public.payroll_update_entry(jsonb_build_object('id',x,'amount',15000,'reason','Revised KPI','expected_amount',20000,'expected_reason','Monthly KPI'));
 if private.payroll_month_balance(e,'2026-09-01')<>15000 then raise exception 'Edit not reflected';end if;
 if (select count(*) from public.audit_logs where entity_id=x and user_id=u and action_code in ('payroll.adjustment.created','payroll.adjustment.updated'))<>2 then raise exception 'Missing audit';end if;
 perform public.payroll_journal_command('delete',jsonb_build_object('id',x,'reason','Rollback fixture deletion'));
 if private.payroll_month_balance(e,'2026-09-01')<>0 then raise exception 'Deletion did not restore salary';end if;
 if not exists(select 1 from public.audit_logs where entity_id=x and action_code='payroll.adjustment.deleted') then raise exception 'Missing deletion audit';end if;
 p:=p||jsonb_build_object('id',gen_random_uuid(),'request_key',gen_random_uuid(),'date','2026-09-02');
 begin perform public.payroll_journal_command('create',p);raise exception 'partial-month-accepted';exception when others then if sqlerrm='partial-month-accepted' then raise;end if;end;
 p:=p||jsonb_build_object('date','2026-09-01','medium','bonus');
 begin perform public.payroll_journal_command('create',p);raise exception 'bonus-medium-accepted';exception when others then if sqlerrm='bonus-medium-accepted' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);perform set_config('app.ctx_ready','0',true);
 begin perform public.payroll_journal_command('create',p||jsonb_build_object('medium','money'));raise exception 'unauthorized-accepted';exception when others then if sqlerrm='unauthorized-accepted' then raise;end if;end;
 raise notice 'PASS: monthly allowance, retry, classification, edit, delete, audit, period/medium validation, permissions';
end $$;
rollback;
