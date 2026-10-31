-- Local owner fixture, full rollback. No real messages or financial writes.
begin;
do $$
declare u uuid;a uuid;v uuid;x uuid;r uuid;begin
 select id into u from auth.users where email='owner@test.com';perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);a:=public.get_active_account_id();v:=public.get_active_venue_id();
 perform set_config('test.movement_a',a::text,true);perform set_config('test.movement_v',v::text,true);perform set_config('test.movement_u',u::text,true);
 perform set_config('test.movement_n',(select coalesce(max(version),0)::text from public.cash_movement_rules where venue_id=v),true);
 insert into public.finance_categories(account_id,name,type) values(a,'Movement income QA','income') returning id into r;
 perform set_config('test.movement_income',r::text,true);
 insert into public.finance_categories(account_id,name,type) values(a,'Movement expense QA','expense') returning id into r;
 perform set_config('test.movement_rules',(select jsonb_build_object('cashAccountId',b[1],'safeAccountId',b[2],'operatingAccountId',b[3],'incomeCategoryId',current_setting('test.movement_income'),'taxiCategoryId',r,'tipsCategoryId',r,'safePattern','инкас|инк.*ация','taxiPattern','такси','tipsPattern','ча[йеюёвы]','lookbackDays',30,'intervalMinutes',60,'autoRead',false,'overrides','[]'::jsonb)::text from (select array_agg(id order by id) b from public.bank_accounts where account_id=a and deleted_at is null and is_active and currency='RUB')q),true);
 perform set_config('test.movement_money',md5(jsonb_build_object('transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t),'banks',(select jsonb_agg(to_jsonb(t) order by id) from public.bank_accounts t),'accruals',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_accruals t),'adjustments',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_adjustments t),'notifications',(select jsonb_agg(to_jsonb(t) order by id) from public.notifications t))::text),true);
 insert into public.roles(venue_id,name,code) values(v,'Movement viewer QA','movement_viewer_qa') returning id into r;
 insert into public.role_permissions(role_id,permission_id,granted) select r,id,true from public.permissions where code in ('sales.view_shifts','finance.view_transactions','org.view_audit');
 x:=gen_random_uuid();insert into auth.users(id,aud,role,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values(x,'authenticated','authenticated','movement-'||x||'@qa.invalid','{}','{}',now(),now());
 insert into public.profiles(id,first_name,active_venue_id) values(x,'QA',v) on conflict(id) do update set active_venue_id=v;
 insert into public.user_venue_roles(user_id,venue_id,role_id,status) values(x,v,r,'active');perform set_config('test.movement_viewer',x::text,true);
 insert into public.roles(venue_id,name,code) values(v,'Movement denied QA','movement_denied_qa') returning id into r;
 insert into public.role_permissions(role_id,permission_id,granted) select r,id,true from public.permissions where code in ('sales.view_shifts','org.view_audit');
 x:=gen_random_uuid();insert into auth.users(id,aud,role,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values(x,'authenticated','authenticated','movement-denied-'||x||'@qa.invalid','{}','{}',now(),now());
 insert into public.profiles(id,first_name,active_venue_id) values(x,'QA',v) on conflict(id) do update set active_venue_id=v;
 insert into public.user_venue_roles(user_id,venue_id,role_id,status) values(x,v,r,'active');perform set_config('test.movement_denied',x::text,true);
 update private.cash_movement_jobs set next_retry_at=now()+interval '1 day';update public.sales_settings set provider_retry_at=null where account_id=a;
 insert into public.venues(account_id,name) values(a,'Movement delete QA') returning id into x;perform set_config('test.movement_delete',x::text,true);
 insert into public.cash_movement_rules(account_id,venue_id,version,config,reason,created_by,actor_name) values(a,x,1,current_setting('test.movement_rules')::jsonb,'QA deletion',u,'QA');
end $$;
set local role authenticated;
do $$
declare v uuid:=current_setting('test.movement_v')::uuid;n integer:=current_setting('test.movement_n')::integer;c jsonb:=current_setting('test.movement_rules')::jsonb;x uuid;j uuid;begin
 x:=public.cash_movement_save_rules(v,n,c,'QA initial');if public.cash_movement_save_rules(v,n,c,'QA initial')<>x then raise exception 'Retry duplicated settings';end if;
 perform public.cash_movement_save_rules(v,n+1,jsonb_set(c,'{lookbackDays}','15'),'QA lookback');
 if (select config->>'lookbackDays' from public.cash_movement_rules where id=x)<>'30' then raise exception 'Old settings overwritten';end if;
 begin perform public.cash_movement_save_rules(v,n,c,'QA stale');raise exception 'Stale settings accepted';exception when raise_exception then if sqlerrm not like 'Правила изменились%' then raise;end if;end;
 begin perform public.cash_movement_save_rules(v,n+2,jsonb_set(c,'{cashAccountId}',c->'safeAccountId'),'QA same bank');raise exception 'Same accounts accepted';exception when raise_exception then if sqlerrm not like 'Касса, сейф%' then raise;end if;end;
 begin perform public.cash_movement_save_rules(v,n+2,jsonb_set(c,'{safePattern}','"(a+)+$"'),'QA unsafe pattern');raise exception 'Unsafe pattern accepted';exception when raise_exception then if sqlerrm not like 'Проверьте правило%' then raise;end if;end;
 begin perform public.cash_movement_save_rules(v,n+2,c||'{"extra":true}','QA unknown');raise exception 'Unknown parameter accepted';exception when raise_exception then if sqlerrm not like 'Проверьте параметры%' then raise;end if;end;
 begin perform public.cash_movement_request(gen_random_uuid(),'2000-01-03');raise exception 'Foreign venue accepted';exception when raise_exception then if sqlerrm not like 'Заведение изменилось%' then raise;end if;end;
 if has_table_privilege('authenticated','public.cash_movement_rules','UPDATE') or has_table_privilege('service_role','public.cash_movement_days','UPDATE') or has_table_privilege('service_role','private.cash_movement_jobs','SELECT') or has_function_privilege('authenticated','public.cash_movement_save_read(uuid,uuid,jsonb,text)','EXECUTE') or has_function_privilege('anon','public.cash_movement_transactions(uuid,date)','EXECUTE') then raise exception 'Unsafe grants';end if;
 j:=public.cash_movement_request(v,'2000-01-03');if public.cash_movement_request(v,'2000-01-03')<>j then raise exception 'Request duplicated';end if;
 begin perform public.cash_movement_request(v,'2000-01-04');raise exception 'Overlapping source scan accepted';exception when raise_exception then if sqlerrm not like 'Сверка другого периода%' then raise;end if;end;
 perform set_config('test.movement_job',j::text,true);
 delete from public.venues where id=current_setting('test.movement_delete')::uuid;if not found then raise exception 'Rules blocked venue deletion';end if;
end $$;
reset role;
do $$
declare j jsonb;jid uuid:=current_setting('test.movement_job')::uuid;f jsonb;bad jsonb;provider text:=repeat('a',64);oldlease uuid;bank public.bank_accounts;tid uuid;projection jsonb;begin
 -- QR filters use literal local hours with Z; the response uses actual UTC.
 -- Keep the live-proven provider contract separate from shift-date conversion.
 if not exists(select 1 from private.cash_movement_jobs where id=jid and request->>'since'=(request->>'from')||'T00:00:00.000Z' and request->>'till'=((now() at time zone (request->>'timezone'))::date+1)::text||'T00:00:00.000Z') then raise exception 'QR wall-clock filter contract changed';end if;
 if (select count(distinct public.sales_next_worker_lane()) from generate_series(1,16))<>8 then raise exception 'Worker lane starves';end if;
 f:=jsonb_build_array(jsonb_build_object('id',1,'date','2000-01-03','amountCents',100000,'type','cashOut','shiftId',1,'openedAt','2000-01-03T09:00:00Z','occurredAt','2000-01-04T01:00:00Z','arrivedAt','2000-01-04T09:00:00Z','comment','Такси'));
 j:=public.cash_movement_claim();if j->>'id'<>jid::text then raise exception 'Wrong job claimed';end if;
 oldlease:=(j->>'lease')::uuid;update private.cash_movement_jobs set claimed_at=now()-interval '3 minutes' where id=jid;
 perform public.cash_movement_fail(jid,oldlease,'Stale writer');if (select last_error from private.cash_movement_jobs where id=jid) is not null then raise exception 'Expired writer changed job';end if;
 begin perform public.cash_movement_save_read(jid,oldlease,f,provider);raise exception 'Expired lease saved';exception when raise_exception then if sqlerrm not like 'Чтение передано%' then raise;end if;end;
 j:=public.cash_movement_claim();perform public.cash_movement_save_read(jid,(j->>'lease')::uuid,f,provider);
 if exists(select 1 from public.cash_movement_days where venue_id=current_setting('test.movement_v')::uuid and business_date='2000-01-03') then raise exception 'First pass published';end if;
 j:=public.cash_movement_claim();bad:=jsonb_set(f,'{0,amountCents}','100001');
 begin perform public.cash_movement_save_read(jid,(j->>'lease')::uuid,bad,provider);raise exception 'Changing source published';exception when raise_exception then if sqlerrm not like 'Кассовые операции изменились%' then raise;end if;end;
 perform public.cash_movement_save_read(jid,(j->>'lease')::uuid,f,provider);
 if (select version from public.cash_movement_days where venue_id=current_setting('test.movement_v')::uuid and business_date='2000-01-03')<>1 then raise exception 'Confirmed snapshot missing';end if;
 if not exists(select 1 from public.cash_movement_history h join public.cash_movement_days d on d.id=h.day_id where d.venue_id=current_setting('test.movement_v')::uuid and d.business_date='2000-01-03' and h.actor_name<>'Система') then raise exception 'Actor snapshot missing';end if;
 update private.cash_movement_jobs set state='pending',phase='first' where id=jid;j:=public.cash_movement_claim();perform public.cash_movement_save_read(jid,(j->>'lease')::uuid,f,provider);j:=public.cash_movement_claim();perform public.cash_movement_save_read(jid,(j->>'lease')::uuid,f,provider);
 if (select version from public.cash_movement_days where venue_id=current_setting('test.movement_v')::uuid and business_date='2000-01-03')<>1 then raise exception 'Identical snapshot inflated history';end if;
 update private.cash_movement_jobs set state='pending',phase='first' where id=jid;j:=public.cash_movement_claim();perform public.cash_movement_save_read(jid,(j->>'lease')::uuid,bad,provider);j:=public.cash_movement_claim();perform public.cash_movement_save_read(jid,(j->>'lease')::uuid,bad,provider);
 if (select version from public.cash_movement_days where venue_id=current_setting('test.movement_v')::uuid and business_date='2000-01-03')<>2 then raise exception 'Changed snapshot not versioned';end if;
 if not exists(select 1 from public.cash_movement_history h join public.cash_movement_days d on d.id=h.day_id where d.venue_id=current_setting('test.movement_v')::uuid and d.business_date='2000-01-03' and h.version=1 and h.items=f) then raise exception 'Original history lost';end if;
 update private.cash_movement_jobs set state='pending',phase='first' where id=jid;j:=public.cash_movement_claim();perform public.cash_movement_save_read(jid,(j->>'lease')::uuid,'[]',provider);j:=public.cash_movement_claim();
 begin perform public.cash_movement_save_read(jid,(j->>'lease')::uuid,'[]',provider);raise exception 'Empty source erased known operations';exception when raise_exception then if sqlerrm not like 'Источник вернул пустой%' then raise;end if;end;
 begin perform public.cash_movement_save_read(jid,(j->>'lease')::uuid,jsonb_set(f,'{0,openedAt}','null'),provider);raise exception 'Unknown timestamp accepted';exception when raise_exception then if sqlerrm not like 'Не подтверждено время%' then raise;end if;end;
 begin perform public.cash_movement_save_read(jid,(j->>'lease')::uuid,f||f,provider);raise exception 'Duplicate source accepted';exception when raise_exception then if sqlerrm not like 'Не подтверждён полный%' then raise;end if;end;
 -- A native tip expense can have the payroll source key without any # marker.
 -- Verify the projection, including cancellation, then roll back the fixture.
 begin
  select * into bank from public.bank_accounts where id=(current_setting('test.movement_rules')::jsonb->>'operatingAccountId')::uuid;
  insert into public.transactions(account_id,venue_id,legal_entity_id,bank_account_id,type,amount,date,category_id,description,source_external_id,created_by)
  values(bank.account_id,current_setting('test.movement_v')::uuid,bank.legal_entity_id,bank.id,'expense',1000,'2000-01-02T12:00:00Z',(current_setting('test.movement_rules')::jsonb->>'tipsCategoryId')::uuid,'Чаевые без номера','quickresto:encashment:'||current_setting('test.movement_v')||':1',current_setting('test.movement_u')::uuid) returning id into tid;
  select e into projection from jsonb_array_elements(public.cash_movement_transactions(current_setting('test.movement_v')::uuid,'2000-01-03'))e where e->>'id'=tid::text;
  if projection is null or projection->'sourceIds'<>'[1]'::jsonb or projection->>'date'<>'2000-01-02' then raise exception 'Linked payroll expense was missed because of date/marker';end if;
  update public.transactions set deleted_at=now(),deleted_by=current_setting('test.movement_u')::uuid where id=tid;
  select e into projection from jsonb_array_elements(public.cash_movement_transactions(current_setting('test.movement_v')::uuid,'2000-01-03'))e where e->>'id'=tid::text;
  if projection->'deleted'<>'true' then raise exception 'Cancelled source identity was lost';end if;
  raise exception using errcode='PZ001',message='rollback movement fixture';
 exception when sqlstate 'PZ001' then null;end;
 -- A delayed row outside the requested days is preserved as a separate warning;
 -- it must not replace the full snapshot of its old cash-shift day.
 update private.cash_movement_jobs set state='pending',phase='first',request=jsonb_set(request,'{from}','"2000-01-03"') where id=jid;
 bad:=f||jsonb_set(jsonb_set(jsonb_set(f->0,'{id}','2'),'{date}','"2000-01-02"'),'{openedAt}','"2000-01-02T09:00:00Z"');
 j:=public.cash_movement_claim();perform public.cash_movement_save_read(jid,(j->>'lease')::uuid,bad,provider);j:=public.cash_movement_claim();perform public.cash_movement_save_read(jid,(j->>'lease')::uuid,bad,provider);
 if jsonb_array_length((select outside from private.cash_movement_jobs where id=jid))<>1 then raise exception 'Delayed outside operation lost';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.movement_viewer'),true),set_config('app.ctx_ready','0',true);
do $$ begin
 if not exists(select 1 from public.cash_movement_days) or not exists(select 1 from public.cash_movement_rules) or not exists(select 1 from public.cash_movement_history) then raise exception 'Viewer cannot read facts';end if;
 perform public.cash_movement_job_status(current_setting('test.movement_v')::uuid,'2000-01-03');perform public.cash_movement_transactions(current_setting('test.movement_v')::uuid,'2000-01-03');
 begin perform public.cash_movement_save_rules(current_setting('test.movement_v')::uuid,0,current_setting('test.movement_rules')::jsonb,'QA denied');raise exception 'Viewer changed settings';exception when raise_exception then if sqlerrm not like 'Сверка поступлений доступна%' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.movement_denied'),true),set_config('app.ctx_ready','0',true);
do $$ begin
 if exists(select 1 from public.cash_movement_days) or exists(select 1 from public.cash_movement_rules) or exists(select 1 from public.cash_movement_history) or exists(select 1 from public.audit_logs where action_code like 'cash.movement.%') then raise exception 'Cash facts leaked';end if;
 begin perform public.cash_movement_transactions(current_setting('test.movement_v')::uuid,'2000-01-03');raise exception 'Denied viewer accessed ledger';exception when raise_exception then if sqlerrm not like 'Нет доступа%' then raise;end if;end;
end $$;
reset role;
do $$ begin
 if exists(select 1 from public.cash_movement_rules where venue_id=current_setting('test.movement_delete')::uuid) then raise exception 'Orphaned settings';end if;
 if current_setting('test.movement_money') is distinct from md5(jsonb_build_object('transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t),'banks',(select jsonb_agg(to_jsonb(t) order by id) from public.bank_accounts t),'accruals',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_accruals t),'adjustments',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_adjustments t),'notifications',(select jsonb_agg(to_jsonb(t) order by id) from public.notifications t))::text) then raise exception 'Movement reader changed money/payroll/messages';end if;
 raise notice 'PASS: movement rules, RLS, double read, leases, immutable history, delayed arrivals, scope, empty-source guard, unchanged money/payroll/messages';
end $$;
rollback;
