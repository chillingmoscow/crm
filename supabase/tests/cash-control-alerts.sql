-- Controlled local fixtures, full rollback; no external delivery or money writes.
begin;
do $$
declare u uuid;a uuid;v uuid;r uuid;x uuid;idx integer;cfg jsonb;n integer;rule uuid;d date;tz text;hour integer;begin
 select id into u from auth.users where email='owner@test.com';
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 perform set_config('test.alert_a',a::text,true);perform set_config('test.alert_v',v::text,true);perform set_config('test.alert_owner',u::text,true);
 perform set_config('test.alert_money',md5(jsonb_build_object('transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t),'banks',(select jsonb_agg(to_jsonb(t) order by id) from public.bank_accounts t),'accruals',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_accruals t),'adjustments',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_adjustments t))::text),true);
 -- One finance-only user, one sales-only user, one fired finance user.
 for idx in 1..3 loop
  insert into public.roles(venue_id,name,code) values(v,'Cash alert QA '||idx,'cash_alert_qa_'||idx) returning id into r;
  insert into public.role_permissions(role_id,permission_id,granted) select r,id,true from public.permissions where code=case when idx=2 then 'sales.view_shifts' else 'finance.view_transactions' end;
  x:=gen_random_uuid();
  insert into auth.users(id,aud,role,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values(x,'authenticated','authenticated','cash-alert-'||x||'@qa.invalid','{}','{}',now(),now());
  insert into public.profiles(id,first_name,active_venue_id) values(x,'QA alert '||idx,v) on conflict(id) do update set active_venue_id=v;
  insert into public.user_venue_roles(user_id,venue_id,role_id,status,fired_at) values(x,v,r,'active',case when idx=3 then now() else null end);
  perform set_config('test.alert_user'||idx,x::text,true);
 end loop;
 cfg:='{"thresholdCents":100,"opening":true,"closing":true,"autoRead":false,"intervalMinutes":60}';
 select coalesce(max(version),0) into n from public.cash_control_rules where venue_id=v;
 rule:=public.cash_control_save_rules(v,n,cfg,'QA legacy notification defaults');
 if public.cash_control_save_rules(v,n,cfg,'QA legacy notification defaults')<>rule or (select config->'notifyFinance' from public.cash_control_rules where id=rule)<>'false' then raise exception 'Legacy settings not safely idempotent';end if;
 update public.cash_control_rules set created_at=now()-interval '2 days' where id=rule;
 begin perform public.cash_control_save_rules(v,n+1,cfg||'{"notifyFinance":"true"}','QA invalid');raise exception 'Invalid notification flag accepted';exception when raise_exception then if sqlerrm not like 'Проверьте порог%' then raise;end if;end;
 begin perform public.cash_control_save_rules(v,n+1,cfg||'{"notificationAudience":"everyone"}','QA invalid audience');raise exception 'Invalid audience accepted';exception when raise_exception then if sqlerrm not like 'Выберите получателей%' then raise;end if;end;
 rule:=public.cash_control_save_rules(v,n+1,cfg||'{"notifyFinance":true}','QA notifications enabled');
 update public.cash_control_rules set created_at=now()-interval '1 day' where id=rule;
 perform set_config('test.alert_rule',rule::text,true);
 select timezone,day_start_hour into tz,hour from public.sales_settings where account_id=a and venue_id=v;
 begin perform public.cash_control_request(v,(now() at time zone tz)::date+1);raise exception 'Future day accepted';exception when raise_exception then if sqlerrm not like 'Выберите текущий%' then raise;end if;end;
 d:=(((now()-interval '10 minutes') at time zone tz)-make_interval(hours=>hour))::date;
 update private.cash_control_jobs set state='ready',next_retry_at=now()+interval '1 day';
 update public.sales_settings set provider_retry_at=null where account_id=a;
 perform set_config('test.alert_job',public.cash_control_request(v,d)::text,true);
 perform set_config('test.alert_date',d::text,true);
 perform set_config('test.alert_before',(select count(*)::text from public.notifications where type='finance.cash_discrepancy'),true);
end $$;

create function pg_temp.cash_alert_read(f jsonb) returns void language plpgsql as $$
declare j jsonb;jid uuid:=current_setting('test.alert_job')::uuid;begin
 update private.cash_control_jobs set state='pending',phase='first',next_retry_at=now(),candidate=null where id=jid;
 j:=public.cash_control_claim();if j->>'id'<>jid::text then raise exception 'Wrong alert job';end if;
 perform public.cash_control_save_read(jid,(j->>'lease')::uuid,f,repeat('a',64));
 j:=public.cash_control_claim();perform public.cash_control_save_read(jid,(j->>'lease')::uuid,f,repeat('a',64));
end $$;
do $$
declare f jsonb;base jsonb;j jsonb;jid uuid:=current_setting('test.alert_job')::uuid;dayid uuid;before_n integer:=current_setting('test.alert_before')::integer;begin
 base:=jsonb_build_object('id',987654321,'shiftNumber',1,'openedAt',now()-interval '10 minutes','closedAt',now()-interval '5 minutes','terminalId','qa','terminal','Касса QA','cashier','QA','status','CLOSED','incomplete',false,'openExpected',100000,'openDeclared',99800,'closeExpected',100000,'closeDeclared',100300);
 f:=jsonb_build_array(base,base||'{"id":987654322,"openDeclared":99900,"closeDeclared":100000}',base||'{"id":987654323,"incomplete":true}',base||'{"id":987654324,"status":"OPENED","closedAt":null,"closeExpected":null,"closeDeclared":null,"openDeclared":null}');
 perform set_config('test.alert_reports',f::text,true);
 j:=public.cash_control_claim();perform public.cash_control_save_read(jid,(j->>'lease')::uuid,f,repeat('a',64));
 if (select count(*) from public.notifications where type='finance.cash_discrepancy')<>before_n then raise exception 'Unconfirmed first read notified';end if;
 j:=public.cash_control_claim();dayid:=public.cash_control_save_read(jid,(j->>'lease')::uuid,f,repeat('a',64));
 perform set_config('test.alert_day',dayid::text,true);
 if (select count(*) from private.cash_control_alert_events where day_id=dayid)<>2 then raise exception 'Threshold, incomplete or open report eligibility incorrect';end if;
 if (select count(*) from public.notifications where entity_id in(select id from private.cash_control_alert_events where day_id=dayid) and user_id=current_setting('test.alert_owner')::uuid)<>2 then raise exception 'Owner delivery missing/duplicated';end if;
 if (select count(*) from public.notifications where entity_id in(select id from private.cash_control_alert_events where day_id=dayid) and user_id=current_setting('test.alert_user1')::uuid and link is null and category='finance' and pushed_at is not null)<>2 then raise exception 'Finance-only delivery or in-app-only channel incorrect';end if;
 if exists(select 1 from public.notifications where entity_id in(select id from private.cash_control_alert_events where day_id=dayid) and user_id in(current_setting('test.alert_user2')::uuid,current_setting('test.alert_user3')::uuid)) then raise exception 'Sales-only/fired user notified';end if;
 if exists(select 1 from private.cash_control_alert_events where day_id=dayid and (rule_id<>current_setting('test.alert_rule')::uuid or threshold_cents<>100 or source_version<1)) then raise exception 'Decision provenance lost';end if;
 if exists(select 1 from public.notifications where entity_id in(select id from private.cash_control_alert_events where day_id=dayid) and body not like '%Расчёт:%указано:%') then raise exception 'Finance-only notification lacks amounts';end if;
 before_n:=(select count(*) from public.notifications where type='finance.cash_discrepancy');
 perform pg_temp.cash_alert_read(f);
 update private.cash_control_alert_events set created_at=now()-interval '30 days' where day_id=dayid;
 perform pg_temp.cash_alert_read(jsonb_set(f,'{0,openDeclared}','99000'));
 if (select count(*) from public.notifications where type='finance.cash_discrepancy')<>before_n then raise exception 'Repeat/correction created another notification';end if;
 -- A new rule does not send historical source events, even newly discovered IDs.
 update public.cash_control_rules set created_at=now() where id=current_setting('test.alert_rule')::uuid;
 perform pg_temp.cash_alert_read(f||jsonb_build_array(base||'{"id":987654325}'));
 if (select count(*) from public.notifications where type='finance.cash_discrepancy')<>before_n then raise exception 'Archive replayed after enabling';end if;
 update public.cash_control_rules set config=jsonb_set(config,'{notifyFinance}','false'),created_at=now()-interval '1 day' where id=current_setting('test.alert_rule')::uuid;
 perform pg_temp.cash_alert_read(f||jsonb_build_array(base||'{"id":987654326}'));
 if (select count(*) from public.notifications where type='finance.cash_discrepancy')<>before_n then raise exception 'Disabled notification delivered';end if;
 perform set_config('test.alert_count',before_n::text,true);
 if has_function_privilege('authenticated','private.cash_control_notify_confirmed()','execute') or has_function_privilege('anon','public.cash_control_notification_visible(uuid)','execute') or has_table_privilege('service_role','private.cash_control_alert_events','insert') then raise exception 'Unsafe notification grants';end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.alert_user1'),true),set_config('app.ctx_ready','0',true);
do $$ begin
 if (select count(*) from public.notifications where entity_id in(select entity_id from public.notifications where type='finance.cash_discrepancy'))<>2 then raise exception 'Finance-only recipient cannot see own notifications';end if;
 if public.cash_control_notification_visible(gen_random_uuid()) then raise exception 'Foreign venue visible';end if;
end $$;
reset role;
update public.role_permissions set granted=false where role_id in(select role_id from public.user_venue_roles where user_id=current_setting('test.alert_user1')::uuid) and permission_id in(select id from public.permissions where code='finance.view_transactions');
set local role authenticated;
do $$ begin
 if public.cash_control_notification_visible(current_setting('test.alert_v')::uuid) or exists(select 1 from public.notifications where type='finance.cash_discrepancy') then raise exception 'Revoked finance permission retained notification access';end if;
end $$;
reset role;
-- A failed local delivery must roll back its event and source history, so a
-- retry can deliver once rather than silently lose the notification.
create function pg_temp.cash_alert_abort() returns trigger language plpgsql as $$ begin
 if new.type='finance.cash_discrepancy' then raise exception using errcode='PZ009',message='QA notification failure';end if;return new;
end $$;
create trigger cash_alert_qa_abort before insert on public.notifications for each row execute function pg_temp.cash_alert_abort();
do $$
declare f jsonb:=(current_setting('test.alert_reports')::jsonb)||jsonb_build_array((current_setting('test.alert_reports')::jsonb->0)||'{"id":987654327}');j jsonb;before_n integer;before_version integer;jid uuid:=current_setting('test.alert_job')::uuid;begin
 update public.cash_control_rules set config=config||'{"notifyFinance":true,"notificationAudience":"owner"}',created_at=now()-interval '1 day' where id=current_setting('test.alert_rule')::uuid;
 update public.role_permissions set granted=true where role_id in(select role_id from public.user_venue_roles where user_id=current_setting('test.alert_user1')::uuid) and permission_id in(select id from public.permissions where code='finance.view_transactions');
 select count(*) into before_n from public.notifications where type='finance.cash_discrepancy';
 select version into before_version from public.cash_control_days where id=current_setting('test.alert_day')::uuid;
 update private.cash_control_jobs set state='pending',phase='first',next_retry_at=now(),candidate=null where id=jid;
 j:=public.cash_control_claim();perform public.cash_control_save_read(jid,(j->>'lease')::uuid,f,repeat('a',64));j:=public.cash_control_claim();
 begin perform public.cash_control_save_read(jid,(j->>'lease')::uuid,f,repeat('a',64));raise exception 'Delivery failure ignored';exception when sqlstate 'PZ009' then null;end;
 if (select count(*) from public.notifications where type='finance.cash_discrepancy')<>before_n or exists(select 1 from private.cash_control_alert_events where day_id=current_setting('test.alert_day')::uuid and report_id=987654327) or (select version from public.cash_control_days where id=current_setting('test.alert_day')::uuid)<>before_version then raise exception 'Failed notification partially committed';end if;
 drop trigger cash_alert_qa_abort on public.notifications;
 perform public.cash_control_save_read(jid,(j->>'lease')::uuid,f,repeat('a',64));
 if (select count(*) from private.cash_control_alert_events where day_id=current_setting('test.alert_day')::uuid and report_id=987654327)<>2 then raise exception 'Delivery not recovered after rollback';end if;
 if (select count(*) from public.notifications where entity_id in(select id from private.cash_control_alert_events where day_id=current_setting('test.alert_day')::uuid and report_id=987654327))<>2 or exists(select 1 from public.notifications where entity_id in(select id from private.cash_control_alert_events where day_id=current_setting('test.alert_day')::uuid and report_id=987654327) and user_id<>current_setting('test.alert_owner')::uuid) then raise exception 'Owner-only audience ignored';end if;
end $$;
-- Unrelated edits must not reset the current activation period or rewrite
-- the threshold that applied to an event still waiting for its first read.
do $$
declare v uuid:=current_setting('test.alert_v')::uuid;c jsonb;n integer;f jsonb;rid uuid;before_n integer;begin
 perform set_config('request.jwt.claim.sub',current_setting('test.alert_owner'),true);perform set_config('app.ctx_ready','0',true);
 select config,version into c,n from public.cash_control_rules where venue_id=v order by version desc limit 1;
 rid:=public.cash_control_save_rules(v,n,c||'{"intervalMinutes":120,"thresholdCents":999999}','QA interval/threshold edit before delayed read');
 select reports into f from public.cash_control_days where id=current_setting('test.alert_day')::uuid;
 f:=f||jsonb_build_array((f->0)||'{"id":987654328}');perform pg_temp.cash_alert_read(f);
 if (select count(*) from private.cash_control_alert_events where day_id=current_setting('test.alert_day')::uuid and report_id=987654328 and rule_id=current_setting('test.alert_rule')::uuid and threshold_cents=100)<>2 then raise exception 'Settings edit lost pending event or changed its historical threshold';end if;
 -- Disabling and enabling begins a new period; the former period is not replayed.
 rid:=public.cash_control_save_rules(v,n+1,c||'{"notifyFinance":false}','QA notifications off');
 rid:=public.cash_control_save_rules(v,n+2,c||'{"notifyFinance":true}','QA notifications back on');
 before_n:=(select count(*) from public.notifications where type='finance.cash_discrepancy');
 perform pg_temp.cash_alert_read(f||jsonb_build_array((f->0)||'{"id":987654329}'));
 if exists(select 1 from private.cash_control_alert_events where day_id=current_setting('test.alert_day')::uuid and report_id=987654329) or (select count(*) from public.notifications where type='finance.cash_discrepancy')<>before_n then raise exception 'Re-enabled period replayed former events';end if;
end $$;
do $$ begin
 if current_setting('test.alert_money') is distinct from md5(jsonb_build_object('transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t),'banks',(select jsonb_agg(to_jsonb(t) order by id) from public.bank_accounts t),'accruals',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_accruals t),'adjustments',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_adjustments t))::text) then raise exception 'Alerts changed financial or payroll data';end if;
 raise notice 'PASS: confirmed-only in-app alerts, owner/finance audience, live permission revocation, permanent deduplication, thresholds, no archive replay, unchanged finances/payroll';
end $$;
rollback;
