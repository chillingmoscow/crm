begin;
-- Reviewed source state is separate from documents/attachments and from pay rates.
create table public.payroll_automation_people (
 employee_id uuid primary key, account_id uuid not null, venue_id uuid not null,
 employment_id uuid not null default gen_random_uuid(), hired_on date,
 legacy_reconciled boolean not null default false,
 missing_fine_state text not null default 'unknown' check(missing_fine_state in ('unknown','recorded','not_recorded')),
 expiry_fine_state text not null default 'unknown' check(expiry_fine_state in ('unknown','recorded','not_recorded')),
 birthday date, gender text check(gender in ('male','female')), gift_role text,
 medical_required boolean, medical_state text not null default 'unknown' check(medical_state in ('unknown','missing','present')),
 medical_case_id uuid, examined_on date, valid_until date,
 reimbursement_state text not null default 'unknown' check(reimbursement_state in ('unknown','recorded','not_recorded')),
 version integer not null default 1, updated_at timestamptz not null default now(), updated_by uuid references public.profiles(id),
 foreign key(account_id,venue_id,employee_id) references public.payroll_employees(account_id,venue_id,id),
 check(medical_state<>'present' or medical_case_id is not null),
 check(valid_until is null or examined_on is null or valid_until>=examined_on),
 check(gift_role is null or length(gift_role) between 1 and 100)
);
create index payroll_automation_people_venue on public.payroll_automation_people(venue_id,employee_id);
create table public.payroll_uniform_issues (
 id uuid primary key default gen_random_uuid(), account_id uuid not null, venue_id uuid not null, employee_id uuid not null,
 title text not null check(length(trim(title)) between 1 and 200),
 installments jsonb not null, source_ref text, cancelled_at timestamptz,
 created_at timestamptz not null default now(), created_by uuid references public.profiles(id),
 foreign key(account_id,venue_id,employee_id) references public.payroll_employees(account_id,venue_id,id),
 unique(venue_id,source_ref)
);
create table public.payroll_automation_runs (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null references public.venues(id),
 business_date date not null, fingerprint text not null, mode text not null check(mode in ('comparison','native')),
 applied_count integer not null default 0,decisions jsonb not null, blockers jsonb not null, recorded_candidates jsonb not null,
 created_at timestamptz not null default now(),created_by uuid references public.profiles(id)
);
create index payroll_automation_runs_recent on public.payroll_automation_runs(venue_id,created_at desc);
create table public.payroll_automation_effects (
 event_key text primary key,account_id uuid not null,venue_id uuid not null,employee_id uuid not null,
 decision jsonb not null, adjustment_id uuid references public.payroll_adjustments(id),
 state text not null check(state in ('applied','legacy')),source_ref text,
 created_at timestamptz not null default now(),created_by uuid references public.profiles(id),
 foreign key(account_id,venue_id,employee_id) references public.payroll_employees(account_id,venue_id,id)
);
create index payroll_automation_effects_venue on public.payroll_automation_effects(venue_id);

