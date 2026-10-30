begin;
do $test$
declare u uuid;a uuid;v uuid;e uuid;d date;w uuid;fine uuid;n integer;
begin
 select p.id into u from auth.users p where email='owner@test.com';perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();d:=current_date;
 insert into public.payroll_employees(account_id,venue_id,name,role_name,active) values(a,v,'Warning correction fixture','Бармен',true) returning id into e;
 for n in 1..5 loop
  insert into public.payroll_adjustments(account_id,venue_id,employee_id,business_date,kind,medium,amount,reason,approved,managed)
  values(a,v,e,d,'warning','none',0,'Предупреждение fixture',true,true) returning id into w;
 end loop;
 select id into fine from public.payroll_adjustments where employee_id=e and origin='warning_threshold';
 if fine is null then raise exception 'Fifth warning did not create fine';end if;
 update public.payroll_adjustments set deleted_at=now(),delete_reason='Ошибочное предупреждение',deleted_by=u where id=w;
 if not exists(select 1 from public.payroll_adjustments where id=fine and deleted_at is not null and deleted_by is null) then raise exception 'Fine survived warning correction';end if;
 update public.payroll_adjustments set deleted_at=null,delete_reason=null,deleted_by=null where id=w;
 if (select count(*) from public.payroll_adjustments where employee_id=e and origin='warning_threshold')<>1 or (select deleted_at from public.payroll_adjustments where id=fine) is not null then raise exception 'Restore duplicated or lost fine';end if;
 update public.payroll_adjustments set deleted_at=now(),delete_reason='Решение руководителя',deleted_by=u where id=fine;
 update public.payroll_adjustments set deleted_at=now() where id=w;update public.payroll_adjustments set deleted_at=null where id=w;
 if (select deleted_at from public.payroll_adjustments where id=fine) is null then raise exception 'Explicit cancellation was undone';end if;
 raise notice 'PASS: warning deletion cancels derived fine, restore uses same ID, explicit managerial cancellation preserved';
end $test$;
rollback;
