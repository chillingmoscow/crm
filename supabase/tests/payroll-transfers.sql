-- Financial regressions for explicit transfers and the single close-month workflow.
-- Fixtures and all finance operations are rolled back.
begin;
do $$
declare u uuid;w uuid;a uuid;v uuid;e uuid;other_e uuid;p uuid;ac uuid;bank uuid;cat uuid;payment uuid;paid_target uuid;t uuid;payload jsonb;n integer;cur_balance numeric;
begin
 select id into u from auth.users where email='owner@test.com';
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 select id into w from auth.users where email='waiter@test.com';
 insert into public.user_venue_roles(user_id,venue_id,role_id,status) select w,v,id,'active' from public.roles where venue_id=v and code='custom_waiter' on conflict(user_id,venue_id) do update set status='active',fired_at=null;
 update public.profiles set active_venue_id=v where id=w;
 update public.payroll_settings set starts_on='2025-01-01' where venue_id=v;
 select id into bank from public.bank_accounts where account_id=a and is_active and currency='RUB' and (venue_id=v or venue_id is null) limit 1;
 select id into cat from public.finance_categories where account_id=a and type='expense' and archived_at is null limit 1;
 insert into public.payroll_employees(account_id,venue_id,name,role_name,opening_confirmed,local_user_id) values(a,v,'Manual transfer regression','Мастер',true,w) returning id into e;
 insert into public.payroll_employees(account_id,venue_id,name,role_name,opening_confirmed) values(a,v,'Private transfer regression','Мастер',true) returning id into other_e;
 insert into public.payroll_periods(account_id,venue_id,month) values(a,v,'2025-01-01') returning id into p;
 insert into public.payroll_accruals(account_id,venue_id,employee_id,business_date,period_id,salary,status) values(a,v,e,'2025-01-02',p,1000,'ready') returning id into ac;
 insert into public.payroll_source_days(account_id,venue_id,business_date,state) select a,v,day::date,'complete' from generate_series('2025-01-01'::timestamp,'2025-01-31'::timestamp,'1 day') day;
 insert into public.payroll_attendance(account_id,venue_id,employee_id,external_id,business_date,starts_at,ends_at,role_name,status,issue) values(a,v,e,-991999,'2025-01-02','2025-01-02 10:00+00','2025-01-02 22:00+00','Мастер','unplanned','Фактический выход без опубликованной смены в Sheerly');
 if private.payroll_blocks_salary('unplanned','Без графика',now()) or private.payroll_blocks_salary('deviation','План и факт отличаются более чем на 15 минут',now()) or not private.payroll_blocks_salary('open','Не закрыта',null) or not private.payroll_blocks_salary('deviation','Личная смена пересекает границу рабочего дня',now()) then raise exception 'Fact/schedule distinction failed';end if;
 payload:=jsonb_build_object('request_key',gen_random_uuid(),'kind','salary','amount',400,'bank_account_id',bank,'category_id',cat,'date',now(),'allocations',jsonb_build_array(jsonb_build_object('employee_id',e,'month','2025-01-01','amount',400,'settled_amount',400)));
 payment:=public.payroll_post_payment(payload);
 if private.payroll_month_balance(e,'2025-01-01')<>600 then raise exception 'Draft-period payment failed';end if;
 if private.payroll_month_balance(e,'2025-02-01')<>0 then raise exception 'Debt carried automatically';end if;
 select count(*) into n from public.transactions;
 payload:=jsonb_build_object('request_key',gen_random_uuid(),'employee_id',e,'from_month','2025-01-01','to_month','2025-02-01','amount',600,'reason','Pay with next month');
 t:=public.payroll_transfer(payload);
 if public.payroll_transfer(payload)<>t or (select count(*) from public.payroll_transfers where id=t)<>1 then raise exception 'Transfer duplicated';end if;
 if (select count(*) from public.transactions)<>n then raise exception 'Transfer created a financial expense';end if;
 if private.payroll_month_balance(e,'2025-01-01')<>0 or private.payroll_month_balance(e,'2025-02-01')<>600 then raise exception 'Transfer failed to move debt';end if;
 begin perform public.payroll_transfer(payload||jsonb_build_object('amount',500));raise exception 'changed-key-accepted';exception when others then if sqlerrm='changed-key-accepted' then raise;end if;end;
 begin perform public.payroll_transfer(payload||jsonb_build_object('request_key',gen_random_uuid(),'amount',1));raise exception 'oversized-transfer-accepted';exception when others then if sqlerrm='oversized-transfer-accepted' then raise;end if;end;
 begin perform public.payroll_transfer(payload||jsonb_build_object('request_key',gen_random_uuid(),'from_month','2025-02-01','to_month','2025-01-01'));raise exception 'backward-transfer-accepted';exception when others then if sqlerrm='backward-transfer-accepted' then raise;end if;end;
 perform public.payroll_cancel_transfer(t);perform public.payroll_cancel_transfer(t);
 if private.payroll_month_balance(e,'2025-01-01')<>600 or private.payroll_month_balance(e,'2025-02-01')<>0 then raise exception 'Cancellation did not restore debt';end if;
 t:=public.payroll_transfer(payload||jsonb_build_object('request_key',gen_random_uuid()));
 payload:=jsonb_build_object('request_key',gen_random_uuid(),'kind','salary','amount',300,'bank_account_id',bank,'category_id',cat,'date',now(),'allocations',jsonb_build_array(jsonb_build_object('employee_id',e,'month','2025-02-01','amount',300,'settled_amount',300)));
 paid_target:=public.payroll_post_payment(payload);
 begin perform public.payroll_cancel_transfer(t);raise exception 'spent-transfer-cancelled';exception when others then if sqlerrm='spent-transfer-cancelled' then raise;end if;end;
 perform public.payroll_cancel_payment(paid_target);perform public.payroll_cancel_transfer(t);
 if private.payroll_month_balance(e,'2025-01-01')<>600 or private.payroll_month_balance(e,'2025-02-01')<>0 then raise exception 'Payment cancellation failed to restore transferred debt';end if;
 perform public.payroll_cancel_payment(payment);
 -- One close action, with POS fact but no Sheerly schedule, locks the month.
 perform public.payroll_command('period',jsonb_build_object('id',p,'version',1,'status','closed'));
 if (select status from public.payroll_periods where id=p)<>'closed' or (select status from public.payroll_accruals where id=ac)<>'approved' then raise exception 'Direct close did not freeze accruals';end if;
 -- A payroll reviewer cannot make duplicate recipients bypass the period balance.
 payload:=jsonb_build_object('request_key',gen_random_uuid(),'kind','salary','amount',1200,'bank_account_id',bank,'category_id',cat,'date',now(),'allocations',jsonb_build_array(jsonb_build_object('employee_id',e,'month','2025-01-01','amount',600,'settled_amount',600),jsonb_build_object('employee_id',e,'month','2025-01-01','amount',600,'settled_amount',600)));
 select count(*) into n from public.transactions;
 begin perform public.payroll_post_payment(payload);raise exception 'duplicate-recipients-accepted';exception when others then if sqlerrm='duplicate-recipients-accepted' then raise;end if;end;
 if (select count(*) from public.transactions)<>n then raise exception 'Invalid payment leaked an expense';end if;
 -- Negative opening is a prepayment; it too moves only via an explicit signed transfer.
 update public.payroll_employees set opening_balance=-100 where id=other_e;
 t:=public.payroll_transfer(jsonb_build_object('request_key',gen_random_uuid(),'employee_id',other_e,'from_month','2025-01-01','to_month','2025-02-01','amount',-100,'reason','Prepayment transfer'));
 if private.payroll_month_balance(other_e,'2025-01-01')<>0 or private.payroll_month_balance(other_e,'2025-02-01')<>-100 then raise exception 'Prepayment transfer incorrect';end if;
 perform public.payroll_cancel_transfer(t);
 if private.payroll_month_balance(other_e,'2025-01-01')<>-100 then raise exception 'Prepayment cancellation incorrect';end if;
 perform set_config('payroll.test.transfer.employee',e::text,true);perform set_config('payroll.test.transfer.other',other_e::text,true);
 perform set_config('request.jwt.claim.sub',w::text,true);perform set_config('app.ctx_ready','0',true);perform private.pgrst_pre_request();
 begin perform public.payroll_transfer(payload);raise exception 'employee-can-transfer';exception when others then if sqlerrm='employee-can-transfer' then raise;end if;end;
 raise notice 'PASS: draft payment, manual debt/prepayment transfers, conserved debt, idempotency, overtransfer cap, cancellation, spent transfer guard, no finance expense, direct close, duplicate allocation rejection';
end $$;
set local role authenticated;
do $$ begin
 if not exists(select 1 from public.payroll_transfers where employee_id=current_setting('payroll.test.transfer.employee')::uuid) then raise exception 'Own transfer not visible';end if;
 if exists(select 1 from public.payroll_transfers where employee_id=current_setting('payroll.test.transfer.other')::uuid) then raise exception 'Peer transfer leaked';end if;
 if has_table_privilege(current_user,'public.payroll_transfers','INSERT') or has_table_privilege(current_user,'public.payroll_transfers','UPDATE') then raise exception 'Direct transfer mutation allowed';end if;
 raise notice 'PASS: own transfer access, peer transfer isolation, employee cannot post transfer, direct table writes denied';
end $$;
rollback;
