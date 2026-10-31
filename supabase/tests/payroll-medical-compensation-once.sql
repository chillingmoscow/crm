begin;
select set_config('test.payroll_owner',(select id::text from auth.users where email='owner@test.com'),true);
do $test$
declare u uuid:=current_setting('test.payroll_owner')::uuid;a uuid;v uuid;e uuid;s public.payroll_automation_people;payload jsonb;cfg jsonb;today date;snapshot jsonb;plan jsonb;decision jsonb;preview uuid;run uuid;key text;
begin
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();today:=(now() at time zone 'Europe/Moscow')::date;
 insert into public.payroll_employees(account_id,venue_id,name,role_name,active,quickresto_id) values(a,v,'Single medical award fixture','Бармен',true,999999978) returning id into e;
 select config into cfg from public.payroll_automation_settings where venue_id=v;
 if cfg is null then raise exception 'Fixture settings are missing';end if;
 perform public.payroll_set_execution_policy(coalesce((select version from public.payroll_execution_policy where venue_id=v),0),today,null,true);
 payload:=jsonb_build_object('hired_on',today-200,'birthday',null,'gender',null,'gift_role',null,'medical_required',true,'medical_state','present','examined_on',today-100,'valid_until',today+265,'reimbursement_state','not_recorded','new_medical_case',false,'legacy_reconciled',false,'missing_fine_state','unknown','expiry_fine_state','not_recorded');
 perform public.payroll_save_automation_person(e,0,payload);
 select * into s from public.payroll_automation_people where employee_id=e;
 key:='payroll:'||v||':'||e||':medical_reimbursement:'||s.medical_case_id||':once';
 decision:=jsonb_build_object('key',key,'venueId',v,'employeeId',e,'sourceId',s.medical_case_id,'ruleVersion',(select version from public.payroll_automation_settings where venue_id=v),'businessDate',today,'rule','medical_reimbursement','kind','bonus','medium','money','amount',3000,'reason','Компенсация медицинской книжки');
 plan:=jsonb_build_object('decisions',jsonb_build_array(decision),'blockers','[]'::jsonb,'recordedCandidates','[]'::jsonb);
 snapshot:=public.payroll_automation_snapshot(v);
 preview:=public.payroll_commit_automation_run(v,today,snapshot,plan,'comparison',u);
 run:=public.payroll_commit_automation_run(v,today,snapshot,plan,'native',u,preview);
 if (select applied_count from public.payroll_automation_runs where id=run)<>1 or (select reimbursement_state from public.payroll_automation_people where employee_id=e)<>'recorded' then raise exception 'First compensation not recorded';end if;
 -- Renewal and temporary document absence must not reset the lifetime award.
 payload:=payload||jsonb_build_object('examined_on',today,'valid_until',today+365,'new_medical_case',true);
 perform public.payroll_save_automation_person(e,(select version from public.payroll_automation_people where employee_id=e),payload);
 if (select medical_case_id from public.payroll_automation_people where employee_id=e)=s.medical_case_id or (select reimbursement_state from public.payroll_automation_people where employee_id=e)<>'recorded' then raise exception 'Renewal reset compensation';end if;
 perform public.payroll_save_automation_person(e,(select version from public.payroll_automation_people where employee_id=e),jsonb_set(payload,'{medical_state}','"missing"'));
 if (select reimbursement_state from public.payroll_automation_people where employee_id=e)<>'recorded' then raise exception 'Missing document reset compensation';end if;
 perform public.payroll_save_automation_person(e,(select version from public.payroll_automation_people where employee_id=e),payload);
 -- Even an old integration with stale state and a different key cannot double-accrue.
 update public.payroll_automation_people set reimbursement_state='not_recorded',version=version+1 where employee_id=e;
 key:='payroll:'||v||':'||e||':medical_reimbursement:'||e||':once';
 decision:=decision||jsonb_build_object('key',key,'sourceId',e);
 plan:=jsonb_set(plan,'{decisions}',jsonb_build_array(decision));snapshot:=public.payroll_automation_snapshot(v);
 preview:=public.payroll_commit_automation_run(v,today,snapshot,plan,'comparison',u);
 run:=public.payroll_commit_automation_run(v,today,snapshot,plan,'native',u,preview);
 if (select applied_count from public.payroll_automation_runs where id=run)<>0 or (select count(*) from public.payroll_adjustments where employee_id=e)<>1 then raise exception 'Repeated compensation accepted';end if;
 -- The ordinary card cannot submit hidden accounting controls.
 begin
 perform public.payroll_save_employee_medical(e,(select version from public.payroll_automation_people where employee_id=e),jsonb_build_object('medical_required',true,'medical_state','present','examined_on',today,'valid_until',today+365,'reimbursement_state','not_recorded'),null,null,null);
 raise exception 'Accounting override accepted';exception when raise_exception then if sqlerrm<>'Проверьте данные медкнижки' then raise;end if;end;
end $test$;
rollback;
