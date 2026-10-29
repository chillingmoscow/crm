-- Integration test: isolated tenants, real RLS/RPCs, ingress retries, and atomic
-- hire completion. No external requests. Everything is rolled back.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
values('ce000000-0000-4000-8000-000000000001','authenticated','authenticated','candidate-qa-owner@import.local',now(),'{}','{}',now(),now()),
('ce000000-0000-4000-8000-000000000002','authenticated','authenticated','candidate-qa-recruiter@import.local',now(),'{}','{}',now(),now());
insert into public.accounts(id,name,owner_id) values('ce000000-0000-4000-8000-000000000010','Кандидаты QA','ce000000-0000-4000-8000-000000000001'),('ce000000-0000-4000-8000-000000000011','Другой аккаунт QA','ce000000-0000-4000-8000-000000000001');
insert into public.venues(id,account_id,name) values('ce000000-0000-4000-8000-000000000020','ce000000-0000-4000-8000-000000000010','QA'),('ce000000-0000-4000-8000-000000000021','ce000000-0000-4000-8000-000000000011','Чужое QA');
insert into public.user_venue_roles(user_id,venue_id,role_id,status) select 'ce000000-0000-4000-8000-000000000001','ce000000-0000-4000-8000-000000000020',id,'active' from public.roles where code='owner' and venue_id is null;
insert into public.roles(id,venue_id,name,code) values('ce000000-0000-4000-8000-000000000030','ce000000-0000-4000-8000-000000000020','Рекрутер QA','candidate_qa_recruiter');
insert into public.role_permissions(role_id,permission_id,granted) select 'ce000000-0000-4000-8000-000000000030',id,true from public.permissions where code in ('people.view_candidates','people.manage_candidates');
insert into public.user_venue_roles(user_id,venue_id,role_id,status) values('ce000000-0000-4000-8000-000000000002','ce000000-0000-4000-8000-000000000020','ce000000-0000-4000-8000-000000000030','active');
update public.profiles set active_venue_id='ce000000-0000-4000-8000-000000000020' where id in ('ce000000-0000-4000-8000-000000000001','ce000000-0000-4000-8000-000000000002');
insert into public.candidates(id,account_id,full_name) values('ce000000-0000-4000-8000-000000000040','ce000000-0000-4000-8000-000000000010','Кандидат QA'),('ce000000-0000-4000-8000-000000000041','ce000000-0000-4000-8000-000000000011','Чужой кандидат QA');
-- Display names differ from storage paths. Exercise the actual storage RLS policy.
insert into public.candidate_files(account_id,candidate_id,name,storage_path,state) values
('ce000000-0000-4000-8000-000000000010','ce000000-0000-4000-8000-000000000040','portrait.jpg','ce000000-0000-4000-8000-000000000010/qa/photo.jpg','ready'),
('ce000000-0000-4000-8000-000000000011','ce000000-0000-4000-8000-000000000041','other.jpg','ce000000-0000-4000-8000-000000000011/qa/photo.jpg','ready');
insert into storage.objects(bucket_id,name) values
('candidate-files','ce000000-0000-4000-8000-000000000010/qa/photo.jpg'),
('candidate-files','ce000000-0000-4000-8000-000000000011/qa/photo.jpg');
insert into public.candidate_connections(id,account_id,secret_hash,enabled,form_id,created_by) values('ce000000-0000-4000-8000-000000000050','ce000000-0000-4000-8000-000000000010',repeat('a',64),true,'form123','ce000000-0000-4000-8000-000000000001');
set local role service_role;
select public.candidate_receive('ce000000-0000-4000-8000-000000000050','qa-event','{"full_name":"Повтор webhook","phone":"+79990000000","photos":[]}','{"formid":"form123"}');
select public.candidate_receive('ce000000-0000-4000-8000-000000000050','qa-event','{"full_name":"Повтор webhook","phone":"+79990000000","photos":[]}','{"formid":"form123"}');
reset role;
do $$begin
 if (select count(*) from public.candidate_deliveries where source_id='qa-event')<>1 then raise exception 'Duplicate delivery';end if;
 if (select count(*) from public.candidate_jobs where account_id='ce000000-0000-4000-8000-000000000010' and kind='notify')<>1 then raise exception 'Duplicate notification';end if;
 if has_function_privilege('authenticated','public.candidate_finish_hire(uuid)','execute') or has_function_privilege('anon','public.candidate_receive(uuid,text,jsonb,jsonb)','execute') then raise exception 'Privileged function exposed';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select set_config('app.ctx_ready','',true);
