-- Local controlled fixtures only. Every expense, balance and journal entry rolls back.
begin;
do $$
declare a uuid;v uuid;u uuid;le uuid;b uuid;tx uuid;tx2 uuid;d uuid;d2 uuid;r uuid:=gen_random_uuid();n integer;outcome jsonb;baseline text;viewer uuid;role_id uuid;
begin
 select id into u from auth.users where email='owner@test.com';
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 select legal_entity_id into le from public.bank_accounts where account_id=a and deleted_at is null limit 1;
 insert into public.bank_accounts(account_id,venue_id,legal_entity_id,name,type)values(a,v,le,'Supply allocations QA','cash')returning id into b;
 insert into public.transactions(account_id,venue_id,legal_entity_id,bank_account_id,type,amount,date,created_by,description)values(a,v,le,b,'income',1000,now(),u,'QA funding');
 insert into public.transactions(account_id,venue_id,legal_entity_id,bank_account_id,type,amount,date,created_by,description)values(a,v,le,b,'expense',500,now(),u,'QA invoice payment')returning id into tx;
 insert into public.transactions(account_id,venue_id,legal_entity_id,bank_account_id,type,amount,date,created_by,description)values(a,v,le,b,'expense',100,now(),u,'QA second payment')returning id into tx2;
 insert into private.supply_documents(account_id,venue_id,qr_id,data)values(a,v,999990001,'{"id":999990001,"number":"QA allocation","amountCents":40000,"paid":false,"processed":true,"invoiceDate":"2026-10-02","invoiceAt":"2026-10-02T10:00:00Z","issues":[],"storeId":1,"storeTitle":"QA"}')returning id into d;
 insert into private.supply_documents(account_id,venue_id,qr_id,data)select a,v,999990002,data||'{"id":999990002,"number":"QA allocation second"}'from private.supply_documents where id=d returning id into d2;
 baseline:=md5(jsonb_build_object('tx',(select jsonb_agg(to_jsonb(t)order by id)from public.transactions t),'banks',(select jsonb_agg(to_jsonb(t)order by id)from public.bank_accounts t))::text);
 if public.supply_detail(v,d)->'payment'->>'state'<>'unlinked'then raise exception 'QR flag incorrectly proves ledger payment';end if;
 outcome:=public.supply_set_payment(v,d,tx,30000,1,r,'QA first allocation');
 if outcome->'payment'->>'state'<>'partial'or outcome->'payment'->>'remainingCents'<>'10000'then raise exception 'Partial payment is wrong';end if;
 if public.supply_set_payment(v,d,tx,30000,1,r,'QA first allocation')<>outcome then raise exception 'Retry duplicated or changed allocation';end if;
 begin perform public.supply_set_payment(v,d2,tx,30000,1,gen_random_uuid(),'QA excess payment');raise exception 'Expense allocated twice';exception when raise_exception then if sqlerrm not like 'Сумма превышает нераспределённую%'then raise;end if;end;
 begin perform public.supply_set_payment(v,d,tx2,10001,2,gen_random_uuid(),'QA excess invoice');raise exception 'Invoice overpaid';exception when raise_exception then if sqlerrm not like 'Сумма превышает нераспределённую%'then raise;end if;end;
 update public.transactions set amount=200 where id=tx2;
 begin perform public.supply_set_payment(v,d,tx2,10001,2,gen_random_uuid(),'QA excess invoice only');raise exception 'Invoice remainder bypassed';exception when raise_exception then if sqlerrm not like 'Сумма превышает остаток накладной%'then raise;end if;end;
 update public.transactions set amount=100 where id=tx2;
 begin perform public.supply_set_payment(v,d,tx2,10000,1,gen_random_uuid(),'QA stale card');raise exception 'Stale card accepted';exception when raise_exception then if sqlerrm not like 'Накладная изменилась%'then raise;end if;end;
 begin perform public.supply_set_payment(v,d,tx2,10000,2,r,'QA reused request');raise exception 'Request changed body';exception when raise_exception then if sqlerrm not like 'Запрос уже использован%'then raise;end if;end;
 outcome:=public.supply_set_payment(v,d,tx2,10000,2,gen_random_uuid(),'QA complete invoice');
 if outcome->'payment'->>'state'<>'paid'or outcome->'payment'->>'sourceMismatch'<>'true'then raise exception 'Ledger truth did not supersede unpaid source flag';end if;
 perform public.supply_set_payment(v,d2,tx,20000,1,gen_random_uuid(),'QA one expense for two invoices');
 if public.supply_payment_candidates(v,d2,'QA invoice')->>'total'<>'0'then raise exception 'Consumed expense offered twice';end if;
 if baseline<>md5(jsonb_build_object('tx',(select jsonb_agg(to_jsonb(t)order by id)from public.transactions t),'banks',(select jsonb_agg(to_jsonb(t)order by id)from public.bank_accounts t))::text)then raise exception 'Linking changed money';end if;
 -- A normal cancellation still changes the bank balance normally, and both invoices need review.
 update public.transactions set deleted_at=now(),deleted_by=u where id=tx;
 if public.supply_detail(v,d)->'payment'->>'state'<>'review'or public.supply_detail(v,d2)->'payment'->>'state'<>'review' then raise exception 'Cancellation left invoices paid';end if;
 if(select balance from public.bank_accounts where id=b)<>900 then raise exception 'Cancellation balance effect changed';end if;
 update public.transactions set deleted_at=null,deleted_by=null where id=tx;
 if public.supply_detail(v,d)->'payment'->>'state'<>'paid'then raise exception 'Restore lost payment allocation';end if;
 update public.transactions set amount=400 where id=tx;
 if public.supply_detail(v,d)->'payment'->>'remainingCents'is not null then raise exception 'Overallocated edited expense gave a false outstanding amount';end if;
 select revision into n from private.supply_documents where id=d2;
 perform public.supply_set_payment(v,d2,tx,10000,n,gen_random_uuid(),'QA correct allocation after expense edit');
 if public.supply_detail(v,d)->'payment'->>'state'<>'paid'or public.supply_detail(v,d2)->'payment'->>'state'<>'partial'then raise exception 'Corrected split is inconsistent';end if;
 update private.supply_documents set data=jsonb_set(data,'{amountCents}','35000'),revision=revision+1 where id=d;
 if public.supply_detail(v,d)->'payment'->>'state'<>'review'then raise exception 'Reduced invoice amount not reviewed';end if;
 select revision into n from private.supply_documents where id=d;
 perform public.supply_set_payment(v,d,tx,25000,n,gen_random_uuid(),'QA correct invoice allocation');
 select revision into n from private.supply_documents where id=d;
 perform public.supply_set_payment(v,d,tx2,0,n,gen_random_uuid(),'QA remove reference only');
 if(select amount from public.transactions where id=tx2)<>100 or(select balance from public.bank_accounts where id=b)<>500 then raise exception 'Unlink changed the expense or bank balance';end if;
 if not exists(select 1 from private.supply_history where document_id=d and action='payment_changed')or not exists(select 1 from public.audit_logs where entity_type='transaction'and entity_id=tx2 and action_code='finance.supply.payment_unlinked')then raise exception 'Payment audit missing';end if;
 -- Scope and live permissions are checked even on an idempotent replay.
 insert into public.roles(venue_id,name,code)values(v,'QA supply payments reader','qa_supply_payments_reader')returning id into role_id;
 insert into public.role_permissions(role_id,permission_id,granted)select role_id,id,true from public.permissions where code='finance.view_transactions';
 viewer:=gen_random_uuid();insert into auth.users(id,aud,role,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)values(viewer,'authenticated','authenticated','supply-payment-'||viewer||'@qa.invalid','{}','{}',now(),now());
 insert into public.profiles(id,first_name,active_venue_id)values(viewer,'QA',v)on conflict(id)do update set active_venue_id=v;
 insert into public.user_venue_roles(user_id,venue_id,role_id,status)values(viewer,v,role_id,'active');
 perform set_config('test.payment_venue',v::text,true);perform set_config('test.payment_doc',d::text,true);perform set_config('test.payment_tx',tx::text,true);perform set_config('test.payment_request',r::text,true);perform set_config('test.payment_role',role_id::text,true);
 perform set_config('request.jwt.claim.sub',viewer::text,true);perform set_config('app.ctx_ready','0',true);
