-- All CRM fixtures roll back; never calls a provider or sends a message.
begin;
do $$
declare u uuid;a uuid;v uuid;x uuid;r uuid;outcome jsonb;request uuid:=gen_random_uuid();before_hash text;begin
 select id into u from auth.users where email='owner@test.com';perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);a:=public.get_active_account_id();v:=public.get_active_venue_id();
 perform set_config('test.crm_a',a::text,true);perform set_config('test.crm_v',v::text,true);perform set_config('test.crm_u',u::text,true);
 before_hash:=md5(jsonb_build_object('tx',(select jsonb_agg(to_jsonb(t)order by id)from public.transactions t),'banks',(select jsonb_agg(to_jsonb(t)order by id)from public.bank_accounts t),'salary',(select jsonb_agg(to_jsonb(t)order by id)from public.payroll_accruals t),'notifications',(select jsonb_agg(to_jsonb(t)order by id)from public.notifications t))::text);perform set_config('test.crm_protected',before_hash,true);
 outcome:=public.crm_guest_command(v,'create',null,0,request,'{"name":"QA CRM guest","contacts":"QA private contact","note":"QA private note","day":29,"month":2,"year":2000}','QA create');
 perform set_config('test.crm_id',outcome->>'id',true);
 if public.crm_guest_command(v,'create',null,0,request,'{"name":"QA CRM guest","contacts":"QA private contact","note":"QA private note","day":29,"month":2,"year":2000}','QA create') is distinct from outcome then raise exception 'Guest retry changed result';end if;
 if(select count(*)from private.crm_guest_history where guest_id=(outcome->>'id')::uuid)<>1 then raise exception 'Guest retry duplicated history';end if;
 outcome:=public.crm_guest_command(v,'update',(outcome->>'id')::uuid,1,gen_random_uuid(),'{"name":"QA manual name"}','QA update');
 begin perform public.crm_guest_command(v,'update',(outcome->>'id')::uuid,1,gen_random_uuid(),'{"name":"Lost edit"}','QA stale');raise exception 'Stale guest edit accepted';exception when raise_exception then if sqlerrm not like 'Карточка уже изменилась%' then raise;end if;end;
 begin perform public.crm_guest_command(v,'update',(outcome->>'id')::uuid,2,gen_random_uuid(),'{"day":31,"month":2}','QA impossible birthday');raise exception 'Invalid birthday accepted';exception when raise_exception then if sqlerrm not like 'Проверьте дату рождения%' then raise;end if;end;
 perform public.crm_guest_command(v,'archive',(outcome->>'id')::uuid,2,gen_random_uuid(),'{}','QA archive');
 perform public.crm_guest_command(v,'restore',(outcome->>'id')::uuid,3,gen_random_uuid(),'{}','QA restore');
 if private.crm_next_birthday(29,2,'2025-03-01')<>'2028-02-29'::date then raise exception 'Leap birthday invented';end if;
 insert into public.roles(venue_id,name,code) values(v,'CRM list QA','crm_list_qa') returning id into r;
 insert into public.role_permissions(role_id,permission_id,granted)select r,id,true from public.permissions where code in ('crm.view_guests','crm.manage_guests','org.view_audit');
 x:=gen_random_uuid();insert into auth.users(id,aud,role,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)values(x,'authenticated','authenticated','crm-viewer-'||x||'@qa.invalid','{}','{}',now(),now());
 insert into public.profiles(id,first_name,active_venue_id)values(x,'QA',v)on conflict(id)do update set active_venue_id=v;
 insert into public.user_venue_roles(user_id,venue_id,role_id,status)values(x,v,r,'active');
 perform set_config('request.jwt.claim.sub',x::text,true);perform set_config('app.ctx_ready','0',true);
end $$;
set local role authenticated;
do $$declare v uuid:=current_setting('test.crm_v')::uuid;x jsonb;begin
 x:=public.crm_guest_list(v,'QA manual name');if(x->>'total')::integer<>1 then raise exception 'Guest list lost native record';end if;
 if x->'rows'->0->'data'?'contacts' or x->'rows'->0->'data'?'note' then raise exception 'List leaked contact/preferences';end if;
 x:=public.crm_guest_detail(v,current_setting('test.crm_id')::uuid);
 if x->'data'?'contacts' or x->'history'->0?'before_data' then raise exception 'List-only viewer read details/history';end if;
 if(public.crm_guest_list(v,'QA private contact')->>'total')::integer<>0 then raise exception 'Private contact leaked through search';end if;
 begin perform public.crm_guest_command(v,'update',current_setting('test.crm_id')::uuid,4,gen_random_uuid(),'{"name":"Denied"}','QA denied');raise exception 'Writer without detail permission changed card';exception when raise_exception then if sqlerrm<>'Нет доступа к гостям' then raise;end if;end;
 begin perform public.crm_guest_list(gen_random_uuid());raise exception 'Cross-venue guest list accepted';exception when raise_exception then if sqlerrm not like 'Заведение изменилось%' then raise;end if;end;
 if has_table_privilege('authenticated','private.crm_guests','select') or has_table_privilege('service_role','private.crm_guest_history','select') or has_function_privilege('authenticated','public.crm_guest_publish(uuid,uuid,jsonb,text,jsonb,jsonb)','execute') then raise exception 'Unsafe guest grants';end if;
