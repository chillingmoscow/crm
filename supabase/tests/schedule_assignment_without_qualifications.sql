-- Local regression: assignment authority suffices across positions; venue and permission guards remain.
begin;
do $$
declare owner_id uuid;staff_id uuid;v uuid;position_id uuid;other_venue uuid;foreign_position uuid;shift_id uuid;body jsonb;ver integer;denied boolean;
begin
 select id into owner_id from auth.users where email='owner@test.com';
 select id into staff_id from auth.users where email='waiter@test.com';
 select active_venue_id into v from public.profiles where id=owner_id;
 if owner_id is null or staff_id is null or v is null then raise exception 'Нужны локальные seed-пользователи';end if;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);perform set_config('app.ctx_ready','0',true);
 insert into public.roles(venue_id,name,code) values(v,'TEST Другая должность','test_other_'||gen_random_uuid()) returning id into position_id;
 if exists(select 1 from public.schedule_qualifications where user_id=staff_id and role_id=position_id) then raise exception 'У тестового сотрудника уже есть допуск';end if;
 body:=jsonb_build_object('date',(current_date+64)::text,'start_time','09:00','end_time','17:00','title','TEST Свободное назначение','color','blue','break_minutes',0,'arrival_minutes',0,'user_id',staff_id,'role_id',position_id,'department_id',null,'checklist_ids','[]'::jsonb);
 shift_id:=(public.schedule_command('shift.create',body)->>'id')::uuid;
 if not exists(select 1 from public.schedule_shifts where id=shift_id and user_id=staff_id and role_id=position_id) then raise exception 'Назначение на другую должность не сохранилось';end if;
 select version into ver from public.schedule_shifts where id=shift_id;
 perform public.schedule_command('shift.assign',jsonb_build_object('id',shift_id,'version',ver,'user_id',null));
 select version into ver from public.schedule_shifts where id=shift_id;
 perform public.schedule_command('shift.assign',jsonb_build_object('id',shift_id,'version',ver,'user_id',staff_id));
 if not exists(select 1 from public.schedule_shifts where id=shift_id and user_id=staff_id and role_id=position_id) then raise exception 'Назначение в открытую смену потребовало допуск';end if;
 perform set_config('request.jwt.claim.sub',staff_id::text,true);perform set_config('app.ctx_ready','0',true);
 denied:=false;
 begin perform public.schedule_command('shift.assign',jsonb_build_object('id',shift_id,'version',ver,'user_id',owner_id));exception when others then denied:=sqlerrm like '%Недостаточно прав%';end;
 if not denied then raise exception 'Обычный сотрудник получил право назначать смены';end if;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);perform set_config('app.ctx_ready','0',true);
 select id into other_venue from public.venues where id<>v limit 1;
 if other_venue is not null then
  insert into public.roles(venue_id,name,code) values(other_venue,'TEST Чужая должность','test_foreign_'||gen_random_uuid()) returning id into foreign_position;
  denied:=false;
  begin perform public.schedule_command('shift.create',body||jsonb_build_object('role_id',foreign_position,'date',(current_date+65)::text));exception when others then denied:=sqlerrm='Должность из другого заведения';end;
  if not denied then raise exception 'Разрешена должность другого заведения';end if;
 end if;
 raise notice 'PASS: cross-position create/assign without qualifications; assignment permission and venue isolation retained';
end $$;
rollback;
