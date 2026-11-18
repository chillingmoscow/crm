-- Автоматические штрафы смены пересчитываются по графику (миграция 346).
begin;
do $$
declare u uuid;a uuid;v uuid;e uuid;role_id uuid;plan uuid;lost uuid;entry uuid;missing uuid;day1 date:='2026-09-18';day2 date:='2026-09-20';
  tpl uuid;def uuid;occ uuid;fine uuid;
begin
 select id into u from auth.users where email='owner@test.com';
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 insert into public.roles(venue_id,name,code) values(v,'Fines follow shift role','fines_follow_shift') returning id into role_id;
 insert into public.payroll_employees(account_id,venue_id,name,role_name,local_user_id,role_id,opening_confirmed) values(a,v,'Fines follow employee','Test',u,role_id,true) returning id into e;
 insert into public.payroll_discipline_settings(venue_id,account_id,enabled,valid_from,late_bonus,missing_mark_strict_from) values(v,a,true,'2026-09-01',false,'2026-09-01')
 on conflict(venue_id) do update set enabled=true,valid_from='2026-09-01',late_bonus=false,late_enabled=true,missing_enabled=true,late_grace=5,late_step=5,late_amount=400,late_max=5000,missing_mark_strict_from='2026-09-01';
 -- Окружение не зависит от того, что сейчас лежит в локальной базе.
 update public.payroll_settings set starts_on='2026-09-01',historical_through=null where venue_id=v;
 insert into public.sales_settings(venue_id,account_id,day_start_hour) values(v,a,9) on conflict(venue_id) do update set day_start_hour=9;

 -- 1. Опоздание пересчитывается по новому времени смены.
 insert into public.schedule_shifts(venue_id,user_id,role_id,title,starts_at,ends_at,published) values(v,u,role_id,'Late shift','2026-09-18 12:00+03','2026-09-18 23:00+03',true) returning id into plan;
 insert into public.payroll_attendance(account_id,venue_id,business_date,external_id,employee_id,starts_at,ends_at,shift_id,role_name,status) values(a,v,day1,999999981,e,'2026-09-18 12:06+03','2026-09-18 23:00+03',plan,'Test','confirmed');
 insert into public.payroll_source_days(account_id,venue_id,business_date,state) values(a,v,day1,'pending') on conflict(venue_id,business_date) do update set state='pending';
 update public.payroll_source_days set state='complete' where venue_id=v and business_date=day1;
 select id into entry from public.payroll_adjustments where employee_id=e and origin='lateness';
 if entry is null or (select amount from public.payroll_adjustments where id=entry)<>-800 then raise exception 'Опоздание не начислено';end if;

 update public.schedule_shifts set starts_at='2026-09-18 11:50+03' where id=plan;
 update public.payroll_source_days set state='complete' where venue_id=v and business_date=day1;
 if (select reason from public.payroll_adjustments where id=entry)<>'Опоздание на 16 мин.' or (select amount from public.payroll_adjustments where id=entry)>=-800
   or (select count(*) from public.payroll_adjustments where employee_id=e and origin='lateness')<>1 then raise exception 'Опоздание не пересчитано по новому началу смены';end if;

 update public.schedule_shifts set starts_at='2026-09-18 12:10+03' where id=plan;
 update public.payroll_source_days set state='complete' where venue_id=v and business_date=day1;
 if (select deleted_at from public.payroll_adjustments where id=entry) is null or (select deleted_by from public.payroll_adjustments where id=entry) is not null
   then raise exception 'Опоздание не снято, когда смену сдвинули позже прихода';end if;

 update public.schedule_shifts set starts_at='2026-09-18 12:00+03' where id=plan;
 update public.payroll_source_days set state='complete' where venue_id=v and business_date=day1;
 if (select deleted_at from public.payroll_adjustments where id=entry) is not null or (select amount from public.payroll_adjustments where id=entry)<>-800
   then raise exception 'Снятое системой опоздание не восстановлено';end if;

 -- Удалённое человеком системой не восстанавливается.
 update public.payroll_adjustments set deleted_at=now(),deleted_by=u,delete_reason='Уважительная причина' where id=entry;
 update public.payroll_source_days set state='complete' where venue_id=v and business_date=day1;
 if (select deleted_by from public.payroll_adjustments where id=entry)<>u then raise exception 'Система отменила решение человека';end if;

 -- 2. «Нет отметки» снимается вместе с ошибочной сменой.
 insert into public.schedule_shifts(venue_id,user_id,role_id,title,starts_at,ends_at,published) values(v,u,role_id,'Wrong shift','2026-09-20 12:00+03','2026-09-20 23:00+03',true) returning id into lost;
 insert into public.payroll_source_days(account_id,venue_id,business_date,state) values(a,v,day2,'pending') on conflict(venue_id,business_date) do update set state='pending';
 update public.payroll_source_days set state='complete' where venue_id=v and business_date=day2;
 select id into missing from public.payroll_adjustments where employee_id=e and origin='missing_clockin' and business_date=day2;
 if missing is null then raise exception 'Нет отметки не начислено';end if;
 delete from public.schedule_shifts where id=lost;
 if (select state from public.payroll_source_days where venue_id=v and business_date=day2)<>'pending' then raise exception 'Удаление смены не поставило день на пересчёт';end if;
 update public.payroll_source_days set state='complete' where venue_id=v and business_date=day2;
 if (select deleted_at from public.payroll_adjustments where id=missing) is null then raise exception 'Штраф за отметку остался после удаления смены';end if;
 if (select delete_reason from public.payroll_adjustments where id=missing)<>private.payroll_shift_fine_released_reason() then raise exception 'Причина снятия не записана';end if;

 -- 3. Смену с невыполненной задачей без отчёта можно удалить, штраф снимается.
 insert into public.schedule_templates(venue_id,name,color,start_time,end_time) values(v,'Fines follow tpl','blue','09:00','17:00') returning id into tpl;
 insert into public.schedule_task_definitions(venue_id,account_id,name,template_id,recurrence,starts_on,review_mode,items,enabled)
 values(v,a,'Fines follow task',tpl,'{"unit":"week","interval":1,"anchor":"2026-09-14"}','2026-09-14','auto','[]',false) returning id into def;
 insert into public.schedule_shifts(venue_id,user_id,role_id,template_id,title,starts_at,ends_at,published) values(v,u,role_id,tpl,'Task shift','2026-09-21 09:00+03','2026-09-21 17:00+03',true) returning id into lost;
 insert into public.payroll_adjustments(account_id,venue_id,employee_id,business_date,kind,medium,amount,reason,approved,managed,origin,automation_key)
 values(a,v,e,'2026-09-21','deduction','money',-300,'Задача «Fines follow task» не выполнена',true,true,'task','task:test:result') returning id into fine;
 insert into public.schedule_task_occurrences(venue_id,account_id,definition_id,business_date,snapshot,status,shift_id,employee_id,user_id,adjustment_id,settled_at)
 values(v,a,def,'2026-09-21','{}','missed',lost,e,u,fine,now()) returning id into occ;
 delete from public.schedule_shifts where id=lost;
 if (select deleted_at from public.payroll_adjustments where id=fine) is null then raise exception 'Штраф за задачу остался после удаления смены';end if;
 if (select status from public.schedule_task_occurrences where id=occ)<>'missed' then raise exception 'Задача перестала быть невыполненной';end if;

 -- С начатым отчётом удалить смену по-прежнему нельзя.
 insert into public.schedule_shifts(venue_id,user_id,role_id,template_id,title,starts_at,ends_at,published) values(v,u,role_id,tpl,'Task shift 2','2026-09-22 09:00+03','2026-09-22 17:00+03',true) returning id into lost;
 insert into public.schedule_task_occurrences(venue_id,account_id,definition_id,business_date,snapshot,status,shift_id,employee_id,user_id,answers)
 values(v,a,def,'2026-09-22','{}','in_progress',lost,e,u,'{"x":true}');
 begin
  delete from public.schedule_shifts where id=lost;
  raise exception 'Смена с отчётом удалилась';
 exception when others then
  if sqlerrm<>'Нельзя удалить смену с начатым отчётом задачи' then raise; end if;
 end;
 raise notice 'PASS: опоздание пересчитывается, снимается и восстанавливается; решение человека не трогается; отметка и задача снимаются с удалённой сменой';
end $$;
rollback;
