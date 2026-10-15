begin;
do $$
declare u uuid;a uuid;v uuid;e uuid;entry uuid;payload jsonb;baseline numeric;cur numeric;n integer;w uuid;
begin
 select id into u from auth.users where email='owner@test.com';
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 insert into public.payroll_employees(account_id,venue_id,name,role_name,opening_confirmed) values(a,v,'Journal rollback test','Test',true) returning id into e;
 payload:=jsonb_build_object('id',gen_random_uuid(),'request_key',gen_random_uuid(),'employee_id',e,'date','2026-09-20','kind','bonus','medium','money','amount',1000,'reason','Journal test');
 entry:=public.payroll_journal_command('create',payload);
 if private.payroll_month_balance(e,'2026-09-01')<>1000 then raise exception 'Salary not updated immediately';end if;
 if public.payroll_journal_command('create',payload)<>entry or private.payroll_month_balance(e,'2026-09-01')<>1000 then raise exception 'Retry duplicated entry';end if;
 -- Simulate a worker committing a snapshot read before the new entry existed.
 update public.payroll_accruals set salary=2000,components='[{"kind":"base","label":"Base","amount":2000,"source":"QR","basis":"Test"}]' where employee_id=e;
 if private.payroll_month_balance(e,'2026-09-01')<>3000 then raise exception 'Worker lost live adjustment';end if;
 update public.payroll_accruals set salary=salary,components=components where employee_id=e;
 if private.payroll_month_balance(e,'2026-09-01')<>3000 then raise exception 'Repeated overlay duplicated entry';end if;
 perform public.payroll_journal_command('delete',jsonb_build_object('id',entry,'reason','Rollback delete'));
 if private.payroll_month_balance(e,'2026-09-01')<>2000 then raise exception 'Delete did not restore salary';end if;
 perform public.payroll_journal_command('delete',jsonb_build_object('id',entry,'reason','Second delete'));
 if (select count(*) from public.payroll_adjustment_history where adjustment_id=entry and action='deleted')<>1 then raise exception 'Delete not idempotent';end if;
 payload:=payload||jsonb_build_object('id',gen_random_uuid(),'request_key',gen_random_uuid(),'medium','bonus','amount',500);
 entry:=public.payroll_journal_command('create',payload);
 if private.payroll_month_balance(e,'2026-09-01')<>2000 then raise exception 'Bonus points changed salary';end if;
 update public.payroll_discipline_settings set enabled=true where venue_id=v;
 for n in 1..10 loop
  payload:=payload||jsonb_build_object('id',gen_random_uuid(),'request_key',gen_random_uuid(),'kind','warning','medium','none','amount',0);
  w:=public.payroll_journal_command('create',payload);
 end loop;
 if private.payroll_month_balance(e,'2026-09-01')<>-1000 then raise exception 'Warning escalation not cumulative 500+2500';end if;
 if (select count(*) from public.payroll_adjustments where employee_id=e and origin='warning_threshold')<>2 then raise exception 'Escalation duplicates';end if;
 perform public.payroll_journal_command('comment',jsonb_build_object('id',entry,'body','Test comment','request_key',u));
 perform public.payroll_journal_command('comment',jsonb_build_object('id',entry,'body','Test comment','request_key',u));
 if (select count(*) from public.payroll_adjustment_comments where adjustment_id=entry)<>1 then raise exception 'Comment retry duplicated';end if;
 if exists(select 1 from public.notifications where entity_id=entry and user_id=u) then raise exception 'Self notification';end if;
 -- An imported adjustment can also be reversed without an external refresh.
 insert into public.payroll_adjustments(account_id,venue_id,employee_id,business_date,kind,amount,reason,source_ref,approved) values(a,v,e,'2026-09-22','bonus',100,'Imported rollback entry','migration:rollback:entry',true) returning id into entry;
 insert into public.payroll_accruals(account_id,venue_id,employee_id,business_date,period_id,components,salary,tips,status,issues,calculation_snapshot)
 select a,v,e,'2026-09-22',id,'[{"kind":"bonus","label":"Imported rollback entry","amount":100,"basis":"Migration","source":"migration:rollback:entry"}]',100,0,'ready','{}','{"kind":"adjustment"}' from public.payroll_periods where venue_id=v and month='2026-09-01';
 baseline:=private.payroll_month_balance(e,'2026-09-01');
 perform public.payroll_journal_command('delete',jsonb_build_object('id',entry,'reason','Remove imported entry'));
 if private.payroll_month_balance(e,'2026-09-01')<>baseline-100 then raise exception 'Imported adjustment reversal failed';end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);perform set_config('app.ctx_ready','0',true);
 begin perform public.payroll_journal_command('create',payload);raise exception 'unauthorized-create-accepted';exception when others then if sqlerrm='unauthorized-create-accepted' then raise;end if;end;
 begin perform public.payroll_journal_command('comment',jsonb_build_object('id',entry,'body','Forbidden','request_key',gen_random_uuid()));raise exception 'unauthorized-comment-accepted';exception when others then if sqlerrm='unauthorized-comment-accepted' then raise;end if;end;
 raise notice 'PASS: immediate salary, stale worker merge, retry, delete, bonus separation, cumulative warnings, comment retry, no self notification, access';
end $$;
rollback;