end $$;
reset role;
do $$
declare a uuid:=current_setting('test.crm_a')::uuid;v uuid:=current_setting('test.crm_v')::uuid;provider text;facts jsonb;j uuid;lease uuid;outcome jsonb;h integer;expected_version integer;begin
 perform set_config('request.jwt.claim.sub','',true);perform set_config('app.ctx_ready','0',true);
 update private.crm_guests set qr_id=900000001 where id=current_setting('test.crm_id')::uuid;
 provider:=private.finance_execution_provider(a,v);select coalesce(max(version),0)+1 into expected_version from private.crm_guest_sources where venue_id=v;
 facts:=jsonb_build_array(jsonb_build_object('id',900000001,'name','QA changed source name','contacts','QR changed contact','groupId',null,'groupTitle',null,'discountPercent',null,'day',1,'month',1,'year',1990,'issues','[]'::jsonb));
 lease:=gen_random_uuid();insert into private.crm_guest_jobs(account_id,venue_id,state,phase,cursor,payload,request,lease,claimed_at)
 select a,v,'running','verify',1,jsonb_build_object('provider',provider,'first',facts,'second',facts,'groups','[]'::jsonb,'verifiedGroups','[]'::jsonb),jsonb_build_object('timezone',timezone,'dayStartHour',day_start_hour),lease,now() from public.sales_settings where venue_id=v returning id into j;
 outcome:=public.crm_guest_publish(j,lease,facts,provider,'[]','[]');
 if outcome->>'rows'<>'1' then raise exception 'Confirmed guest source not published';end if;
 if(select(source_data||local_data)->>'name' from private.crm_guests where id=current_setting('test.crm_id')::uuid)<>'QA manual name' or(select(source_data||local_data)->>'contacts' from private.crm_guests where id=current_setting('test.crm_id')::uuid)<>'QA private contact' then raise exception 'Source overwrote manual profile';end if;
 select count(*)into h from private.crm_guest_history where guest_id=current_setting('test.crm_id')::uuid;
 lease:=gen_random_uuid();insert into private.crm_guest_jobs(account_id,venue_id,state,phase,cursor,payload,request,lease,claimed_at)
 select a,v,'running','verify',1,jsonb_build_object('provider',provider,'first',facts,'second',facts,'groups','[]'::jsonb,'verifiedGroups','[]'::jsonb),jsonb_build_object('timezone',timezone,'dayStartHour',day_start_hour),lease,now() from public.sales_settings where venue_id=v returning id into j;
 outcome:=public.crm_guest_publish(j,lease,facts,provider,'[]','[]');
 if outcome->>'version'<>expected_version::text or(select count(*)from private.crm_guest_history where guest_id=current_setting('test.crm_id')::uuid)<>h then raise exception 'Identical guest read duplicated versions';end if;
 perform set_config('request.jwt.claim.sub',current_setting('test.crm_u'),true);perform set_config('app.ctx_ready','0',true);
 if public.crm_guest_detail(v,current_setting('test.crm_id')::uuid)->'data'->>'contacts'<>'QA private contact' then raise exception 'Owner lost guest details';end if;
 perform public.crm_guest_import_legacy(v,provider,current_setting('test.crm_u')::uuid,jsonb_build_array(jsonb_build_object('legacyId','qa-glide-crm','qrId',900000001,'patch',jsonb_build_object('name','QA legacy name','work','QA legacy work'),'legacyData',jsonb_build_object('group','Platinum','discount',20),'reason','Прежние условия Glide: Platinum, 20%. Действующие условия — Quick Resto.')),'[{"guestId":900000001,"joinedAt":"2026-10-01T00:00:00Z"}]');
 h:=(select count(*)from private.crm_guest_history where guest_id=current_setting('test.crm_id')::uuid);
 outcome:=public.crm_guest_import_legacy(v,provider,current_setting('test.crm_u')::uuid,jsonb_build_array(jsonb_build_object('legacyId','qa-glide-crm','qrId',900000001,'patch',jsonb_build_object('name','QA legacy name','work','QA legacy work'),'legacyData',jsonb_build_object('group','Platinum','discount',20),'reason','Прежние условия Glide: Platinum, 20%. Действующие условия — Quick Resto.')),'[{"guestId":900000001,"joinedAt":"2026-10-01T00:00:00Z"}]');
 if outcome->>'skipped'<>'1'or(select count(*)from private.crm_guest_history where guest_id=current_setting('test.crm_id')::uuid)<>h or public.crm_guest_detail(v,current_setting('test.crm_id')::uuid)->'data'->>'name'<>'QA manual name'then raise exception 'Legacy replay changed guest/manual fields';end if;
 if has_function_privilege('authenticated','public.crm_guest_import_legacy(uuid,text,uuid,jsonb,jsonb)','execute')then raise exception 'Legacy import exposed';end if;
 if current_setting('test.crm_protected')is distinct from md5(jsonb_build_object('tx',(select jsonb_agg(to_jsonb(t)order by id)from public.transactions t),'banks',(select jsonb_agg(to_jsonb(t)order by id)from public.bank_accounts t),'salary',(select jsonb_agg(to_jsonb(t)order by id)from public.payroll_accruals t),'notifications',(select jsonb_agg(to_jsonb(t)order by id)from public.notifications t))::text)then raise exception 'Guest CRM changed protected data';end if;
 raise notice 'PASS: private guest projections, scoped CRUD/archive/restore/history, exact request replay, stale edits, partial birthday/leap handling, source preserves manual data, unchanged money/payroll/messages';
end $$;
rollback;