-- Direct mutation is unavailable to browser roles, including owners.
do $$ declare t text;begin
 foreach t in array array['payroll_automation_people','payroll_uniform_issues','payroll_automation_runs','payroll_automation_effects'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('create policy automation_configure_read on public.%I for select to authenticated using(account_id=public.get_active_account_id() and venue_id=public.get_active_venue_id() and public.has_permission(''payroll.configure''))',t);
 end loop;
end $$;

create function public.payroll_save_automation_person(p_employee uuid,p_version integer,p_input jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare a uuid;v uuid;u uuid;staff_id uuid;staff_row public.staff_account_details;changes jsonb;old_row public.payroll_automation_people;new_row public.payroll_automation_people;
begin
 select s.a,s.v,s.u into a,v,u from private.payroll_scope('payroll.configure') s;
 perform pg_advisory_xact_lock(hashtextextended('payroll-automation:'||v::text,0));
 if not exists(select 1 from public.payroll_employees where id=p_employee and account_id=a and venue_id=v) then raise exception 'Сотрудник недоступен';end if;
 select * into old_row from public.payroll_automation_people where employee_id=p_employee for update;
 if p_version is distinct from coalesce(old_row.version,0) then raise exception 'Сведения изменились. Обновите страницу';end if;
 if p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>4096
 or p_input-array['hired_on','birthday','gender','gift_role','medical_required','medical_state','examined_on','valid_until','reimbursement_state','new_medical_case','legacy_reconciled','missing_fine_state','expiry_fine_state']<>'{}'::jsonb
 or not(p_input ?& array['medical_state','reimbursement_state','new_medical_case','legacy_reconciled','missing_fine_state','expiry_fine_state'])
 or jsonb_typeof(p_input->'new_medical_case') is distinct from 'boolean'
 or jsonb_typeof(p_input->'legacy_reconciled') is distinct from 'boolean'
 or jsonb_typeof(p_input->'missing_fine_state') is distinct from 'string' or p_input->>'missing_fine_state' not in ('unknown','recorded','not_recorded')
 or jsonb_typeof(p_input->'expiry_fine_state') is distinct from 'string' or p_input->>'expiry_fine_state' not in ('unknown','recorded','not_recorded')
 or jsonb_typeof(p_input->'medical_state') is distinct from 'string' or jsonb_typeof(p_input->'reimbursement_state') is distinct from 'string'
 or p_input->>'medical_state' not in ('unknown','missing','present') or p_input->>'reimbursement_state' not in ('unknown','recorded','not_recorded')
 or (p_input->'medical_required' is not null and p_input->'medical_required'<>'null'::jsonb and jsonb_typeof(p_input->'medical_required')<>'boolean') then raise exception 'Проверьте сведения';end if;
 select local_user_id into staff_id from public.payroll_employees where id=p_employee;
 if staff_id is not null then select * into staff_row from public.staff_account_details where account_id=a and user_id=staff_id;end if;
 new_row.employee_id:=p_employee;new_row.account_id:=a;new_row.venue_id:=v;
 new_row.employment_id:=coalesce(old_row.employment_id,gen_random_uuid());
 new_row.legacy_reconciled:=(p_input->>'legacy_reconciled')::boolean;
 new_row.missing_fine_state:=p_input->>'missing_fine_state';new_row.expiry_fine_state:=p_input->>'expiry_fine_state';
 new_row.hired_on:=nullif(p_input->>'hired_on','')::date;new_row.birthday:=nullif(p_input->>'birthday','')::date;
 new_row.gender:=nullif(p_input->>'gender','');new_row.gift_role:=nullif(trim(p_input->>'gift_role'),'');
 new_row.medical_required:=(p_input->>'medical_required')::boolean;new_row.medical_state:=p_input->>'medical_state';
 if new_row.medical_state='present' then
  new_row.medical_case_id:=case when (p_input->>'new_medical_case')::boolean then gen_random_uuid() else coalesce(old_row.medical_case_id,gen_random_uuid()) end;
  new_row.examined_on:=nullif(p_input->>'examined_on','')::date;new_row.valid_until:=nullif(p_input->>'valid_until','')::date;
  new_row.reimbursement_state:=p_input->>'reimbursement_state';
 else new_row.medical_case_id:=old_row.medical_case_id;new_row.examined_on:=old_row.examined_on;new_row.valid_until:=coalesce(old_row.valid_until,staff_row.medical_book_date);new_row.reimbursement_state:='unknown';end if;
 new_row.version:=coalesce(old_row.version,0)+1;new_row.updated_at:=now();new_row.updated_by:=u;
 insert into public.payroll_automation_people select (new_row).* on conflict(employee_id) do update set
 missing_fine_state=excluded.missing_fine_state,expiry_fine_state=excluded.expiry_fine_state,legacy_reconciled=excluded.legacy_reconciled,hired_on=excluded.hired_on,birthday=excluded.birthday,gender=excluded.gender,gift_role=excluded.gift_role,medical_required=excluded.medical_required,medical_state=excluded.medical_state,
 medical_case_id=excluded.medical_case_id,examined_on=excluded.examined_on,valid_until=excluded.valid_until,reimbursement_state=excluded.reimbursement_state,version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
 -- Reuse existing HR dates; document numbers and scans are never copied.
 select local_user_id into staff_id from public.payroll_employees where id=p_employee;
 if staff_id is not null then
  select * into staff_row from public.staff_account_details where account_id=a and user_id=staff_id;
  if new_row.hired_on is distinct from staff_row.employment_date or (new_row.medical_state='present' and new_row.valid_until is distinct from staff_row.medical_book_date) then
   if not public.has_permission('people.edit_staff') then raise exception 'Для изменения дат в карточке сотрудника нужно право редактирования сотрудников';end if;
   insert into public.staff_account_details(account_id,user_id,employment_date,medical_book_date,created_by,updated_by)
   values(a,staff_id,new_row.hired_on,case when new_row.medical_state='present' then new_row.valid_until else staff_row.medical_book_date end,u,u)
   on conflict(account_id,user_id) do update set employment_date=excluded.employment_date,medical_book_date=excluded.medical_book_date,updated_by=u,updated_at=now();
  end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('field',k,'old',to_jsonb(old_row)->k,'new',to_jsonb(new_row)->k)),'[]') into changes
 from unnest(array['hired_on','birthday','gender','gift_role','medical_required','medical_state','examined_on','valid_until','reimbursement_state','legacy_reconciled','missing_fine_state','expiry_fine_state']) k where to_jsonb(old_row)->k is distinct from to_jsonb(new_row)->k;
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details)
 values(a,v,u,case when old_row.employee_id is null then 'payroll.automation_person.created' else 'payroll.automation_person.updated' end,'payroll_automation_person',p_employee,jsonb_build_object('employee_name',(select name from public.payroll_employees where id=p_employee),'changes',changes,'before',to_jsonb(old_row),'after',to_jsonb(new_row)));
