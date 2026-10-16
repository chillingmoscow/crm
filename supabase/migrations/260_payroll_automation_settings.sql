begin;
-- Configuration only. No worker or provider call consumes these rules before cutover.
create function private.payroll_automation_roles_valid(r jsonb) returns boolean
language sql immutable set search_path='' as $$
 select case when jsonb_typeof(r)='array' then jsonb_array_length(r) between 1 and 30
  and not exists(select 1 from jsonb_array_elements(r) x where jsonb_typeof(x)<>'string' or length(btrim(x#>>'{}')) not between 1 and 100) else false end
$$;
revoke all on function private.payroll_automation_roles_valid(jsonb) from public,anon,authenticated;

create function private.payroll_automation_config_valid(c jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare r jsonb; x jsonb; n numeric; previous integer:=0; seen text[]:='{}';
begin
 if c is null or octet_length(c::text)>65536 then return false;end if;
 if not (jsonb_typeof(c)='object' and ((c) - array['medical','uniform','tasks','gifts']::text[])='{}'::jsonb and c ?& array['medical','uniform','tasks','gifts']::text[] and
 jsonb_typeof(c->'medical')='object' and ((c->'medical') - array['reminders','reminder_after_hire_days','reminder_before_expiry_days','submission_fine','submission_after_hire_months','submission_amount','expiry_fine','expiry_amount','expiry_frequency','reimbursement','reimbursement_amount','reimbursement_after_exam_months','reimbursement_requires_exam_after_hire']::text[])='{}'::jsonb and c->'medical' ?& array['reminders','reminder_after_hire_days','reminder_before_expiry_days','submission_fine','submission_after_hire_months','submission_amount','expiry_fine','expiry_amount','expiry_frequency','reimbursement','reimbursement_amount','reimbursement_after_exam_months','reimbursement_requires_exam_after_hire']::text[] and
 jsonb_typeof(c->'medical'->'reminders')='boolean' and
 jsonb_typeof(c->'medical'->'reminder_after_hire_days')='number' and
 jsonb_typeof(c->'medical'->'reminder_before_expiry_days')='number' and
 jsonb_typeof(c->'medical'->'submission_fine')='boolean' and
 jsonb_typeof(c->'medical'->'submission_after_hire_months')='number' and
 jsonb_typeof(c->'medical'->'submission_amount')='number' and
 jsonb_typeof(c->'medical'->'expiry_fine')='boolean' and
 jsonb_typeof(c->'medical'->'expiry_amount')='number' and
 jsonb_typeof(c->'medical'->'expiry_frequency')='string' and
 jsonb_typeof(c->'medical'->'reimbursement')='boolean' and
 jsonb_typeof(c->'medical'->'reimbursement_amount')='number' and
 jsonb_typeof(c->'medical'->'reimbursement_after_exam_months')='number' and
 jsonb_typeof(c->'medical'->'reimbursement_requires_exam_after_hire')='boolean' and
 jsonb_typeof(c->'uniform')='object' and ((c->'uniform') - array['enabled','installments','payment_days']::text[])='{}'::jsonb and c->'uniform' ?& array['enabled','installments','payment_days']::text[] and
 jsonb_typeof(c->'uniform'->'enabled')='boolean' and
 jsonb_typeof(c->'uniform'->'installments')='number' and
 jsonb_typeof(c->'uniform'->'payment_days')='array' and
 jsonb_typeof(c->'tasks')='object' and ((c->'tasks') - array['missing_enabled','missing_kind','missing_amount','extra_reward_enabled','extra_reward_medium']::text[])='{}'::jsonb and c->'tasks' ?& array['missing_enabled','missing_kind','missing_amount','extra_reward_enabled','extra_reward_medium']::text[] and
 jsonb_typeof(c->'tasks'->'missing_enabled')='boolean' and
 jsonb_typeof(c->'tasks'->'missing_kind')='string' and
 jsonb_typeof(c->'tasks'->'missing_amount')='number' and
 jsonb_typeof(c->'tasks'->'extra_reward_enabled')='boolean' and
 jsonb_typeof(c->'tasks'->'extra_reward_medium')='string' and
 jsonb_typeof(c->'gifts')='object' and ((c->'gifts') - array['enabled','tenure_boundary_days','holidays','tenure']::text[])='{}'::jsonb and c->'gifts' ?& array['enabled','tenure_boundary_days','holidays','tenure']::text[] and
 jsonb_typeof(c->'gifts'->'enabled')='boolean' and
 jsonb_typeof(c->'gifts'->'tenure_boundary_days')='number' and
 jsonb_typeof(c->'gifts'->'holidays')='array' and
 jsonb_typeof(c->'gifts'->'tenure')='array') then return false;end if;
 for r in select value from jsonb_each(c->'medical') loop
  if jsonb_typeof(r)='number' and ((r#>>'{}')::numeric<0 or (r#>>'{}')::numeric>1000000) then return false;end if;
 end loop;
 for x in select to_jsonb(k) from unnest(array['reminder_after_hire_days','reminder_before_expiry_days','submission_after_hire_months','reimbursement_after_exam_months']) k loop
  n:=(c->'medical'->>(x#>>'{}'))::numeric;
  if n<>trunc(n) or n>(case when x#>>'{}' in ('reminder_after_hire_days','reminder_before_expiry_days') then 365 else 36 end) then return false;end if;
 end loop;
 if (c#>>'{medical,submission_after_hire_months}')::integer<1 or c#>>'{medical,expiry_frequency}'<>'once_per_expiry_case' then return false;end if;
 n:=(c#>>'{uniform,installments}')::numeric;
 if n<>trunc(n) or n not between 1 and 24 or jsonb_array_length(c#>'{uniform,payment_days}') not between 1 and 4 then return false;end if;
 for r in select value from jsonb_array_elements(c#>'{uniform,payment_days}') loop
  if jsonb_typeof(r)<>'number' then return false;end if;n:=(r#>>'{}')::numeric;
  if n<>trunc(n) or n<=previous or n>28 then return false;end if;previous:=n;
 end loop;
 if c#>>'{tasks,missing_kind}' not in ('deduction','warning') or c#>>'{tasks,extra_reward_medium}' not in ('money','bonus') then return false;end if;
 n:=(c#>>'{tasks,missing_amount}')::numeric;if n not between 0 and 1000000 then return false;end if;
 n:=(c#>>'{gifts,tenure_boundary_days}')::numeric;if n<>trunc(n) or n not between 1 and 3650 then return false;end if;
 if jsonb_array_length(c#>'{gifts,holidays}')>30 or jsonb_array_length(c#>'{gifts,tenure}')>30 then return false;end if;
 for r in select value from jsonb_array_elements(c#>'{gifts,holidays}') loop
  if jsonb_typeof(r)<>'object' or not(r ?& array['id','name','month_day','junior_amount','senior_amount','roles','gender'])
   or r-array['id','name','month_day','junior_amount','senior_amount','roles','gender']::text[]<>'{}'::jsonb then return false;end if;
  foreach x in array array[r->'id',r->'name',r->'month_day',r->'gender'] loop
   if jsonb_typeof(x)<>'string' then return false;end if;
  end loop;
  if length(btrim(r->>'id')) not between 1 and 100 or length(btrim(r->>'name')) not between 1 and 100 or (r->>'id')=any(seen) then return false;end if;
  seen:=array_append(seen,r->>'id');
  if r->>'gender' not in ('all','male','female') then return false;end if;
  if r->>'month_day'<>'' then
   if r->>'month_day' !~ '^\d{2}-\d{2}$' or to_char(('2000-'||(r->>'month_day'))::date,'MM-DD')<>r->>'month_day' then return false;end if;
  end if;
  foreach x in array array[r->'junior_amount',r->'senior_amount'] loop
   if jsonb_typeof(x)<>'number' or (x#>>'{}')::numeric not between 0 and 1000000 then return false;end if;
  end loop;
  if not private.payroll_automation_roles_valid(r->'roles') then return false;end if;
 end loop;
 previous:=0;
 for r in select value from jsonb_array_elements(c#>'{gifts,tenure}') loop
  if jsonb_typeof(r)<>'object' or not(r ?& array['days','amount','discount_percent','roles']) or r-array['days','amount','discount_percent','roles']::text[]<>'{}'::jsonb then return false;end if;
  foreach x in array array[r->'days',r->'amount',r->'discount_percent'] loop
   if jsonb_typeof(x)<>'number' then return false;end if;
  end loop;
  n:=(r->>'days')::numeric;if n<>trunc(n) or n<=previous or n>36500 then return false;end if;previous:=n;
  n:=(r->>'amount')::numeric;if n not between 0 and 1000000 then return false;end if;
  n:=(r->>'discount_percent')::numeric;if n<>trunc(n) or n not between 0 and 100 then return false;end if;
  if not private.payroll_automation_roles_valid(r->'roles') then return false;end if;
 end loop;
 return true;
exception when others then return false;
end $$;

revoke all on function private.payroll_automation_config_valid(jsonb) from public,anon,authenticated;
create table public.payroll_automation_settings (
 venue_id uuid primary key references public.venues(id), account_id uuid not null references public.accounts(id),
 version integer not null check(version>0), config jsonb not null,
 updated_at timestamptz not null default now(), updated_by uuid references public.profiles(id)
);
create table public.payroll_automation_settings_history (
 venue_id uuid not null references public.venues(id), account_id uuid not null references public.accounts(id),
 version integer not null, config jsonb not null, updated_at timestamptz not null default now(),
 actor_id uuid references public.profiles(id), actor_name text not null, primary key(venue_id,version)
);
alter table public.payroll_automation_settings enable row level security;
alter table public.payroll_automation_settings_history enable row level security;
revoke all on public.payroll_automation_settings,public.payroll_automation_settings_history from public,anon,authenticated;
grant select on public.payroll_automation_settings,public.payroll_automation_settings_history to authenticated;
grant all on public.payroll_automation_settings,public.payroll_automation_settings_history to service_role;
create policy payroll_automation_read on public.payroll_automation_settings for select to authenticated
 using(account_id=public.get_active_account_id() and venue_id=public.get_active_venue_id() and public.has_permission('payroll.configure'));
create policy payroll_automation_history_read on public.payroll_automation_settings_history for select to authenticated
 using(account_id=public.get_active_account_id() and venue_id=public.get_active_venue_id() and public.has_permission('payroll.configure'));

create function private.payroll_automation_settings_audit() returns trigger
language plpgsql security definer set search_path='' as $$
declare who text; before_config jsonb;
begin
 if not private.payroll_automation_config_valid(new.config) then raise exception 'Проверьте настройки автоматизаций';end if;
 if not exists(select 1 from public.venues where id=new.venue_id and account_id=new.account_id) then raise exception 'Неверное заведение';end if;
 if tg_op='UPDATE' then
  if new.venue_id<>old.venue_id or new.account_id<>old.account_id then raise exception 'Нельзя менять заведение настроек';end if;
  before_config:=old.config;new.version:=old.version+1;
 else new.version:=1;end if;
 new.updated_at:=now();new.updated_by:=auth.uid();
 select concat_ws(' ',first_name,last_name) into who from public.profiles where id=auth.uid();
 insert into public.payroll_automation_settings_history(account_id,venue_id,version,config,actor_id,actor_name)
 values(new.account_id,new.venue_id,new.version,new.config,auth.uid(),coalesce(nullif(who,''),'Система'));
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details)
 values(new.account_id,new.venue_id,auth.uid(),'payroll.automation_settings.updated','payroll_automation_settings',new.venue_id,
 jsonb_build_object('version',new.version,'before',before_config,'after',new.config,'execution_mode','legacy_until_cutover'));
 return new;
end $$;
revoke all on function private.payroll_automation_settings_audit() from public,anon,authenticated;
create trigger payroll_automation_settings_audit before insert or update on public.payroll_automation_settings
 for each row execute function private.payroll_automation_settings_audit();
create policy payroll_automation_audit_access on public.audit_logs as restrictive for select to authenticated
 using(entity_type<>'payroll_automation_settings' or (venue_id=public.get_active_venue_id() and public.has_permission('payroll.configure')));

create function private.payroll_save_automation_settings(p_venue uuid,p_version integer,p_config jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare a uuid:=public.get_active_account_id(); v uuid:=public.get_active_venue_id(); current_version integer;
begin
 if auth.uid() is null or a is null or v is null or p_venue is distinct from v or not public.has_permission('payroll.configure') then raise exception 'Нет доступа';end if;
 if p_version is null or p_version<0 or not private.payroll_automation_config_valid(p_config) then raise exception 'Проверьте настройки автоматизаций';end if;
 perform pg_advisory_xact_lock(hashtextextended('payroll-automation:'||v::text,0));
 select version into current_version from public.payroll_automation_settings where venue_id=v and account_id=a for update;
 if coalesce(current_version,0)<>p_version then raise exception 'Настройки изменились. Обновите страницу';end if;
 if current_version is null then
  insert into public.payroll_automation_settings(account_id,venue_id,version,config) values(a,v,1,p_config);
 else
  update public.payroll_automation_settings set config=p_config where account_id=a and venue_id=v;
 end if;
end $$;
revoke all on function private.payroll_save_automation_settings(uuid,integer,jsonb) from public,anon;
grant execute on function private.payroll_save_automation_settings(uuid,integer,jsonb) to authenticated;
create function public.payroll_save_automation_settings(p_venue uuid,p_version integer,p_config jsonb) returns void
language sql security invoker set search_path='' as $$ select private.payroll_save_automation_settings(p_venue,p_version,p_config) $$;
revoke all on function public.payroll_save_automation_settings(uuid,integer,jsonb) from public,anon;
grant execute on function public.payroll_save_automation_settings(uuid,integer,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
