-- Real local read fixture required; all mutation/replay/permission checks roll back.
begin;
do $test$
declare u uuid;v uuid;cfg jsonb;d jsonb;r uuid;x uuid;
begin
 select id into u from auth.users where email='owner@test.com';perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 v:=public.get_active_venue_id();select config into cfg from public.stock_writeoff_sources where venue_id=v;
 select payload into d from public.stock_writeoff_documents where venue_id=v order by external_id limit 1;
 if d is null or cfg is null then raise exception 'Prepare real writeoff fixture first';end if;
 d:=d||jsonb_build_object('id',900000001,'date','2020-02-10','invoiceAt','2020-02-10T10:00:00Z','processed',true);
 perform set_config('test.stock_owner',u::text,true);perform set_config('test.stock_venue',v::text,true);perform set_config('test.stock_doc',d::text,true);
 perform set_config('test.stock_finance',md5(jsonb_build_object('transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t),'accruals',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_accruals t),'adjustments',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_adjustments t),'banks',(select jsonb_agg(to_jsonb(t) order by id) from public.bank_accounts t),'notifications',(select jsonb_agg(to_jsonb(t) order by id) from public.notifications t))::text),true);
 perform private.stock_validate_writeoff_payload(d,cfg,'2020-02-01');
 perform private.stock_validate_writeoff_payload(d||'{"customerType":"","kind":"unknown","issues":["Не определён получатель списания"]}',cfg,'2020-02-01');
 begin perform private.stock_validate_writeoff_payload(d||'{"id":null}',cfg,'2020-02-01');raise exception 'Null ID accepted';exception when raise_exception then if sqlerrm not like 'Некорректный ID%' then raise;end if;end;
 begin perform private.stock_validate_writeoff_payload(d||'{"user":{"password":"not-a-secret"}}',cfg,'2020-02-01');raise exception 'Raw user accepted';exception when raise_exception then if sqlerrm not like 'Некорректные данные%' then raise;end if;end;
 begin perform private.stock_validate_writeoff_payload(d||'{"storeId":999999}',cfg,'2020-02-01');raise exception 'Foreign store accepted';exception when raise_exception then if sqlerrm not like 'Некорректные данные%' then raise;end if;end;
 begin perform private.stock_validate_writeoff_payload(d||'{"date":"2020-03-10"}',cfg,'2020-02-01');raise exception 'Foreign month accepted';exception when raise_exception then if sqlerrm not like 'Некорректные данные%' then raise;end if;end;
 begin perform private.stock_validate_writeoff_payload(jsonb_set(d,'{lines,0,id}','null'),cfg,'2020-02-01');raise exception 'Null line ID accepted';exception when raise_exception then if sqlerrm not like 'Некорректная позиция%' and sqlerrm not like 'Повтор или неполные%' then raise;end if;end;
 begin update public.stock_writeoff_sources set config=config||'{"personalFinance":{}}' where venue_id=v;raise exception 'Incomplete finance mapping accepted';exception when raise_exception then if sqlerrm not like 'Проверьте финансовое%' then raise;end if;end;
 insert into public.roles(venue_id,name,code) values(v,'Stock reader QA','stock_reader_qa') returning id into r;
 insert into public.role_permissions(role_id,permission_id,granted) select r,id,true from public.permissions where code='inventory.view_results';
 x:=gen_random_uuid();insert into auth.users(id,aud,role,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values(x,'authenticated','authenticated','stock-reader-'||x||'@qa.invalid','{}','{}',now(),now());
 insert into public.profiles(id,first_name,active_venue_id) values(x,'QA',v) on conflict(id) do update set active_venue_id=v;
 insert into public.user_venue_roles(user_id,venue_id,role_id,status) values(x,v,r,'active');perform set_config('test.stock_reader',x::text,true);
 insert into public.roles(venue_id,name,code) values(v,'No stock QA','no_stock_qa') returning id into r;
 insert into public.role_permissions(role_id,permission_id,granted) select r,id,true from public.permissions where code='org.view_audit';
 x:=gen_random_uuid();insert into auth.users(id,aud,role,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values(x,'authenticated','authenticated','stock-denied-'||x||'@qa.invalid','{}','{}',now(),now());
 insert into public.profiles(id,first_name,active_venue_id) values(x,'QA',v) on conflict(id) do update set active_venue_id=v;
 insert into public.user_venue_roles(user_id,venue_id,role_id,status) values(x,v,r,'active');perform set_config('test.stock_denied',x::text,true);
end $test$;
set local role authenticated;
do $$ declare v uuid:=current_setting('test.stock_venue')::uuid;begin
 if not public.stock_request_writeoff_month(v,'2020-02-01') then raise exception 'Owner request not queued';end if;
 if public.stock_request_writeoff_month(v,'2020-02-01') then raise exception 'Concurrent request reset job';end if;
 begin perform public.stock_request_writeoff_month(gen_random_uuid(),'2020-02-01');raise exception 'Foreign venue accepted';exception when raise_exception then if sqlerrm not like 'Заведение изменилось%' then raise;end if;end;
 if has_table_privilege('authenticated','public.stock_writeoff_documents','UPDATE') or has_table_privilege('authenticated','public.stock_writeoff_jobs','SELECT') or has_function_privilege('authenticated','public.stock_checkpoint_writeoff_job(uuid,uuid,jsonb,jsonb)','EXECUTE') or has_function_privilege('anon','public.stock_writeoff_job_status(uuid)','EXECUTE') then raise exception 'Unsafe grants';end if;
end $$;
reset role;
do $test$
declare v uuid:=current_setting('test.stock_venue')::uuid;j jsonb;stale uuid;d jsonb:=current_setting('test.stock_doc')::jsonb;n integer;ver integer;
begin
 -- Persisted rotation cannot stick to one lane at fixed minute boundaries.
 if (select count(distinct lane) from (select public.sales_next_worker_lane() as lane from generate_series(1,4)) x)<>4 then raise exception 'Workload lanes starved';end if;
 if has_function_privilege('authenticated','public.sales_next_worker_lane()','EXECUTE') or has_table_privilege('authenticated','private.sales_worker_rotation','SELECT') then raise exception 'Rotation exposed';end if;
 -- Keep the fixture first without touching other jobs.
 update public.stock_writeoff_jobs set updated_at='1900-01-01' where venue_id=v and month='2020-02-01';
 j:=public.stock_claim_writeoff_job(v);stale:=(j->>'lease')::uuid;
 if not public.stock_checkpoint_writeoff_job((j->>'id')::uuid,stale,'[900000001,900000002]') then raise exception 'List not staged';end if;
 if public.stock_checkpoint_writeoff_job((j->>'id')::uuid,stale,'[900000001,900000002]') then raise exception 'Stale lease accepted';end if;
 j:=public.stock_claim_writeoff_job(v);perform public.stock_checkpoint_writeoff_job((j->>'id')::uuid,(j->>'lease')::uuid,null,d);
 if exists(select 1 from public.stock_writeoff_documents where venue_id=v and external_id=900000001) then raise exception 'Partial month leaked';end if;
 j:=public.stock_claim_writeoff_job(v);perform public.stock_fail_writeoff_job((j->>'id')::uuid,(j->>'lease')::uuid,'QA retry');
 if (select cursor from public.stock_writeoff_jobs where id=(j->>'id')::uuid)<>1 then raise exception 'Failure lost progress';end if;
 update public.stock_writeoff_jobs set next_retry_at=now() where id=(j->>'id')::uuid;
 j:=public.stock_claim_writeoff_job(v);stale:=(j->>'lease')::uuid;update public.stock_writeoff_jobs set claimed_at=now()-interval '3 minutes' where id=(j->>'id')::uuid;
 j:=public.stock_claim_writeoff_job(v);
 if (j->>'lease')::uuid=stale or public.stock_checkpoint_writeoff_job((j->>'id')::uuid,stale,null,d||'{"id":900000002}') then raise exception 'Expired lease accepted';end if;
 perform public.stock_checkpoint_writeoff_job((j->>'id')::uuid,(j->>'lease')::uuid,null,d||'{"id":900000002}');
 if (select count(*) from public.stock_writeoff_documents where venue_id=v and external_id in(900000001,900000002))<>2 or (select state from public.stock_writeoff_jobs where id=(j->>'id')::uuid)<>'ready' then raise exception 'Complete month not published';end if;
 select count(*) into n from public.stock_writeoff_history;
 -- Identical replay must not add history or update versions.
 perform private.stock_enqueue_writeoffs(v,'2020-02-01',true,null);j:=public.stock_claim_writeoff_job(v);perform public.stock_checkpoint_writeoff_job((j->>'id')::uuid,(j->>'lease')::uuid,'[900000001,900000002]');
 j:=public.stock_claim_writeoff_job(v);perform public.stock_checkpoint_writeoff_job((j->>'id')::uuid,(j->>'lease')::uuid,null,d);
 j:=public.stock_claim_writeoff_job(v);perform public.stock_checkpoint_writeoff_job((j->>'id')::uuid,(j->>'lease')::uuid,null,d||'{"id":900000002}');
 if (select count(*) from public.stock_writeoff_history)<>n or exists(select 1 from public.stock_writeoff_documents where venue_id=v and external_id in(900000001,900000002) and version<>1) then raise exception 'Replay duplicated history';end if;
 -- Missing source: retain immutable before image; restore is another event.
 perform private.stock_enqueue_writeoffs(v,'2020-02-01',true,null);j:=public.stock_claim_writeoff_job(v);perform public.stock_checkpoint_writeoff_job((j->>'id')::uuid,(j->>'lease')::uuid,'[]');
 if (select count(*) from public.stock_writeoff_documents where venue_id=v and external_id in(900000001,900000002) and missing_at is not null)<>2 then raise exception 'Missing source not retained';end if;
 perform private.stock_enqueue_writeoffs(v,'2020-02-01',true,null);j:=public.stock_claim_writeoff_job(v);perform public.stock_checkpoint_writeoff_job((j->>'id')::uuid,(j->>'lease')::uuid,'[900000001]');
 j:=public.stock_claim_writeoff_job(v);perform public.stock_checkpoint_writeoff_job((j->>'id')::uuid,(j->>'lease')::uuid,null,d||'{"processed":false}');
 if not exists(select 1 from public.stock_writeoff_history h join public.stock_writeoff_documents x on h.document_id=x.id where x.external_id=900000001 and h.action='source_restored') or (select missing_at is not null or payload->>'processed'<>'false' from public.stock_writeoff_documents where venue_id=v and external_id=900000001) then raise exception 'Restore/draft not preserved';end if;
 -- Configuration changes discard staging from the old scope.
 perform private.stock_enqueue_writeoffs(v,'2020-02-01',true,null);j:=public.stock_claim_writeoff_job(v);select version into ver from public.stock_writeoff_sources where venue_id=v;
 update public.stock_writeoff_sources set config=jsonb_set(config,'{storeIds}','[1]') where venue_id=v;
 if (select version from public.stock_writeoff_sources where venue_id=v)<>ver+1 or public.stock_checkpoint_writeoff_job((j->>'id')::uuid,(j->>'lease')::uuid,'[]') then raise exception 'Stale source config accepted';end if;
 j:=public.stock_claim_writeoff_job(v);if j->'source_ids'<>'null'::jsonb or (j->>'cursor')::integer<>0 then raise exception 'Changed source kept old list';end if;
 -- Simulate moved/deleted provider act: rescan flag clears IDs/cursor.
 perform public.stock_checkpoint_writeoff_job((j->>'id')::uuid,(j->>'lease')::uuid,'[900000001]');j:=public.stock_claim_writeoff_job(v);perform public.stock_fail_writeoff_job((j->>'id')::uuid,(j->>'lease')::uuid,'QA rescan',30000,true);
 if (select source_ids is not null or cursor<>0 from public.stock_writeoff_jobs where id=(j->>'id')::uuid) then raise exception 'Rescan retained stale source list';end if;
end $test$;
select set_config('request.jwt.claim.sub',current_setting('test.stock_reader'),true),set_config('app.ctx_ready','0',true);
set local role authenticated;
do $$ declare v uuid:=current_setting('test.stock_venue')::uuid;begin
 if not exists(select 1 from public.stock_writeoff_documents where venue_id=v) or not exists(select 1 from public.stock_writeoff_archive where venue_id=v) or not exists(select 1 from public.stock_writeoff_history where venue_id=v) then raise exception 'Reader cannot see own scope';end if;
 perform public.stock_writeoff_job_status(v);
 begin perform public.stock_request_writeoff_month(v,'2020-02-01');raise exception 'Reader refreshed without sync permission';exception when raise_exception then if sqlerrm not like 'Нет доступа%' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.stock_denied'),true),set_config('app.ctx_ready','0',true);
do $$ begin
 if exists(select 1 from public.stock_writeoff_documents) or exists(select 1 from public.stock_writeoff_history) or exists(select 1 from public.stock_writeoff_archive) or exists(select 1 from public.stock_writeoff_sources) or exists(select 1 from public.audit_logs where action_code like 'stock.writeoffs.%') then raise exception 'Non-reader leak';end if;
 begin perform public.stock_writeoff_job_status(current_setting('test.stock_venue')::uuid);raise exception 'Status leak';exception when raise_exception then if sqlerrm not like 'Нет доступа%' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','',true),set_config('app.ctx_ready','0',true);
do $$ begin if exists(select 1 from public.stock_writeoff_documents) or exists(select 1 from public.stock_writeoff_archive) then raise exception 'Anonymous leak';end if;end $$;
reset role;
do $$ begin
 if current_setting('test.stock_finance') is distinct from md5(jsonb_build_object('transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t),'accruals',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_accruals t),'adjustments',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_adjustments t),'banks',(select jsonb_agg(to_jsonb(t) order by id) from public.bank_accounts t),'notifications',(select jsonb_agg(to_jsonb(t) order by id) from public.notifications t))::text) then raise exception 'Finance/payroll/notifications changed';end if;
 raise notice 'PASS: source validation, complete-month atomicity, no-op replay, expired/lost lease, config drift, missing/restore/draft history, bounded retry/rescan, role/RLS denial, unchanged money/payroll/notifications';
end $$;
rollback;
