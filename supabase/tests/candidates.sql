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
insert into public.role_permissions(role_id,permission_id,granted) select 'ce000000-0000-4000-8000-000000000030',id,true from public.permissions where code in ('people.manage_candidates','org.view_audit');
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
insert into public.candidate_employment_settings(account_id,venue_id) values('ce000000-0000-4000-8000-000000000010','ce000000-0000-4000-8000-000000000020');
update public.candidate_employment_settings set store_ids='{1,2}' where venue_id='ce000000-0000-4000-8000-000000000020';
update public.candidate_connections set telegram_secret='{"encrypted":"qa-not-a-real-secret","iv":"qa","tag":"qa"}' where id='ce000000-0000-4000-8000-000000000050';
savepoint owner_interviewer;
delete from public.user_venue_roles where user_id='ce000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select set_config('app.ctx_ready','',true);
do $$begin
 if not exists(select 1 from jsonb_array_elements(public.candidate_hiring_options()->'members') member where member->>'id'='ce000000-0000-4000-8000-000000000001') then raise exception 'Owner missing from interviewers';end if;
 perform public.candidate_command('appointment','ce000000-0000-4000-8000-000000000040',jsonb_build_object('kind','interview','venue_id','ce000000-0000-4000-8000-000000000020','interviewer_id','ce000000-0000-4000-8000-000000000001','appointment_date',(now()+interval '1 day')::date,'starts_at',now()+interval '1 day','timezone','UTC','outcome','scheduled'));
 if not exists(select 1 from public.candidate_appointments where candidate_id='ce000000-0000-4000-8000-000000000040' and venue_id='ce000000-0000-4000-8000-000000000020' and location='QA' and timezone='Europe/Moscow') then raise exception 'Venue location or timezone not derived';end if;
 begin perform public.candidate_command('appointment','ce000000-0000-4000-8000-000000000040',jsonb_build_object('kind','interview','appointment_date',(now()+interval '1 day')::date,'starts_at',now()+interval '1 day','location','Свободный текст','outcome','scheduled'));raise exception 'Unstructured new meeting place allowed';exception when others then if SQLERRM not like 'Выберите заведение или%' then raise;end if;end;
 begin perform public.candidate_command('appointment','ce000000-0000-4000-8000-000000000040',jsonb_build_object('kind','interview','venue_id','ce000000-0000-4000-8000-000000000020','interviewer_id','ce000000-0000-4000-8000-000000000099','appointment_date',(now()+interval '1 day')::date,'starts_at',now()+interval '1 day','outcome','scheduled'));raise exception 'Unknown interviewer allowed';exception when others then if SQLERRM<>'Интервьюер недоступен' then raise;end if;end;
 perform public.candidate_command('appointment','ce000000-0000-4000-8000-000000000040',jsonb_build_object('id',(select id from public.candidate_appointments where candidate_id='ce000000-0000-4000-8000-000000000040'),'revision',1,'kind','interview','venue_id',null,'appointment_date',(now()+interval '1 day')::date,'starts_at',now()+interval '1 day','timezone','Europe/Moscow','location','https://example.com/meeting','outcome','scheduled'));
 if not exists(select 1 from public.candidate_appointments where candidate_id='ce000000-0000-4000-8000-000000000040' and venue_id is null and location='https://example.com/meeting') then raise exception 'Meeting link lost';end if;

