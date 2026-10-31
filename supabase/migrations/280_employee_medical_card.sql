begin;
-- One document editor writes HR fields and the reviewed payroll state atomically.
create function public.payroll_save_employee_medical(p_employee uuid,p_version integer,p_medical jsonb,p_number text,p_expected_number text,p_expected_until date) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare a uuid;v uuid;u uuid;e public.payroll_employees;person public.payroll_automation_people;hr public.staff_account_details;payload jsonb;current_version integer;until_date date;
begin
 select s.a,s.v,s.u into a,v,u from private.payroll_scope('payroll.configure') s;
 perform pg_advisory_xact_lock(hashtextextended('payroll-automation:'||v,0));
 select * into e from public.payroll_employees where id=p_employee and account_id=a and venue_id=v;
 if e.id is null then raise exception 'Сотрудник недоступен';end if;
 select * into person from public.payroll_automation_people where employee_id=e.id for update;
 if p_version is distinct from coalesce(person.version,0) then raise exception 'Медкнижка изменена. Обновите карточку';end if;
 if jsonb_typeof(p_medical) is distinct from 'object' or octet_length(p_medical::text)>4096
 or p_medical-array['medical_required','medical_state','examined_on','valid_until','reimbursement_state','missing_fine_state','expiry_fine_state','new_medical_case','legacy_reconciled']<>'{}'::jsonb
 or not(p_medical ?& array['medical_required','medical_state','examined_on','valid_until','reimbursement_state','missing_fine_state','expiry_fine_state','new_medical_case','legacy_reconciled'])
 or length(coalesce(p_number,''))>100 then raise exception 'Проверьте данные медкнижки';end if;
 until_date:=(p_medical->>'valid_until')::date;
 if e.local_user_id is not null then
  select * into hr from public.staff_account_details where account_id=a and user_id=e.local_user_id for update;
  if hr.medical_book_number is distinct from p_expected_number or hr.medical_book_date is distinct from p_expected_until then raise exception 'Документ изменён в другой вкладке. Обновите карточку';end if;
  if hr.medical_book_number is distinct from nullif(trim(p_number),'') or hr.medical_book_date is distinct from until_date then
   perform public.upsert_staff_account_details(a,e.local_user_id,jsonb_build_object('medical_book_number',nullif(trim(p_number),''),'medical_book_date',until_date));
  end if;
 elsif p_number is not null then raise exception 'Номер документа доступен в личной карточке сотрудника';end if;
 -- HR changes invalidate the old review. Check the original version first, then
 -- save the final state in this same transaction, retaining unrelated fields.
 select coalesce(version,0) into current_version from public.payroll_automation_people where employee_id=e.id;
 payload:=p_medical||jsonb_build_object('hired_on',coalesce(hr.employment_date,person.hired_on,e.hired_on),'birthday',person.birthday,'gender',person.gender,'gift_role',person.gift_role);
 perform public.payroll_save_automation_person(e.id,coalesce(current_version,0),payload);
end $$;
revoke all on function public.payroll_save_employee_medical(uuid,integer,jsonb,text,text,date) from public,anon;
grant execute on function public.payroll_save_employee_medical(uuid,integer,jsonb,text,text,date) to authenticated;
-- Administrative notifications open the employee, not a migration workspace.
do $$ declare definition text;needle text:=$needle$case when recipient=e.local_user_id then '/profile' else '/people/automations' end$needle$;
begin
 definition:=pg_get_functiondef('public.payroll_commit_automation_run(uuid,date,jsonb,jsonb,text,uuid,uuid)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Reminder link contract changed';end if;
 definition:=replace(definition,needle,$replacement$case when recipient=e.local_user_id then '/profile' when e.local_user_id is not null then '/people/staff/'||e.local_user_id||'?tab=documents' else '/people/payroll/'||e.id||'?tab=documents' end$replacement$);
 execute definition;
end $$;
notify pgrst,'reload schema';
commit;
