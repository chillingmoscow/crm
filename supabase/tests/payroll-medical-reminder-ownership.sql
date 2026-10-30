begin;
do $test$
declare u uuid;a uuid;v uuid;e uuid;today date;source uuid;ver integer;snapshot jsonb;plan jsonb;k text;preview uuid;run uuid;expiry date;before_count bigint;
begin
 select p.id into u from auth.users p where email='owner@test.com';perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();today:=(now() at time zone 'Europe/Moscow')::date;expiry:=today+30;
 select version into ver from public.payroll_automation_settings where venue_id=v;
 perform public.payroll_set_execution_policy(coalesce((select version from public.payroll_execution_policy where venue_id=v),0),today,null,true);
 insert into public.payroll_employees(account_id,venue_id,name,role_name,active,local_user_id) values(a,v,'Medical notification fixture','Бармен',true,u) returning id into e;
 perform public.payroll_save_automation_person(e,0,jsonb_build_object('hired_on',today-100,'birthday',null,'gender',null,'gift_role',null,'medical_required',true,'medical_state','present','examined_on',today-99,'valid_until',expiry,'reimbursement_state','recorded','new_medical_case',false,'legacy_reconciled',true,'missing_fine_state','not_recorded','expiry_fine_state','not_recorded'));
 update public.staff_account_details set medical_book_expiry_notified_for=null where account_id=a and user_id=u;
 select medical_case_id into source from public.payroll_automation_people where employee_id=e;
 k:='payroll:'||v||':'||e||':medical_reminder:'||source||':expiry:'||expiry;
 plan:=jsonb_build_object('decisions',jsonb_build_array(jsonb_build_object('key',k,'venueId',v,'employeeId',e,'sourceId',source,'ruleVersion',ver,'businessDate',today,'rule','medical_reminder','kind','notification','medium','none','amount',0,'reason','Истекает срок действия медицинской книжки')),'blockers','[]'::jsonb,'recordedCandidates','[]'::jsonb);
 snapshot:=public.payroll_automation_snapshot(v);
 preview:=public.payroll_commit_automation_run(v,today,snapshot,plan,'comparison',u);
 if exists(select 1 from public.notifications where entity_id=e) then raise exception 'Comparison sent notification';end if;
 run:=public.payroll_commit_automation_run(v,today,snapshot,plan,'native',u,preview);
 if (select count(*) from public.notifications where entity_id=e and user_id=u)<>1 then raise exception 'Employee/owner notification not delivered exactly once';end if;
 if (select medical_book_expiry_notified_for from public.staff_account_details where account_id=a and user_id=u) is distinct from expiry then raise exception 'Shared expiry marker not set';end if;
 select count(*) into before_count from public.notifications where user_id=u;
 perform public.enqueue_medical_book_expiry_notifications();
 if (select count(*) from public.notifications where user_id=u)<>before_count then raise exception 'Existing HR worker duplicated payroll reminder';end if;
 snapshot:=public.payroll_automation_snapshot(v);preview:=public.payroll_commit_automation_run(v,today,snapshot,plan,'comparison',u);perform public.payroll_commit_automation_run(v,today,snapshot,plan,'native',u,preview);
 if (select count(*) from public.notifications where entity_id=e and user_id=u)<>1 then raise exception 'Repeated reminder duplicated notification';end if;
 raise notice 'PASS: comparison silent, one employee/owner notification, profile link, shared marker, old HR worker and retry deduplicated';
end $test$;
rollback;