do $$declare n int;begin
 if has_any_column_privilege('authenticated','public.candidates','INSERT') then raise exception 'Manual candidate insertion allowed';end if;
 begin perform public.candidate_command('create',null,'{"full_name":"Недопустимый ручной кандидат"}');raise exception 'Manual candidate creation allowed';exception when others then if SQLERRM='Manual candidate creation allowed' then raise;end if;end;
 begin perform public.candidate_command('update','ce000000-0000-4000-8000-000000000040','{"revision":1,"status":"unknown"}');raise exception 'Unknown status allowed';exception when others then if SQLERRM='Unknown status allowed' then raise;end if;end;
 begin perform public.candidate_command('update','ce000000-0000-4000-8000-000000000040','{"revision":1,"responsible_id":null}');raise exception 'Assignment allowed';exception when others then if SQLERRM='Assignment allowed' then raise;end if;end;
 select count(*) into n from public.candidates where id='ce000000-0000-4000-8000-000000000041';if n<>0 then raise exception 'Cross-tenant read';end if;
 perform public.candidate_command('comment','ce000000-0000-4000-8000-000000000040','{"body":"Комментарий QA","request_key":"ce000000-0000-4000-8000-000000000090"}');
 perform public.candidate_command('comment','ce000000-0000-4000-8000-000000000040','{"body":"Комментарий QA","request_key":"ce000000-0000-4000-8000-000000000090"}');
 if (select count(*) from public.candidate_comments where candidate_id='ce000000-0000-4000-8000-000000000040')<>1 then raise exception 'Duplicate comment';end if;
 if not exists(select 1 from public.candidate_events where candidate_id='ce000000-0000-4000-8000-000000000040' and kind='commented') then raise exception 'Recruiter cannot read journal';end if;
 if not exists(select 1 from storage.objects where bucket_id='candidate-files' and name='ce000000-0000-4000-8000-000000000010/qa/photo.jpg') then raise exception 'Recruiter cannot read candidate file';end if;
 if exists(select 1 from storage.objects where bucket_id='candidate-files' and name='ce000000-0000-4000-8000-000000000011/qa/photo.jpg') then raise exception 'Cross-tenant file exposed';end if;
 begin perform public.candidate_command('update','ce000000-0000-4000-8000-000000000041','{"revision":1,"status":"rejected"}');raise exception 'Cross-tenant write permitted';exception when others then if SQLERRM='Cross-tenant write permitted' then raise;end if;end;
 begin perform public.candidate_command('update','ce000000-0000-4000-8000-000000000040','{"revision":1,"status":"hired"}');raise exception 'Status bypass permitted';exception when others then if SQLERRM='Status bypass permitted' then raise;end if;end;
 begin perform public.candidate_command('archive','ce000000-0000-4000-8000-000000000040','{}');raise exception 'Recruiter archive permitted';exception when others then if SQLERRM='Recruiter archive permitted' then raise;end if;end;
 perform public.candidate_command('appointment','ce000000-0000-4000-8000-000000000040','{"kind":"interview","appointment_date":"2026-10-30","starts_at":"2026-10-30T11:00:00Z","timezone":"Europe/Moscow","outcome":"scheduled","location":"QA"}');
 declare qa_appointment uuid;
 begin
  select id into qa_appointment from public.candidate_appointments where candidate_id='ce000000-0000-4000-8000-000000000040';
  perform public.candidate_command('appointment','ce000000-0000-4000-8000-000000000040',jsonb_build_object('id',qa_appointment,'revision',1,'kind','trial','appointment_date','2026-10-30','starts_at','2026-10-30T12:00:00Z','timezone','Europe/Moscow','outcome','scheduled'));
  if not exists(select 1 from public.candidate_appointments where id=qa_appointment and kind='trial' and starts_at='2026-10-30T12:00:00Z' and revision=2) then raise exception 'Meeting edit not saved';end if;
 end;
 perform public.candidate_command('update','ce000000-0000-4000-8000-000000000040','{"revision":1,"status":"interview"}');
 begin perform public.candidate_command('update','ce000000-0000-4000-8000-000000000040','{"revision":1,"status":"trial"}');raise exception 'Stale update permitted';exception when others then if SQLERRM='Stale update permitted' then raise;end if;end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
