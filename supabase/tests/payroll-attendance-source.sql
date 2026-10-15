-- Dated source, plan validity, no invented QR identity, tenant/access protection.
begin;
do $$
declare u uuid;a uuid;v uuid;e uuid;sh uuid;fact bigint;rule uuid;new_rule uuid;n integer;
begin
 select id into u from auth.users where email='owner@test.com';
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 insert into public.payroll_employees(account_id,venue_id,name,role_name,local_user_id,active) values(a,v,'Schedule source fixture','Test',u,true) returning id into e;
 insert into public.schedule_shifts(venue_id,user_id,title,color,starts_at,ends_at,published) values(v,u,'Source fixture','blue','2026-09-10 10:00+00','2026-09-10 18:00+00',true) returning id,payroll_fact_id into sh,fact;
 begin insert into public.payroll_attendance(account_id,venue_id,business_date,external_id,employee_id,shift_id,starts_at,ends_at,status) values(a,v,'2026-09-10',fact,e,sh,'2026-09-10 10:00+00','2026-09-10 18:00+00','confirmed');raise exception 'schedule-source-not-required';exception when others then if sqlerrm='schedule-source-not-required' then raise;end if;end;
 rule:=public.payroll_set_attendance_source(e,'schedule','2026-09-01','Approved schedule source',null);
 if not exists(select 1 from public.audit_logs where entity_id=rule and user_id=u and action_code='payroll.attendance_source.changed') then raise exception 'Source audit missing';end if;
 update public.payroll_discipline_settings set enabled=true,missing_enabled=true,valid_from='2026-09-01' where venue_id=v;
 insert into public.payroll_source_days(account_id,venue_id,business_date,state) values(a,v,'2026-09-10','complete') on conflict(venue_id,business_date) do update set state='complete';
 if exists(select 1 from public.payroll_adjustments where employee_id=e and origin='missing_clockin') then raise exception 'Planned source received a missing clock-in penalty';end if;
 insert into public.payroll_attendance(account_id,venue_id,business_date,external_id,employee_id,shift_id,starts_at,ends_at,status) values(a,v,'2026-09-10',fact,e,sh,'2026-09-10 10:00+00','2026-09-10 18:00+00','confirmed');
 if not exists(select 1 from public.payroll_attendance where external_id=fact and source='schedule' and employee_id=e) then raise exception 'Schedule fact not linked';end if;
 begin update public.payroll_attendance set starts_at='2026-09-10 11:00+00' where external_id=fact;raise exception 'modified-plan-accepted';exception when others then if sqlerrm='modified-plan-accepted' then raise;end if;end;
 new_rule:=public.payroll_set_attendance_source(e,'quickresto','2026-11-01','Return to QR after October',rule);
 if private.payroll_attendance_source(e,'2026-10-01')<>'schedule' or private.payroll_attendance_source(e,'2026-11-01')<>'quickresto' then raise exception 'Future source changed history';end if;
 begin perform public.payroll_set_attendance_source(e,'quickresto','2026-12-01','Stale form',rule);raise exception 'stale-source-accepted';exception when others then if sqlerrm='stale-source-accepted' then raise;end if;end;
 begin perform public.payroll_set_attendance_source(gen_random_uuid(),'schedule','2026-09-01','Other employee',null);raise exception 'foreign-employee-accepted';exception when others then if sqlerrm='foreign-employee-accepted' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',(select id::text from auth.users where email='waiter@test.com'),true);perform set_config('app.ctx_ready','0',true);
 begin perform public.payroll_set_attendance_source(e,'quickresto','2026-12-01','Without configure rights',new_rule);raise exception 'source-without-permission';exception when others then if sqlerrm='source-without-permission' then raise;end if;end;
 raise notice 'PASS: source dates, preserved history, valid schedule facts, missing-clockin exclusion, audit, stale write and permissions';
end $$;
rollback;