end $$;
rollback to savepoint owner_interviewer;
-- New form contracts and author-owned comment lifecycle, without external calls.
savepoint editing_forms;
insert into public.candidate_comments(account_id,candidate_id,author_id,body) values('ce000000-0000-4000-8000-000000000010','ce000000-0000-4000-8000-000000000040','ce000000-0000-4000-8000-000000000001','Комментарий владельца QA');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select set_config('app.ctx_ready','',true);
do $$declare cid uuid;aid uuid;original public.candidate_appointments;begin
 perform public.candidate_command('comment','ce000000-0000-4000-8000-000000000040','{"body":"Свой комментарий QA","request_key":"ce000000-0000-4000-8000-000000000091"}');
 select id into cid from public.candidate_comments where source_id='ce000000-0000-4000-8000-000000000091';
 perform public.candidate_edit_comment('ce000000-0000-4000-8000-000000000040',cid,1,'Исправленный комментарий QA');
 if not exists(select 1 from public.candidate_comments where id=cid and revision=2 and body='Исправленный комментарий QA') then raise exception 'Own comment edit failed';end if;
 begin perform public.candidate_edit_comment('ce000000-0000-4000-8000-000000000040',cid,1,'Повтор QA');raise exception 'Stale comment update allowed';exception when others then if SQLERRM not like 'Комментарий изменён%' then raise;end if;end;
 begin perform public.candidate_edit_comment('ce000000-0000-4000-8000-000000000040',cid,2,'  ');raise exception 'Empty comment allowed';exception when others then if SQLERRM not like 'Введите комментарий%' then raise;end if;end;
 begin perform public.candidate_edit_comment('ce000000-0000-4000-8000-000000000041',cid,2,'Чужой аккаунт');raise exception 'Cross-tenant comment edit allowed';exception when others then if SQLERRM<>'Кандидат недоступен' then raise;end if;end;
 begin perform public.candidate_edit_comment('ce000000-0000-4000-8000-000000000040',(select id from public.candidate_comments where body='Комментарий владельца QA'),1,'Чужой комментарий');raise exception 'Other author edit allowed';exception when others then if SQLERRM not like 'Изменять и удалять%' then raise;end if;end;
 perform public.candidate_edit_comment('ce000000-0000-4000-8000-000000000040',cid,2,null,true);
 if exists(select 1 from public.candidate_comments where id=cid) then raise exception 'Deleted comment visible';end if;
 if (select count(*) from public.candidate_events where candidate_id='ce000000-0000-4000-8000-000000000040' and kind in ('comment_updated','comment_deleted'))<>2 then raise exception 'Comment history missing';end if;
 if (select count(*) from public.audit_logs where entity_id='ce000000-0000-4000-8000-000000000040' and action_code in ('candidate.comment.updated','candidate.comment.deleted'))<>2 then raise exception 'Shared comment history missing';end if;
 aid:=(public.candidate_save_appointment('ce000000-0000-4000-8000-000000000040','schedule',jsonb_build_object('kind','interview','venue_id','ce000000-0000-4000-8000-000000000020','appointment_date',(now()-interval '1 day')::date,'starts_at',now()-interval '1 day','timezone','Europe/Moscow','interviewer_id','ce000000-0000-4000-8000-000000000001'))->>'id')::uuid;
 select * into original from public.candidate_appointments where id=aid;
 perform public.candidate_save_appointment('ce000000-0000-4000-8000-000000000040','result',jsonb_build_object('id',aid,'revision',1,'outcome','passed','notes','Самостоятельный результат QA','interview_feedback','{"punctuality":"on_time"}'::jsonb));
 if not exists(select 1 from public.candidate_appointments where id=aid and starts_at=original.starts_at and appointment_date=original.appointment_date and interviewer_id=original.interviewer_id and location=original.location and outcome='passed') then raise exception 'Result changed appointment';end if;
 begin perform public.candidate_save_appointment('ce000000-0000-4000-8000-000000000040','result',jsonb_build_object('id',aid,'revision',2,'outcome','passed','notes','QA','starts_at',now()));raise exception 'Result rescheduled meeting';exception when others then if SQLERRM not like 'Дата и участники%' then raise;end if;end;
 begin perform public.candidate_save_appointment('ce000000-0000-4000-8000-000000000040','schedule',jsonb_build_object('id',aid,'revision',2,'outcome','rejected'));raise exception 'Schedule changed result';exception when others then if SQLERRM not like 'Итог встречи%' then raise;end if;end;
 perform public.candidate_save_appointment('ce000000-0000-4000-8000-000000000040','schedule',jsonb_build_object('id',aid,'revision',2,'kind','interview','venue_id','ce000000-0000-4000-8000-000000000020','appointment_date',(now()-interval '2 days')::date,'starts_at',now()-interval '2 days','timezone','Europe/Moscow','location','QA'));
 if not exists(select 1 from public.candidate_appointments where id=aid and outcome='passed' and notes='Самостоятельный результат QA' and interview_feedback->>'punctuality'='on_time' and revision=3) then raise exception 'Reschedule lost result';end if;
 -- Expanded observations survive the real result command, with strict validation.
 perform public.candidate_save_appointment('ce000000-0000-4000-8000-000000000040','result',jsonb_build_object('id',aid,'revision',3,'outcome','passed','notes','Оценка QA','interview_feedback','{"punctuality":"late_warned","smiled":"occasionally","appearance":"В целом опрятный вид","communication":"Ясно и по делу"}'::jsonb));
 if not exists(select 1 from public.candidate_appointments where id=aid and interview_feedback->>'smiled'='occasionally' and interview_feedback->>'punctuality'='late_warned' and revision=4) then raise exception 'Expanded feedback lost';end if;
 begin
  perform public.candidate_save_appointment('ce000000-0000-4000-8000-000000000040','result',jsonb_build_object('id',aid,'revision',4,'outcome','passed','notes','QA','interview_feedback','{"smiled":"invalid"}'::jsonb));
  raise exception 'Invalid feedback accepted';
 exception when check_violation then null;end;
 perform public.candidate_save_appointment('ce000000-0000-4000-8000-000000000040','schedule',jsonb_build_object('kind','trial','venue_id','ce000000-0000-4000-8000-000000000020','appointment_date',(now()+interval '1 day')::date,'starts_at',null,'timezone','Europe/Moscow'));
 perform public.candidate_save_appointment('ce000000-0000-4000-8000-000000000040','schedule',jsonb_build_object('kind','trial','venue_id','ce000000-0000-4000-8000-000000000020','appointment_date',(now()+interval '2 days')::date,'starts_at',null,'timezone','Europe/Moscow'));
 if (select count(*) from public.candidate_appointments where candidate_id='ce000000-0000-4000-8000-000000000040' and kind='trial')<>2 then raise exception 'Multiple trial days unavailable';end if;
 if has_function_privilege('anon','public.candidate_save_appointment(uuid,text,jsonb)','execute') or has_function_privilege('anon','public.candidate_edit_comment(uuid,uuid,integer,text,boolean)','execute') then raise exception 'New RPC exposed to anon';end if;
