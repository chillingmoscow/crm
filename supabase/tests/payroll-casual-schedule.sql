-- Run against local database only. All identities, schedule rows and facts roll back.
begin;
do $$
declare u uuid; v uuid; a uuid; pos uuid; model uuid; sh uuid; person uuid; body jsonb; fact bigint; users_before int; profiles_before int; other_shift uuid; saved public.schedule_shifts;
begin
 select id into u from auth.users where email='owner@test.com';
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('app.ctx_ready','0',true);
 v:=public.get_active_venue_id();
 select account_id into a from public.venues where id=v;
 select r.id,m.id into pos,model from public.roles r join public.payroll_models m on m.venue_id=r.venue_id and m.role_name=r.name and not m.archived and m.monthly_amount=0 where r.venue_id=v limit 1;
 if model is null then raise exception 'Нужны реальные должность и модель';end if;
 select count(*) into users_before from auth.users;
 select count(*) into profiles_before from public.profiles;
 body:=jsonb_build_object('date','2025-09-10','start_time','22:00','end_time','06:00','title','Разовая подмена','color','blue','user_id',null,'casual_name','Проверка подменного сотрудника','payroll_model_id',model,'role_id',pos,'department_id',(select department_id from public.roles where id=pos),'template_id',null,'break_minutes',0,'arrival_minutes',0,'checklist_ids','[]'::jsonb,'note','Тест с откатом');
 sh:=(public.schedule_command('shift.create',body)->>'id')::uuid;
 select * into saved from public.schedule_shifts where id=sh;
 person:=saved.payroll_employee_id;fact:=saved.payroll_fact_id;
 if person is null or saved.user_id is not null or saved.payroll_model_id<>model or fact>=0 then raise exception 'Неверное назначение разового сотрудника';end if;
 if (select count(*) from auth.users)<>users_before or (select count(*) from public.profiles)<>profiles_before then raise exception 'Создан аккаунт для разового сотрудника';end if;
 if (saved.ends_at-saved.starts_at)<>interval '8 hours' then raise exception 'Неверная ночная смена';end if;
 begin perform public.schedule_command('shift.create',body||jsonb_build_object('casual_name','','payroll_employee_id',person));raise exception 'Допущено пересечение';exception when others then if sqlerrm='Допущено пересечение' then raise;end if;end;
 begin perform public.schedule_command('shift.create',body||jsonb_build_object('date','2025-09-11','payroll_model_id',gen_random_uuid()));raise exception 'Принята чужая модель';exception when others then if sqlerrm='Принята чужая модель' then raise;end if;end;
 begin
 insert into public.payroll_attendance(account_id,venue_id,business_date,external_id,employee_id,shift_id,starts_at,ends_at,role_name,status) values(a,v,'2025-09-10',fact,person,sh,saved.starts_at,saved.ends_at,'Тест','confirmed');
 raise exception 'Черновик попал в зарплату';exception when others then if sqlerrm='Черновик попал в зарплату' then raise;end if;end;
 perform public.schedule_command('shift.publish',jsonb_build_object('id',sh,'version',1));
 insert into public.payroll_attendance(account_id,venue_id,business_date,external_id,employee_id,shift_id,starts_at,ends_at,role_name,status) values(a,v,'2025-09-10',fact,person,sh,saved.starts_at,saved.ends_at,'Тест','confirmed');
 if (select source from public.payroll_attendance where shift_id=sh)<>'schedule' then raise exception 'График выдан за факт Quick Resto';end if;
 begin perform public.schedule_command('shift.delete',jsonb_build_object('id',sh,'version',2));raise exception 'Удалена учтённая смена';exception when others then if sqlerrm='Удалена учтённая смена' then raise;end if;end;
 -- Keep former staff inactive: one casual assignment does not restore employment/access.
 update public.payroll_employees set active=false where id=person;
 other_shift:=(public.schedule_command('shift.create',body||jsonb_build_object('casual_name','','payroll_employee_id',person,'date','2033-01-02'))->>'id')::uuid;
 perform public.schedule_command('shift.edit',body||jsonb_build_object('id',other_shift,'version',1,'casual_name','','payroll_employee_id',null,'payroll_model_id',null,'role_id',null,'department_id',null,'user_id',u,'date','2033-01-02'));
 if exists(select 1 from public.schedule_shifts where id=other_shift and (payroll_employee_id is not null or payroll_model_id is not null or user_id is distinct from u)) then raise exception 'Обратное переназначение не очищает разовую модель';end if;
 update public.payroll_attendance set status='deviation',issue='Отметка удалена в Quick Resto' where shift_id=sh;
 if not exists(select 1 from public.payroll_attendance where shift_id=sh and status='ignored' and issue='Смена изменена в графике') then raise exception 'Снятый факт графика помечен как ошибка кассы';end if;
 if (select active from public.payroll_employees where id=person) then raise exception 'Восстановлено трудоустройство';end if;
 if (select count(*) from auth.users)<>users_before then raise exception 'Создан доступ бывшему сотруднику';end if;
 perform set_config('request.jwt.claim.sub',(select id::text from auth.users where email='waiter@test.com'),true);
 perform set_config('app.ctx_ready','0',true);
 begin perform public.schedule_command('shift.create',body);raise exception 'Создание без прав разрешено';exception when others then if sqlerrm='Создание без прав разрешено' then raise;end if;end;
 raise notice 'PASS: casual without auth/profile, selected model, night shift, overlap, unpublished exclusion, schedule fact source, former inactive, access guard';
end $$;
rollback;