end $$;
set local role authenticated;
do $$declare v uuid:=current_setting('test.payment_venue')::uuid;d uuid:=current_setting('test.payment_doc')::uuid;begin
 if public.supply_detail(v,d)->>'canLink'<>'false'then raise exception 'Reader can change allocations';end if;
 if public.supply_payment_candidates(v,d)->>'total'<>'0'then raise exception 'Reader can select uneditable expenses';end if;
 begin perform public.supply_set_payment(v,d,current_setting('test.payment_tx')::uuid,30000,1,current_setting('test.payment_request')::uuid,'QA first allocation');raise exception 'Reader replayed owner command';exception when raise_exception then if sqlerrm not like 'Нет доступа к изменению%'then raise;end if;end;
 if has_table_privilege('authenticated','private.supply_payment_links','select')or has_function_privilege('authenticated','private.supply_payment_summary(uuid)','execute')then raise exception 'Private financial links exposed';end if;
 begin perform public.supply_detail(gen_random_uuid(),d);raise exception 'Foreign venue accessible';exception when raise_exception then if sqlerrm not like 'Заведение изменилось%'then raise;end if;end;
end $$;
reset role;
do $$begin
 update public.role_permissions set granted=false where role_id=current_setting('test.payment_role')::uuid;
 perform set_config('app.ctx_ready','0',true);
 begin perform public.supply_detail(current_setting('test.payment_venue')::uuid,current_setting('test.payment_doc')::uuid);raise exception 'Revoked reader retained access';exception when raise_exception then if sqlerrm<>'Нет доступа к поставкам'then raise;end if;end;
end $$;
rollback;