end $$;
reset role;
-- Account owners still cannot edit someone else's comment.
insert into public.candidate_comments(account_id,candidate_id,author_id,body) values('ce000000-0000-4000-8000-000000000010','ce000000-0000-4000-8000-000000000040','ce000000-0000-4000-8000-000000000002','Комментарий рекрутера QA');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('app.ctx_ready','',true);
do $$begin
 begin perform public.candidate_edit_comment('ce000000-0000-4000-8000-000000000040',(select id from public.candidate_comments where body='Комментарий рекрутера QA'),1,null,true);raise exception 'Owner deleted another author comment';exception when others then if SQLERRM not like 'Изменять и удалять%' then raise;end if;end;
end $$;
rollback to savepoint editing_forms;

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
 begin perform public.candidate_command('appointment','ce000000-0000-4000-8000-000000000040','{"kind":"interview","appointment_date":"2026-10-29","starts_at":null,"timezone":"Europe/Moscow","outcome":"scheduled"}');raise exception 'Interview without time allowed';exception when others then if SQLERRM='Interview without time allowed' then raise;end if;end;
 perform public.candidate_command('appointment','ce000000-0000-4000-8000-000000000040',jsonb_build_object('kind','interview','venue_id','ce000000-0000-4000-8000-000000000020','appointment_date',(now()-interval '1 day')::date,'starts_at',now()-interval '1 day','timezone','Europe/Moscow','outcome','scheduled','location','QA'));
 if not exists(select 1 from public.candidates where id='ce000000-0000-4000-8000-000000000040' and status='interview' and revision=2) then raise exception 'Interview did not advance stage';end if;
 declare qa_interview uuid;qa_trial uuid;v int;payroll_before int;staff_before int;
 begin
  select id into qa_interview from public.candidate_appointments where candidate_id='ce000000-0000-4000-8000-000000000040';
  begin perform public.candidate_command('appointment','ce000000-0000-4000-8000-000000000040','{"kind":"trial","venue_id":"ce000000-0000-4000-8000-000000000020","appointment_date":"2026-10-31","starts_at":null,"timezone":"Europe/Moscow","outcome":"scheduled"}');raise exception 'Trial before result allowed';exception when others then if SQLERRM not like 'Сначала заполните результат%' then raise;end if;end;
  begin perform public.candidate_command('appointment','ce000000-0000-4000-8000-000000000040',jsonb_build_object('id',qa_interview,'revision',1,'kind','interview','appointment_date',(now()-interval '1 day')::date,'starts_at',now()-interval '1 day','timezone','Europe/Moscow','outcome','passed'));raise exception 'Empty result allowed';exception when others then if SQLERRM not like 'Заполните комментарий%' then raise;end if;end;
  perform public.candidate_command('appointment','ce000000-0000-4000-8000-000000000040',jsonb_build_object('id',qa_interview,'revision',1,'kind','interview','appointment_date',(now()-interval '1 day')::date,'starts_at',now()-interval '1 day','timezone','Europe/Moscow','outcome','passed','notes','Результат собеседования QA','interview_feedback',jsonb_build_object('punctuality','on_time','appearance','Опрятно','communication','Общался спокойно','smiled',false)));
  begin perform public.candidate_command('appointment','ce000000-0000-4000-8000-000000000040',jsonb_build_object('id',qa_interview,'revision',2,'kind','trial','venue_id','ce000000-0000-4000-8000-000000000020','appointment_date','2026-10-31','starts_at',null,'timezone','Europe/Moscow','outcome','scheduled'));raise exception 'Appointment kind overwrite allowed';exception when others then if SQLERRM not like 'Тип проведённой%' then raise;end if;end;
  begin perform public.candidate_command('appointment','ce000000-0000-4000-8000-000000000040','{"kind":"trial","venue_id":"ce000000-0000-4000-8000-000000000021","appointment_date":"2026-10-31","starts_at":null,"timezone":"Europe/Moscow","outcome":"scheduled"}');raise exception 'Foreign venue trial allowed';exception when others then if SQLERRM not like 'Выберите доступное%' then raise;end if;end;
  select count(*) into payroll_before from public.payroll_employees where account_id='ce000000-0000-4000-8000-000000000010';
  select count(*) into staff_before from public.user_venue_roles where venue_id='ce000000-0000-4000-8000-000000000020';
  select (public.candidate_command('appointment','ce000000-0000-4000-8000-000000000040','{"kind":"trial","venue_id":"ce000000-0000-4000-8000-000000000020","appointment_date":"2026-10-31","starts_at":"2026-10-31T09:00:00Z","timezone":"Europe/Moscow","outcome":"scheduled"}')->>'id')::uuid into qa_trial;
  if not exists(select 1 from public.candidates where id='ce000000-0000-4000-8000-000000000040' and status='trial' and hired_user_id is null) then raise exception 'Trial stage missing or hired early';end if;
  if (select count(*) from public.payroll_employees where account_id='ce000000-0000-4000-8000-000000000010')<>payroll_before or (select count(*) from public.user_venue_roles where venue_id='ce000000-0000-4000-8000-000000000020')<>staff_before then raise exception 'Trial created staff or payroll';end if;
  perform public.candidate_command('appointment','ce000000-0000-4000-8000-000000000040',jsonb_build_object('id',qa_trial,'revision',1,'kind','trial','venue_id','ce000000-0000-4000-8000-000000000020','appointment_date','2026-10-31','starts_at','2026-10-31T10:00:00Z','timezone','Europe/Moscow','outcome','scheduled'));
  if not exists(select 1 from public.candidate_appointments where id=qa_trial and venue_id='ce000000-0000-4000-8000-000000000020' and starts_at='2026-10-31T10:00:00Z' and revision=2) then raise exception 'Trial edit not saved';end if;
  if public.candidate_calendar_trials()<>'[]'::jsonb then raise exception 'Calendar exposed without schedule permission';end if;
  begin perform public.candidate_command('appointment','ce000000-0000-4000-8000-000000000040',jsonb_build_object('kind','interview','venue_id','ce000000-0000-4000-8000-000000000020','appointment_date',(now()+interval '2 days')::date,'starts_at',now()+interval '2 days','timezone','Europe/Moscow','outcome','scheduled'));raise exception 'Second interview allowed by legacy RPC';exception when unique_violation then null;end;
  begin perform public.candidate_save_appointment('ce000000-0000-4000-8000-000000000040','schedule',jsonb_build_object('kind','interview','venue_id','ce000000-0000-4000-8000-000000000020','appointment_date',(now()+interval '2 days')::date,'starts_at',now()+interval '2 days','timezone','Europe/Moscow'));raise exception 'Second interview allowed';exception when others then if SQLERRM not like 'Собеседование уже назначено%' then raise;end if;end;
  if (select count(*) from public.candidate_appointments where candidate_id='ce000000-0000-4000-8000-000000000040' and kind='interview')<>1 then raise exception 'Duplicate interviews exist';end if;
  perform public.candidate_save_appointment('ce000000-0000-4000-8000-000000000040','result',jsonb_build_object('id',qa_interview,'revision',2,'outcome','no_show','notes','Результат изменён QA','interview_feedback',(select interview_feedback from public.candidate_appointments where id=qa_interview)));
  begin perform public.candidate_command('appointment','ce000000-0000-4000-8000-000000000040','{"kind":"trial","venue_id":"ce000000-0000-4000-8000-000000000020","appointment_date":"2026-10-31","starts_at":null,"timezone":"Europe/Moscow","outcome":"scheduled"}');raise exception 'Old result bypassed current interview';exception when others then if SQLERRM not like 'Сначала заполните результат%' then raise;end if;end;
  perform public.candidate_save_appointment('ce000000-0000-4000-8000-000000000040','result',jsonb_build_object('id',qa_interview,'revision',3,'outcome','passed','notes','Результат собеседования QA','interview_feedback',(select interview_feedback from public.candidate_appointments where id=qa_interview)));
  -- Simple stage overrides stay direct; meeting stages require scheduling.
  foreach v in array array[0,1] loop
   perform public.candidate_command('update','ce000000-0000-4000-8000-000000000040',jsonb_build_object('revision',(select revision from public.candidates where id='ce000000-0000-4000-8000-000000000040'),'status',(array['new','review','interview','trial'])[v+1]));
  end loop;
  begin perform public.candidate_command('update','ce000000-0000-4000-8000-000000000040',jsonb_build_object('revision',(select revision from public.candidates where id='ce000000-0000-4000-8000-000000000040'),'status','trial'));raise exception 'Dateless trial stage allowed';exception when others then if SQLERRM not like 'Для этого этапа%' then raise;end if;end;
  perform public.candidate_command('appointment','ce000000-0000-4000-8000-000000000040',jsonb_build_object('id',qa_trial,'revision',2,'kind','trial','venue_id','ce000000-0000-4000-8000-000000000020','appointment_date','2026-10-31','starts_at','2026-10-31T10:00:00Z','timezone','Europe/Moscow','outcome','scheduled'));

 end;
 begin perform public.candidate_command('update','ce000000-0000-4000-8000-000000000040','{"revision":1,"status":"trial"}');raise exception 'Stale update permitted';exception when others then if SQLERRM='Stale update permitted' then raise;end if;end;
