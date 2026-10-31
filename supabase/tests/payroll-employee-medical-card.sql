begin;
select set_config('test.payroll_owner',(select id::text from auth.users where email='owner@test.com'),true);
do $test$
declare u uuid:=current_setting('test.payroll_owner')::uuid;a uuid;v uuid;e uuid;s public.payroll_automation_people;hr public.staff_account_details;payload jsonb;medical jsonb;expected_number text;expected_until date;before_pay bigint;before_tx bigint;
begin
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 select * into hr from public.staff_account_details where account_id=a and user_id=u;
 expected_number:=hr.medical_book_number;expected_until:=hr.medical_book_date;
 insert into public.payroll_employees(account_id,venue_id,name,role_name,active,local_user_id,quickresto_id) values(a,v,'Medical card fixture','Бармен',true,u,999999979) returning id into e;
 payload:=jsonb_build_object('hired_on',coalesce(hr.employment_date,current_date-100),'birthday','1990-01-01','gender','male','gift_role','saved fixture','medical_required',true,'medical_state','present','examined_on',current_date-20,'valid_until',coalesce(expected_until,current_date+200),'reimbursement_state','recorded','new_medical_case',false,'legacy_reconciled',true,'missing_fine_state','waived','expiry_fine_state','not_recorded');
 perform public.payroll_save_automation_person(e,0,payload);
 select * into s from public.payroll_automation_people where employee_id=e;
 select medical_book_number,medical_book_date into expected_number,expected_until from public.staff_account_details where account_id=a and user_id=u;
 medical:=jsonb_build_object('medical_required',true,'medical_state','present','valid_until',current_date+365,'examined_on',current_date-20);
 select count(*) into before_pay from public.payroll_adjustments;select count(*) into before_tx from public.transactions;
 perform public.payroll_save_employee_medical(e,s.version,medical,'fixture book',expected_number,expected_until);
 if not exists(select 1 from public.staff_account_details where account_id=a and user_id=u and medical_book_number='fixture book' and medical_book_date=current_date+365) then raise exception 'HR not saved';end if;
 if not exists(select 1 from public.payroll_automation_people where employee_id=e and medical_state='present' and valid_until=current_date+365 and examined_on=current_date-20 and legacy_reconciled and birthday='1990-01-01' and gift_role='saved fixture' and medical_case_id=s.medical_case_id) then raise exception 'Reviewed source or unrelated fields lost';end if;
 select * into s from public.payroll_automation_people where employee_id=e;
 -- Validation fails after the HR write: both parts must roll back.
 begin
  perform public.payroll_save_employee_medical(e,s.version,jsonb_set(medical,'{medical_state}','"invalid"'),'must rollback','fixture book',current_date+365);
  raise exception 'Invalid input accepted';
 exception when raise_exception then if sqlerrm<>'Проверьте сведения' then raise;end if;end;
 if not exists(select 1 from public.staff_account_details where account_id=a and user_id=u and medical_book_number='fixture book') or (select version from public.payroll_automation_people where employee_id=e)<>s.version then raise exception 'Partial medical write';end if;
 begin
  perform public.payroll_save_employee_medical(e,s.version-1,medical,'stale','fixture book',current_date+365);raise exception 'Stale source accepted';
 exception when raise_exception then if sqlerrm<>'Медкнижка изменена. Обновите карточку' then raise;end if;end;
 begin
  perform public.payroll_save_employee_medical(e,s.version,medical,'stale','old number',current_date+365);raise exception 'Stale HR accepted';
 exception when raise_exception then if sqlerrm<>'Документ изменён в другой вкладке. Обновите карточку' then raise;end if;end;
 begin
  perform public.payroll_save_employee_medical(gen_random_uuid(),0,medical,null,null,null);raise exception 'Foreign employee accepted';
 exception when raise_exception then if sqlerrm<>'Сотрудник недоступен' then raise;end if;end;
 if (select count(*) from public.payroll_adjustments)<>before_pay or (select count(*) from public.transactions)<>before_tx then raise exception 'Document edit created finance/payroll effect';end if;
 if not exists(select 1 from public.audit_logs where entity_type='payroll_automation_person' and entity_id=e and user_id=u and action_code='payroll.automation_person.updated') then raise exception 'Source history absent';end if;
 -- A later edit in the basic HR card also retains the single award. The
 -- document editor can confirm the renewed book without technical checkboxes.
 perform public.upsert_staff_account_details(a,u,jsonb_build_object('medical_book_date',current_date+400));
 select * into s from public.payroll_automation_people where employee_id=e;
 if s.reimbursement_state<>'recorded' or s.medical_state<>'unknown' then raise exception 'HR edit lost compensation';end if;
 medical:=medical||jsonb_build_object('examined_on',current_date,'valid_until',current_date+400);
 perform public.payroll_save_employee_medical(e,s.version,medical,'fixture book','fixture book',current_date+400);
 if not exists(select 1 from public.payroll_automation_people where employee_id=e and reimbursement_state='recorded' and medical_state='present' and expiry_fine_state='not_recorded') then raise exception 'Renewed HR document cannot be confirmed';end if;

end $test$;
rollback;
