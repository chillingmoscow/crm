-- Fines chat queue: selection rules, worker claim/finish lifecycle, access.
-- Full rollback: nothing is sent and no data is kept.
\set ON_ERROR_STOP on
begin;
do $$
declare u uuid;a uuid;v uuid;e uuid;x uuid;b uuid;bv uuid;
 before_id uuid;after_id uuid;threshold_id uuid;bonus_id uuid;w1 uuid;w2 uuid;w3 uuid;
 j jsonb;n integer;q public.payroll_adjustment_notifications;
begin
 select id into u from auth.users where email='owner@test.com';
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 -- Seeded data must never be picked up by the claims below.
 update public.payroll_adjustment_notifications set available_at=now()+interval '1 day';
 insert into public.payroll_employees(account_id,venue_id,name,role_name,opening_confirmed) values(a,v,'Fines chat QA','Test',true) returning id into e;
 insert into public.organization_telegram_settings(account_id,secret,default_chat_id,updated_by)
 values(a,'{"encrypted":"qa-only","iv":"qa","tag":"qa"}','-100111',u)
 on conflict(account_id) do update set fines_chat_id=null,fines_notify_from=null;

 -- Settings RPC: enabling stamps the start once, disabling clears it.
 perform public.payroll_save_fines_chat('-100500',true);
 if (select fines_notify_from from public.organization_telegram_settings where account_id=a) is distinct from now() then raise exception 'Enable did not set start';end if;
 update public.organization_telegram_settings set fines_notify_from=now()-interval '1 hour' where account_id=a;
 perform public.payroll_save_fines_chat('-100500',true);
 if (select fines_notify_from from public.organization_telegram_settings where account_id=a)<>now()-interval '1 hour' then raise exception 'Re-enable moved start';end if;
 begin perform public.payroll_save_fines_chat('abc',true);raise exception 'bad-chat-accepted';exception when raise_exception then if sqlerrm='bad-chat-accepted' then raise;end if;end;
 begin perform public.payroll_save_fines_chat(null,true);raise exception 'empty-chat-accepted';exception when raise_exception then if sqlerrm='empty-chat-accepted' then raise;end if;end;

 -- Entry created before the start: not queued.
 insert into public.payroll_adjustments(account_id,venue_id,employee_id,business_date,kind,amount,reason,approved,created_at)
 values(a,v,e,'2026-10-10','deduction',-100,'Before start',true,now()-interval '2 hours') returning id into before_id;
 if exists(select 1 from public.payroll_adjustment_notifications where adjustment_id=before_id) then raise exception 'Entry before start queued';end if;
 -- Entry after the start: queued as pending.
 insert into public.payroll_adjustments(account_id,venue_id,employee_id,business_date,kind,amount,reason,approved)
 values(a,v,e,'2026-10-10','deduction',-200,'After start',true) returning id into after_id;
 if not exists(select 1 from public.payroll_adjustment_notifications where adjustment_id=after_id and state='pending' and venue_id=v) then raise exception 'Entry after start not queued';end if;
 -- Unapproved entry: not queued until approved.
 insert into public.payroll_adjustments(account_id,venue_id,employee_id,business_date,kind,amount,reason,approved)
 values(a,v,e,'2026-10-10','deduction',-50,'Draft entry',false) returning id into x;
 if exists(select 1 from public.payroll_adjustment_notifications where adjustment_id=x) then raise exception 'Unapproved queued';end if;
 update public.payroll_adjustments set approved=true where id=x;
 if not exists(select 1 from public.payroll_adjustment_notifications where adjustment_id=x) then raise exception 'Approval not queued';end if;
 delete from public.payroll_adjustment_notifications where adjustment_id=x;
 -- Automatic escalation entries are not announced.
 insert into public.payroll_adjustments(account_id,venue_id,employee_id,business_date,kind,amount,reason,approved,origin,automation_key)
 values(a,v,e,'2026-10-10','deduction',-500,'Threshold QA',true,'warning_threshold','qa:fines:threshold') returning id into threshold_id;
 if exists(select 1 from public.payroll_adjustment_notifications where adjustment_id=threshold_id) then raise exception 'warning_threshold queued';end if;
 -- Bonus points: only after the external write-off is done, exactly once.
 insert into public.payroll_adjustments(account_id,venue_id,employee_id,business_date,kind,medium,amount,reason,approved,external_state)
 values(a,v,e,'2026-10-10','deduction','bonus',-300,'Bonus QA',true,'pending') returning id into bonus_id;
 if exists(select 1 from public.payroll_adjustment_notifications where adjustment_id=bonus_id) then raise exception 'Pending bonus queued';end if;
 update public.payroll_adjustments set external_state='done' where id=bonus_id;
 update public.payroll_adjustments set external_state='done' where id=bonus_id;
 if (select count(*) from public.payroll_adjustment_notifications where adjustment_id=bonus_id and state='pending')<>1 then raise exception 'Done bonus not queued once';end if;
 -- Deleting an entry cancels its pending notification.
 update public.payroll_adjustments set deleted_at=now(),delete_reason='QA delete' where id=after_id;
 if not exists(select 1 from public.payroll_adjustment_notifications where adjustment_id=after_id and state='skipped') then raise exception 'Delete not skipped';end if;

 -- Claim: warning count up to this entry in the same month, first photo, chat.
 insert into public.payroll_adjustments(account_id,venue_id,employee_id,business_date,kind,medium,amount,reason,approved,created_at)
 values(a,v,e,'2026-10-03','warning','none',0,'Warning one',true,now()-interval '30 minutes') returning id into w1;
 insert into public.payroll_adjustments(account_id,venue_id,employee_id,business_date,kind,medium,amount,reason,approved,created_at)
 values(a,v,e,'2026-10-20','warning','none',0,'Warning two',true,now()-interval '10 minutes') returning id into w2;
 insert into public.payroll_adjustments(account_id,venue_id,employee_id,business_date,kind,medium,amount,reason,approved)
 values(a,v,e,'2026-10-25','warning','none',0,'Warning three',true) returning id into w3;
 insert into public.payroll_adjustments(account_id,venue_id,employee_id,business_date,kind,medium,amount,reason,approved,created_at)
 values(a,v,e,'2026-09-28','warning','none',0,'Other month',true,now()-interval '40 minutes');
 insert into public.payroll_adjustment_photos(account_id,venue_id,employee_id,adjustment_id,storage_path,name,uploaded_by,created_at)
 values(a,v,e,w2,a||'/'||v||'/'||w2||'/second.jpg','second.jpg',u,now()),(a,v,e,w2,a||'/'||v||'/'||w2||'/first.jpg','first.jpg',u,now()-interval '1 minute');
 update public.payroll_adjustment_notifications set available_at=now()+interval '1 day' where account_id=a and adjustment_id<>w2;
 j:=public.payroll_claim_adjustment_notification();
 if j->>'adjustment_id'<>w2::text then raise exception 'Wrong row claimed: %',j;end if;
 if (j->>'warnings_in_month')::int<>2 then raise exception 'Warning count % instead of 2',j->>'warnings_in_month';end if;
 if j->>'photo_path' not like '%/first.jpg' or j->>'chat_id'<>'-100500' or j->>'employee_name'<>'Fines chat QA' then raise exception 'Claim payload wrong: %',j;end if;
 if (select state from public.payroll_adjustment_notifications where adjustment_id=w2)<>'sending' then raise exception 'Claim did not mark sending';end if;
 if public.payroll_claim_adjustment_notification() is not null then raise exception 'Sending row claimed twice';end if;

 -- Error: attempts grow, backoff least(attempts^2,60) minutes.
 perform public.payroll_finish_adjustment_notification(w2,a,null,'Telegram 500');
 select * into q from public.payroll_adjustment_notifications where adjustment_id=w2;
 if q.state<>'error' or q.attempts<>1 or q.available_at<>now()+interval '1 minute' or q.last_error<>'Telegram 500' then raise exception 'First error wrong: %',row_to_json(q);end if;
 if public.payroll_claim_adjustment_notification() is not null then raise exception 'Claimed before backoff';end if;
 update public.payroll_adjustment_notifications set available_at=now(),attempts=7 where adjustment_id=w2;
 if public.payroll_claim_adjustment_notification()->>'adjustment_id'<>w2::text then raise exception 'Error row not reclaimed';end if;
 perform public.payroll_finish_adjustment_notification(w2,a,null,'Telegram 500');
 select * into q from public.payroll_adjustment_notifications where adjustment_id=w2;
 if q.attempts<>8 or q.available_at<>now()+interval '60 minutes' then raise exception 'Backoff not capped: %',row_to_json(q);end if;
 update public.payroll_adjustment_notifications set available_at=now()-interval '1 minute' where adjustment_id=w2;
 if public.payroll_claim_adjustment_notification() is not null then raise exception 'Exhausted row claimed';end if;

 -- Stuck sending older than 10 minutes returns to error and is claimable again.
 update public.payroll_adjustment_notifications set attempts=2,available_at=now() where adjustment_id=w2;
 perform public.payroll_claim_adjustment_notification();
 update public.payroll_adjustment_notifications set claimed_at=now()-interval '9 minutes' where adjustment_id=w2;
 if public.payroll_claim_adjustment_notification() is not null then raise exception 'Fresh sending reset';end if;
 update public.payroll_adjustment_notifications set claimed_at=now()-interval '11 minutes' where adjustment_id=w2;
 j:=public.payroll_claim_adjustment_notification();
 if j->>'adjustment_id'<>w2::text or (j->>'attempts')::int<>3 then raise exception 'Stale sending not reclaimed: %',j;end if;

 -- Sent: stored message id, never claimed again.
 perform public.payroll_finish_adjustment_notification(w2,a,42,null);
 select * into q from public.payroll_adjustment_notifications where adjustment_id=w2;
 if q.state<>'sent' or q.message_id<>42 then raise exception 'Sent not stored: %',row_to_json(q);end if;
 update public.payroll_adjustment_notifications set available_at=now()-interval '1 hour',claimed_at=now()-interval '1 hour' where adjustment_id=w2;
 if public.payroll_claim_adjustment_notification() is not null then raise exception 'Sent row claimed again';end if;
 perform public.payroll_finish_adjustment_notification(w2,a,null,'Late error');
 if (select state from public.payroll_adjustment_notifications where adjustment_id=w2)<>'sent' then raise exception 'Finish overwrote sent';end if;

 -- Disabled chat: due rows are skipped instead of sent.
 update public.payroll_adjustment_notifications set available_at=now() where adjustment_id=w1;
 perform public.payroll_save_fines_chat(null,false);
 if (select fines_notify_from from public.organization_telegram_settings where account_id=a) is not null then raise exception 'Disable kept start';end if;
 if public.payroll_claim_adjustment_notification() is not null then raise exception 'Claimed while disabled';end if;
 if (select state from public.payroll_adjustment_notifications where adjustment_id=w1)<>'skipped' then raise exception 'Disabled row not skipped';end if;

 -- Grants: worker RPC and queue writes are service-role only.
 if has_function_privilege('authenticated','public.payroll_claim_adjustment_notification()','execute')
    or has_function_privilege('anon','public.payroll_finish_adjustment_notification(uuid,uuid,bigint,text)','execute')
    or has_function_privilege('authenticated','public.payroll_finish_adjustment_notification(uuid,uuid,bigint,text)','execute')
    or has_function_privilege('anon','public.payroll_save_fines_chat(text,boolean)','execute')
    or has_table_privilege('authenticated','public.payroll_adjustment_notifications','insert')
    or has_table_privilege('authenticated','public.payroll_adjustment_notifications','update') then raise exception 'Unsafe grants';end if;

 -- Owner of another organization, with payroll rights there.
 x:=gen_random_uuid();b:=gen_random_uuid();bv:=gen_random_uuid();
 insert into auth.users(id,aud,role,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values(x,'authenticated','authenticated','fines-qa-'||x||'@qa.invalid','{}','{}',now(),now());
 insert into public.profiles(id,first_name) values(x,'QA') on conflict(id) do nothing;
 insert into public.accounts(id,name,owner_id) values(b,'Fines QA other',x);
 insert into public.venues(id,account_id,name,type) values(bv,b,'Fines QA venue','restaurant');
 update public.profiles set active_venue_id=bv where id=x;
 insert into public.user_venue_roles(user_id,venue_id,role_id,status) select x,bv,id,'active' from public.roles where code='owner' and venue_id is null
 on conflict(user_id,venue_id) do update set role_id=excluded.role_id,status='active';
 begin perform set_config('request.jwt.claim.sub',x::text,true);perform set_config('app.ctx_ready','0',true);
  perform public.payroll_save_fines_chat('-100999',true);raise exception 'foreign-save-accepted';
 exception when raise_exception then if sqlerrm='foreign-save-accepted' then raise;end if;end;
 perform set_config('test.fines_owner',u::text,true);perform set_config('test.fines_other',x::text,true);
 raise notice 'setup and worker lifecycle passed';
end $$;
-- RLS: the owner sees own queue, another organization sees nothing.
set local role authenticated;
do $$begin
 perform set_config('request.jwt.claim.sub',current_setting('test.fines_owner'),true);perform set_config('app.ctx_ready','0',true);
 if (select count(*) from public.payroll_adjustment_notifications)=0 then raise exception 'Owner sees no queue';end if;
 perform set_config('request.jwt.claim.sub',current_setting('test.fines_other'),true);perform set_config('app.ctx_ready','0',true);
 if (select count(*) from public.payroll_adjustment_notifications)<>0 then raise exception 'Foreign account sees queue';end if;
 raise notice 'PASS: fines chat queue selection, claim/finish lifecycle, backoff, stale sending, settings and access';
end $$;
reset role;
rollback;
