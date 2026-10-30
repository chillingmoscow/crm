begin;
do $test$
declare u uuid;a uuid;v uuid;e uuid;i uuid;today date;source uuid;ver integer;snapshot jsonb;plan jsonb;k text;job uuid;lease uuid;run uuid;native_count bigint;
begin
 select p.id into u from auth.users p where email='owner@test.com';perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();today:=(now() at time zone 'Europe/Moscow')::date;
 select version into ver from public.payroll_automation_settings where venue_id=v;
 perform public.payroll_set_execution_policy(coalesce((select version from public.payroll_execution_policy where venue_id=v),0),today,null,true);
 insert into public.payroll_employees(account_id,venue_id,name,role_name,active) values(a,v,'Native scheduled fixture','Бармен',true) returning id into e;
 perform public.payroll_save_automation_person(e,0,jsonb_build_object('hired_on',today-100,'birthday',null,'gender',null,'gift_role',null,'medical_required',true,'medical_state','present','examined_on',today-99,'valid_until',today-1,'reimbursement_state','recorded','new_medical_case',false,'legacy_reconciled',true,'missing_fine_state','not_recorded','expiry_fine_state','not_recorded'));
 select medical_case_id into source from public.payroll_automation_people where employee_id=e;
 i:=public.payroll_add_uniform_issue(e,'Форма fixture',jsonb_build_array(jsonb_build_object('dueOn',today,'amount',25)),gen_random_uuid());
 k:='payroll:'||v||':'||e||':medical_expired:'||source||':once';
 plan:=jsonb_build_object('decisions',jsonb_build_array(
 jsonb_build_object('key',k,'venueId',v,'employeeId',e,'sourceId',source,'ruleVersion',ver,'businessDate',today,'rule','medical_expired','kind','deduction','medium','money','amount',3000,'reason','Медицинская книжка просрочена'),
 jsonb_build_object('key','payroll:'||v||':'||e||':uniform:'||i||':1','venueId',v,'employeeId',e,'sourceId',i,'ruleVersion',ver,'businessDate',today,'rule','uniform','kind','deduction','medium','money','amount',25,'reason','Возмещение стоимости формы (1/1)')),'blockers','[]'::jsonb,'recordedCandidates','[]'::jsonb);
 snapshot:=public.payroll_automation_snapshot(v);lease:=gen_random_uuid();
 insert into public.payroll_automation_jobs(account_id,venue_id,business_date,fingerprint,state,lease_token,claimed_at) values(a,v,today,md5(snapshot::text),'running',lease,now()) returning id into job;
 run:=public.payroll_commit_scheduled_automation(job,lease,snapshot,plan);
 if (select mode from public.payroll_automation_runs where id=run)<>'native' then raise exception 'Scheduled medical/uniform did not apply after explicit cutover';end if;
 if (select sum(amount) from public.payroll_adjustments where employee_id=e)<>-3025 then raise exception 'Wrong scheduled money effects';end if;
 if public.payroll_commit_scheduled_automation(job,lease,snapshot,plan)<>run then raise exception 'Lost completion response was not idempotent';end if;
 if (select count(*) from public.payroll_adjustments where employee_id=e)<>2 then raise exception 'Scheduled repeat duplicated a deduction';end if;
 raise notice 'PASS: atomic scheduled comparison/native commit, medical once per case, uniform installment, response loss and no repeated effects';
end $test$;
rollback;
