-- Full transfer/expense chains and legacy identities. All fixtures roll back.
begin;
do $$
declare a uuid;v uuid;u uuid;le uuid;b uuid;cat uuid;r uuid;n integer;cfg jsonb;req jsonb;provider text;items jsonb;hash text;begin
 select id into u from auth.users where email='owner@test.com';perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);a:=public.get_active_account_id();v:=public.get_active_venue_id();
 perform set_config('test.cash_a',a::text,true);perform set_config('test.cash_v',v::text,true);perform set_config('test.cash_u',u::text,true);
 select legal_entity_id into le from public.bank_accounts where account_id=a and deleted_at is null limit 1;
 insert into public.bank_accounts(account_id,venue_id,legal_entity_id,name,type,balance) values(a,v,le,'Native cash QA','cash',1000) returning id into b;perform set_config('test.cash_bank',b::text,true);
 insert into public.bank_accounts(account_id,venue_id,legal_entity_id,name,type) values(a,v,le,'Native operating QA','cash') returning id into b;perform set_config('test.cash_operating',b::text,true);
 insert into public.bank_accounts(account_id,venue_id,legal_entity_id,name,type) values(a,v,le,'Native safe QA','safe') returning id into b;
 insert into public.finance_categories(account_id,name,type) values(a,'Native cash income QA','income') returning id into cat;
 cfg:=jsonb_build_object('cashAccountId',current_setting('test.cash_bank'),'safeAccountId',b,'operatingAccountId',current_setting('test.cash_operating'),'incomeCategoryId',cat,'safePattern','инкас|инк.*ация','taxiPattern','такси','tipsPattern','ча[йеюёвы]','lookbackDays',30,'intervalMinutes',60,'autoRead',false,'overrides','[]'::jsonb);
 insert into public.finance_categories(account_id,name,type) values(a,'Native taxi QA','expense') returning id into cat;cfg:=cfg||jsonb_build_object('taxiCategoryId',cat,'tipsCategoryId',cat);perform set_config('test.cash_category',cat::text,true);
 select coalesce(max(version),0) into n from public.cash_movement_rules where venue_id=v;r:=public.cash_movement_save_rules(v,n,cfg,'QA cash rules');
 insert into public.finance_execution_rules(account_id,venue_id,version,enabled,from_date,settlement,movements,legacy_stopped,reason,created_by,actor_name) select a,v,coalesce(max(version),0)+1,true,'2000-01-04',false,true,true,'QA isolated cash chains',u,'QA' from public.finance_execution_rules where venue_id=v;
 select jsonb_build_object('timezone',timezone,'dayStartHour',day_start_hour,'from','2000-01-04','through','2000-01-04') into req from public.sales_settings where account_id=a and venue_id=v;
 provider:=private.finance_execution_provider(a,v);
 items:=jsonb_build_array(jsonb_build_object('id',9010001,'date','2000-01-04','amountCents',10000,'type','cashOut','shiftId',1,'openedAt','2000-01-04T09:00:00Z','occurredAt','2000-01-04T20:00:00Z','arrivedAt','2000-01-04T21:00:00Z','comment','Такси'));
 hash:=md5(jsonb_build_object('items',items,'timezone',req->>'timezone','provider',provider)::text);
 insert into public.cash_movement_days(account_id,venue_id,business_date,items,request,source_hash,version) values(a,v,'2000-01-04',items,req,hash,1);
 update private.finance_execution_jobs set next_retry_at=now()+interval '1 day';
 insert into private.finance_execution_jobs(account_id,venue_id,kind,business_date,source_hash) values(a,v,'movements','2000-01-04',hash) returning id into r;perform set_config('test.cash_job',r::text,true);
 perform set_config('request.jwt.claim.sub','',true);perform set_config('app.ctx_ready','0',true);
end $$;
create function pg_temp.cash_cmd(source_id integer,amount_cents integer,direction text,p_mode text default 'create',tid uuid default null) returns jsonb language sql as $$
 select jsonb_build_object('key','qr:cash-movement:'||current_setting('test.cash_v')||':'||case when direction='transfer' then source_id||':transfer' else 'taxi:2000-01-04:part:'||source_id end,'date','2000-01-04','type',case when direction='transfer' then 'transfer' else 'expense' end,'bankAccountId',case when direction='transfer' then current_setting('test.cash_bank') else current_setting('test.cash_operating') end,'toBankAccountId',case when direction='transfer' then current_setting('test.cash_operating') else null end,'categoryId',case when direction='transfer' then null else current_setting('test.cash_category') end,'amountCents',amount_cents,'description','Такси · #'||source_id,'sourceIds',jsonb_build_array(source_id),'mode',p_mode,'transactionIds',case when tid is null then '[]'::jsonb else jsonb_build_array(tid) end)
