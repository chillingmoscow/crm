-- Rollback-only financial integration checks: no test money is retained.
begin;
do $$
declare u uuid;a uuid;v uuid;r1 uuid;r2 uuid;e1 uuid;e2 uuid;b uuid;payload jsonb;ids uuid[];again uuid[];n integer;bal numeric;cat uuid;
begin
 select id into u from auth.users where email='owner@test.com';
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 select id into b from public.bank_accounts where account_id=a and is_active and currency='RUB' and (venue_id=v or venue_id is null) limit 1;
 if b is null then raise exception 'Missing local test bank';end if;
 insert into public.roles(venue_id,name,code) values(v,'Payroll role A test','payroll_test_a') returning id into r1;
 insert into public.roles(venue_id,name,code) values(v,'Payroll role B test','payroll_test_b') returning id into r2;
 if (select count(*) from public.finance_categories c join public.finance_category_groups g on g.id=c.group_id where c.payroll_role_id in (r1,r2) and g.is_payroll and g.account_id=a)<>2 then raise exception 'Role categories missing';end if;
 select id into cat from public.finance_categories where payroll_role_id=r1;
 update public.roles set name='Renamed role A' where id=r1;
 if (select name from public.finance_categories where id=cat)<>'Renamed role A' then raise exception 'Category rename lost stable identity';end if;
 insert into public.payroll_employees(account_id,venue_id,name,role_name,role_id,opening_confirmed) values(a,v,'Actual paid A','A',r1,false) returning id into e1;
 insert into public.payroll_employees(account_id,venue_id,name,role_name,role_id,opening_confirmed) values(a,v,'Actual paid B','B',r2,false) returning id into e2;
 payload:=jsonb_build_object('request_key',gen_random_uuid(),'bank_account_id',b,'month','2026-09-01','date',now(),'note','Rollback test','recipients',jsonb_build_array(jsonb_build_object('employee_id',e1,'amount',100),jsonb_build_object('employee_id',e2,'month','2026-10-01','amount',200)));
 ids:=public.payroll_record_payments(payload);
 if cardinality(ids)<>2 or (select count(*) from public.transactions t join public.payroll_payments p on p.transaction_id=t.id where p.id=any(ids) and t.category_id in (select id from public.finance_categories where payroll_role_id in (r1,r2)))<>2 then raise exception 'Payments not one transaction per employee';end if;
 if (select count(*) from public.payroll_allocations where payment_id=any(ids))<>2 then raise exception 'Allocations missing';end if;
 if not exists(select 1 from public.payroll_allocations where payment_id=ids[1] and employee_id=e1 and month='2026-09-01') or not exists(select 1 from public.payroll_allocations where payment_id=ids[2] and employee_id=e2 and month='2026-10-01') then raise exception 'Recipient months were overwritten';end if;
 if exists(select 1 from public.transactions t join public.payroll_payments p on p.transaction_id=t.id where p.id=any(ids) and t.date<>(payload->>'date')::timestamptz) then raise exception 'Cash dates differ from payment date';end if;
 if (select count(*) from public.audit_logs l join public.payroll_payments p on p.transaction_id=l.entity_id where p.id=any(ids) and l.action_code='finance.transaction.created' and l.user_id=u)<>2 then raise exception 'Payment creation missing from audit';end if;
 again:=public.payroll_record_payments(payload);
 if ids is distinct from again then raise exception 'Retry created duplicate payments';end if;
 begin perform public.payroll_record_payments(payload||jsonb_build_object('note','changed'));raise exception 'changed-retry-accepted';exception when others then if sqlerrm='changed-retry-accepted' then raise;end if;end;
 bal:=private.payroll_month_balance(e1,'2026-09-01');
 perform public.payroll_cancel_payment(ids[1]);
 if (select state from public.payroll_payments where id=ids[1])<>'cancelled' or private.payroll_month_balance(e1,'2026-09-01')<>bal+100 then raise exception 'Cancellation did not restore balance';end if;
 if (select count(*) from public.audit_logs l join public.payroll_payments p on p.transaction_id=l.entity_id where p.id=ids[1] and l.action_code='finance.transaction.deleted' and l.user_id=u)<>1 then raise exception 'Payment cancellation missing from audit';end if;
 -- A bad second recipient must also roll back the first expense.
 select count(*) into n from public.transactions;
 payload:=jsonb_set(payload,'{request_key}',to_jsonb(gen_random_uuid()));
 payload:=jsonb_set(payload,'{recipients,1,employee_id}',to_jsonb(gen_random_uuid()));
 begin perform public.payroll_record_payments(payload);raise exception 'invalid-recipient-accepted';exception when others then if sqlerrm='invalid-recipient-accepted' then raise;end if;end;
 if (select count(*) from public.transactions)<>n then raise exception 'Partial batch leaked a transaction';end if;
 payload:=jsonb_set(payload,'{request_key}',to_jsonb(gen_random_uuid()));
 payload:=jsonb_set(payload,'{recipients,1,employee_id}',to_jsonb(e1));
 begin perform public.payroll_record_payments(payload);raise exception 'duplicate-recipient-accepted';exception when others then if sqlerrm='duplicate-recipient-accepted' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);perform set_config('app.ctx_ready','0',true);
 begin perform public.payroll_record_payments(payload);raise exception 'unauthorized-payment-accepted';exception when others then if sqlerrm='unauthorized-payment-accepted' then raise;end if;end;
 raise notice 'PASS: auto categories, stable rename, individual transactions, editable amounts with unknown history, retry, rollback, cancellation, access';
end $$;
rollback;
