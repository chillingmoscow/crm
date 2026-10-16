-- Imported current balances must not be charged again by historical payouts.
begin;
do $$
declare a uuid;v uuid;u uuid;le uuid;b uuid;dest uuid;t uuid;emp uuid;p uuid;old_ac uuid;backdated uuid;warning_id uuid;token uuid:=gen_random_uuid();n numeric;
begin
 select id into u from auth.users where email='owner@test.com';
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 select legal_entity_id into le from public.bank_accounts where account_id=a limit 1;
 insert into public.bank_accounts(account_id,legal_entity_id,venue_id,name,type,balance_anchor_at,balance_anchor_amount)
 values(a,le,v,'Historical balance test','cash','2026-10-16 10:00+00',1000) returning id into b;
 perform public.apply_transaction_balance_delta(b,1000);
 insert into public.bank_accounts(account_id,legal_entity_id,venue_id,name,type)
 values(a,le,v,'Live destination test','cash') returning id into dest;
 insert into public.transactions(account_id,legal_entity_id,venue_id,bank_account_id,type,amount,date,source,balance_covered_by_import)
 values(a,le,v,b,'expense',400,'2026-09-25 12:00+00','import',true) returning id into t;
 if (select balance from public.bank_accounts where id=b)<>1000 then raise exception 'Historical expense charged balance twice';end if;
 update public.transactions set amount=450 where id=t;
 if (select balance from public.bank_accounts where id=b)<>950 then raise exception 'Historical edit must apply only the difference';end if;
 update public.transactions set deleted_at=now() where id=t;
 if (select balance from public.bank_accounts where id=b)<>1400 then raise exception 'Historical cancellation must refund current amount';end if;
 update public.transactions set deleted_at=null where id=t;
 if (select balance from public.bank_accounts where id=b)<>950 then raise exception 'Historical restore must charge current amount';end if;
 update public.transactions set date='2026-10-16 11:00+00' where id=t;
 if (select balance from public.bank_accounts where id=b)<>950 then raise exception 'Changing date must not duplicate an existing expense';end if;
 update public.transactions set date='2026-09-25 12:00+00' where id=t;
 if (select balance from public.bank_accounts where id=b)<>950 then raise exception 'Returning date must preserve the existing expense';end if;
 insert into public.transactions(account_id,legal_entity_id,venue_id,bank_account_id,to_bank_account_id,to_legal_entity_id,type,amount,date,balance_covered_by_import)
 values(a,le,v,b,dest,le,'transfer',100,'2026-09-25 12:00+00',true);
 if (select balance from public.bank_accounts where id=b)<>950 or (select balance from public.bank_accounts where id=dest)<>100 then raise exception 'Transfer legs did not respect independent anchors';end if;
 insert into public.transactions(account_id,legal_entity_id,venue_id,bank_account_id,type,amount,date)
 values(a,le,v,b,'expense',100,'2026-10-16 12:00+00');
 if (select balance from public.bank_accounts where id=b)<>850 then raise exception 'New payout did not affect balance';end if;

 -- A date-only expense entered today is NOT part of the imported balance.
 insert into public.transactions(account_id,legal_entity_id,venue_id,bank_account_id,type,amount,date,source)
 values(a,le,v,b,'expense',50,'2026-10-16 00:00+00','manual') returning id into backdated;
 if (select balance from public.bank_accounts where id=b)<>800 then raise exception 'New date-only expense did not change balance';end if;
 update public.transactions set date='2026-06-01 00:00+00' where id=backdated;
 if (select balance from public.bank_accounts where id=b)<>800 then raise exception 'Backdating a new expense lost its balance effect';end if;
 update public.transactions set deleted_at=now() where id=backdated;
 if (select balance from public.bank_accounts where id=b)<>850 then raise exception 'Cancelling backdated expense failed';end if;

 update public.payroll_settings set historical_through='2026-10-15' where venue_id=v;
 insert into public.payroll_employees(account_id,venue_id,name,role_name) values(a,v,'Historical calculation test','Мастер') returning id into emp;
 insert into public.payroll_periods(account_id,venue_id,month) values(a,v,'2026-06-01') on conflict(venue_id,month) do nothing;
 select id into p from public.payroll_periods where venue_id=v and month='2026-06-01';
 insert into public.payroll_accruals(account_id,venue_id,employee_id,business_date,period_id,salary,status,components)
 values(a,v,emp,'2026-06-02',p,7000,'ready','[{"kind":"base","amount":7000,"label":"Выход","source":"glide"}]') returning id into old_ac;
 insert into public.payroll_source_days(account_id,venue_id,business_date,state,lease_token) values(a,v,'2026-06-02','loading',token)
 on conflict(venue_id,business_date) do update set state='loading',lease_token=token;
 perform public.payroll_commit_day(jsonb_build_object('account_id',a,'venue_id',v,'date','2026-06-02','lease_token',token,'attendance','[]'::jsonb,'accruals','[]'::jsonb,'cashbox','[]'::jsonb));
 if (select salary from public.payroll_accruals where id=old_ac)<>7000 then raise exception 'Source refresh replaced historical salary';end if;
 insert into public.payroll_adjustments(account_id,venue_id,employee_id,business_date,kind,amount,reason,approved,managed)
 values(a,v,emp,'2026-06-02','bonus',500,'Editable historical premium',true,true);
 -- Imported payments retain cancellation history in the shared finance audit.
 insert into public.payroll_payments(account_id,venue_id,request_key,transaction_id,kind,amount,occurred_at,created_by)
 values(a,v,gen_random_uuid(),t,'salary',450,'2026-09-25 12:00+00',u);
 update public.transactions set deleted_at=now(),deleted_by=u where id=t;
 if not exists(select 1 from public.audit_logs where entity_id=t and action_code='finance.transaction.deleted' and user_id=u) then raise exception 'Imported payment cancellation missing from finance audit';end if;
 if (select balance from public.bank_accounts where id=b)<>1300 then raise exception 'Historical payment cancellation did not refund current amount';end if;
 if (select salary from public.payroll_accruals where id=old_ac)<>7500 then raise exception 'Historical journal edit was blocked or doubled';end if;
 select count(*) into n from public.payroll_adjustments where employee_id=emp;
 insert into public.payroll_adjustments(account_id,venue_id,employee_id,business_date,kind,amount,reason,medium,approved,managed,origin)
 select a,v,emp,'2026-06-02','warning',0,'Imported warning','none',true,true,'glide' from generate_series(1,5);
 if (select count(*) from public.payroll_adjustments where employee_id=emp and kind='deduction')<>0 then raise exception 'Import retroactively generated warning fines';end if;
 select id into warning_id from public.payroll_adjustments where employee_id=emp and kind='warning' limit 1;
 update public.payroll_adjustments set reason='Edited imported warning' where id=warning_id;
 if not exists(select 1 from public.payroll_adjustment_history where adjustment_id=warning_id and action='updated') then raise exception 'Imported edit mislabelled as import';end if;
 update public.payroll_adjustments set deleted_at=now(),delete_reason='Rollback test' where id=warning_id;
 if not exists(select 1 from public.payroll_adjustment_history where adjustment_id=warning_id and action='deleted') then raise exception 'Imported deletion mislabelled as import';end if;
 raise notice 'PASS: initial history without double charge, edit deltas, cancellation/restore, date-only and backdated expenses, independent transfer legs, audit, frozen source and editable journal';
end $$;
rollback;