$$;
create function pg_temp.cash_source(items jsonb) returns void language plpgsql as $$ begin
 update public.cash_movement_days set items=cash_source.items,version=version+1,source_hash=md5(jsonb_build_object('items',cash_source.items,'timezone',request->>'timezone','provider',private.finance_execution_provider(account_id,venue_id))::text) where venue_id=current_setting('test.cash_v')::uuid and business_date='2000-01-04';
end $$;
create function pg_temp.cash_apply(commands jsonb) returns jsonb language plpgsql as $$
declare j jsonb;s jsonb;begin
 update private.finance_execution_jobs set state='pending',lease=null,claimed_at=null,next_retry_at=now(),source_hash=(select source_hash from public.cash_movement_days where venue_id=current_setting('test.cash_v')::uuid and business_date='2000-01-04') where id=current_setting('test.cash_job')::uuid;
 j:=public.finance_claim_execution();if j->>'id'<>current_setting('test.cash_job') then raise exception 'Wrong cash job';end if;
 s:=public.finance_execution_source((j->>'id')::uuid,(j->>'lease')::uuid);
 return public.finance_apply_execution((j->>'id')::uuid,(j->>'lease')::uuid,gen_random_uuid(),s,jsonb_build_object('commands',commands,'blockers','[]'::jsonb));
