begin;
-- The date belongs to the venue. Role rules still own eligibility and the scale.
-- NULL means no new tenure accrual; preserved historical components stay intact.
alter table public.payroll_settings
 add column experience_starts_on date,
 add column experience_policy_version integer not null default 0 check(experience_policy_version>=0),
 add column experience_policy_request_key uuid,
 add column experience_policy_request_input jsonb;
comment on column public.payroll_settings.experience_starts_on is 'Начислять надбавку за стаж с этой даты включительно, без тестов. NULL — дата ещё не назначена. Исторические начисления не удаляются.';

create function public.payroll_set_experience_start(p_date date,p_version integer,p_request uuid,p_reason text,p_expected_venue uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare a uuid;v uuid;u uuid;s public.payroll_settings;cutoff date;changed_from date;next_version integer;payload jsonb;
begin
 select c.a,c.v,c.u into a,v,u from private.payroll_scope('payroll.configure') c;
 if p_expected_venue is distinct from v then raise exception 'Заведение изменилось. Откройте настройки заново';end if;
 perform pg_advisory_xact_lock(hashtextextended(v::text,0));
 select * into s from public.payroll_settings where account_id=a and venue_id=v for update;
 if not found then raise exception 'Сначала настройте расчёт зарплаты';end if;
 if p_request is null or p_date is null or extract(year from p_date) not between 2000 and 2100
 or p_date<s.starts_on or p_date<=coalesce(s.historical_through,'1900-01-01'::date)
 or coalesce(length(trim(p_reason)),0) not between 3 and 1000 then raise exception 'Проверьте дату и укажите причину изменения';end if;
 payload:=jsonb_build_object('date',p_date,'version',p_version,'reason',trim(p_reason));
 if s.experience_policy_request_key=p_request then
  if s.experience_policy_request_input is distinct from payload then raise exception 'Ключ запроса уже использован для других настроек';end if;
  return s.experience_policy_version;
 end if;
 if p_version is distinct from s.experience_policy_version then raise exception 'Настройки изменились. Обновите страницу';end if;
 if s.experience_starts_on=p_date then return s.experience_policy_version;end if;
 next_version:=s.experience_policy_version+1;
 update public.payroll_settings set experience_starts_on=p_date,experience_policy_version=next_version,
  experience_policy_request_key=p_request,experience_policy_request_input=payload,updated_at=now() where venue_id=v and account_id=a;
 -- Reset the exact lease too: an old worker cannot commit a pre-change snapshot.
 changed_from:=least(coalesce(s.experience_starts_on,p_date),p_date);
 select ((now() at time zone q.timezone)-make_interval(hours=>q.day_start_hour))::date into cutoff
 from public.sales_settings q where q.account_id=a and q.venue_id=v;
 update public.payroll_source_days set state='pending',lease_token=null,error=null
 where account_id=a and venue_id=v and business_date>=changed_from and business_date<=cutoff
  and business_date>coalesce(s.historical_through,'1900-01-01'::date);
 insert into public.payroll_events(account_id,venue_id,entity_id,actor_id,action,details)
 values(a,v,v,u,'experience_policy',jsonb_build_object('old',s.experience_starts_on,'new',p_date,'reason',trim(p_reason),'version',next_version));
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details)
 values(a,v,u,'payroll.experience.updated','venue',v,jsonb_build_object('old',s.experience_starts_on,'new',p_date,'reason',trim(p_reason),'version',next_version));
 return next_version;
end $$;
revoke all on function public.payroll_set_experience_start(date,integer,uuid,text,uuid) from public,anon;
grant execute on function public.payroll_set_experience_start(date,integer,uuid,text,uuid) to authenticated;

-- Keep former confirmations as read-only history; old clients cannot create more.
create function private.payroll_tests_retired() returns trigger
language plpgsql set search_path='' as $$ begin
 raise exception 'Тесты и связанные с ними надбавки больше не используются';
end $$;
revoke all on function private.payroll_tests_retired() from public,anon,authenticated;
create trigger payroll_tests_retired before insert or update on public.payroll_qualifications
 for each row execute function private.payroll_tests_retired();
notify pgrst,'reload schema';
commit;
