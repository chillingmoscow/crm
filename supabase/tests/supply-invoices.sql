-- Integration checks use the local CHILLING fixture and roll back every effect.
begin;
create function pg_temp.supply_verified_job(a uuid,v uuid,provider text,headers jsonb,facts jsonb)returns jsonb language plpgsql as $$
declare j uuid;lease uuid:=gen_random_uuid();rule uuid;begin
 select id into rule from private.supply_read_rules where venue_id=v order by version desc limit 1;
 insert into private.supply_jobs(account_id,venue_id,state,phase,cursor,payload,request,lease,claimed_at)
 select a,v,'running','financial_verify',jsonb_array_length(facts),jsonb_build_object('provider',provider,'first',headers,'second',headers,'facts',facts),jsonb_build_object('timezone',s.timezone,'dayStartHour',s.day_start_hour,'businessIds',r.config->'businessIds','ruleId',rule),lease,now()from public.sales_settings s join private.supply_read_rules r on r.id=rule where s.venue_id=v returning id into j;
 return jsonb_build_object('id',j,'lease',lease);
end $$;
do $$
declare v uuid:='0bd81f1b-53be-4250-af97-eb5f693b30e1';a uuid;u uuid;provider text;cfg jsonb;n integer;j uuid;claim jsonb;headers jsonb;facts jsonb;h1 jsonb;h2 jsonb;f1 jsonb;f2 jsonb;payload jsonb;lease uuid;outcome jsonb;first_document uuid;history_n integer;source_n integer;viewer uuid;role_id uuid;before_hash text;
begin
 select account_id into a from public.venues where id=v;select owner_id into u from public.accounts where id=a;
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);provider:=private.finance_execution_provider(a,v);
 before_hash:=md5(jsonb_build_object('tx',(select jsonb_agg(to_jsonb(t)order by id)from public.transactions t),'banks',(select jsonb_agg(to_jsonb(t)order by id)from public.bank_accounts t),'salary',(select jsonb_agg(to_jsonb(t)order by id)from public.payroll_accruals t),'notifications',(select jsonb_agg(to_jsonb(t)order by id)from public.notifications t))::text);perform set_config('test.supply_hash',before_hash,true);
 cfg:=jsonb_build_object('autoRead',false,'intervalMinutes',60,'businessIds',jsonb_build_array(1),'businessNames',jsonb_build_object('1','CHILLING'),'provider',provider);select coalesce(max(version),0)into n from private.supply_read_rules where venue_id=v;
 perform public.supply_save_read_rules(v,n,cfg,'QA source rules');
 begin perform public.supply_save_read_rules(v,n,cfg,'QA stale rule');raise exception 'Stale rules accepted';exception when raise_exception then if sqlerrm not like 'Настройки изменились%'then raise;end if;end;
 j:=public.supply_request(v);if public.supply_request(v)<>j then raise exception 'Read retry duplicated job';end if;
 claim:=public.supply_claim();if claim->>'id'<>j::text then raise exception 'Source queue not claimed';end if;lease:=(claim->>'lease')::uuid;
 perform public.supply_fail(j,lease,'QA temporary read timeout',30);
 if(select state<>'pending'or source_failures<>1 or q.payload is distinct from claim->'payload' from private.supply_jobs q where q.id=j)then raise exception 'Temporary read failure lost progress';end if;
 if public.supply_schedule()<>0 or public.supply_claim()is not null then raise exception 'Read retried during provider cooldown';end if;
 update private.supply_jobs set next_retry_at=now()-interval '1 second'where id=j;
 update public.sales_settings set provider_retry_at=now()-interval '1 second'where account_id=a;
 if public.supply_schedule()<1 then raise exception 'Pending read did not wake local worker';end if;
 claim:=public.supply_claim();lease:=(claim->>'lease')::uuid;
 h1:='{"id":900000001,"version":1,"number":"SAME NUMBER","invoiceAt":"2026-10-02T09:00:00.000Z","providerId":1,"providerName":"QA Supplier","storeId":1,"storeTitle":"Store","processed":true,"paid":true,"amountCents":2900,"authorName":"QA author"}';
 h2:=h1||'{"id":900000002,"paid":false}';headers:=jsonb_build_array(h1,h2);
 f1:=h1||'{"businessId":1,"invoiceDate":"2026-10-02","paidAt":"2026-10-02T11:00:00.000Z","paidDate":"2026-10-02","accountId":4,"accountTitle":"Cash","issues":[]}';
 f2:=h2||'{"businessId":1,"invoiceDate":"2026-10-02","paidAt":null,"paidDate":null,"accountId":null,"accountTitle":null,"issues":[]}';facts:=jsonb_build_array(f1,f2);
 payload:=jsonb_build_object('provider',provider,'first','[]'::jsonb,'second','[]'::jsonb,'facts','[]'::jsonb);
 begin perform public.supply_save_slice(j,lease,'financial_verify',2,payload);raise exception 'Source phase skipped';exception when raise_exception then if sqlerrm not like 'Некорректный переход%'then raise;end if;end;
 perform public.supply_save_slice(j,lease,'grid_first',2,payload||jsonb_build_object('first',jsonb_build_array(h2,h1)));
 if(select source_failures<>0 from private.supply_jobs where id=j)then raise exception 'Successful slice did not reset retries';end if;
 claim:=public.supply_claim();lease:=(claim->>'lease')::uuid;payload:=payload||jsonb_build_object('first',headers);
 perform public.supply_save_slice(j,lease,'financial_first',2,payload);
 claim:=public.supply_claim();lease:=(claim->>'lease')::uuid;payload:=payload||jsonb_build_object('facts',facts);
 begin perform public.supply_save_slice(j,lease,'grid_verify',0,payload||jsonb_build_object('facts',jsonb_build_array(f1)));raise exception 'Truncated financial source accepted';exception when raise_exception then if sqlerrm not like 'Оплаты и накладные%'then raise;end if;end;
 perform public.supply_save_slice(j,lease,'grid_verify',0,payload);
 claim:=public.supply_claim();lease:=(claim->>'lease')::uuid;perform public.supply_save_slice(j,lease,'grid_verify',2,payload||jsonb_build_object('second',jsonb_build_array(h2,h1)));
 claim:=public.supply_claim();lease:=(claim->>'lease')::uuid;payload:=payload||jsonb_build_object('second',headers);perform public.supply_save_slice(j,lease,'financial_verify',2,payload);
 claim:=public.supply_claim();lease:=(claim->>'lease')::uuid;
 begin perform public.supply_publish(j,gen_random_uuid(),facts,provider);raise exception 'Stale lease published';exception when raise_exception then if sqlerrm not like 'Чтение поставок передано%'then raise;end if;end;
 begin perform public.supply_publish(j,lease,jsonb_build_array(f1||'{"amountCents":3000}',f2),provider);raise exception 'Changed financial source published';exception when raise_exception then if sqlerrm not like 'Два полных прохода%'then raise;end if;end;
 select coalesce(max(version),0)+1 into source_n from private.supply_sources where venue_id=v;outcome:=public.supply_publish(j,lease,facts,provider);
 if outcome->>'rows'<>'2'or outcome->>'version'<>source_n::text then raise exception 'Complete source not published';end if;
 if(select count(*)from private.supply_documents where venue_id=v and qr_id in(900000001,900000002))<>2 then raise exception 'Same-number invoices merged';end if;
 select id into first_document from private.supply_documents where venue_id=v and qr_id=900000001;select count(*)into history_n from private.supply_history where document_id=first_document;
 claim:=pg_temp.supply_verified_job(a,v,provider,headers,facts);outcome:=public.supply_publish((claim->>'id')::uuid,(claim->>'lease')::uuid,facts,provider);
 if outcome->>'version'<>source_n::text or(select count(*)from private.supply_history where document_id=first_document)<>history_n then raise exception 'Unchanged source duplicated history';end if;
 claim:=pg_temp.supply_verified_job(a,v,provider,jsonb_build_array(h2),jsonb_build_array(f2));perform public.supply_publish((claim->>'id')::uuid,(claim->>'lease')::uuid,jsonb_build_array(f2),provider);
 if not(select source_missing from private.supply_documents where id=first_document)then raise exception 'Missing source invoice not preserved';end if;
 claim:=pg_temp.supply_verified_job(a,v,provider,headers,facts);perform public.supply_publish((claim->>'id')::uuid,(claim->>'lease')::uuid,facts,provider);
 if(select source_missing from private.supply_documents where id=first_document)then raise exception 'Returned invoice still missing';end if;
 claim:=pg_temp.supply_verified_job(a,v,provider,'[]','[]');begin perform public.supply_publish((claim->>'id')::uuid,(claim->>'lease')::uuid,'[]',provider);raise exception 'Empty source replaced known invoices';exception when raise_exception then if sqlerrm not like 'Пустой источник%'then raise;end if;end;
 perform public.supply_fail((claim->>'id')::uuid,(claim->>'lease')::uuid,'QA empty source guard',null);
 insert into public.roles(venue_id,name,code)values(v,'QA supply reader','qa_supply_reader')returning id into role_id;
 insert into public.role_permissions(role_id,permission_id,granted)select role_id,id,true from public.permissions where code in('finance.view_transactions','org.view_audit');
 viewer:=gen_random_uuid();insert into auth.users(id,aud,role,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)values(viewer,'authenticated','authenticated','supply-reader-'||viewer||'@qa.invalid','{}','{}',now(),now());
 insert into public.profiles(id,first_name,active_venue_id)values(viewer,'QA',v)on conflict(id)do update set active_venue_id=v;
 insert into public.user_venue_roles(user_id,venue_id,role_id,status)values(viewer,v,role_id,'active');
 perform set_config('test.supply_venue',v::text,true);perform set_config('test.supply_owner',u::text,true);perform set_config('test.supply_viewer',viewer::text,true);perform set_config('test.supply_document',first_document::text,true);perform set_config('test.supply_role',role_id::text,true);
 perform set_config('request.jwt.claim.sub',viewer::text,true);perform set_config('app.ctx_ready','0',true);