end $$;
reset role;
-- Calendar requires both permissions and uses the active venue, never creating shifts.
insert into public.role_permissions(role_id,permission_id,granted) select 'ce000000-0000-4000-8000-000000000030',id,true from public.permissions where code='schedule.view_all' on conflict(role_id,permission_id) do update set granted=true;
set local role authenticated;
select set_config('app.ctx_ready','',true);
do $$begin
 if jsonb_array_length(public.candidate_calendar_trials())<>1 then raise exception 'Trial missing from calendar';end if;
 if public.candidate_calendar_trials()->0->>'full_name'<>'Кандидат QA' then raise exception 'Wrong calendar candidate';end if;
end $$;
reset role;
-- Shared journal, app notifications, one permission and the separate hiring gate.
select public.candidate_notify_in_app('ce000000-0000-4000-8000-000000000040');
select public.candidate_notify_in_app('ce000000-0000-4000-8000-000000000040');
select public.candidate_notify_in_app('ce000000-0000-4000-8000-000000000041');
insert into public.candidate_events(account_id,candidate_id,actor_id,kind,details) values('ce000000-0000-4000-8000-000000000010','ce000000-0000-4000-8000-000000000040','ce000000-0000-4000-8000-000000000002','file_added','{"name":"QA.jpg"}');
do $$begin
 if (select count(*) from public.permissions where code like 'people.%candidates')<>1 then raise exception 'More than one candidate permission';end if;
 if (select count(*) from public.audit_logs where entity_id='ce000000-0000-4000-8000-000000000040' and action_code='candidate.commented')<>1 then raise exception 'Missing or duplicate shared comment event';end if;
 if not exists(select 1 from public.candidate_appointments where candidate_id='ce000000-0000-4000-8000-000000000040' and kind='interview' and interview_feedback->>'punctuality'='on_time' and interview_feedback->>'smiled'='false') then raise exception 'Interview feedback lost';end if;
 if not exists(select 1 from public.audit_logs where entity_id='ce000000-0000-4000-8000-000000000040' and action_code='candidate.appointment.updated' and details->'after'->>'kind'='trial') then raise exception 'Meeting missing from shared journal';end if;
 if not exists(select 1 from public.audit_logs where entity_id='ce000000-0000-4000-8000-000000000040' and action_code='candidate.updated' and details->'changes'->'status'->>'new'='interview') then raise exception 'Status diff missing from shared journal';end if;
 if not exists(select 1 from public.audit_logs where entity_id='ce000000-0000-4000-8000-000000000040' and action_code='candidate.file.created' and details->>'name_of_file'='QA.jpg') then raise exception 'File missing from shared journal';end if;
 if (select count(*) from public.notifications where entity_id='ce000000-0000-4000-8000-000000000040' and type='candidate.new')<>2 then raise exception 'Missing or duplicate app notification';end if;
 if (select count(*) from public.notifications where entity_id='ce000000-0000-4000-8000-000000000041' and type='candidate.new')<>1 then raise exception 'Owner without membership not notified';end if;
 if not exists(select 1 from public.audit_logs where action_code='candidate.employment_settings.updated' and details->'changes'->'store_ids'->'new'='[1,2]'::jsonb) then raise exception 'Employment settings missing from shared journal';end if;
 if exists(select 1 from public.audit_logs where action_code='candidate.connection.updated' and (details::text like '%'||repeat('a',64)||'%' or details::text like '%qa-not-a-real-secret%')) then raise exception 'Integration credential leaked to journal';end if;
