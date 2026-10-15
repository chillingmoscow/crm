begin;
do $$
declare u uuid;a uuid;v uuid;e uuid;role_id uuid;plan uuid;entry uuid;source_day date:='2026-09-18';base numeric;n integer;
begin
 select id into u from auth.users where email='owner@test.com';
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 insert into public.roles(venue_id,name,code) values(v,'Automation rollback role','automation_rollback') returning id into role_id;
 insert into public.payroll_employees(account_id,venue_id,name,role_name,local_user_id,role_id,opening_confirmed,quickresto_guest_id,quickresto_bonus_account_id) values(a,v,'Automation rollback employee','Test',u,role_id,true,123,456) returning id into e;
 update public.payroll_discipline_settings set enabled=true,valid_from='2026-09-01',late_bonus=true where venue_id=v;
 insert into public.schedule_shifts(venue_id,user_id,role_id,title,starts_at,ends_at,published) values(v,u,role_id,'Automation rollback shift','2026-09-18 12:00+03','2026-09-18 23:00+03',true) returning id into plan;
 insert into public.payroll_attendance(account_id,venue_id,business_date,external_id,employee_id,starts_at,ends_at,shift_id,role_name,status) values(a,v,source_day,999999991,e,'2026-09-18 12:06+03','2026-09-18 23:00+03',plan,'Test','confirmed');
 insert into public.payroll_source_days(account_id,venue_id,business_date,state) values(a,v,source_day,'pending') on conflict(venue_id,business_date) do update set state='pending';
 update public.payroll_source_days set state='error' where venue_id=v and business_date=source_day;
 if exists(select 1 from public.payroll_adjustments where employee_id=e) then raise exception 'Provider error produced a fine';end if;
 update public.payroll_source_days set state='complete' where venue_id=v and business_date=source_day;
 select id into entry from public.payroll_adjustments where employee_id=e and origin='lateness';
 if entry is null or (select amount from public.payroll_adjustments where id=entry)<>-800 then raise exception 'Lateness formula failed';end if;
 update public.payroll_source_days set state='pending' where venue_id=v and business_date=source_day;
 update public.payroll_source_days set state='complete' where venue_id=v and business_date=source_day;
 if (select count(*) from public.payroll_adjustments where employee_id=e and origin='lateness')<>1 then raise exception 'Automatic replay duplicated fine';end if;
 perform public.payroll_resolve_bonus(entry,799,123,456);
 if (select medium from public.payroll_adjustments where id=entry)<>'money' or private.payroll_month_balance(e,'2026-09-01')<>-800 then raise exception 'Insufficient bonuses did not become full money fine';end if;
 -- A second case has enough points and must leave salary unchanged.
 insert into public.payroll_adjustments(account_id,venue_id,employee_id,business_date,kind,medium,amount,reason,approved,managed,origin,external_state) values(a,v,e,'2026-09-19','deduction','bonus',-500,'Bonus rollback test',true,true,'lateness','review') returning id into entry;
 perform public.payroll_resolve_bonus(entry,500,123,456);
 if (select medium from public.payroll_adjustments where id=entry)<>'bonus' or (select external_state from public.payroll_adjustments where id=entry)<>'pending' or private.payroll_month_balance(e,'2026-09-01')<>-800 then raise exception 'Sufficient bonuses changed salary';end if;
 perform public.payroll_resolve_bonus(entry,0,123,456);
 if (select medium from public.payroll_adjustments where id=entry)<>'bonus' then raise exception 'Retry changed a resolved bonus fine';end if;
 raise notice 'PASS: failed source creates no fine, lateness from linked plan, automatic dedup, full money fallback, enough bonuses separate, stable resolution';
end $$;
rollback;