end $$;
set local role authenticated;
do $$declare v uuid:=current_setting('test.supply_venue')::uuid;r jsonb;begin
 r:=public.supply_list(v,'2026-10-01','2026-10-31','QA Supplier');if r->>'total'<>'2'or r->>'paidCents'<>'0'or r->>'unpaidCents'<>'5800'then raise exception 'Invoice list/financial summary not scoped';end if;
 if public.supply_detail(v,current_setting('test.supply_document')::uuid)->'data'->>'number'<>'SAME NUMBER'then raise exception 'Authorized reader cannot open invoice';end if;
 begin perform public.supply_request(v);raise exception 'Reader requested source refresh';exception when raise_exception then if sqlerrm<>'Нет доступа к поставкам'then raise;end if;end;
 begin perform public.supply_read_configuration(v);raise exception 'Reader obtained owner configuration';exception when raise_exception then if sqlerrm<>'Нет доступа к поставкам'then raise;end if;end;
 begin perform public.supply_list(gen_random_uuid(),'2026-10-01','2026-10-31');raise exception 'Cross-venue read accepted';exception when raise_exception then if sqlerrm not like 'Заведение изменилось%'then raise;end if;end;
 if has_table_privilege('authenticated','private.supply_documents','select')or has_function_privilege('authenticated','public.supply_publish(uuid,uuid,jsonb,text)','execute')then raise exception 'Unsafe source privileges';end if;