end $$;
revoke all on function public.payroll_save_automation_person(uuid,integer,jsonb) from public,anon;
grant execute on function public.payroll_save_automation_person(uuid,integer,jsonb) to authenticated;

create function public.payroll_add_uniform_issue(p_employee uuid,p_title text,p_installments jsonb,p_request uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid;v uuid;u uuid;r jsonb;previous date;total numeric:=0;existing public.payroll_uniform_issues;
begin
 select s.a,s.v,s.u into a,v,u from private.payroll_scope('payroll.configure') s;
 perform pg_advisory_xact_lock(hashtextextended('payroll-automation:'||v::text,0));
 if p_request is null or not exists(select 1 from public.payroll_employees where id=p_employee and account_id=a and venue_id=v) then raise exception 'Сотрудник недоступен';end if;
 select * into existing from public.payroll_uniform_issues where id=p_request;
 if existing.id is not null then
  if existing.account_id<>a or existing.venue_id<>v or existing.employee_id<>p_employee or existing.title is distinct from trim(p_title) or existing.installments is distinct from p_installments then raise exception 'Повторный запрос изменён';end if;return existing.id;
 end if;
 if length(trim(coalesce(p_title,''))) not between 1 and 200 or jsonb_typeof(p_installments) is distinct from 'array' or jsonb_array_length(p_installments) not between 1 and 24 then raise exception 'Проверьте покупку формы';end if;
 for r in select value from jsonb_array_elements(p_installments) loop
  if jsonb_typeof(r)<>'object' or not(r ?& array['dueOn','amount']) or r-array['dueOn','amount']<>'{}'::jsonb or jsonb_typeof(r->'amount') is distinct from 'number'
   or (r->>'amount')::numeric<=0 or (r->>'amount')::numeric>1000000 or (r->>'amount')::numeric<>round((r->>'amount')::numeric,2)
   or (r->>'dueOn')::date is null or (previous is not null and (r->>'dueOn')::date<=previous) then raise exception 'Проверьте части удержания';end if;
  previous:=(r->>'dueOn')::date;total:=total+(r->>'amount')::numeric;
 end loop;
 if total>1000000 then raise exception 'Слишком большая стоимость формы';end if;
 insert into public.payroll_uniform_issues(id,account_id,venue_id,employee_id,title,installments,created_by) values(p_request,a,v,p_employee,trim(p_title),p_installments,u);
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details)
 values(a,v,u,'payroll.uniform.created','payroll_uniform',p_request,jsonb_build_object('employee_name',(select name from public.payroll_employees where id=p_employee),'employee_id',p_employee,'title',p_title,'installments',p_installments));
 return p_request;
end $$;
revoke all on function public.payroll_add_uniform_issue(uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.payroll_add_uniform_issue(uuid,text,jsonb,uuid) to authenticated;

-- A document edited in the existing staff card invalidates the prior automation review.
create function private.payroll_automation_medical_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare e record;before_row public.payroll_automation_people;
begin
 for e in select id,venue_id,name from public.payroll_employees where account_id=new.account_id and local_user_id=new.user_id loop
  perform pg_advisory_xact_lock(hashtextextended('payroll-automation:'||e.venue_id::text,0));
  select * into before_row from public.payroll_automation_people where employee_id=e.id for update;
  if before_row.employee_id is not null and (before_row.valid_until is distinct from new.medical_book_date or before_row.hired_on is distinct from new.employment_date or (tg_op='UPDATE' and old.medical_book_number is distinct from new.medical_book_number)) then
   update public.payroll_automation_people set hired_on=new.employment_date,medical_state='unknown',valid_until=new.medical_book_date,examined_on=null,reimbursement_state='unknown',legacy_reconciled=false,expiry_fine_state='unknown',version=version+1,updated_at=now(),updated_by=auth.uid() where employee_id=e.id;
   insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details)
   values(new.account_id,e.venue_id,auth.uid(),'payroll.automation_person.updated','payroll_automation_person',e.id,jsonb_build_object('employee_name',e.name,'reason','Документ изменён в карточке сотрудника — сведения требуют сверки','changes',jsonb_build_array(jsonb_build_object('field','valid_until','old',before_row.valid_until,'new',new.medical_book_date))));
  end if;
 end loop;
 return new;
