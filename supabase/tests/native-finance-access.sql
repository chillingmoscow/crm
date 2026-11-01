-- Full rollback: no external calls and no financial operations.
begin;
do $$
declare u uuid;a uuid;v uuid;r uuid;x uuid;run uuid:=gen_random_uuid();rule uuid:=gen_random_uuid();begin
 select id into u from auth.users where email='owner@test.com';
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 perform set_config('test.access_venue',v::text,true);perform set_config('test.access_rule',rule::text,true);
 insert into public.finance_execution_runs(id,account_id,venue_id,kind,business_date,source_hash,rule_id,policy_version,snapshot,plan,state)
 values(run,a,v,'movements','2000-01-05','QA',rule,1,'{}','{}','committed');
 insert into public.roles(venue_id,name,code) values(v,'Native finance viewer QA','native_finance_viewer_qa') returning id into r;
 insert into public.role_permissions(role_id,permission_id,granted) select r,id,true from public.permissions where code in ('sales.view_shifts','finance.view_transactions','org.view_audit');
 x:=gen_random_uuid();
 insert into auth.users(id,aud,role,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values(x,'authenticated','authenticated','native-viewer-'||x||'@qa.invalid','{}','{}',now(),now());
 insert into public.profiles(id,first_name,active_venue_id) values(x,'QA',v) on conflict(id) do update set active_venue_id=v;
 insert into public.user_venue_roles(user_id,venue_id,role_id,status) values(x,v,r,'active');
 perform set_config('request.jwt.claim.sub',x::text,true);perform set_config('app.ctx_ready','0',true);
end $$;
set local role authenticated;
do $$declare v uuid:=current_setting('test.access_venue')::uuid;begin
 if exists(select 1 from public.finance_execution_runs) or exists(select 1 from public.finance_execution_rules) then raise exception 'Viewer read owner snapshots';end if;
 if public.finance_execution_day_rule(v,'2000-01-05','movements') is distinct from current_setting('test.access_rule')::uuid then raise exception 'Viewer cannot compare posted rules';end if;
 begin perform public.finance_save_execution_rules(v,0,false,null,true,true,false,'QA denied');raise exception 'Viewer changed owner policy';exception when raise_exception then if sqlerrm not like 'Сверка поступлений доступна владельцу%' then raise;end if;end;
 begin perform public.finance_retry_execution(v,'2000-01-05','movements');raise exception 'Viewer requested write';exception when raise_exception then if sqlerrm not like 'Сверка поступлений доступна владельцу%' then raise;end if;end;
 begin perform public.finance_execution_day_rule(gen_random_uuid(),'2000-01-05','movements');raise exception 'Foreign venue exposed';exception when raise_exception then if sqlerrm not like 'Заведение изменилось%' then raise;end if;end;
 if has_function_privilege('anon','public.finance_execution_day_rule(uuid,date,text)','execute') or has_table_privilege('authenticated','public.finance_execution_rules','insert') or has_table_privilege('authenticated','private.finance_execution_jobs','select') then raise exception 'Unsafe public financial grants';end if;
 raise notice 'PASS: viewer comparisons without raw snapshots, owner-only policies/retries, cross-venue scope and closed writer APIs';
end $$;
reset role;
rollback;