end $$;
set local role authenticated;
select set_config('app.ctx_ready','',true);
do $$begin
 if public.candidate_new_count()<>1 then raise exception 'New count does not track status and account';end if;
 if (public.candidate_hiring_options()->'venues'->0->>'can_hire')::boolean then raise exception 'Recruiter can hire without staff permission';end if;
 begin perform public.candidate_begin_hire('ce000000-0000-4000-8000-000000000040','{"revision":2,"venue_id":"ce000000-0000-4000-8000-000000000020","role_id":"ce000000-0000-4000-8000-000000000030"}');raise exception 'Hire allowed without staff permission';exception when others then if SQLERRM='Hire allowed without staff permission' then raise;end if;end;
 if not exists(select 1 from public.audit_logs where entity_id='ce000000-0000-4000-8000-000000000040') then raise exception 'Allowed journal inaccessible';end if;
end $$;
reset role;
delete from public.role_permissions where role_id='ce000000-0000-4000-8000-000000000030' and permission_id=(select id from public.permissions where code='people.manage_candidates');
set local role authenticated;
select set_config('app.ctx_ready','',true);
do $$begin
 if public.candidate_calendar_trials()<>'[]'::jsonb or public.candidate_new_count()<>0 or exists(select 1 from public.candidates) then raise exception 'Revoked candidate access still reads data';end if;
 if exists(select 1 from public.audit_logs where action_code like 'candidate.%') then raise exception 'Revoked candidate journal data exposed';end if;
 if exists(select 1 from public.notifications where entity_type='candidate') then raise exception 'Revoked candidate notification exposed';end if;
 if exists(select 1 from storage.objects where bucket_id='candidate-files') then raise exception 'Revoked candidate photo exposed';end if;
 begin perform public.candidate_save_appointment('ce000000-0000-4000-8000-000000000040','schedule','{}');raise exception 'Revoked meeting edit allowed';exception when others then if SQLERRM<>'Нет доступа к кандидатам' then raise;end if;end;
 begin perform public.candidate_edit_comment('ce000000-0000-4000-8000-000000000040','ce000000-0000-4000-8000-000000000090',1,'Denied');raise exception 'Revoked comment edit allowed';exception when others then if SQLERRM<>'Нет доступа к кандидатам' then raise;end if;end;

 begin perform public.candidate_command('comment','ce000000-0000-4000-8000-000000000040','{"body":"Denied","request_key":"ce000000-0000-4000-8000-000000000099"}');raise exception 'Revoked candidate write allowed';exception when others then if SQLERRM='Revoked candidate write allowed' then raise;end if;end;