end $$;
revoke all on function private.payroll_automation_medical_changed() from public,anon,authenticated;
create trigger payroll_automation_medical_changed after insert or update of medical_book_date,medical_book_number,employment_date on public.staff_account_details for each row execute function private.payroll_automation_medical_changed();

create function public.payroll_cancel_uniform_issue(p_issue uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare a uuid;v uuid;u uuid;i public.payroll_uniform_issues;
begin
 select s.a,s.v,s.u into a,v,u from private.payroll_scope('payroll.configure') s;
 perform pg_advisory_xact_lock(hashtextextended('payroll-automation:'||v::text,0));
 select * into i from public.payroll_uniform_issues where id=p_issue and account_id=a and venue_id=v for update;
 if i.id is null then raise exception 'Покупка недоступна';end if;
 if i.cancelled_at is not null then return;end if;
 if length(trim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'Укажите причину отмены';end if;
 update public.payroll_uniform_issues set cancelled_at=now() where id=p_issue;
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details)
 values(a,v,u,'payroll.uniform.cancelled','payroll_uniform',p_issue,jsonb_build_object('title',i.title,'reason',p_reason,'employee_name',(select name from public.payroll_employees where id=i.employee_id)));
end $$;
revoke all on function public.payroll_cancel_uniform_issue(uuid,text) from public,anon;
grant execute on function public.payroll_cancel_uniform_issue(uuid,text) to authenticated;

-- One atomic snapshot/fingerprint prevents applying a plan after source or settings edits.
create function public.payroll_automation_snapshot(p_venue uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('account_id',v.account_id,'venue_id',v.id,'timezone',coalesce(v.timezone,'Europe/Moscow'),
 'settings',(select to_jsonb(s) from public.payroll_automation_settings s where s.venue_id=v.id),
 'employees',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'active',e.active,'name',e.name,'role_name',e.role_name,'subject',to_jsonb(s)) order by e.id) from public.payroll_employees e left join public.payroll_automation_people s on s.employee_id=e.id where e.venue_id=v.id),'[]'::jsonb),
 'uniform',coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from public.payroll_uniform_issues i where i.venue_id=v.id and i.cancelled_at is null),'[]'::jsonb),
 'recorded',coalesce((select jsonb_agg(jsonb_build_object('key',e.event_key,'decision',e.decision) order by e.event_key) from public.payroll_automation_effects e where e.venue_id=v.id),'[]'::jsonb))
 from public.venues v where v.id=p_venue;
$$;
revoke all on function public.payroll_automation_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.payroll_automation_snapshot(uuid) to service_role;

