begin;
select set_config('test.payroll_owner',(select id::text from auth.users where email='owner@test.com'),true);
do $test$
declare u uuid:=current_setting('test.payroll_owner')::uuid;a uuid;v uuid;e uuid;i uuid:=gen_random_uuid();other uuid:=gen_random_uuid();s public.payroll_automation_people;cfg jsonb;staff_id uuid;payload jsonb;snapshot jsonb;plan jsonb;decision jsonb;run uuid;preview uuid;today date;key text;before_count bigint;
begin
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 select id into e from public.payroll_employees where venue_id=v and active and not exists(select 1 from public.payroll_automation_people p where p.employee_id=payroll_employees.id) order by local_user_id nulls last limit 1;
 if e is null then raise exception 'Missing payroll employee fixture';end if;
 today:=(now() at time zone 'Europe/Moscow')::date;
 cfg:=$cfg${"medical": {"reminders": true, "reminder_after_hire_days": 3, "reminder_before_expiry_days": 30, "submission_fine": true, "submission_after_hire_months": 1, "submission_amount": 3000, "expiry_fine": true, "expiry_amount": 3000, "expiry_frequency": "once_per_expiry_case", "reimbursement": true, "reimbursement_amount": 3000, "reimbursement_after_exam_months": 3, "reimbursement_requires_exam_after_hire": true}, "uniform": {"enabled": true, "installments": 4, "payment_days": [3, 18]}, "tasks": {"missing_enabled": true, "missing_kind": "deduction", "missing_amount": 200, "extra_reward_enabled": true, "extra_reward_medium": "bonus"}, "gifts": {"enabled": false, "tenure_boundary_days": 90, "holidays": [], "tenure": []}}$cfg$::jsonb;
 perform public.payroll_save_automation_settings(v,coalesce((select version from public.payroll_automation_settings where venue_id=v),0),cfg);
 payload:=jsonb_build_object('hired_on',today-100,'birthday',null,'gender',null,'gift_role',null,'medical_required',true,'medical_state','present','examined_on',today-99,'valid_until',today-1,'reimbursement_state','recorded','new_medical_case',false,'legacy_reconciled',true,'missing_fine_state','not_recorded','expiry_fine_state','not_recorded');
 perform public.payroll_save_automation_person(e,0,payload);
 select * into s from public.payroll_automation_people where employee_id=e;
 if s.version<>1 or s.employment_id is null or s.medical_case_id is null then raise exception 'Source creation failed';end if;
 begin
  perform public.payroll_save_automation_person(e,0,payload);raise exception 'Stale source write accepted';
 exception when raise_exception then if sqlerrm not like 'Сведения изменились%' then raise;end if;end;
 begin
  perform public.payroll_save_automation_person(other,0,payload);raise exception 'Foreign employee accepted';
 exception when raise_exception then if sqlerrm<>'Сотрудник недоступен' then raise;end if;end;
 begin
  perform public.payroll_save_automation_person(e,1,jsonb_set(payload,'{medical_state}','null'));raise exception 'Null enum accepted';
 exception when raise_exception then if sqlerrm<>'Проверьте сведения' then raise;end if;end;
 payload:=jsonb_set(payload,'{hired_on}',to_jsonb((today-101)::text));
 perform public.payroll_save_automation_person(e,1,payload);
 if not exists(select 1 from public.payroll_automation_people where employee_id=e and employment_id=s.employment_id and medical_case_id=s.medical_case_id and version=2) then raise exception 'Correction changed event identity';end if;
 perform public.payroll_save_automation_person(e,2,jsonb_set(payload,'{medical_state}','"missing"'));
 perform public.payroll_save_automation_person(e,3,payload);
 if (select medical_case_id from public.payroll_automation_people where employee_id=e)<>s.medical_case_id then raise exception 'State round trip changed case ID';end if;
 key:='payroll:'||v||':'||e||':medical_expired:'||s.medical_case_id||':once';
 decision:=jsonb_build_object('key',key,'venueId',v,'employeeId',e,'sourceId',s.medical_case_id,'ruleVersion',(select version from public.payroll_automation_settings where venue_id=v),'businessDate',today,'rule','medical_expired','kind','deduction','medium','money','amount',3000,'reason','Медицинская книжка просрочена');
 plan:=jsonb_build_object('decisions',jsonb_build_array(decision),'blockers','[]'::jsonb,'recordedCandidates','[]'::jsonb);
 snapshot:=public.payroll_automation_snapshot(v);
 select count(*) into before_count from public.payroll_adjustments;
 begin
  perform public.payroll_commit_automation_run(v,today,snapshot,plan,'native',u,null);raise exception 'Missing comparison accepted';
 exception when raise_exception then if sqlerrm not like 'Сначала выполните%' then raise;end if;end;
 preview:=public.payroll_commit_automation_run(v,today,snapshot,plan,'comparison',u);
 if (select count(*) from public.payroll_adjustments)<>before_count then raise exception 'Comparison changed salary';end if;
 begin
  perform public.payroll_commit_automation_run(v,today,snapshot,jsonb_set(plan,'{decisions,0,amount}','4000'),'native',u,preview);raise exception 'Changed preview accepted';
 exception when raise_exception then if sqlerrm not like 'Сначала выполните%' then raise;end if;end;
 run:=public.payroll_commit_automation_run(v,today,snapshot,plan,'native',u,preview);
 if (select applied_count from public.payroll_automation_runs where id=run)<>1 then raise exception 'Native entry was not created';end if;
 if not exists(select 1 from public.payroll_adjustments where automation_key=key and amount=-3000 and medium='money' and managed and approved) then raise exception 'Wrong salary entry';end if;
 if not exists(select 1 from public.payroll_adjustment_history h join public.payroll_automation_effects f on f.adjustment_id=h.adjustment_id where f.event_key=key and h.actor_id=u) then raise exception 'Initiating actor lost';end if;
 begin
  perform public.payroll_commit_automation_run(v,today,snapshot,plan,'native',u,preview);raise exception 'Stale snapshot accepted';
 exception when raise_exception then if sqlerrm not like 'Источники изменились%' then raise;end if;end;
 snapshot:=public.payroll_automation_snapshot(v);
 preview:=public.payroll_commit_automation_run(v,today,snapshot,plan,'comparison',u);
 run:=public.payroll_commit_automation_run(v,today,snapshot,plan,'native',u,preview);
 if (select applied_count from public.payroll_automation_runs where id=run)<>0 or (select count(*) from public.payroll_adjustments)<>before_count+1 then raise exception 'Repeated effect charged again';end if;
 -- A blocker for a person holds their money even when the plan contains a candidate.
 decision:=jsonb_set(decision,'{key}',to_jsonb(key||'-held'));
 plan:=jsonb_build_object('decisions',jsonb_build_array(decision),'blockers',jsonb_build_array(jsonb_build_object('employeeId',e,'code','legacy_unchecked','message','Нужна проверка')),'recordedCandidates','[]'::jsonb);
 preview:=public.payroll_commit_automation_run(v,today,snapshot,plan,'comparison',u);
 run:=public.payroll_commit_automation_run(v,today,snapshot,plan,'native',u,preview);
 if (select applied_count from public.payroll_automation_runs where id=run)<>0 then raise exception 'Held entry applied';end if;
 -- Bonus gifts are comparison only: no external or salary effect is recorded.
 decision:=jsonb_set(jsonb_set(jsonb_set(decision,'{medium}','"bonus"'),'{kind}','"bonus"'),'{rule}','"holiday"');
 plan:=jsonb_build_object('decisions',jsonb_build_array(decision),'blockers','[]'::jsonb,'recordedCandidates','[]'::jsonb);
 preview:=public.payroll_commit_automation_run(v,today,snapshot,plan,'comparison',u);
 run:=public.payroll_commit_automation_run(v,today,snapshot,plan,'native',u,preview);
 if (select applied_count from public.payroll_automation_runs where id=run)<>0 then raise exception 'Bonus operation applied';end if;
 -- Uniform request identity survives retries, and changed retries are rejected.
 perform public.payroll_add_uniform_issue(e,'Футболка',jsonb_build_array(jsonb_build_object('dueOn',today,'amount',250)),i);
 perform public.payroll_add_uniform_issue(e,'Футболка',jsonb_build_array(jsonb_build_object('dueOn',today,'amount',250)),i);
 begin
  perform public.payroll_add_uniform_issue(e,'Другая покупка',jsonb_build_array(jsonb_build_object('dueOn',today,'amount',250)),i);raise exception 'Changed uniform retry accepted';
 exception when raise_exception then if sqlerrm<>'Повторный запрос изменён' then raise;end if;end;
 perform public.payroll_cancel_uniform_issue(i,'Исправление покупки');
 perform public.payroll_cancel_uniform_issue(i,'Повтор');
 if exists(select 1 from jsonb_array_elements(public.payroll_automation_snapshot(v)->'uniform') t where t->>'id'=i::text) then raise exception 'Cancelled issue is still due';end if;
 if (select count(*) from public.payroll_adjustments)<>before_count+1 then raise exception 'Source edits changed posted salary';end if;
 select local_user_id into staff_id from public.payroll_employees where id=e;
 if staff_id is not null then
  update public.staff_account_details set medical_book_date=today+365 where account_id=a and user_id=staff_id;
  if not exists(select 1 from public.payroll_automation_people where employee_id=e and medical_state='unknown' and valid_until=today+365 and not legacy_reconciled and medical_case_id=s.medical_case_id) then raise exception 'Document card edit did not invalidate review';end if;
 end if;
 if has_table_privilege('authenticated','public.payroll_automation_people','UPDATE') or has_function_privilege('authenticated','public.payroll_commit_automation_run(uuid,date,jsonb,jsonb,text,uuid,uuid)','EXECUTE') or has_function_privilege('anon','public.payroll_save_automation_person(uuid,integer,jsonb)','EXECUTE') then raise exception 'Unsafe grants';end if;
 raise notice 'PASS: source validation, stable identities, preview equality, stale snapshots, deduplication, held rows, bonus shadow, uniform cancellation, actor history and grants';
end $test$;
set local role authenticated;
select set_config('request.jwt.claim.sub','',true),set_config('app.ctx_ready','0',true);
do $$ begin if exists(select 1 from public.payroll_automation_people) or exists(select 1 from public.payroll_uniform_issues) or exists(select 1 from public.payroll_automation_runs) or exists(select 1 from public.payroll_automation_effects) then raise exception 'Unauthenticated RLS leak';end if;end $$;
rollback;