end $$;
reset role;
insert into public.role_permissions(role_id,permission_id,granted) select 'ce000000-0000-4000-8000-000000000030',id,true from public.permissions where code='people.manage_candidates';
select set_config('app.ctx_ready','',true);
reset role;
select set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
create temp table qa_hire_context(payload jsonb);
do $$declare r uuid;h jsonb;stage text;begin
 r:=public.candidate_create_role('ce000000-0000-4000-8000-000000000020','{"name":"Бармен QA","valid_from":"2026-10-01","monthly_amount":0,"basis":"none","tips":false,"shift_pay":true,"rates":{"1":{"1":{"base":2000,"percent":0}}},"food_amount":0,"knowledge_amount":0,"quickresto_role_id":999}');
 foreach stage in array array['new','review','interview','rejected'] loop
  if stage='interview' then
    perform public.candidate_command('appointment','ce000000-0000-4000-8000-000000000040',(select to_jsonb(ap) from public.candidate_appointments ap where candidate_id='ce000000-0000-4000-8000-000000000040' and kind='interview'));
  else
  perform public.candidate_command('update','ce000000-0000-4000-8000-000000000040',jsonb_build_object('revision',(select revision from public.candidates where id='ce000000-0000-4000-8000-000000000040'),'status',stage));
  end if;
  begin perform public.candidate_begin_hire('ce000000-0000-4000-8000-000000000040',jsonb_build_object('revision',(select revision from public.candidates where id='ce000000-0000-4000-8000-000000000040'),'venue_id','ce000000-0000-4000-8000-000000000020','role_id',r,'first_name','Кандидат','last_name','QA','employment_date','2026-10-29','attendance_source','quickresto'));raise exception 'Hire outside trial allowed';exception when others then if SQLERRM not like 'Приём на работу доступен только%' then raise;end if;end;
 end loop;
 perform public.candidate_command('appointment','ce000000-0000-4000-8000-000000000040',jsonb_build_object('id',(select id from public.candidate_appointments where candidate_id='ce000000-0000-4000-8000-000000000040' and kind='trial' limit 1),'revision',(select revision from public.candidate_appointments where candidate_id='ce000000-0000-4000-8000-000000000040' and kind='trial' limit 1),'kind','trial','venue_id','ce000000-0000-4000-8000-000000000020','appointment_date','2026-10-31','starts_at','2026-10-31T10:00:00Z','timezone','Europe/Moscow','outcome','scheduled'));
 h:=public.candidate_begin_hire('ce000000-0000-4000-8000-000000000040',jsonb_build_object('revision',(select revision from public.candidates where id='ce000000-0000-4000-8000-000000000040'),'venue_id','ce000000-0000-4000-8000-000000000020','role_id',r,'first_name','Кандидат','last_name','QA','employment_date','2026-10-29','attendance_source','quickresto'));
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
 begin perform public.candidate_link_staff('ce000000-0000-4000-8000-000000000043',(h->>'target_user_id')::uuid,'ce000000-0000-4000-8000-000000000020',1);raise exception 'Staff link outside trial allowed';exception when others then if SQLERRM not like 'Приём на работу доступен только%' then raise;end if;end;
 update public.candidates set status='trial' where id='ce000000-0000-4000-8000-000000000043';
 perform public.candidate_link_staff('ce000000-0000-4000-8000-000000000043',(h->>'target_user_id')::uuid,'ce000000-0000-4000-8000-000000000020',2);
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
