-- Controlled financial fixtures, full rollback. Never runs a provider request.
begin;
do $$
declare a uuid;v uuid;u uuid;le uuid;b uuid;cat uuid;r uuid;n integer;cfg jsonb;facts jsonb;request jsonb;provider text;hash text;begin
 select id into u from auth.users where email='owner@test.com';perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 perform set_config('test.native_a',a::text,true);perform set_config('test.native_v',v::text,true);perform set_config('test.native_u',u::text,true);
 perform set_config('test.native_protected',md5(jsonb_build_object('transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t),'banks',(select jsonb_agg(to_jsonb(t) order by id) from public.bank_accounts t),'accruals',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_accruals t),'adjustments',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_adjustments t),'notifications',(select jsonb_agg(to_jsonb(t) order by id) from public.notifications t))::text),true);
 select legal_entity_id into le from public.bank_accounts where account_id=a and deleted_at is null limit 1;
 insert into public.bank_accounts(account_id,venue_id,legal_entity_id,name,type) values(a,v,le,'Native finance QA','cash') returning id into b;
 insert into public.finance_categories(account_id,name,type) values(a,'Native finance income QA','income') returning id into cat;
 perform set_config('test.native_bank',b::text,true);perform set_config('test.native_category',cat::text,true);
 select coalesce(max(version),0) into n from public.finance_execution_rules where venue_id=v;
 begin perform public.finance_save_execution_rules(v,n,true,'2000-01-03',true,false,false,'QA without ownership');raise exception 'Legacy owner guard bypassed';exception when raise_exception then if sqlerrm not like 'Сначала остановите%' then raise;end if;end;
 begin perform public.finance_save_execution_rules(v,n,true,'2000-01-03',true,false,true,'QA retroactive cutover');raise exception 'Historical cutover accepted';exception when raise_exception then if sqlerrm not like 'Проведение можно начать%' then raise;end if;end;
 r:=public.finance_save_execution_rules(v,n,false,null,true,false,false,'QA comparison');
 if public.finance_save_execution_rules(v,n,false,null,true,false,false,'QA comparison')<>r then raise exception 'Policy retry duplicated';end if;
 begin perform public.finance_save_execution_rules(v,n,false,null,true,true,false,'QA stale');raise exception 'Stale policy accepted';exception when raise_exception then if sqlerrm not like 'Режим изменился%' then raise;end if;end;
 -- Historical policy exists only inside this transaction to exercise balances.
 insert into public.finance_execution_rules(account_id,venue_id,version,enabled,from_date,settlement,movements,legacy_stopped,reason,created_by,actor_name) values(a,v,n+2,true,'2000-01-03',true,false,true,'QA isolated execution',u,'QA');
 select jsonb_build_object('timezone',timezone,'dayStartHour',day_start_hour) into request from public.sales_settings where account_id=a and venue_id=v;
 cfg:=request||jsonb_build_object('venueId',v,'revenueCategoryId',cat,'methods',jsonb_build_array(jsonb_build_object('paymentTypeId',1,'bankAccountId',b,'excluded',null,'feePercent',0,'feeAccounting','net')),'personal',null);
 insert into public.finance_settlement_settings(account_id,venue_id,version,config,auto_read,reason,created_by,actor_name) select a,v,coalesce(max(version),0)+1,cfg,true,'QA source',u,'QA' from public.finance_settlement_settings where venue_id=v;
 perform public.finance_save_execution_rules(v,n+2,true,'2000-01-03',true,false,true,'QA ongoing period');
 begin perform public.finance_save_execution_rules(v,n+3,true,'2000-01-03',true,true,true,'QA new lane archive');raise exception 'New lane replayed archive';exception when raise_exception then if sqlerrm not like 'Проведение можно начать%' then raise;end if;end;
 provider:=private.finance_execution_provider(a,v);
 facts:=jsonb_build_array(jsonb_build_object('id',1,'createdAt',extract(epoch from '2000-01-03T12:00:00Z'::timestamptz)*1000,'payerId',null,'excluded',null,'cost',null,'payments',jsonb_build_array(jsonb_build_object('id',-1,'typeId',1,'amountCents',10000))));
 hash:=md5(jsonb_build_object('facts',facts,'methods','[]'::jsonb,'source',request,'provider',provider)::text);
 insert into public.finance_settlement_days(account_id,venue_id,business_date,facts,methods,summary,source_hash,version) values(a,v,'2000-01-03',facts,'[]',jsonb_build_object('double_checked',true,'source',request,'provider',provider),hash,1);
 update private.finance_execution_jobs set next_retry_at=now()+interval '1 day';
 insert into private.finance_execution_jobs(account_id,venue_id,kind,business_date,source_hash) values(a,v,'settlement','2000-01-03',hash) returning id into r;
 perform set_config('test.native_job',r::text,true);
 perform set_config('test.native_cmd',jsonb_build_object('key','qr:daily-settlement:'||v||':2000-01-03:revenue:'||b,'date','2000-01-03','type','income','bankAccountId',b,'toBankAccountId',null,'categoryId',cat,'amountCents',10000,'description','Выручка Quick Resto','sourceIds','[]'::jsonb,'mode','create','transactionIds','[]'::jsonb)::text,true);
 perform set_config('request.jwt.claim.sub','',true);perform set_config('app.ctx_ready','0',true);
end $$;
create function pg_temp.native_read_apply(c jsonb) returns jsonb language plpgsql as $$
declare j jsonb;s jsonb;p jsonb;r uuid:=gen_random_uuid();begin
 update private.finance_execution_jobs set state='pending',lease=null,claimed_at=null,next_retry_at=now(),source_hash=(select source_hash from public.finance_settlement_days where venue_id=current_setting('test.native_v')::uuid and business_date='2000-01-03') where id=current_setting('test.native_job')::uuid;
 j:=public.finance_claim_execution();if j->>'id'<>current_setting('test.native_job') then raise exception 'Wrong native job claimed';end if;
 s:=public.finance_execution_source((j->>'id')::uuid,(j->>'lease')::uuid);p:=jsonb_build_object('commands',c,'blockers','[]'::jsonb);
 perform set_config('test.native_snapshot',s::text,true);perform set_config('test.native_plan',p::text,true);perform set_config('test.native_request',r::text,true);perform set_config('test.native_lease',j->>'lease',true);
 return public.finance_apply_execution((j->>'id')::uuid,(j->>'lease')::uuid,r,s,p);
end $$;
create function pg_temp.native_change_source(amount_cents integer,returned boolean default false) returns void language plpgsql as $$ begin
 update public.finance_settlement_days set facts=case when returned then jsonb_set(jsonb_set(facts,'{0,excluded}','"returned"'),'{0,payments}','[]') else jsonb_set(jsonb_set(facts,'{0,excluded}','null'),'{0,payments}',jsonb_build_array(jsonb_build_object('id',-1,'typeId',1,'amountCents',amount_cents))) end,version=version+1 where venue_id=current_setting('test.native_v')::uuid and business_date='2000-01-03';
 update public.finance_settlement_days set source_hash=md5(jsonb_build_object('facts',facts,'methods',methods,'source',summary->'source','provider',summary->>'provider')::text) where venue_id=current_setting('test.native_v')::uuid and business_date='2000-01-03';
end $$;
do $$
declare c jsonb:=current_setting('test.native_cmd')::jsonb;outcome jsonb;tid uuid;hash text;j jsonb;s jsonb;p jsonb;req uuid;before_n integer;begin
 outcome:=pg_temp.native_read_apply(jsonb_build_array(c));
 if outcome->>'state'<>'committed' then raise exception 'Create failed: %',outcome;end if;
 select transaction_id into tid from private.finance_execution_bindings where venue_id=current_setting('test.native_v')::uuid and key=c->>'key';
 perform set_config('test.native_tid',tid::text,true);
 if (select balance from public.bank_accounts where id=current_setting('test.native_bank')::uuid)<>100 then raise exception 'Income balance incorrect';end if;
 outcome:=public.finance_apply_execution(current_setting('test.native_job')::uuid,current_setting('test.native_lease')::uuid,current_setting('test.native_request')::uuid,current_setting('test.native_snapshot')::jsonb,current_setting('test.native_plan')::jsonb);
 if outcome->>'state'<>'committed' or (select count(*) from public.transactions where bank_account_id=current_setting('test.native_bank')::uuid)<>1 then raise exception 'Replay duplicated money';end if;
 -- New settings cannot silently change the calculation of a posted day.
 perform set_config('request.jwt.claim.sub',current_setting('test.native_u'),true);perform set_config('app.ctx_ready','0',true);
 if public.finance_execution_day_rule(current_setting('test.native_v')::uuid,'2000-01-03','settlement') is distinct from (current_setting('test.native_snapshot')::jsonb->'rule'->>'id')::uuid then raise exception 'Comparison lost pinned rule';end if;
 insert into public.finance_settlement_settings(account_id,venue_id,version,config,auto_read,reason,created_by,actor_name)
 select account_id,venue_id,version+1,jsonb_set(config,'{methods,0,feePercent}','20'),true,'QA later fee',created_by,actor_name from public.finance_settlement_settings where id=(current_setting('test.native_snapshot')::jsonb->'rule'->>'id')::uuid;
 if private.finance_execution_snapshot(current_setting('test.native_a')::uuid,current_setting('test.native_v')::uuid,'settlement','2000-01-03')->'rule' is distinct from current_setting('test.native_snapshot')::jsonb->'rule' then raise exception 'Later settings repriced posted day';end if;
 perform set_config('request.jwt.claim.sub','',true);perform set_config('app.ctx_ready','0',true);
 perform pg_temp.native_change_source(15000);
 c:=c||jsonb_build_object('mode','update','amountCents',15000,'transactionIds',jsonb_build_array(tid));
 outcome:=pg_temp.native_read_apply(jsonb_build_array(c));
 if outcome->>'state'<>'committed' or (select balance from public.bank_accounts where id=current_setting('test.native_bank')::uuid)<>150 then raise exception 'Correction delta incorrect: %',outcome;end if;
 -- Human edits use the same event journal; native correction may not erase them.
 perform set_config('request.jwt.claim.sub',current_setting('test.native_u'),true);perform set_config('app.ctx_ready','0',true);
 update public.transactions set amount=160,description='Решение управляющего',updated_by=current_setting('test.native_u')::uuid where id=tid;
 if public.finance_execution_status(current_setting('test.native_v')::uuid,'2000-01-03')->0->>'state'<>'review' then raise exception 'Manual edit not shown as conflict';end if;
 perform set_config('request.jwt.claim.sub','',true);perform set_config('app.ctx_ready','0',true);
 perform pg_temp.native_change_source(17500);
 outcome:=pg_temp.native_read_apply(jsonb_build_array(c||'{"amountCents":17500}'));
 if outcome->>'state'<>'error' or (select amount from public.transactions where id=tid)<>160 or (select balance from public.bank_accounts where id=current_setting('test.native_bank')::uuid)<>160 then raise exception 'Manual edit overwritten';end if;
 if not exists(select 1 from public.audit_logs where entity_id=tid and action_code='finance.transaction.updated' and user_id=current_setting('test.native_u')::uuid) then raise exception 'Human edit missing from history';end if;
 update public.transactions set amount=150,description='Выручка Quick Resto' where id=tid;
 perform pg_temp.native_change_source(0,true);
 outcome:=pg_temp.native_read_apply(jsonb_build_array(c||'{"mode":"cancel"}'));
 if outcome->>'state'<>'committed' or (select balance from public.bank_accounts where id=current_setting('test.native_bank')::uuid)<>0 or not(select deleted_at is not null from public.transactions where id=tid) then raise exception 'Refund reversal incorrect: %',outcome;end if;
 perform pg_temp.native_change_source(15000);
 outcome:=pg_temp.native_read_apply(jsonb_build_array(c||'{"mode":"restore"}'));
 if outcome->>'state'<>'committed' or (select balance from public.bank_accounts where id=current_setting('test.native_bank')::uuid)<>150 then raise exception 'Refund undo incorrect: %',outcome;end if;
 -- A later failing effect must roll back the entire financial commit.
 perform pg_temp.native_change_source(17500);
 select md5(jsonb_build_object('tx',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t),'banks',(select jsonb_agg(to_jsonb(t) order by id) from public.bank_accounts t),'bindings',(select jsonb_agg(to_jsonb(t) order by key) from private.finance_execution_bindings t))::text) into hash;
 outcome:=pg_temp.native_read_apply(jsonb_build_array(c||'{"amountCents":17500}',(current_setting('test.native_cmd')::jsonb)||jsonb_build_object('key','qr:daily-settlement:'||current_setting('test.native_v')||':2000-01-03:revenue:'||gen_random_uuid(),'bankAccountId',gen_random_uuid())));
 if outcome->>'state'<>'error' or hash is distinct from md5(jsonb_build_object('tx',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t),'banks',(select jsonb_agg(to_jsonb(t) order by id) from public.bank_accounts t),'bindings',(select jsonb_agg(to_jsonb(t) order by key) from private.finance_execution_bindings t))::text) then raise exception 'Partial financial commit survived error';end if;
 -- A mutation between preparation and commit invalidates the whole proposal.
 update private.finance_execution_jobs set state='pending',next_retry_at=now() where id=current_setting('test.native_job')::uuid;
 j:=public.finance_claim_execution();s:=public.finance_execution_source((j->>'id')::uuid,(j->>'lease')::uuid);
 update public.transactions set description='Ручная правка после подготовки' where id=tid;
 p:=jsonb_build_object('commands',jsonb_build_array(c||'{"amountCents":17500}'),'blockers','[]'::jsonb);
 outcome:=public.finance_apply_execution((j->>'id')::uuid,(j->>'lease')::uuid,gen_random_uuid(),s,p);
 if outcome->>'state'<>'stale' or (select amount from public.transactions where id=tid)<>150 then raise exception 'Stale ledger accepted';end if;
 update private.finance_execution_jobs set next_retry_at=now() where id=current_setting('test.native_job')::uuid;j:=public.finance_claim_execution();
 update private.finance_execution_jobs set claimed_at=now()-interval '3 minutes' where id=(j->>'id')::uuid;
 begin perform public.finance_apply_execution((j->>'id')::uuid,(j->>'lease')::uuid,gen_random_uuid(),s,p);raise exception 'Expired lease accepted';exception when raise_exception then if sqlerrm not like 'Проведение передано%' then raise;end if;end;
 if has_function_privilege('authenticated','public.finance_apply_execution(uuid,uuid,uuid,jsonb,jsonb)','execute') or has_table_privilege('authenticated','private.finance_execution_bindings','select') or has_table_privilege('service_role','private.finance_execution_jobs','select') then raise exception 'Unsafe native finance grants';end if;
 -- Disabling the owner switch after a claim prevents every financial effect.
 update private.finance_execution_jobs set state='pending',lease=null,claimed_at=null,next_retry_at=now() where id=current_setting('test.native_job')::uuid;
 j:=public.finance_claim_execution();s:=public.finance_execution_source((j->>'id')::uuid,(j->>'lease')::uuid);
 update public.finance_execution_rules set enabled=false where venue_id=current_setting('test.native_v')::uuid;
 outcome:=public.finance_apply_execution((j->>'id')::uuid,(j->>'lease')::uuid,gen_random_uuid(),s,p);
 if outcome->>'state'<>'disabled' or (select amount from public.transactions where id=tid)<>150 then raise exception 'Disabled policy still posted';end if;
 perform set_config('request.jwt.claim.sub',current_setting('test.native_u'),true);perform set_config('app.ctx_ready','0',true);
 begin perform public.finance_execution_day_rule(gen_random_uuid(),'2000-01-03','settlement');raise exception 'Foreign day exposed';exception when raise_exception then if sqlerrm not like 'Заведение изменилось%' then raise;end if;end;
 raise notice 'PASS: exact balances, corrections/refunds/restores, permanent replay protection, manual edit journal/protection, atomic rollback, stale snapshots, expired leases and closed service APIs';
end $$;
rollback;
