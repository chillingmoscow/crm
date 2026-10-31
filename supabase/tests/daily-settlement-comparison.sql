-- Local owner fixture. Every setting, job, audit and QA row rolls back.
begin;
do $$
declare u uuid;a uuid;v uuid;b uuid;inc uuid;outc uuid;c jsonb;r uuid;x uuid;begin
 select id into u from auth.users where email='owner@test.com';
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 select id into b from public.bank_accounts where account_id=a and (venue_id=v or venue_id is null) and is_active and deleted_at is null and currency='RUB' order by id limit 1;
 select id into inc from public.finance_categories where account_id=a and type='income' and archived_at is null order by id limit 1;
 select id into outc from public.finance_categories where account_id=a and type='expense' and archived_at is null order by id limit 1;
 if b is null or inc is null or outc is null then raise exception 'Missing local finance fixtures';end if;
 select jsonb_build_object('venueId',v,'timezone',timezone,'dayStartHour',day_start_hour,'revenueCategoryId',inc,'methods',jsonb_build_array(jsonb_build_object('paymentTypeId',1,'bankAccountId',b,'excluded',null,'feePercent',1.704,'feeAccounting','net')),'personal',jsonb_build_object('payerId',2,'bankAccountId',b,'incomeCategoryId',inc,'expenseCategoryId',outc)) into c from public.sales_settings where venue_id=v;
 perform set_config('test.settlement_v',v::text,true);perform set_config('test.settlement_a',a::text,true);perform set_config('test.settlement_owner',u::text,true);perform set_config('test.settlement_cfg',c::text,true);
 perform set_config('test.settlement_n',(select coalesce(max(version),0)::text from public.finance_settlement_settings where venue_id=v),true);
 perform set_config('test.settlement_money',md5(jsonb_build_object('transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t),'banks',(select jsonb_agg(to_jsonb(t) order by id) from public.bank_accounts t),'accruals',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_accruals t),'adjustments',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_adjustments t))::text),true);
 insert into public.roles(venue_id,name,code) values(v,'Settlement reader QA','settlement_qa') returning id into r;
 insert into public.role_permissions(role_id,permission_id,granted) select r,id,true from public.permissions where code in ('sales.view_shifts','finance.view_transactions','org.view_audit');
 x:=gen_random_uuid();insert into auth.users(id,aud,role,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values(x,'authenticated','authenticated','settlement-'||x||'@qa.invalid','{}','{}',now(),now());
 insert into public.profiles(id,first_name,active_venue_id) values(x,'QA',v) on conflict(id) do update set active_venue_id=v;
 insert into public.user_venue_roles(user_id,venue_id,role_id,status) values(x,v,r,'active');perform set_config('test.settlement_other',x::text,true);
 -- Make only this transaction's synthetic job claimable. Restored on rollback.
 update public.finance_settlement_jobs set next_retry_at=now()+interval '1 day';
 update public.sales_settings set provider_retry_at=null where account_id=a;
end $$;
set local role authenticated;
do $$
declare v uuid:=current_setting('test.settlement_v')::uuid;c jsonb:=current_setting('test.settlement_cfg')::jsonb;n integer:=current_setting('test.settlement_n')::integer;r uuid;j uuid;begin
 r:=public.finance_save_settlement_settings(v,n,c,false,'QA initial');
 if public.finance_save_settlement_settings(v,n,c,false,'QA initial')<>r then raise exception 'Lost save response duplicated rules';end if;
 perform public.finance_save_settlement_settings(v,n+1,jsonb_set(c,'{methods,0,feePercent}','2'),false,'QA change');
 if (select config#>>'{methods,0,feePercent}' from public.finance_settlement_settings where id=r)<>'1.704' then raise exception 'History overwritten';end if;
 begin perform public.finance_save_settlement_settings(v,n,c,false,'QA stale');raise exception 'Stale version accepted';exception when raise_exception then if sqlerrm not like 'Настройки изменились%' then raise;end if;end;
 begin perform public.finance_save_settlement_settings(v,n+2,jsonb_set(c,'{methods,0,bankAccountId}',to_jsonb(gen_random_uuid())),false,'QA foreign bank');raise exception 'Foreign bank accepted';exception when raise_exception then if sqlerrm not like 'Выберите действующий%' then raise;end if;end;
 begin perform public.finance_save_settlement_settings(v,n+2,jsonb_set(c,'{methods,0,feePercent}','-1'),false,'QA invalid');raise exception 'Negative fee accepted';exception when raise_exception then if sqlerrm not like 'Проверьте способы%' then raise;end if;end;
 begin perform public.finance_save_settlement_settings(gen_random_uuid(),0,c,false,'QA scope');raise exception 'Other venue accepted';exception when raise_exception then if sqlerrm not like 'Заведение изменилось%' then raise;end if;end;
 if has_table_privilege('authenticated','public.finance_settlement_settings','UPDATE') or has_table_privilege('service_role','public.finance_settlement_days','UPDATE') or has_table_privilege('authenticated','public.finance_settlement_jobs','SELECT') or has_function_privilege('authenticated','public.finance_publish_settlement(uuid,uuid,jsonb,jsonb,jsonb)','EXECUTE') or has_function_privilege('anon','public.finance_request_settlement(uuid,date)','EXECUTE') then raise exception 'Unsafe grants';end if;
 j:=public.finance_request_settlement(v,'2000-01-03');
 if public.finance_request_settlement(v,'2000-01-03')<>j then raise exception 'Request retry duplicated job';end if;
 if (select count(*) from public.audit_logs where action_code='finance.settlement.requested' and details->>'job_id'=j::text)<>1 then raise exception 'Request retry duplicated audit';end if;
 perform set_config('test.settlement_job',j::text,true);
 perform public.finance_settlement_transactions(v,'2026-10-30');
end $$;
reset role;
do $$
declare j jsonb;jid uuid:=current_setting('test.settlement_job')::uuid;oldlease uuid;f jsonb:='[{"id":1,"createdAt":946880000000,"payerId":null,"excluded":null,"cost":null,"payments":[]}]';m jsonb:='[]';begin
 if (select count(distinct public.sales_next_worker_lane()) from generate_series(1,12))<>6 then raise exception 'One of six worker lanes starves';end if;
 j:=public.finance_claim_settlement_job();if j->>'id'<>jid::text then raise exception 'Claimed wrong QA job';end if;oldlease:=(j->>'lease')::uuid;
 update public.finance_settlement_jobs set claimed_at=now()-interval '3 minutes' where id=jid;
 perform public.finance_fail_settlement(jid,oldlease,'Stale writer',null);
 if (select last_error from public.finance_settlement_jobs where id=jid) is not null then raise exception 'Expired worker changed job';end if;
 begin perform public.finance_save_settlement_slice(jid,oldlease,'orders',0,'{}');raise exception 'Expired lease saved';exception when raise_exception then if sqlerrm not like 'Чтение уже передано%' then raise;end if;end;
 j:=public.finance_claim_settlement_job();if (j->>'lease')::uuid=oldlease then raise exception 'Lease was not replaced';end if;
 perform public.finance_save_settlement_slice(jid,(j->>'lease')::uuid,'commit',0,jsonb_build_object('orders',jsonb_build_array(jsonb_build_object('id',1)),'facts',f,'reference',f,'methods',m,'provider','qa'));
 j:=public.finance_claim_settlement_job();
 perform public.finance_publish_settlement(jid,(j->>'lease')::uuid,f,m,'{"double_checked":true}');
 if (select version from public.finance_settlement_days where venue_id=current_setting('test.settlement_v')::uuid and business_date='2000-01-03')<>1 then raise exception 'Publish failed';end if;
 if (select count(*) from public.finance_settlement_history h join public.finance_settlement_days d on d.id=h.day_id where d.business_date='2000-01-03' and d.venue_id=current_setting('test.settlement_v')::uuid)<>1 then raise exception 'No source history';end if;
 -- Identical source retries do not inflate versions/history.
 update public.finance_settlement_jobs set state='running',lease=gen_random_uuid(),claimed_at=now() where id=jid returning to_jsonb(finance_settlement_jobs.*) into j;
 perform public.finance_publish_settlement(jid,(j->>'lease')::uuid,f,m,'{"double_checked":true}');
 if (select version from public.finance_settlement_days where venue_id=current_setting('test.settlement_v')::uuid and business_date='2000-01-03')<>1 then raise exception 'Retry inflated source version';end if;
 -- Changed source settings leave the last complete day untouched.
 update public.finance_settlement_jobs set state='running',lease=gen_random_uuid(),claimed_at=now(),request='{"timezone":"UTC","dayStartHour":0}' where id=jid returning to_jsonb(finance_settlement_jobs.*) into j;
 begin perform public.finance_publish_settlement(jid,(j->>'lease')::uuid,f,m,'{"double_checked":true}');raise exception 'Changed window accepted';exception when raise_exception then if sqlerrm not like 'Источники смен изменились%' then raise;end if;end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.settlement_other'),true),set_config('app.ctx_ready','0',true);
do $$ begin
 if exists(select 1 from public.finance_settlement_settings) or exists(select 1 from public.finance_settlement_days) or exists(select 1 from public.finance_settlement_history) or exists(select 1 from public.audit_logs where action_code like 'finance.settlement.%') then raise exception 'Private financial comparison leaked';end if;
 begin perform public.finance_settlement_job_status(current_setting('test.settlement_v')::uuid,'2000-01-03');raise exception 'Non-owner accessed job';exception when raise_exception then if sqlerrm not like 'Сверка поступлений доступна%' then raise;end if;end;
end $$;
reset role;
do $$ begin
 if current_setting('test.settlement_money') is distinct from md5(jsonb_build_object('transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t),'banks',(select jsonb_agg(to_jsonb(t) order by id) from public.bank_accounts t),'accruals',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_accruals t),'adjustments',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_adjustments t))::text) then raise exception 'Comparison changed money/payroll';end if;
 raise notice 'PASS: owner/scope/RLS, immutable config and audit, retry idempotency, live leases, double verification, source window, unchanged money/payroll';
end $$;
rollback;