end $$;
reset role;
do $$begin
 update public.role_permissions set granted=false where role_id=current_setting('test.supply_role')::uuid and permission_id in(select id from public.permissions where code='finance.view_transactions');perform set_config('app.ctx_ready','0',true);
 if current_setting('test.supply_hash')is distinct from md5(jsonb_build_object('tx',(select jsonb_agg(to_jsonb(t)order by id)from public.transactions t),'banks',(select jsonb_agg(to_jsonb(t)order by id)from public.bank_accounts t),'salary',(select jsonb_agg(to_jsonb(t)order by id)from public.payroll_accruals t),'notifications',(select jsonb_agg(to_jsonb(t)order by id)from public.notifications t))::text)then raise exception 'Supply mirror changed money, payroll or notifications';end if;
end $$;
set local role authenticated;
do $$begin
 begin perform public.supply_detail(current_setting('test.supply_venue')::uuid,current_setting('test.supply_document')::uuid);raise exception 'Revoked reader read supply';exception when raise_exception then if sqlerrm<>'Нет доступа к поставкам'then raise;end if;end;
 if exists(select 1 from public.audit_logs where action_code like 'finance.supply.%')then raise exception 'Revoked reader saw supply audit';end if;
end $$;
reset role;
-- A disconnected tenant cannot roll back a healthy tenant's scheduled read.
do $$
declare v uuid:='0bd81f1b-53be-4250-af97-eb5f693b30e1';a uuid;u uuid;bad_a uuid:=gen_random_uuid();bad_v uuid:='00000001-0000-4000-8000-000000000001';cfg jsonb;n integer;jobs_n integer;begin
 select account_id into a from public.venues where id=v;select owner_id into u from public.accounts where id=a;
 insert into public.accounts(id,name,owner_id)values(bad_a,'QA disconnected supply account',u);
 insert into public.venues(id,account_id,name)values(bad_v,bad_a,'QA disconnected supply venue');
 select config,version into cfg,n from private.supply_read_rules where venue_id=v order by version desc limit 1;
 cfg:=jsonb_set(cfg,'{autoRead}','true');
 insert into private.supply_read_rules(account_id,venue_id,version,config,actor_name,reason)values(a,v,n+1,cfg,'QA','QA healthy scheduler'),(bad_a,bad_v,1,cfg,'QA','QA disconnected scheduler');
 update private.supply_jobs set state='done',lease=null,claimed_at=null,created_at=now()-interval '2 hours'where venue_id=v;
 perform public.supply_schedule();
 if not exists(select 1 from private.supply_jobs where venue_id=v and state='pending')then raise exception 'Disconnected tenant blocked healthy scheduling';end if;
 if(select count(*)from private.supply_jobs where venue_id=bad_v and state='error')<>1 then raise exception 'Disconnected source error was hidden';end if;
 select count(*)into jobs_n from private.supply_jobs where venue_id in(v,bad_v);
 perform public.supply_schedule();
 if(select count(*)from private.supply_jobs where venue_id in(v,bad_v))<>jobs_n then raise exception 'Scheduler duplicated error/live read on retry';end if;
end $$;
do $$begin raise notice 'PASS: full paginated supply publication, independent financial equality, phase/lease guards, immutable history, separate same-number invoices, missing/return protection, scope, role revocation, unchanged money/payroll/messages';end $$;
rollback;
