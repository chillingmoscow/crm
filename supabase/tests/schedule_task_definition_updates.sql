-- A changed definition must not leave obsolete future assignments eligible for deductions.
begin;
do $$
declare owner_id uuid;staff_id uuid;v uuid;a uuid;d date;tpl uuid;def uuid;draft uuid;old_occ uuid;new_occ uuid;current_occ uuid;historical_occ uuid;carry_occ uuid;started_occ uuid;photo_occ uuid;point uuid:=gen_random_uuid();body jsonb;snap jsonb;
begin
 select id into owner_id from auth.users where email='owner@test.com';
 select id into staff_id from auth.users where email='waiter@test.com';
 select active_venue_id into v from public.profiles where id=owner_id;
 select account_id,(now() at time zone coalesce(timezone,'Europe/Moscow'))::date into a,d from public.venues where id=v;
 if owner_id is null or staff_id is null or v is null then raise exception 'Нужны локальные seed-пользователи';end if;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);perform set_config('app.ctx_ready','0',true);
 body:=jsonb_build_object('request_key',gen_random_uuid(),'name','TEST Unconfigured Imported Draft','instructions','','template_id',null,'review_mode','manager','items','[]'::jsonb,'recurrence',null,'starts_on',d,'enabled',false,'penalty_enabled',false,'fine_amount',0,'reward_amount',0);
 draft:=(public.schedule_task_command('definition.save',body)->>'id')::uuid;
 if not exists(select 1 from public.schedule_task_definitions where id=draft and template_id is null and recurrence is null and items='[]'::jsonb and not enabled) then raise exception 'Не удалось сохранить ненастроенный черновик';end if;
 select to_jsonb(t)||jsonb_build_object('enabled',true) into body from public.schedule_task_definitions t where id=draft;
 begin
  perform public.schedule_task_command('definition.save',body);
  raise exception 'Ненастроенный черновик удалось включить';
 exception when others then
  if sqlerrm<>'Для включения задачи укажите смену, повтор и чек-лист' then raise;end if;
 end;
 insert into public.schedule_templates(venue_id,name,color,start_time,end_time) values(v,'TEST Definition Updates','blue','09:00','17:00') returning id into tpl;
 insert into public.schedule_task_settings(venue_id,account_id,enabled_from,legacy_stopped,paused) values(v,a,d-7,true,false) on conflict(venue_id) do update set enabled_from=d-7,legacy_stopped=true,paused=false;
 body:=jsonb_build_object('request_key',gen_random_uuid(),'name','TEST Future Plan','instructions','Версия 1','template_id',tpl,'review_mode','manager','items',jsonb_build_array(jsonb_build_object('id',point,'title','Фото результата','kind','photo','required',true)),'recurrence',jsonb_build_object('unit','week','interval',1,'anchor',d+1),'starts_on',d,'enabled',true,'penalty_enabled',false,'fine_amount',0,'reward_amount',0,'equipment_groups','[]'::jsonb);
 def:=(public.schedule_task_command('definition.save',body)->>'id')::uuid;
 insert into public.schedule_shifts(venue_id,user_id,template_id,title,color,starts_at,ends_at,published)
 select v,staff_id,tpl,'TEST Definition Shift','blue',(day::timestamp+interval '9 hours') at time zone 'Europe/Moscow',(day::timestamp+interval '17 hours') at time zone 'Europe/Moscow',true from unnest(array[d+1,d+2]) day;
 perform public.schedule_process_tasks();
 select id into old_occ from public.schedule_task_occurrences where definition_id=def and business_date=d+1;
 if old_occ is null then raise exception 'Обработчик не создал будущее назначение';end if;
 select snapshot into snap from public.schedule_task_occurrences where id=old_occ;
 insert into public.schedule_task_occurrences(venue_id,account_id,definition_id,business_date,snapshot,status,settled_at) values(v,a,def,d-1,snap,'completed',now()) returning id into historical_occ;
 insert into public.schedule_task_occurrences(venue_id,account_id,definition_id,business_date,snapshot,status) values(v,a,def,d,snap,'assigned') returning id into current_occ;
 insert into public.schedule_task_occurrences(venue_id,account_id,definition_id,business_date,snapshot,status,transferred,transferred_from_id) values(v,a,def,d+3,snap,'assigned',true,historical_occ) returning id into carry_occ;
 insert into public.schedule_task_occurrences(venue_id,account_id,definition_id,business_date,snapshot,status,answers) values(v,a,def,d+4,snap,'in_progress',jsonb_build_object(point,'saved-answer')) returning id into started_occ;
 insert into public.schedule_task_occurrences(venue_id,account_id,definition_id,business_date,snapshot,status) values(v,a,def,d+5,snap,'assigned') returning id into photo_occ;
 insert into storage.objects(bucket_id,name,metadata) values('task-evidence',photo_occ||'/'||point||'/pending.jpg','{"mimetype":"image/jpeg"}');
 select to_jsonb(t) into body from public.schedule_task_definitions t where id=def;
 body:=body||jsonb_build_object('instructions','Версия 2','recurrence',jsonb_build_object('unit','week','interval',1,'anchor',d+2));
 perform public.schedule_task_command('definition.save',body);
 if exists(select 1 from public.schedule_task_occurrences where id=old_occ) then raise exception 'Перенос повтора оставил устаревшее будущее назначение';end if;
 if (select count(*) from public.schedule_task_occurrences where id in(historical_occ,current_occ,carry_occ,started_occ,photo_occ) and snapshot=snap)<>5 then raise exception 'Редактирование затронуло сегодняшний/исторический отчёт, перенос или начатую работу';end if;
 if not exists(select 1 from public.schedule_task_history where entity_id=def and action='assignment.cancelled' and details->>'occurrence_id'=old_occ::text and details->'before'->'snapshot'=snap) then raise exception 'Отмена назначения потеряла аудит';end if;
 perform public.schedule_process_tasks();
 select id into new_occ from public.schedule_task_occurrences where definition_id=def and business_date=d+2;
 if new_occ is null or exists(select 1 from public.schedule_task_occurrences where definition_id=def and business_date=d+1) then raise exception 'Обработчик не перестроил план по новому повтору';end if;
 if not exists(select 1 from public.schedule_task_occurrences where id=new_occ and snapshot->>'instructions'='Версия 2') then raise exception 'Новое назначение потеряло обновлённые инструкции';end if;
 select to_jsonb(t)||jsonb_build_object('enabled',false) into body from public.schedule_task_definitions t where id=def;
 perform public.schedule_task_command('definition.save',body);
 perform public.schedule_process_tasks();
 if exists(select 1 from public.schedule_task_occurrences where id=new_occ or (definition_id=def and business_date in(d+1,d+2))) then raise exception 'Выключенный шаблон оставил или восстановил будущий план';end if;
 if (select count(*) from public.schedule_task_occurrences where id in(historical_occ,current_occ,carry_occ,started_occ,photo_occ))<>5 then raise exception 'Выключение затронуло защищённые отчёты';end if;
 if exists(select 1 from public.payroll_adjustments where automation_key in('task:'||old_occ||':result','task:'||new_occ||':result')) then raise exception 'Устаревший план попал в начисления';end if;
 raise notice 'PASS: future plan is rebuilt after recurrence edits and removed on disable; today/history/carries/started/photo reports and cancellation audit are preserved';
end $$;
rollback;
