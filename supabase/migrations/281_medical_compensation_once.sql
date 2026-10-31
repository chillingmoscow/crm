begin;
-- Reimbursement belongs to the employee, not to a renewal of the medical book.
-- Existing consumed effects keep their keys and financial links.
do $$ declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.payroll_save_automation_person(uuid,integer,jsonb)'::regprocedure);
 needle:='new_row.reimbursement_state:=p_input->>''reimbursement_state'';';
 if position(needle in definition)=0 then raise exception 'Medical source contract changed';end if;
 definition:=replace(definition,needle,'new_row.reimbursement_state:=case when old_row.reimbursement_state=''recorded'' or exists(select 1 from public.payroll_automation_effects where account_id=a and employee_id=p_employee and decision->>''rule''=''medical_reimbursement'') then ''recorded'' else p_input->>''reimbursement_state'' end;');
 needle:='new_row.reimbursement_state:=''unknown'';';
 if position(needle in definition)=0 then raise exception 'Missing document contract changed';end if;
 definition:=replace(definition,needle,'new_row.reimbursement_state:=coalesce(old_row.reimbursement_state,''unknown'');');
 execute definition;
 definition:=pg_get_functiondef('private.payroll_automation_medical_changed()'::regprocedure);
 needle:='reimbursement_state=''unknown'',';
 if position(needle in definition)=0 then raise exception 'HR medical source contract changed';end if;
 execute replace(definition,needle,'');
 definition:=pg_get_functiondef('public.payroll_commit_automation_source_run(uuid,date,jsonb,jsonb,text,uuid,uuid)'::regprocedure);
 needle:='select * into effect from public.payroll_automation_effects where event_key=r->>''key'';';
 if position(needle in definition)=0 then raise exception 'Automation effect contract changed';end if;
 definition:=replace(definition,'p.legacy_reconciled and case r->>''rule''','case r->>''rule''');
 definition:=replace(definition,needle,$replacement$
  if r->>'rule'='medical_reimbursement' and exists(select 1 from public.payroll_automation_effects where account_id=a and employee_id=(r->>'employeeId')::uuid and decision->>'rule'='medical_reimbursement') then continue;end if;
  select * into effect from public.payroll_automation_effects where event_key=r->>'key';$replacement$);
 needle:='applied:=applied+1;';
 if position(needle in definition)=0 then raise exception 'Automation accounting contract changed';end if;
 definition:=replace(definition,needle,$replacement$
  if r->>'rule'='medical_reimbursement' then
   update public.payroll_automation_people set reimbursement_state='recorded',version=version+1,updated_at=now(),updated_by=p_actor where employee_id=(r->>'employeeId')::uuid;
   insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details)
   values(a,p_venue,p_actor,'payroll.automation_person.updated','payroll_automation_person',(r->>'employeeId')::uuid,jsonb_build_object('employee_name',(select name from public.payroll_employees where id=(r->>'employeeId')::uuid),'reason','Однократная компенсация медкнижки учтена в зарплате','changes',jsonb_build_array(jsonb_build_object('field','reimbursement_state','old','not_recorded','new','recorded'))));
  end if;
  applied:=applied+1;$replacement$);
 execute definition;
end $$;
alter function public.payroll_save_automation_person(uuid,integer,jsonb) set search_path=public,pg_catalog;
alter function public.payroll_commit_automation_source_run(uuid,date,jsonb,jsonb,text,uuid,uuid) set search_path=public,pg_catalog;

-- Document forms edit only the document. Accounting state is retained from DB.
alter function public.payroll_save_employee_medical(uuid,integer,jsonb,text,text,date) rename to payroll_save_employee_medical_source;
revoke all on function public.payroll_save_employee_medical_source(uuid,integer,jsonb,text,text,date) from public,anon,authenticated,service_role;
create function public.payroll_save_employee_medical(p_employee uuid,p_version integer,p_medical jsonb,p_number text,p_expected_number text,p_expected_until date) returns void
language plpgsql security definer set search_path=public,pg_catalog as $$
declare a uuid;v uuid;u uuid;p public.payroll_automation_people;payload jsonb;renewal boolean;expiry_state text;reviewed boolean;today date;compensation text;
begin
 select s.a,s.v,s.u into a,v,u from private.payroll_scope('payroll.configure') s;
 perform pg_advisory_xact_lock(hashtextextended('payroll-automation:'||v,0));
 if not exists(select 1 from public.payroll_employees where id=p_employee and account_id=a and venue_id=v) then raise exception 'Сотрудник недоступен';end if;
 select * into p from public.payroll_automation_people where employee_id=p_employee for update;
 if p_version is distinct from coalesce(p.version,0) then raise exception 'Медкнижка изменена. Обновите карточку';end if;
 if jsonb_typeof(p_medical) is distinct from 'object' or p_medical-array['medical_required','medical_state','examined_on','valid_until']<>'{}'::jsonb or not(p_medical ?& array['medical_required','medical_state','examined_on','valid_until']) then raise exception 'Проверьте данные медкнижки';end if;
 today:=(now() at time zone coalesce((select timezone from public.venues where id=v),'Europe/Moscow'))::date;
 -- A fresh native card has no legacy compensation to reconcile. Imported
 -- unknown/cancelled cases stay held; a consumed effect always wins.
 compensation:=case
  when p.reimbursement_state='recorded' or exists(select 1 from public.payroll_automation_effects where account_id=a and employee_id=p_employee and decision->>'rule'='medical_reimbursement') then 'recorded'
  when p.reimbursement_state='unknown' and not exists(select 1 from public.payroll_events where account_id=a and venue_id=v and employee_id=p_employee and action='automation_source_imported' and details->>'legacy_employee_id' is not null) then 'not_recorded'
  else coalesce(p.reimbursement_state,'not_recorded') end;
 renewal:=coalesce(p_medical->>'medical_state'='present' and (p_medical->>'valid_until')::date>today and (
  ((p_medical->>'examined_on')::date>p.examined_on and (p_medical->>'valid_until')::date>p.valid_until)
  or (p.medical_case_id is not null and p.medical_state='unknown' and p.examined_on is null and p_medical->>'examined_on' is not null)),false);
 expiry_state:=case when renewal or (p_medical->>'medical_state'='present' and (p_medical->>'valid_until')::date>today and p.expiry_fine_state='unknown') then 'not_recorded' else coalesce(p.expiry_fine_state,'not_recorded') end;
 reviewed:=coalesce(p.legacy_reconciled,false) or (p.employee_id is null and p_medical->>'medical_state' in ('missing','present')) or (p_medical->>'medical_state'='present' and compensation in ('recorded','not_recorded') and expiry_state in ('recorded','not_recorded','waived'));
 payload:=p_medical||jsonb_build_object('reimbursement_state',compensation,'new_medical_case',renewal,'legacy_reconciled',coalesce(reviewed,false),'missing_fine_state',coalesce(p.missing_fine_state,'not_recorded'),'expiry_fine_state',expiry_state);
 perform public.payroll_save_employee_medical_source(p_employee,p_version,payload,p_number,p_expected_number,p_expected_until);
end $$;
revoke all on function public.payroll_save_employee_medical(uuid,integer,jsonb,text,text,date) from public,anon;
grant execute on function public.payroll_save_employee_medical(uuid,integer,jsonb,text,text,date) to authenticated;
notify pgrst,'reload schema';
commit;