create temp table qa_hire_context(payload jsonb);
do $$declare r uuid;h jsonb;begin
 r:=public.candidate_create_role('ce000000-0000-4000-8000-000000000020','{"name":"Бармен QA","valid_from":"2026-10-01","monthly_amount":0,"basis":"none","tips":false,"shift_pay":true,"rates":{"1":{"1":{"base":2000,"percent":0}}},"food_amount":0,"knowledge_amount":0,"quickresto_role_id":999}');
 h:=public.candidate_begin_hire('ce000000-0000-4000-8000-000000000040',jsonb_build_object('revision',2,'venue_id','ce000000-0000-4000-8000-000000000020','role_id',r,'first_name','Кандидат','last_name','QA','employment_date','2026-10-29','attendance_source','quickresto'));
 insert into qa_hire_context values(h);
end $$;
reset role;
do $$declare h jsonb;begin
 select payload into h from qa_hire_context;
 insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values((h->>'target_user_id')::uuid,'authenticated','authenticated','candidate-qa-hired@import.local',now(),'{}','{}',now(),now());
 begin perform public.candidate_finish_hire((h->>'id')::uuid);raise exception 'Unconfirmed provisioning accepted';exception when others then if SQLERRM='Unconfirmed provisioning accepted' then raise;end if;end;
 if exists(select 1 from public.user_venue_roles where user_id=(h->>'target_user_id')::uuid) then raise exception 'Partial staff creation';end if;
 update public.candidate_hires set provisioning='{"employee":{"state":"done","id":999999,"pin":"9834"},"guest":{"state":"done","id":999998},"bonus":{"state":"done","id":999997}}' where id=(h->>'id')::uuid;
 insert into public.staff_door_codes(account_id,hire_id,user_number,password_hash,source) values('ce000000-0000-4000-8000-000000000010',(h->>'id')::uuid,899,'qa-hash','sheerly');
 perform public.candidate_finish_hire((h->>'id')::uuid);perform public.candidate_finish_hire((h->>'id')::uuid);
 if (select count(*) from public.user_venue_roles where user_id=(h->>'target_user_id')::uuid)<>1 then raise exception 'Duplicate membership';end if;
 if (select count(*) from public.payroll_employees where local_user_id=(h->>'target_user_id')::uuid)<>1 then raise exception 'Missing or duplicate payroll';end if;
 if not exists(select 1 from public.candidates where id='ce000000-0000-4000-8000-000000000040' and status='hired' and hired_user_id=(h->>'target_user_id')::uuid) then raise exception 'Hire not linked';end if;
 if not exists(select 1 from public.payroll_employees where local_user_id=(h->>'target_user_id')::uuid and quickresto_id=999999) then raise exception 'Quick Resto link missing';end if;
 if not exists(select 1 from public.staff_door_codes where hire_id=(h->>'id')::uuid and user_id=(h->>'target_user_id')::uuid) then raise exception 'Door code not linked';end if;
 if not exists(select 1 from public.payroll_employees where local_user_id=(h->>'target_user_id')::uuid and role_id=(h->'input'->>'role_id')::uuid and quickresto_guest_id=999998 and quickresto_bonus_account_id=999997) then raise exception 'Role or bonus IDs missing';end if;
 insert into public.candidates(id,account_id,full_name) values('ce000000-0000-4000-8000-000000000043','ce000000-0000-4000-8000-000000000010','Повторная анкета сотрудника QA');
 perform public.candidate_link_staff('ce000000-0000-4000-8000-000000000043',(h->>'target_user_id')::uuid,'ce000000-0000-4000-8000-000000000020',1);
 if (select count(*) from public.payroll_employees where local_user_id=(h->>'target_user_id')::uuid)<>1 or (select count(*) from public.staff_door_codes where user_id=(h->>'target_user_id')::uuid)<>1 then raise exception 'Existing staff was provisioned twice';end if;

end $$;
set local role authenticated;
select public.candidate_command('archive','ce000000-0000-4000-8000-000000000040','{}');
reset role;
select set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$begin if exists(select 1 from public.candidates where id='ce000000-0000-4000-8000-000000000040') or exists(select 1 from public.candidate_comments where candidate_id='ce000000-0000-4000-8000-000000000040') then raise exception 'Archived data exposed';end if;
if exists(select 1 from storage.objects where bucket_id='candidate-files' and name='ce000000-0000-4000-8000-000000000010/qa/photo.jpg') then raise exception 'Archived file exposed';end if;end $$;
reset role;
rollback;
\echo 'Candidates integration checks passed'