create function public.payroll_commit_automation_run(p_venue uuid,p_date date,p_snapshot jsonb,p_plan jsonb,p_mode text,p_actor uuid default null,p_preview uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare live jsonb;a uuid;run uuid;r jsonb;effect public.payroll_automation_effects;adjustment uuid;n numeric;applied integer:=0;
begin
 if p_mode not in ('comparison','native') or p_mode is null or p_date is null or p_snapshot is null or p_plan is null then raise exception 'Неверный запуск';end if;
 perform pg_advisory_xact_lock(hashtextextended('payroll-automation:'||p_venue::text,0));
 live:=public.payroll_automation_snapshot(p_venue);
 if live is null or live is distinct from p_snapshot then raise exception 'Источники изменились. Повторите расчёт';end if;
 a:=(live->>'account_id')::uuid;
 perform set_config('request.jwt.claim.sub',coalesce(p_actor::text,''),true);
 perform set_config('app.ctx_ready','0',true);
 if p_actor is not null and (public.get_active_account_id() is distinct from a or public.get_active_venue_id() is distinct from p_venue or not public.has_permission('payroll.configure') or (p_mode='native' and not public.has_permission('payroll.review'))) then raise exception 'Нет доступа к запуску';end if;
 if coalesce((live->'settings'->>'version')::integer,0)<1 then raise exception 'Сначала сохраните настройки автоматизаций';end if;
 if p_date>((now() at time zone (live->>'timezone'))::date) or p_date<((now() at time zone (live->>'timezone'))::date)-7 then raise exception 'Выберите дату за последние семь дней';end if;
 if p_mode='native' and not exists(select 1 from public.payroll_automation_runs where id=p_preview and venue_id=p_venue and account_id=a and business_date=p_date and mode='comparison' and fingerprint=md5(live::text) and decisions=p_plan->'decisions' and blockers=p_plan->'blockers' and recorded_candidates=p_plan->'recordedCandidates') then raise exception 'Сначала выполните свежую сверку и проверьте результат';end if;
 if jsonb_typeof(p_plan->'decisions') is distinct from 'array' or jsonb_typeof(p_plan->'blockers') is distinct from 'array' or jsonb_typeof(p_plan->'recordedCandidates') is distinct from 'array' then raise exception 'Некорректный план';end if;
 insert into public.payroll_automation_runs(account_id,venue_id,business_date,fingerprint,mode,decisions,blockers,recorded_candidates,created_by)
 values(a,p_venue,p_date,md5(live::text),p_mode,p_plan->'decisions',p_plan->'blockers',p_plan->'recordedCandidates',p_actor) returning id into run;
 for r in select value from jsonb_array_elements(p_plan->'decisions') loop
  if r->>'venueId' is distinct from p_venue::text or r->>'businessDate' is distinct from p_date::text or (r->>'ruleVersion')::integer is distinct from (live->'settings'->>'version')::integer
   or not exists(select 1 from public.payroll_employees where id=(r->>'employeeId')::uuid and venue_id=p_venue and account_id=a and active)
   or left(r->>'key',length('payroll:'||p_venue::text||':'||(r->>'employeeId')||':'))<>('payroll:'||p_venue::text||':'||(r->>'employeeId')||':') then raise exception 'План другого источника';end if;
  if p_mode<>'native' or (r->>'medium'<>'money' and r->>'kind'<>'warning') or r->>'kind' not in ('bonus','deduction','warning') or r->>'rule' not in ('medical_missing','medical_expired','medical_reimbursement','uniform','task') then continue;end if;
  if exists(select 1 from jsonb_array_elements(p_plan->'blockers') b where b->>'employeeId'=r->>'employeeId') then continue;end if;
  if r->>'rule' like 'medical_%' and not exists(select 1 from public.payroll_automation_people p where p.employee_id=(r->>'employeeId')::uuid and p.legacy_reconciled and case r->>'rule' when 'medical_missing' then p.missing_fine_state='not_recorded' when 'medical_expired' then p.expiry_fine_state='not_recorded' when 'medical_reimbursement' then p.reimbursement_state='not_recorded' else false end) then continue;end if;
  select * into effect from public.payroll_automation_effects where event_key=r->>'key';
  if effect.event_key is not null then continue;end if;
  n:=(r->>'amount')::numeric;
  if n is null or n<0 or n>1000000 or n<>round(n,2) or length(trim(coalesce(r->>'reason','')))<3 then raise exception 'Неверная сумма';end if;
  adjustment:=gen_random_uuid();
  insert into public.payroll_adjustments(id,account_id,venue_id,employee_id,business_date,kind,medium,amount,reason,source_ref,approved,managed,origin,automation_key,rule_snapshot)
  values(adjustment,a,p_venue,(r->>'employeeId')::uuid,p_date,r->>'kind',case when r->>'kind'='warning' then 'none' else 'money' end,case when r->>'kind'='deduction' then -n when r->>'kind'='warning' then 0 else n end,r->>'reason',r->>'key',true,true,'native_rule',r->>'key',r);
  insert into public.payroll_automation_effects(event_key,account_id,venue_id,employee_id,decision,adjustment_id,state,created_by) values(r->>'key',a,p_venue,(r->>'employeeId')::uuid,r,adjustment,'applied',p_actor);
  applied:=applied+1;
 end loop;
 update public.payroll_automation_runs set applied_count=applied where id=run;
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details)
 values(a,p_venue,p_actor,'payroll.automation_run.created','payroll_automation_run',run,jsonb_build_object('date',p_date,'mode',p_mode,'applied',applied,'decisions',jsonb_array_length(p_plan->'decisions'),'blockers',jsonb_array_length(p_plan->'blockers')));
 return run;
end $$;
revoke all on function public.payroll_commit_automation_run(uuid,date,jsonb,jsonb,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.payroll_commit_automation_run(uuid,date,jsonb,jsonb,text,uuid,uuid) to service_role;

create policy payroll_automation_state_audit_access on public.audit_logs as restrictive for select to authenticated
 using(entity_type not in ('payroll_automation_person','payroll_uniform','payroll_automation_run') or (venue_id=public.get_active_venue_id() and public.has_permission('payroll.configure')));
notify pgrst,'reload schema';
commit;
