-- Local integration checks; all finance and HR fixtures roll back.
begin;
do $$
declare owner_id uuid;waiter_id uuid;a uuid;v uuid;e uuid;other_e uuid;p uuid;ac uuid;ac2 uuid;cash1 uuid;cash2 uuid;bank uuid;cat uuid;
 payload jsonb;payment uuid;overpayment uuid;again uuid;tx uuid;before_n integer;token uuid;rule uuid;model uuid;existing_tip_tx uuid;other_v uuid;missing_plan uuid;before_attendance integer;before_accrual integer;
begin
 select id into owner_id from auth.users where email='owner@test.com';select id into waiter_id from auth.users where email='waiter@test.com';
 if owner_id is null or waiter_id is null then raise exception 'Local seed users required';end if;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 insert into public.user_venue_roles(user_id,venue_id,role_id,status) select waiter_id,v,id,'active' from public.roles where venue_id=v and code='custom_waiter' on conflict(user_id,venue_id) do update set status='active',fired_at=null;
 update public.profiles set active_venue_id=v where id=waiter_id;
 select id into bank from public.bank_accounts where account_id=a and is_active and currency='RUB' and (venue_id=v or venue_id is null) limit 1;
 select id into cat from public.finance_categories where account_id=a and type='expense' and archived_at is null limit 1;
 if bank is null or cat is null then raise exception 'Prepare local finance before tests';end if;
 insert into public.payroll_settings(account_id,venue_id,starts_on,quickresto_venue_id) values(a,v,'2026-09-01',1) on conflict do nothing;
 insert into public.payroll_employees(account_id,venue_id,name,role_name,local_user_id,opening_confirmed) values(a,v,'Payroll regression','Мастер',waiter_id,true) returning id into e;
 insert into public.payroll_employees(account_id,venue_id,name,role_name,opening_confirmed) values(a,v,'Other payroll regression','Мастер',true) returning id into other_e;
 insert into public.payroll_periods(account_id,venue_id,month,status) values(a,v,'2040-01-01','checked') returning id into p;
 insert into public.payroll_accruals(account_id,venue_id,employee_id,business_date,period_id,salary,tips,status) values(a,v,e,'2040-01-02',p,1000,1100,'approved') returning id into ac;
 insert into public.payroll_accruals(account_id,venue_id,employee_id,business_date,period_id,salary,tips,status) values(a,v,other_e,'2040-01-02',p,1000,1100,'approved') returning id into ac2;
 payload:=jsonb_build_object('request_key',gen_random_uuid(),'kind','salary','amount',400,'bank_account_id',bank,'category_id',cat,'date',now(),'allocations',jsonb_build_array(jsonb_build_object('employee_id',e,'month','2040-01-01','amount',400,'settled_amount',400)));
 payment:=public.payroll_post_payment(payload);again:=public.payroll_post_payment(payload);
 if payment<>again or (select count(*) from public.payroll_payments where id=payment)<>1 then raise exception 'Duplicate payment';end if;
 if not exists(select 1 from public.payroll_payment_accruals where payment_id=payment and accrual_id=ac and amount=400) then raise exception 'Payment not linked to an accrual';end if;
 perform private.payroll_link_accruals(payment);
 if (select sum(amount) from public.payroll_payment_accruals where payment_id=payment)<>400 then raise exception 'Accrual linkage duplicated';end if;
 select transaction_id into tx from public.payroll_payments where id=payment;
 if (select occurred_at from public.payroll_payments where id=payment)<>(payload->>'date')::timestamptz then raise exception 'Payment date lost';end if;
 if not exists(select 1 from public.transactions where id=tx and amount=400 and deleted_at is null) then raise exception 'Finance linkage missing';end if;
 select count(*) into before_n from public.transactions;
 begin perform public.payroll_post_payment(payload||jsonb_build_object('request_key',gen_random_uuid(),'amount',500));raise exception 'invalid-allocation-accepted';exception when others then if sqlerrm='invalid-allocation-accepted' then raise;end if;end;
 if (select count(*) from public.transactions)<>before_n then raise exception 'Failed payment created a partial expense';end if;
 -- Salary payments may exceed accrued pay; the balance records an advance.
 overpayment:=public.payroll_post_payment(payload||jsonb_build_object('request_key',gen_random_uuid(),'amount',700,'allocations',jsonb_build_array(jsonb_build_object('employee_id',e,'month','2040-01-01','amount',700,'settled_amount',700))));
 if private.payroll_month_balance(e,'2040-01-01')<>-100 then raise exception 'Advance balance lost';end if;
 perform public.payroll_cancel_payment(overpayment);
 perform public.payroll_cancel_payment(payment);
 if (select state from public.payroll_payments where id=payment)<>'cancelled' or (select deleted_at is null from public.transactions where id=tx) then raise exception 'Cancellation not atomic';end if;
 if (select coalesce(sum(x.settled_amount),0) from public.payroll_allocations x join public.payroll_payments y on y.id=x.payment_id where x.employee_id=e and y.state='posted')<>0 then raise exception 'Cancellation did not restore debt';end if;
 begin update public.transactions set amount=401 where id=tx;raise exception 'linked-transaction-mutated';exception when others then if sqlerrm='linked-transaction-mutated' then raise;end if;end;
 begin delete from public.transactions where id=tx;raise exception 'linked-transaction-deleted';exception when others then if sqlerrm='linked-transaction-deleted' then raise;end if;end;
 token:=gen_random_uuid();insert into public.payroll_source_days(account_id,venue_id,business_date,state,lease_token) values(a,v,'2040-02-02','loading',token);
 begin perform public.payroll_commit_day(jsonb_build_object('account_id',a,'venue_id',v,'date','2040-02-02','lease_token',gen_random_uuid(),'attendance','[]'::jsonb,'accruals','[]'::jsonb,'cashbox','[]'::jsonb));raise exception 'stale-worker-accepted';exception when others then if sqlerrm='stale-worker-accepted' then raise;end if;end;
 delete from public.payroll_source_days where venue_id=v and business_date='2040-02-02';
 insert into public.schedule_shifts(venue_id,user_id,title,starts_at,ends_at,published) values(v,waiter_id,'Missing attendance fixture','2026-09-15 12:00+00','2026-09-15 20:00+00',true) returning id into missing_plan;
 insert into public.payroll_source_days(account_id,venue_id,business_date,state) values(a,v,'2026-09-15','complete') on conflict(venue_id,business_date) do update set state='complete';
 select count(*) into before_attendance from public.payroll_attendance;select count(*) into before_accrual from public.payroll_accruals;
 perform public.payroll_command('missing_shift',jsonb_build_object('id',missing_plan,'date','2026-09-15','starts_at','2026-09-15 12:00+00','ends_at','2026-09-15 20:00+00','user_id',waiter_id,'reason','Confirmed absence fixture'));
 if not exists(select 1 from public.payroll_schedule_reviews where shift_id=missing_plan and employee_id=e) or (select count(*) from public.payroll_attendance)<>before_attendance or (select count(*) from public.payroll_accruals)<>before_accrual then raise exception 'Absence created an actual shift or accrual';end if;
 insert into public.payroll_attendance(account_id,venue_id,business_date,external_id,employee_id,starts_at,ends_at,status) values(a,v,'2026-09-15',990099,e,'2026-09-15 12:00+00','2026-09-15 20:00+00','confirmed');
 begin perform public.payroll_command('missing_shift',jsonb_build_object('id',missing_plan,'date','2026-09-15','starts_at','2026-09-15 12:00+00','ends_at','2026-09-15 20:00+00','user_id',waiter_id,'reason','Invalid absence fixture'));raise exception 'present-employee-marked-absent';exception when others then if sqlerrm='present-employee-marked-absent' then raise;end if;end;
 delete from public.payroll_attendance where venue_id=v and external_id=990099;
 if private.payroll_valid_rates('{"3":{"1":{"base":1500,"percent":6}},"4":{"1":{"base":1400,"percent":6}}}') is not true or private.payroll_valid_rates('{"3":{"1":{"base":-1,"percent":6}}}') then raise exception 'Rule validation failed';end if;
 begin update public.transactions set deleted_at=null where id=tx;raise exception 'cancelled-payment-restored';exception when others then if sqlerrm='cancelled-payment-restored' then raise;end if;end;
 -- Two withdrawals close 2200 accrued tips with a daily 100 ruble difference.
 select id into other_v from public.venues where account_id=a and id<>v limit 1;
 if other_v is not null then
  insert into public.payroll_settings(account_id,venue_id,starts_on,quickresto_venue_id) values(a,other_v,'2026-09-01',1) on conflict do nothing;
  insert into public.payroll_cashbox(account_id,venue_id,business_date,external_id,amount,occurred_at,comment,kkm_id) values(a,other_v,'2040-01-02',-990001,1000,'2040-01-03 01:00+00','чаевые',2);
  insert into public.payroll_attendance(account_id,venue_id,business_date,external_id,starts_at,ends_at,status) values(a,other_v,'2040-01-02',990001,'2040-01-02 12:00+00','2040-01-02 20:00+00','unlinked'),(a,v,'2040-01-02',990001,'2040-01-02 12:00+00','2040-01-02 20:00+00','ignored');
 end if;
 insert into public.payroll_source_days(account_id,venue_id,business_date,state) values(a,v,'2040-01-02','complete');
 insert into public.payroll_cashbox(account_id,venue_id,business_date,external_id,amount,occurred_at,comment,kkm_id) values(a,v,'2040-01-02',-990001,1000,'2040-01-03 01:00+00','чаевые',2) returning id into cash1;
 insert into public.payroll_cashbox(account_id,venue_id,business_date,external_id,amount,occurred_at,comment,kkm_id) values(a,v,'2040-01-02',-990002,1100,'2040-01-03 02:00+00','чаевые',2) returning id into cash2;
 payload:=jsonb_build_object('date','2040-01-02','payments',jsonb_build_array(
 jsonb_build_object('request_key',cash1,'cashbox_id',cash1,'kind','tips','amount',1000,'bank_account_id',bank,'category_id',cat,'date','2040-01-03 01:00+00','allocations',jsonb_build_array(jsonb_build_object('employee_id',e,'accrual_id',ac,'month','2040-01-01','amount',500,'settled_amount',550),jsonb_build_object('employee_id',other_e,'accrual_id',ac2,'month','2040-01-01','amount',500,'settled_amount',550))),
 jsonb_build_object('request_key',cash2,'cashbox_id',cash2,'kind','tips','amount',1100,'bank_account_id',bank,'category_id',cat,'date','2040-01-03 02:00+00','allocations',jsonb_build_array(jsonb_build_object('employee_id',e,'accrual_id',ac,'month','2040-01-01','amount',550,'settled_amount',550),jsonb_build_object('employee_id',other_e,'accrual_id',ac2,'month','2040-01-01','amount',550,'settled_amount',550)))));
 begin perform public.payroll_post_payment(payload->'payments'->0);raise exception 'individual-tip-bypass-accepted';exception when others then if sqlerrm='individual-tip-bypass-accepted' then raise;end if;end;
 update public.payroll_cashbox set source_error='Source changed' where id=cash1;
 begin perform public.payroll_post_tip_batch(payload);raise exception 'changed-source-issued';exception when others then if sqlerrm='changed-source-issued' then raise;end if;end;
 update public.payroll_cashbox set source_error=null where id=cash1;
 update public.payroll_accruals set status='review' where id=ac2;
 begin perform public.payroll_post_tip_batch(payload);raise exception 'unverified-team-issued';exception when others then if sqlerrm='unverified-team-issued' then raise;end if;end;
 update public.payroll_accruals set status='approved' where id=ac2;
 insert into public.transactions(account_id,legal_entity_id,venue_id,bank_account_id,category_id,type,amount,date,description,source,source_external_id,created_by)
 select a,b.legal_entity_id,v,b.id,cat,'expense',1100,'2040-01-03 02:00+00','Existing source expense','manual','quickresto:encashment:'||v::text||':-990002',owner_id from public.bank_accounts b where b.id=bank returning id into existing_tip_tx;
 perform public.payroll_post_tip_batch(payload);
 if not exists(select 1 from public.payroll_payments where cashbox_id=cash2 and transaction_id=existing_tip_tx) then raise exception 'Existing expense was not linked';end if;
 if (select count(*) from public.payroll_payments where cashbox_id in(cash1,cash2))<>2 or (select sum(rounding) from public.payroll_cashbox where id in(cash1,cash2))<>100 then raise exception 'Daily tip rounding failed';end if;
 perform public.payroll_post_tip_batch(payload);
 if (select count(*) from public.payroll_payments where cashbox_id in(cash1,cash2))<>2 then raise exception 'Tip withdrawal duplicated';end if;
 -- Automatic posting uses configured cashbox accounts and exactly the same guards.
 insert into public.payroll_accruals(account_id,venue_id,employee_id,business_date,period_id,salary,tips,status) values(a,v,e,'2040-01-03',p,0,2200,'approved') returning id into ac;
 insert into public.payroll_source_days(account_id,venue_id,business_date,state) values(a,v,'2040-01-03','complete');
 insert into public.payroll_cashbox(account_id,venue_id,business_date,external_id,amount,occurred_at,comment,kkm_id) values(a,v,'2040-01-03',-990003,2100,'2040-01-04 01:00+00','чаевые',2) returning id into cash1;
 update public.payroll_settings set enabled=true,tip_category_id=cat,cashbox_accounts=jsonb_build_object('2',bank::text) where venue_id=v;
 payload:=jsonb_build_object('account_id',a,'venue_id',v,'date','2040-01-03','payments',jsonb_build_array(jsonb_build_object('request_key',cash1,'cashbox_id',cash1,'kind','tips','amount',2100,'bank_account_id',bank,'category_id',cat,'date','2040-01-04 01:00+00','allocations',jsonb_build_array(jsonb_build_object('employee_id',e,'accrual_id',ac,'month','2040-01-01','amount',2100,'settled_amount',2200)))));
 perform set_config('request.jwt.claim.sub','',true);perform public.payroll_auto_tips(payload);perform public.payroll_auto_tips(payload);
 if (select count(*) from public.payroll_payments where cashbox_id=cash1)<>1 then raise exception 'Automatic withdrawal duplicated or missing';end if;
 perform set_config('payroll.test.employee',e::text,true);perform set_config('payroll.test.other',other_e::text,true);
 perform set_config('request.jwt.claim.sub',waiter_id::text,true);perform set_config('app.ctx_ready','0',true);perform private.pgrst_pre_request();
 begin perform public.payroll_post_payment(payload);raise exception 'employee-can-pay';exception when others then if sqlerrm='employee-can-pay' then raise;end if;end;
 raise notice 'PASS: atomic finance linkage, idempotency, partial payment, advance balance, cancellation, immutable transactions, fencing, multiple withdrawals, 100 RUB daily tolerance, permissions';
end $$;
set local role authenticated;
do $$ begin
 raise notice 'RLS check: own employee';
 if not exists(select 1 from public.payroll_employees where id=current_setting('payroll.test.employee')::uuid) then raise exception 'Own employee not readable';end if;
 raise notice 'RLS check: other employee';
 if exists(select 1 from public.payroll_employees where id=current_setting('payroll.test.other')::uuid) or exists(select 1 from public.payroll_accruals where employee_id=current_setting('payroll.test.other')::uuid) or exists(select 1 from public.payroll_allocations where employee_id=current_setting('payroll.test.other')::uuid) then raise exception 'Other employee payroll leaked';end if;
 raise notice 'RLS check: private source';
 begin perform 1 from public.payroll_source_days;raise exception 'raw-source-readable';exception when insufficient_privilege then null;end;
 raise notice 'RLS check: worker RPC';
 if has_function_privilege(current_user,'public.payroll_auto_tips(jsonb)','EXECUTE') then raise exception 'Employee has worker posting permission';end if;
 raise notice 'PASS: own payroll access, peer salary isolation, private source and worker RPC inaccessible';
end $$;
rollback;
