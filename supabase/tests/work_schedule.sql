-- Проверяет реальные переходы, права, пересечения, снимки и блокировку утверждённых ответов.
-- Запуск на локальном seed; все изменения откатываются.
begin;
do $$
declare owner_id uuid; waiter_id uuid; venue uuid; checklist uuid; shift uuid; run uuid; item_id uuid:=gen_random_uuid(); second_shift uuid; result jsonb; body jsonb; current_version integer;
begin
 select id into owner_id from auth.users where email='owner@test.com';
 select id into waiter_id from auth.users where email='waiter@test.com';
 if owner_id is null or waiter_id is null then raise exception 'Нужны локальные seed-пользователи';end if;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform set_config('app.ctx_ready','0',true);
 venue:=public.get_active_venue_id();
 body:=jsonb_build_object('name','Regression checklist','description','','kind','opening','duration',10,'priority','medium','department_id',null,'items',jsonb_build_array(jsonb_build_object('id',item_id,'title','Проверить','hint','','kind','check','required',true,'parent_id',null,'min',null,'max',null,'unit','','max_length',500)));
 checklist:=(public.schedule_command('checklist.create',body)->>'id')::uuid;
 perform public.schedule_command('checklist.publish',jsonb_build_object('id',checklist,'version',1));
 body:=jsonb_build_object('date','2032-01-05','start_time','22:00','end_time','06:00','title','Ночная проверка','color','purple','user_id',owner_id,'role_id',null,'department_id',null,'template_id',null,'break_minutes',30,'arrival_minutes',15,'checklist_ids',jsonb_build_array(checklist),'note','');
 shift:=(public.schedule_command('shift.create',body)->>'id')::uuid;
 if (select extract(epoch from ends_at-starts_at)/3600 from public.schedule_shifts where id=shift)<>8 then raise exception 'Ночная смена рассчитана неверно';end if;
 begin perform public.schedule_command('shift.create',body);raise exception 'Пересечение пропущено';exception when others then if sqlerrm='Пересечение пропущено' then raise;end if;end;
 second_shift:=(public.schedule_command('shift.create',body||jsonb_build_object('date','2032-01-06'))->>'id')::uuid;
 -- Публикация нескольких смен атомарна даже при конфликте версии второй.
 begin perform public.schedule_command('shift.publish_many',jsonb_build_object('shifts',jsonb_build_array(jsonb_build_object('id',shift,'version',1),jsonb_build_object('id',second_shift,'version',999))));raise exception 'Устаревшая версия пропущена';exception when others then if sqlerrm='Устаревшая версия пропущена' then raise;end if;end;
 if (select published from public.schedule_shifts where id=shift) then raise exception 'Публикация не атомарна';end if;
 perform public.schedule_command('shift.publish',jsonb_build_object('id',shift,'version',1));
 run:=(public.schedule_command('run.start',jsonb_build_object('shift_id',shift,'checklist_id',checklist))->>'id')::uuid;
 begin perform public.schedule_command('run.submit',jsonb_build_object('id',run,'version',1,'answers','{}'::jsonb));raise exception 'Пропущен обязательный пункт';exception when others then if sqlerrm='Пропущен обязательный пункт' then raise;end if;end;
 perform public.schedule_command('run.save',jsonb_build_object('id',run,'version',1,'answers',jsonb_build_object(item_id::text,true)));
 perform public.schedule_command('run.submit',jsonb_build_object('id',run,'version',2,'answers',jsonb_build_object(item_id::text,true)));
 perform public.schedule_command('run.return',jsonb_build_object('id',run,'version',3,'comment','Уточните выполнение'));
 perform public.schedule_command('run.submit',jsonb_build_object('id',run,'version',4,'answers',jsonb_build_object(item_id::text,true)));
 perform public.schedule_command('run.approve',jsonb_build_object('id',run,'version',5,'comment',''));
 begin perform public.schedule_command('run.save',jsonb_build_object('id',run,'version',6,'answers','{}'::jsonb));raise exception 'Утверждённые ответы изменены';exception when others then if sqlerrm='Утверждённые ответы изменены' then raise;end if;end;
 update public.schedule_checklists set name='Новая версия',items='[]' where id=checklist;
 if (select snapshot->>'name' from public.schedule_runs where id=run)<>'Regression checklist' then raise exception 'Снимок изменился';end if;
 -- Назначенная версия не меняется до первого запуска даже после редактирования и архива.
 perform public.schedule_command('shift.publish',jsonb_build_object('id',second_shift,'version',1));
 update public.schedule_checklists set archived=true where id=checklist;
 result:=public.schedule_command('run.start',jsonb_build_object('shift_id',second_shift,'checklist_id',checklist));
 if (select snapshot->>'name' from public.schedule_runs where id=(result->>'id')::uuid)<>'Regression checklist' then raise exception 'Изменилась назначенная версия до запуска';end if;
 -- Назначение сотруднику не выдаёт ему права планировщика.
 update public.schedule_checklists set archived=false where id=checklist;
 second_shift:=(public.schedule_command('shift.create',body||jsonb_build_object('date','2032-01-08','user_id',waiter_id))->>'id')::uuid;
 perform public.schedule_command('shift.publish',jsonb_build_object('id',second_shift,'version',1));
 perform set_config('app.schedule_test.own_shift',second_shift::text,true);
 perform set_config('app.schedule_test.hidden_shift',shift::text,true);
 perform set_config('request.jwt.claim.sub',waiter_id::text,true);
 begin perform public.schedule_command('shift.create',body);raise exception 'Создание без права разрешено';exception when others then if sqlerrm='Создание без права разрешено' then raise;end if;end;
 begin perform public.schedule_command('run.start',jsonb_build_object('shift_id',shift,'checklist_id',checklist));raise exception 'Начато чужое выполнение';exception when others then if sqlerrm='Начато чужое выполнение' then raise;end if;end;
 run:=(public.schedule_command('run.start',jsonb_build_object('shift_id',second_shift,'checklist_id',checklist))->>'id')::uuid;
 perform set_config('app.schedule_test.own_run',run::text,true);
 raise notice 'PASS: ночные смены, пересечения, атомарная публикация, обязательные ответы, возврат, утверждение, снимки и права';
end $$;
set local role authenticated;
do $$
begin
 if not exists(select 1 from public.schedule_shifts where id=current_setting('app.schedule_test.own_shift')::uuid) then raise exception 'Сотрудник не видит собственную опубликованную смену';end if;
 if exists(select 1 from public.schedule_shifts where id=current_setting('app.schedule_test.hidden_shift')::uuid) then raise exception 'Сотрудник видит чужую смену';end if;
 if not exists(select 1 from public.schedule_runs where id=current_setting('app.schedule_test.own_run')::uuid) then raise exception 'Сотрудник не видит свои ответы';end if;
 raise notice 'PASS: RLS собственной смены и ответов, чужие смены скрыты';
end $$;
rollback;
