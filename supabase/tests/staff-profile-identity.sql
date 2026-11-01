\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
select ('e1e10000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
 case when n=2 then 'payroll-e1e10000-0000-4000-8000-000000000002@sheerly.invalid' else 'identity-qa-'||n||'@example.com' end,
 case when n=2 then null else now() end,
 case when n=3 then '{"needs_password_setup":true}'::jsonb when n=6 then '{"role":"owner","is_owner":true}'::jsonb else '{}'::jsonb end,
 case when n=3 then '{"candidate_hire_id":"identity-qa"}'::jsonb else '{}'::jsonb end,
 case when n=2 then null else now()-interval '1 year' end,now() from generate_series(1,7)n;
update auth.users set banned_until='infinity',encrypted_password='',confirmation_token=null,recovery_token=null,raw_user_meta_data='{"needs_password_setup":"true"}'
where id='e1e10000-0000-4000-8000-000000000002';
insert into public.accounts(id,name,owner_id) values
 ('e1e10000-0000-4000-8001-000000000001','Identity QA','e1e10000-0000-4000-8000-000000000001'),
 ('e1e10000-0000-4000-8001-000000000002','Foreign identity QA','e1e10000-0000-4000-8000-000000000005');
insert into public.venues(id,account_id,name,timezone) values
 ('e1e10000-0000-4000-8002-000000000001','e1e10000-0000-4000-8001-000000000001','Identity venue QA','Europe/Moscow'),
 ('e1e10000-0000-4000-8002-000000000002','e1e10000-0000-4000-8001-000000000001','Other venue QA','Europe/Moscow'),
 ('e1e10000-0000-4000-8002-000000000003','e1e10000-0000-4000-8001-000000000002','Foreign venue QA','Europe/Moscow');
insert into public.roles(id,venue_id,name,code) values
 ('e1e10000-0000-4000-8003-000000000001','e1e10000-0000-4000-8002-000000000001','Identity QA without permission','identity_qa');
delete from public.role_permissions where role_id='e1e10000-0000-4000-8003-000000000001';
insert into public.user_venue_roles(user_id,venue_id,role_id,status)
select ('e1e10000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('e1e10000-0000-4000-8002-'||lpad(case when n=4 then '2' when n=5 then '3' else '1' end,12,'0'))::uuid,
 case when n=6 then 'e1e10000-0000-4000-8003-000000000001'::uuid else (select id from public.roles where code='owner' and venue_id is null limit 1) end,
 case when n in (3,7) then 'fired' else 'active' end from generate_series(1,7)n;
update public.profiles set active_venue_id='e1e10000-0000-4000-8002-000000000001' where id in ('e1e10000-0000-4000-8000-000000000001','e1e10000-0000-4000-8000-000000000006','e1e10000-0000-4000-8000-000000000007');
create temp table identity_auth_before on commit drop as select id,to_jsonb(u) as snapshot from auth.users u where id::text like 'e1e10000-%';

set local role authenticated;
select set_config('request.jwt.claim.sub','e1e10000-0000-4000-8000-000000000001',true),set_config('app.ctx_ready','0',true);
do $$declare identity jsonb;begin
 identity:=public.get_staff_profile_identity('e1e10000-0000-4000-8000-000000000002');
 if identity is null or identity->>'id'<>'e1e10000-0000-4000-8000-000000000002' or identity->>'email_confirmed'<>'false'
   or identity->>'created_at' is not null or identity->>'from_candidate'<>'false' or identity->>'needs_password_setup'<>'false'
 then raise exception 'Legacy placeholder with infinite ban / NULL Auth fields is unreadable';end if;
 if identity - array['id','email','email_confirmed','needs_password_setup','from_candidate','created_at']<>'{}'::jsonb then raise exception 'Unexpected Auth data exposed';end if;
 identity:=public.get_staff_profile_identity('e1e10000-0000-4000-8000-000000000003');
 if identity->>'email_confirmed'<>'true' or identity->>'needs_password_setup'<>'true' or identity->>'from_candidate'<>'true' or identity->>'created_at' is null then raise exception 'Fired/registered staff metadata lost';end if;
 if public.get_staff_profile_identity('e1e10000-0000-4000-8000-000000000004') is not null
   or public.get_staff_profile_identity('e1e10000-0000-4000-8000-000000000005') is not null
   or public.get_staff_profile_identity('e1e10000-0000-4000-8000-000000000099') is not null
 then raise exception 'Identity leaked across venue/account or invented for absent user';end if;
end $$;
select set_config('request.jwt.claim.sub','e1e10000-0000-4000-8000-000000000006',true),set_config('app.ctx_ready','0',true);
do $$begin
 begin perform public.get_staff_profile_identity('e1e10000-0000-4000-8000-000000000002');raise exception 'Permission bypass via user metadata';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','e1e10000-0000-4000-8000-000000000007',true),set_config('app.ctx_ready','0',true);
do $$begin
 begin perform public.get_staff_profile_identity('e1e10000-0000-4000-8000-000000000002');raise exception 'Inactive caller can read identity';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$begin
 if has_function_privilege('anon','public.get_staff_profile_identity(uuid)','EXECUTE') then raise exception 'Anonymous identity access';end if;
 if exists(select 1 from identity_auth_before b join auth.users u using(id) where b.snapshot is distinct from to_jsonb(u)) then raise exception 'Reading HR identity changed Auth/login data';end if;
end $$;
rollback;
\echo Staff identity: legacy Auth, metadata, fired staff, venue/account/permission isolation and unchanged login passed
