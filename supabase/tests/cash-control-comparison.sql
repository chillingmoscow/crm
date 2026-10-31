-- Local owner fixture, full rollback. No real messages or financial writes.
begin;
do $$
declare u uuid;a uuid;v uuid;x uuid;r uuid;begin
 select id into u from auth.users where email='owner@test.com';perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);a:=public.get_active_account_id();v:=public.get_active_venue_id();
 perform set_config('test.cash_a',a::text,true);perform set_config('test.cash_v',v::text,true);perform set_config('test.cash_u',u::text,true);
 perform set_config('test.cash_n',(select coalesce(max(version),0)::text from public.cash_control_rules where venue_id=v),true);
 perform set_config('test.cash_rules','{"thresholdCents":0,"opening":true,"closing":true,"autoRead":false,"intervalMinutes":60}',true);
 perform set_config('test.cash_money',md5(jsonb_build_object('transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t),'banks',(select jsonb_agg(to_jsonb(t) order by id) from public.bank_accounts t),'accruals',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_accruals t),'adjustments',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_adjustments t),'notifications',(select jsonb_agg(to_jsonb(t) order by id) from public.notifications t))::text),true);
 insert into public.roles(venue_id,name,code) values(v,'Cash viewer QA','cash_viewer_qa') returning id into r;
 insert into public.role_permissions(role_id,permission_id,granted) select r,id,true from public.permissions where code in ('sales.view_shifts','finance.view_transactions','org.view_audit');
 x:=gen_random_uuid();insert into auth.users(id,aud,role,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values(x,'authenticated','authenticated','cash-'||x||'@qa.invalid','{}','{}',now(),now());
 insert into public.profiles(id,first_name,active_venue_id) values(x,'QA',v) on conflict(id) do update set active_venue_id=v;
 insert into public.user_venue_roles(user_id,venue_id,role_id,status) values(x,v,r,'active');perform set_config('test.cash_viewer',x::text,true);
 insert into public.roles(venue_id,name,code) values(v,'Cash denied QA','cash_denied_qa') returning id into r;
 insert into public.role_permissions(role_id,permission_id,granted) select r,id,true from public.permissions where code in ('sales.view_shifts','org.view_audit');
 x:=gen_random_uuid();insert into auth.users(id,aud,role,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values(x,'authenticated','authenticated','cash-denied-'||x||'@qa.invalid','{}','{}',now(),now());
 insert into public.profiles(id,first_name,active_venue_id) values(x,'QA',v) on conflict(id) do update set active_venue_id=v;
 insert into public.user_venue_roles(user_id,venue_id,role_id,status) values(x,v,r,'active');perform set_config('test.cash_denied',x::text,true);
 update private.cash_control_jobs set next_retry_at=now()+interval '1 day';update public.sales_settings set provider_retry_at=null where account_id=a;
 insert into public.venues(account_id,name) values(a,'Cash delete QA') returning id into x;perform set_config('test.cash_delete',x::text,true);
 insert into public.cash_control_rules(account_id,venue_id,version,config,reason,created_by,actor_name) values(a,x,1,current_setting('test.cash_rules')::jsonb,'QA deletion',u,'QA');
end $$;
set local role authenticated;
do $$
declare v uuid:=current_setting('test.cash_v')::uuid;n integer:=current_setting('test.cash_n')::integer;c jsonb:=current_setting('test.cash_rules')::jsonb;x uuid;j uuid;begin
 x:=public.cash_control_save_rules(v,n,c,'QA initial');if public.cash_control_save_rules(v,n,c,'QA initial')<>x then raise exception 'Retry duplicated rule';end if;
 perform public.cash_control_save_rules(v,n+1,jsonb_set(c,'{thresholdCents}','5000'),'QA threshold');
 if (select config->>'thresholdCents' from public.cash_control_rules where id=x)<>'0' then raise exception 'Old rule overwritten';end if;
 begin perform public.cash_control_save_rules(v,n,c,'QA stale');raise exception 'Stale rule accepted';exception when raise_exception then if sqlerrm not like 'Правила изменились%' then raise;end if;end;
 begin perform public.cash_control_save_rules(v,n+2,jsonb_set(c,'{thresholdCents}','-1'),'QA invalid');raise exception 'Negative threshold accepted';exception when raise_exception then if sqlerrm not like 'Проверьте порог%' then raise;end if;end;
 begin perform public.cash_control_save_rules(v,n+2,c||'{"unknown":true}','QA unknown');raise exception 'Unknown parameter accepted';exception when raise_exception then if sqlerrm not like 'Проверьте параметры%' then raise;end if;end;
 begin perform public.cash_control_request(gen_random_uuid(),'2000-01-03');raise exception 'Foreign venue accepted';exception when raise_exception then if sqlerrm not like 'Заведение изменилось%' then raise;end if;end;
 if has_table_privilege('authenticated','public.cash_control_rules','UPDATE') or has_table_privilege('service_role','public.cash_control_days','UPDATE') or has_table_privilege('service_role','private.cash_control_jobs','SELECT') or has_function_privilege('authenticated','public.cash_control_save_read(uuid,uuid,jsonb,text)','EXECUTE') or has_function_privilege('anon','public.cash_control_request(uuid,date)','EXECUTE') then raise exception 'Unsafe grants';end if;
 j:=public.cash_control_request(v,'2000-01-03');if public.cash_control_request(v,'2000-01-03')<>j then raise exception 'Request retry duplicated job';end if;
 if (select count(*) from public.audit_logs where action_code='cash.control.requested' and details->>'job_id'=j::text)<>1 then raise exception 'Request audit duplicated';end if;perform set_config('test.cash_job',j::text,true);
 delete from public.venues where id=current_setting('test.cash_delete')::uuid;if not found then raise exception 'Rules blocked empty venue deletion';end if;
end $$;
reset role;
do $$
declare j jsonb;jid uuid:=current_setting('test.cash_job')::uuid;f jsonb;bad jsonb;provider text:=repeat('a',64);oldlease uuid;begin
 if (select count(distinct public.sales_next_worker_lane()) from generate_series(1,14))<>7 then raise exception 'Worker lane starves';end if;
 f:=jsonb_build_array(jsonb_build_object('id',1,'shiftNumber',1,'openedAt','2000-01-03T09:00:00+03:00','closedAt',null,'terminalId','1','terminal','QA','cashier','QA','status','CLOSED','incomplete',false,'openExpected',100000,'openDeclared',100000,'closeExpected',120000,'closeDeclared',119000));
 j:=public.cash_control_claim();if j->>'id'<>jid::text then raise exception 'Claimed wrong test job';end if;
 oldlease:=(j->>'lease')::uuid;update private.cash_control_jobs set claimed_at=now()-interval '3 minutes' where id=jid;
 perform public.cash_control_fail(jid,oldlease,'Stale writer');if (select last_error from private.cash_control_jobs where id=jid) is not null then raise exception 'Expired writer changed job';end if;
 begin perform public.cash_control_save_read(jid,oldlease,f,provider);raise exception 'Expired lease saved';exception when raise_exception then if sqlerrm not like 'Чтение передано%' then raise;end if;end;
 j:=public.cash_control_claim();perform public.cash_control_save_read(jid,(j->>'lease')::uuid,f,provider);
 if exists(select 1 from public.cash_control_days where business_date='2000-01-03' and venue_id=current_setting('test.cash_v')::uuid) then raise exception 'First pass published';end if;
 j:=public.cash_control_claim();bad:=jsonb_set(f,'{0,closeDeclared}','0');
 begin perform public.cash_control_save_read(jid,(j->>'lease')::uuid,bad,provider);raise exception 'Changed second pass published';exception when raise_exception then if sqlerrm not like 'Кассовые отчёты изменились%' then raise;end if;end;
 perform public.cash_control_save_read(jid,(j->>'lease')::uuid,f,provider);
 if (select count(*) from public.cash_control_history h join public.cash_control_days d on d.id=h.day_id where d.venue_id=current_setting('test.cash_v')::uuid and d.business_date='2000-01-03')<>1 then raise exception 'Missing confirmed history';end if;
 -- Re-reading the same source must not inflate versions or generate messages.
 update private.cash_control_jobs set state='pending',phase='first' where id=jid;j:=public.cash_control_claim();perform public.cash_control_save_read(jid,(j->>'lease')::uuid,f,provider);j:=public.cash_control_claim();perform public.cash_control_save_read(jid,(j->>'lease')::uuid,f,provider);
 if (select version from public.cash_control_days where venue_id=current_setting('test.cash_v')::uuid and business_date='2000-01-03')<>1 then raise exception 'Identical source inflated version';end if;
 -- New snapshots preserve old values in history.
 update private.cash_control_jobs set state='pending',phase='first' where id=jid;j:=public.cash_control_claim();perform public.cash_control_save_read(jid,(j->>'lease')::uuid,bad,provider);j:=public.cash_control_claim();perform public.cash_control_save_read(jid,(j->>'lease')::uuid,bad,provider);
 if (select version from public.cash_control_days where venue_id=current_setting('test.cash_v')::uuid and business_date='2000-01-03')<>2 then raise exception 'Changed source not versioned';end if;
 if not exists(select 1 from public.cash_control_history h join public.cash_control_days d on d.id=h.day_id where d.venue_id=current_setting('test.cash_v')::uuid and d.business_date='2000-01-03' and h.version=1 and h.reports=f) then raise exception 'Old source lost';end if;
 -- Wrong day/source cannot replace the last confirmed result.
 update private.cash_control_jobs set state='pending',phase='first' where id=jid;j:=public.cash_control_claim();
 begin perform public.cash_control_save_read(jid,(j->>'lease')::uuid,jsonb_set(f,'{0,openedAt}','"2000-01-04T09:00:00+03:00"'),provider);raise exception 'Outside-day source accepted';exception when raise_exception then if sqlerrm not like 'Кассовая смена за пределами%' then raise;end if;end;
 begin perform public.cash_control_save_read(jid,(j->>'lease')::uuid,f||f,provider);raise exception 'Duplicate report accepted';exception when raise_exception then if sqlerrm not like 'Не подтверждён полный набор%' then raise;end if;end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.cash_viewer'),true),set_config('app.ctx_ready','0',true);
do $$ begin
 if not exists(select 1 from public.cash_control_days) or not exists(select 1 from public.cash_control_rules) or not exists(select 1 from public.cash_control_history) then raise exception 'Finance viewer cannot read cash control';end if;
 perform public.cash_control_job_status(current_setting('test.cash_v')::uuid,'2000-01-03');
 begin perform public.cash_control_save_rules(current_setting('test.cash_v')::uuid,0,current_setting('test.cash_rules')::jsonb,'QA denied');raise exception 'Viewer changed settings';exception when raise_exception then if sqlerrm not like 'Сверка поступлений доступна%' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.cash_denied'),true),set_config('app.ctx_ready','0',true);
do $$ begin
 if exists(select 1 from public.cash_control_days) or exists(select 1 from public.cash_control_rules) or exists(select 1 from public.cash_control_history) or exists(select 1 from public.audit_logs where action_code like 'cash.control.%') then raise exception 'Cash facts leaked to sales-only user';end if;
 begin perform public.cash_control_job_status(current_setting('test.cash_v')::uuid,'2000-01-03');raise exception 'Denied viewer accessed job';exception when raise_exception then if sqlerrm not like 'Нет доступа%' then raise;end if;end;
end $$;
reset role;
do $$ begin
 if exists(select 1 from public.cash_control_rules where venue_id=current_setting('test.cash_delete')::uuid) then raise exception 'Orphaned rule after venue deletion';end if;
 if current_setting('test.cash_money') is distinct from md5(jsonb_build_object('transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t),'banks',(select jsonb_agg(to_jsonb(t) order by id) from public.bank_accounts t),'accruals',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_accruals t),'adjustments',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_adjustments t),'notifications',(select jsonb_agg(to_jsonb(t) order by id) from public.notifications t))::text) then raise exception 'Cash check changed money/payroll/messages';end if;
 raise notice 'PASS: cash RLS, owner rules, retry/leases, double read, immutable history, source bounds, queue fairness, venue lifecycle, unchanged money/payroll/messages';
end $$;
rollback;
