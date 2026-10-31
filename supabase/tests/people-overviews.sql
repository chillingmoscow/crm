\set ON_ERROR_STOP on
begin;
-- No fixture is committed or visible to workers/notifications.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
select ('e0e00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','overview-qa-'||n||'@import.local',now(),'{}','{}',now(),now() from generate_series(1,6)n;
insert into public.accounts(id,name,owner_id) values
 ('e0e00000-0000-4000-8001-000000000001','Overview QA','e0e00000-0000-4000-8000-000000000001'),
 ('e0e00000-0000-4000-8001-000000000002','Other account QA','e0e00000-0000-4000-8000-000000000006');
insert into public.venues(id,account_id,name,timezone) values
 ('e0e00000-0000-4000-8002-000000000001','e0e00000-0000-4000-8001-000000000001','Overview venue QA','Europe/Moscow'),
 ('e0e00000-0000-4000-8002-000000000002','e0e00000-0000-4000-8001-000000000001','Second venue QA','Europe/Moscow');
insert into public.roles(id,venue_id,name,code) values
 ('e0e00000-0000-4000-8003-000000000001','e0e00000-0000-4000-8002-000000000001','Overview staff QA','overview_qa'),
 ('e0e00000-0000-4000-8003-000000000002','e0e00000-0000-4000-8002-000000000001','Overview viewer QA','overview_viewer_qa');
delete from public.role_permissions where role_id in ('e0e00000-0000-4000-8003-000000000001','e0e00000-0000-4000-8003-000000000002');
insert into public.role_permissions(role_id,permission_id,granted) select 'e0e00000-0000-4000-8003-000000000002',id,true from public.permissions where code='people.view_staff';
insert into public.user_venue_roles(user_id,venue_id,role_id,status,created_at)
select ('e0e00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'e0e00000-0000-4000-8002-000000000001',
 case when n=1 then (select id from public.roles where code='owner' and venue_id is null limit 1)
 when n=3 then 'e0e00000-0000-4000-8003-000000000002'::uuid else 'e0e00000-0000-4000-8003-000000000001'::uuid end,
 case when n=5 then 'fired' else 'active' end,now()-interval '5 years' from generate_series(1,5)n;
insert into public.user_venue_roles(user_id,venue_id,role_id,status)
select 'e0e00000-0000-4000-8000-000000000001','e0e00000-0000-4000-8002-000000000002',id,'active' from public.roles where code='owner' and venue_id is null limit 1;
update public.profiles set active_venue_id='e0e00000-0000-4000-8002-000000000001' where id::text like 'e0e00000-0000-4000-8000-%';
insert into public.staff_account_details(account_id,user_id,employment_date) values
 ('e0e00000-0000-4000-8001-000000000001','e0e00000-0000-4000-8000-000000000002',date_trunc('month',now() at time zone 'Europe/Moscow')::date),
 ('e0e00000-0000-4000-8001-000000000001','e0e00000-0000-4000-8000-000000000004',(now() at time zone 'Europe/Moscow')::date+10),
 ('e0e00000-0000-4000-8001-000000000001','e0e00000-0000-4000-8000-000000000005',date_trunc('month',now() at time zone 'Europe/Moscow')::date-400);
update public.user_venue_roles set fired_at=now()-interval '2 days' where user_id='e0e00000-0000-4000-8000-000000000005';
-- Same dismissal appears in UVR and the journal: it is still one person.
insert into public.audit_logs(account_id,venue_id,entity_type,entity_id,action_code,details,created_at)
select 'e0e00000-0000-4000-8001-000000000001','e0e00000-0000-4000-8002-000000000001','staff',user_id,'staff.fired',jsonb_build_object('fired_at',fired_at),fired_at from public.user_venue_roles where user_id='e0e00000-0000-4000-8000-000000000005';
insert into public.candidates(account_id,full_name,submitted_at)
select 'e0e00000-0000-4000-8001-000000000001','Overview paging QA '||n,((date_trunc('month',now() at time zone 'Europe/Moscow')-interval '1 month 1 day')+interval '2 days') at time zone 'Europe/Moscow' from generate_series(1,1005)n;
insert into public.candidates(account_id,full_name,status,hired_user_id,hired_venue_id,submitted_at)
values('e0e00000-0000-4000-8001-000000000001','Overview hired QA','hired','e0e00000-0000-4000-8000-000000000005','e0e00000-0000-4000-8002-000000000001',(date_trunc('month',now() at time zone 'Europe/Moscow')-interval '1 month'+interval '2 days') at time zone 'Europe/Moscow');
insert into public.candidates(account_id,full_name,status,submitted_at,archived_at) values
 ('e0e00000-0000-4000-8001-000000000001','Boundary included QA','rejected',(date_trunc('month',now() at time zone 'Europe/Moscow')-interval '1 month') at time zone 'Europe/Moscow',null),
 ('e0e00000-0000-4000-8001-000000000001','Boundary before QA','new',((date_trunc('month',now() at time zone 'Europe/Moscow')-interval '1 month') at time zone 'Europe/Moscow')-interval '1 microsecond',null),
 ('e0e00000-0000-4000-8001-000000000001','Boundary after QA','new',date_trunc('month',now() at time zone 'Europe/Moscow') at time zone 'Europe/Moscow',null),
 ('e0e00000-0000-4000-8001-000000000001','Archived QA','new',(date_trunc('month',now() at time zone 'Europe/Moscow')-interval '1 month'+interval '2 days') at time zone 'Europe/Moscow',now()),
 ('e0e00000-0000-4000-8001-000000000002','Foreign account QA','new',(date_trunc('month',now() at time zone 'Europe/Moscow')-interval '1 month'+interval '2 days') at time zone 'Europe/Moscow',null);

-- Rejection must retain an earlier interview/trial. Historical signals also
-- cover resets to New, canceled and repeated appointments, and removed plans.
update public.candidates set status='rejected',source=case when full_name='Overview paging QA 2' then 'notion' else source end
where account_id='e0e00000-0000-4000-8001-000000000001' and full_name in ('Overview paging QA 1','Overview paging QA 2');
insert into public.candidate_events(account_id,candidate_id,kind,details)
select account_id,id,'updated',jsonb_build_object('changes',jsonb_build_object('status',jsonb_build_object('old',
 case when full_name='Overview paging QA 1' then 'interview' else 'trial' end,'new','rejected')))
from public.candidates where account_id='e0e00000-0000-4000-8001-000000000001' and full_name in ('Overview paging QA 1','Overview paging QA 2');
insert into public.candidate_events(account_id,candidate_id,kind,details)
select c.account_id,c.id,'updated','{"changes":{"status":{"old":"new","new":"review"}}}' from public.candidates c
cross join generate_series(1,10) n where c.account_id='e0e00000-0000-4000-8001-000000000001' and c.full_name='Overview paging QA 3';
insert into public.candidate_appointments(account_id,candidate_id,kind,appointment_date,outcome)
select c.account_id,c.id,case when c.full_name='Overview paging QA 4' then 'interview' else 'trial' end,
 (now() at time zone 'Europe/Moscow')::date,case when c.full_name='Overview paging QA 4' then 'rejected' else 'canceled' end
from public.candidates c cross join generate_series(1,2) n
where c.account_id='e0e00000-0000-4000-8001-000000000001' and c.full_name in ('Overview paging QA 4','Overview paging QA 5')
 and (c.full_name='Overview paging QA 5' or n=1);
insert into public.candidate_events(account_id,candidate_id,kind,details)
select account_id,id,'appointment_updated','{"before":{"kind":"trial"},"after":null}' from public.candidates
where account_id='e0e00000-0000-4000-8001-000000000001' and full_name='Overview paging QA 6';
insert into public.candidate_events(account_id,candidate_id,kind,details,created_at)
select account_id,id,'updated','{"changes":{"status":{"old":"new","new":"trial"}}}',now()+interval '1 day' from public.candidates
where account_id='e0e00000-0000-4000-8001-000000000001' and full_name='Overview paging QA 7';
insert into public.candidate_events(account_id,candidate_id,kind,details)
select account_id,id,'comment_updated','{"after":{"kind":"trial"}}' from public.candidates
where account_id='e0e00000-0000-4000-8001-000000000001' and full_name='Overview paging QA 8';
insert into public.candidate_events(account_id,candidate_id,kind,details)
select account_id,id,'updated','{"changes":{"status":{"old":"trial","new":"hired"}}}' from public.candidates
where full_name in ('Archived QA','Foreign account QA');

set local role authenticated;
select set_config('request.jwt.claim.sub','e0e00000-0000-4000-8000-000000000001',true),set_config('app.ctx_ready','0',true);
do $$declare s jsonb;c jsonb;previous date:=(date_trunc('month',now() at time zone 'Europe/Moscow')-interval '1 month')::date;begin
 s:=public.staff_people_overview();c:=public.candidate_people_overview(previous);
 if (s->>'working')::int<>4 or (s->>'dated_staff')::int<>1 or (s->>'hired')::int<>1 or (s->>'average_days')::numeric<>(s->>'today')::date-(s->>'month')::date then raise exception 'Staff counts used invitation/import/future date';end if;
 if (s#>>'{movement,2,fired}')::int<>1 then raise exception 'Dismissal double counted';end if;
 if (c->>'received')::int<>1007 or (c->>'new')::int<>1003 or (c->>'hired')::int<>1 then raise exception 'Cohort truncated or boundary/hire/scope incorrect: %',c;end if;
 if (select sum((x->>'count')::int) from jsonb_array_elements(c->'arrivals')x)<>1007 or (select sum((x->>'count')::int) from jsonb_array_elements(c->'stages')x)<>1006 then raise exception 'Daily/stage totals differ';end if;
 if (c#>>'{arrivals,0,from}')::date<>previous or (c#>>'{arrivals,-1,to}')::date<>previous+interval '1 month'-interval '1 day'
   or jsonb_array_length(c->'arrivals')<>extract(day from previous+interval '1 month'-interval '1 day')
   or exists(select 1 from jsonb_array_elements(c->'arrivals')x where x->>'from'<>x->>'to') then raise exception 'Daily boundaries drift';end if;
 if (select array_agg((x->>'count')::int order by ord) from jsonb_array_elements(c->'funnel') with ordinality t(x,ord))<>array[1007,7,6,4,1]
   or (c->>'legacy_count')::int<>1 then raise exception 'History lost, duplicated, inferred from rejection, or foreign history leaked: %',c->'funnel';end if;
 if (public.candidate_people_overview((previous-interval '2 months')::date)->>'received')::int<>0 then raise exception 'Empty month not empty';end if;
 if exists(select 1 from jsonb_array_elements(public.candidate_people_overview((previous-interval '2 months')::date)->'funnel')x where (x->>'count')::int<>0) then raise exception 'Empty funnel not empty';end if;
 if (public.candidate_people_overview()#>>'{arrivals,-1,to}')::date<>(now() at time zone 'Europe/Moscow')::date then raise exception 'Future days shown as zeros';end if;
 begin perform public.candidate_people_overview(previous+1);raise exception 'Bad month accepted';exception when raise_exception then if sqlerrm not like 'Выберите%' then raise;end if;end;
 begin perform public.staff_people_overview((previous+interval '2 months')::date);raise exception 'Future month accepted';exception when raise_exception then if sqlerrm not like 'Выберите%' then raise;end if;end;
end $$;
-- A staff viewer without journal access receives counts, never raw audit rows.
select set_config('request.jwt.claim.sub','e0e00000-0000-4000-8000-000000000003',true),set_config('app.ctx_ready','0',true);
do $$begin
 if (public.staff_people_overview()#>>'{movement,2,fired}')::int<>1 then raise exception 'Staff-only viewer lost history';end if;
 if exists(select 1 from public.audit_logs where account_id='e0e00000-0000-4000-8001-000000000001') then raise exception 'Raw journal exposed';end if;
 begin perform public.candidate_people_overview();raise exception 'Candidate permission bypassed';exception when raise_exception then if sqlerrm<>'Нет доступа к обзору кандидатов' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','e0e00000-0000-4000-8000-000000000004',true),set_config('app.ctx_ready','0',true);
do $$begin
 begin perform public.staff_people_overview();raise exception 'Staff permission bypassed';exception when raise_exception then if sqlerrm<>'Нет доступа к обзору сотрудников' then raise;end if;end;
end $$;
reset role;
-- Restoring clears UVR.fired_at but must not erase the historical dismissal.
update public.user_venue_roles set status='active',fired_at=null where user_id='e0e00000-0000-4000-8000-000000000005';
set local role authenticated;
select set_config('request.jwt.claim.sub','e0e00000-0000-4000-8000-000000000001',true),set_config('app.ctx_ready','0',true);
do $$begin
 if (public.staff_people_overview()#>>'{movement,2,fired}')::int<>1 then raise exception 'Restore erased dismissal history';end if;
 if has_function_privilege('anon','public.staff_people_overview(date)','execute') or has_function_privilege('anon','public.candidate_people_overview(date)','execute') or has_function_privilege('anon','private.staff_people_overview(date)','execute') then raise exception 'Anonymous overview exposed';end if;
end $$;
reset role;
update public.profiles set active_venue_id='e0e00000-0000-4000-8002-000000000002' where id='e0e00000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('app.ctx_ready','0',true);
do $$declare s jsonb;begin
 s:=public.staff_people_overview();
 if (s->>'working')::int<>1 or (s->>'dated_staff')::int<>0 or s->>'average_days' is not null then raise exception 'Venue isolation or unknown-date handling failed';end if;
 if (public.candidate_people_overview((date_trunc('month',now() at time zone 'Europe/Moscow')-interval '1 month')::date)->>'received')::int<>1007 then raise exception 'Candidates incorrectly venue-scoped';end if;
end $$;
rollback;
\echo 'People overviews: cohort, 1000+ records, timezone boundaries, null/future dates, restore history, account/venue isolation and permission checks passed'