end $$;
do $$
declare outcome jsonb;t1 uuid;e1 uuid;t3 uuid;e3 uuid;items jsonb;one jsonb;begin
 outcome:=pg_temp.cash_apply(jsonb_build_array(pg_temp.cash_cmd(9010001,10000,'transfer'),pg_temp.cash_cmd(9010001,10000,'expense')));
 if outcome->>'state'<>'committed' then raise exception 'First cash chain failed: %',outcome;end if;
 if (select balance from public.bank_accounts where id=current_setting('test.cash_bank')::uuid)<>900 or (select balance from public.bank_accounts where id=current_setting('test.cash_operating')::uuid)<>0 then raise exception 'Transfer plus taxi balance incorrect';end if;
 select transaction_id into t1 from private.finance_execution_bindings where venue_id=current_setting('test.cash_v')::uuid and key=pg_temp.cash_cmd(9010001,10000,'transfer')->>'key';
 select transaction_id into e1 from private.finance_execution_bindings where venue_id=current_setting('test.cash_v')::uuid and key=pg_temp.cash_cmd(9010001,10000,'expense')->>'key';
 select cd.items into items from public.cash_movement_days cd where venue_id=current_setting('test.cash_v')::uuid and business_date='2000-01-04';one:=items->0;
 items:=items||jsonb_build_array(one||'{"id":9010002,"amountCents":5000}');perform pg_temp.cash_source(items);
 outcome:=pg_temp.cash_apply(jsonb_build_array(pg_temp.cash_cmd(9010001,10000,'transfer','link',t1),pg_temp.cash_cmd(9010001,10000,'expense','link',e1),pg_temp.cash_cmd(9010002,5000,'transfer'),pg_temp.cash_cmd(9010002,5000,'expense')));
 if outcome->>'state'<>'committed' or (outcome->>'created')::integer<>2 then raise exception 'Late taxi chain duplicated prior source: %',outcome;end if;
 if (select balance from public.bank_accounts where id=current_setting('test.cash_bank')::uuid)<>850 or (select balance from public.bank_accounts where id=current_setting('test.cash_operating')::uuid)<>0 then raise exception 'Late taxi delta incorrect';end if;
 items:=jsonb_set(items,'{0,amountCents}','12000');perform pg_temp.cash_source(items);
 outcome:=pg_temp.cash_apply(jsonb_build_array(pg_temp.cash_cmd(9010001,12000,'transfer','update',t1),pg_temp.cash_cmd(9010001,12000,'expense','update',e1)));
 if outcome->>'state'<>'committed' or (select balance from public.bank_accounts where id=current_setting('test.cash_bank')::uuid)<>830 or (select balance from public.bank_accounts where id=current_setting('test.cash_operating')::uuid)<>0 then raise exception 'Cash correction double counted: %',outcome;end if;
 perform pg_temp.cash_source(jsonb_build_array(items->1));
 outcome:=pg_temp.cash_apply(jsonb_build_array(pg_temp.cash_cmd(9010001,12000,'transfer','cancel',t1),pg_temp.cash_cmd(9010001,12000,'expense','cancel',e1)));
 if outcome->>'state'<>'committed' or (select balance from public.bank_accounts where id=current_setting('test.cash_bank')::uuid)<>950 or (select balance from public.bank_accounts where id=current_setting('test.cash_operating')::uuid)<>0 then raise exception 'Cash cancellation delta incorrect: %',outcome;end if;
 perform pg_temp.cash_source(items);
 outcome:=pg_temp.cash_apply(jsonb_build_array(pg_temp.cash_cmd(9010001,12000,'transfer','restore',t1),pg_temp.cash_cmd(9010001,12000,'expense','restore',e1)));
 if outcome->>'state'<>'committed' or (select balance from public.bank_accounts where id=current_setting('test.cash_bank')::uuid)<>830 then raise exception 'Cash restoration failed: %',outcome;end if;
 -- An imported legacy pair is adopted without changing its identity or balance.
 insert into public.transactions(account_id,venue_id,legal_entity_id,bank_account_id,to_bank_account_id,to_legal_entity_id,type,amount,description,date,source,source_external_id)
 select b.account_id,current_setting('test.cash_v')::uuid,b.legal_entity_id,b.id,o.id,o.legal_entity_id,'transfer',40,'Такси · #9010003',('2000-01-04T12:00:00Z')::timestamptz,'import','adesk:qa:9010003:transfer' from public.bank_accounts b,public.bank_accounts o where b.id=current_setting('test.cash_bank')::uuid and o.id=current_setting('test.cash_operating')::uuid returning id into t3;
 insert into public.transactions(account_id,venue_id,legal_entity_id,bank_account_id,category_id,type,amount,description,date,source,source_external_id)
 select b.account_id,current_setting('test.cash_v')::uuid,b.legal_entity_id,b.id,current_setting('test.cash_category')::uuid,'expense',40,'Такси · #9010003',('2000-01-04T12:00:00Z')::timestamptz,'import','adesk:qa:9010003:expense' from public.bank_accounts b where b.id=current_setting('test.cash_operating')::uuid returning id into e3;
 items:=items||jsonb_build_array(one||'{"id":9010003,"amountCents":4000}');perform pg_temp.cash_source(items);
 outcome:=pg_temp.cash_apply(jsonb_build_array(pg_temp.cash_cmd(9010003,4000,'transfer','link',t3),pg_temp.cash_cmd(9010003,4000,'expense','link',e3)));
 if outcome->>'state'<>'committed' or (select balance from public.bank_accounts where id=current_setting('test.cash_bank')::uuid)<>790 or (select source_external_id from public.transactions where id=e3)<>'adesk:qa:9010003:expense' then raise exception 'Legacy adoption changed money or identity: %',outcome;end if;
 items:=jsonb_set(items,'{2,amountCents}','4500');perform pg_temp.cash_source(items);
 outcome:=pg_temp.cash_apply(jsonb_build_array(pg_temp.cash_cmd(9010003,4500,'transfer','update',t3),pg_temp.cash_cmd(9010003,4500,'expense','update',e3)));
 if outcome->>'state'<>'committed' or (select balance from public.bank_accounts where id=current_setting('test.cash_bank')::uuid)<>785 or (select balance from public.bank_accounts where id=current_setting('test.cash_operating')::uuid)<>0 or (select source_external_id from public.transactions where id=e3)<>'adesk:qa:9010003:expense' then raise exception 'Legacy correction changed identity or duplicated expense: %',outcome;end if;
 outcome:=pg_temp.cash_apply(jsonb_build_array(pg_temp.cash_cmd(9999999,4500,'transfer')));
 if outcome->>'state'<>'error' or (select balance from public.bank_accounts where id=current_setting('test.cash_bank')::uuid)<>785 then raise exception 'Foreign source ID posted';end if;
 raise notice 'PASS: complete native cash chains, late taxi remainder, corrections/cancellations/restores, preserved Adesk identities, exact account balances, source membership';
end $$;
rollback;
