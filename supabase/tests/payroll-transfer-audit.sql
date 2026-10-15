-- Real RPC path; all payments, transfers and audit fixtures are rolled back.
begin;
do $$
declare u uuid;a uuid;v uuid;e uuid;p uuid;bank uuid;category uuid;payment uuid;t uuid;payload jsonb;n integer;
begin
 select id into u from auth.users where email='owner@test.com';
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 select id into bank from public.bank_accounts where account_id=a and is_active and currency='RUB' and (venue_id=v or venue_id is null) limit 1;
 select id into category from public.finance_categories where account_id=a and type='expense' and archived_at is null limit 1;
 insert into public.payroll_employees(account_id,venue_id,name,role_name,opening_confirmed) values(a,v,'Transfer audit rollback fixture','Мастер',true) returning id into e;
 insert into public.payroll_periods(account_id,venue_id,month) values(a,v,'2026-09-01') on conflict(venue_id,month) do nothing;
 select id into p from public.payroll_periods where venue_id=v and month='2026-09-01';
 insert into public.payroll_accruals(account_id,venue_id,employee_id,business_date,period_id,salary,status) values(a,v,e,'2026-09-02',p,2000,'ready');
 payment:=public.payroll_post_payment(jsonb_build_object('request_key',gen_random_uuid(),'kind','salary','amount',1000,'bank_account_id',bank,'category_id',category,'date',now(),'allocations',jsonb_build_array(jsonb_build_object('employee_id',e,'month','2026-09-01','amount',1000,'settled_amount',1000))));
 if private.payroll_month_balance(e,'2026-09-01')<>1000 then raise exception 'Expected 1000 remaining after payment';end if;
 payload:=jsonb_build_object('request_key',gen_random_uuid(),'employee_id',e,'from_month','2026-09-01','to_month','2026-10-01','amount',1000,'reason','Pay with October salary');
 select count(*) into n from public.transactions;
 t:=public.payroll_transfer(payload);
 if private.payroll_month_balance(e,'2026-09-01')<>0 or private.payroll_month_balance(e,'2026-10-01')<>1000 then raise exception 'Debt not moved between months';end if;
 if (select count(*) from public.transactions)<>n then raise exception 'Transfer created a financial expense';end if;
 if public.payroll_transfer(payload)<>t then raise exception 'Retry created another transfer';end if;
 if (select count(*) from public.audit_logs where entity_id=t and action_code='payroll.transfer.created' and user_id=u and account_id=a and venue_id=v and details @> '{"amount":1000,"from_month":"2026-09-01","to_month":"2026-10-01"}')<>1 then raise exception 'Missing or duplicate transfer audit';end if;
 perform public.payroll_cancel_transfer(t);perform public.payroll_cancel_transfer(t);
 if private.payroll_month_balance(e,'2026-09-01')<>1000 or private.payroll_month_balance(e,'2026-10-01')<>0 then raise exception 'Cancellation did not restore debt';end if;
 if (select count(*) from public.audit_logs where entity_id=t and action_code='payroll.transfer.cancelled' and user_id=u)<>1 then raise exception 'Missing or duplicate cancellation audit';end if;
 raise notice 'PASS: earned 2000, paid 1000, transferred remaining 1000, conserved debt, no expense, audit actor/scope/months, idempotent create and cancel';
end $$;
rollback;
