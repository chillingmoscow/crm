begin;
do $$ declare u uuid;a uuid;v uuid;e uuid;first_rule uuid;next_rule uuid;begin
 select id into u from auth.users where email='owner@test.com';
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 insert into public.payroll_employees(account_id,venue_id,name,role_name,active,local_user_id,quickresto_id) values(a,v,'Excluded terminal fixture','Мастер',true,u,999999984) returning id into e;
 first_rule:=public.payroll_set_attendance_source(e,'excluded','2026-10-18','Техническая карточка',null);
 if private.payroll_attendance_source(e,'2026-10-17')<>'quickresto' or private.payroll_attendance_source(e,'2026-10-18')<>'excluded' then raise exception 'Date boundary changed history';end if;
 insert into public.payroll_attendance(account_id,venue_id,business_date,external_id,employee_id,starts_at,ends_at,status)
 values(a,v,'2026-10-18',999999984,e,'2026-10-18 01:00Z',null,'open');
 if not exists(select 1 from public.payroll_attendance where employee_id=e and status='ignored') then raise exception 'Excluded open terminal clock is not ignored';end if;
 insert into public.schedule_shifts(venue_id,user_id,title,color,starts_at,ends_at,published) values(v,u,'Excluded source test','blue','2026-10-18 10:00Z','2026-10-18 18:00Z',true);
 update public.payroll_discipline_settings set enabled=true,missing_enabled=true,valid_from='2026-09-01' where venue_id=v;
 insert into public.payroll_source_days(account_id,venue_id,business_date,state) values(a,v,'2026-10-18','complete') on conflict(venue_id,business_date) do update set state='complete';
 if exists(select 1 from public.payroll_adjustments where employee_id=e) then raise exception 'Excluded terminal received a discipline charge';end if;
 next_rule:=public.payroll_set_attendance_source(e,'quickresto','2026-10-20','Явное возвращение в учёт',first_rule);
 if private.payroll_attendance_source(e,'2026-10-19')<>'excluded' or private.payroll_attendance_source(e,'2026-10-20')<>'quickresto' then raise exception 'Resumption changed earlier exclusion';end if;
 begin
 perform public.payroll_set_attendance_source(e,'excluded','2026-10-21','Устаревший запрос',first_rule);raise exception 'Stale source was accepted';
 exception when raise_exception then if sqlerrm not like 'Условия изменились%' then raise;end if;end;
 if not exists(select 1 from public.audit_logs where entity_id=first_rule and action_code='payroll.attendance_source.changed' and details->>'source'='excluded') then raise exception 'No exclusion history';end if;
 raise notice 'PASS: exclusion date, ignored open terminal, no discipline fine, explicit resumption, stale write and audit';
end $$;
rollback;
