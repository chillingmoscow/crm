-- Meaningful integration checks: financial idempotency, review, carry, scope and evidence.
-- The entire scenario rolls back, including payroll journal/notification triggers.
begin;
do $$
declare owner_id uuid;staff_id uuid;manager_id uuid;v uuid;a uuid;tpl uuid;employee uuid;def uuid;def_past uuid;shift uuid;occ uuid;photo uuid:=gen_random_uuid();check_id uuid:=gen_random_uuid();body jsonb;rules jsonb;d date;result jsonb;before_count integer;count_after integer;ver integer;other uuid;def_auto uuid;occ_auto uuid;bonus_id uuid;msg_id uuid;claim jsonb;
begin
 select id into owner_id from auth.users where email='owner@test.com';
 select id into staff_id from auth.users where email='waiter@test.com';
 select id into manager_id from auth.users where email='manager@test.com';
 if owner_id is null or staff_id is null then raise exception 'Нужны локальные seed-пользователи';end if;
 select venue_id into v from public.user_venue_roles where user_id=owner_id and status='active' limit 1;
 select account_id,((now() at time zone coalesce(timezone,'Europe/Moscow'))::date) into a,d from public.venues where id=v;
 update public.profiles set active_venue_id=v where id in(owner_id,staff_id,manager_id);
 perform set_config('request.jwt.claim.sub',owner_id::text,true);perform set_config('app.ctx_ready','0',true);
 insert into public.schedule_templates(venue_id,name,color,start_time,end_time) values(v,'TEST Tasks','blue','09:00','17:00') returning id into tpl;
 select id into employee from public.payroll_employees where venue_id=v and local_user_id=staff_id;
 if employee is null then insert into public.payroll_employees(account_id,venue_id,local_user_id,name,role_name) values(a,v,staff_id,'TEST Task Employee','Официант') returning id into employee;end if;
 body:=jsonb_build_object('request_key',gen_random_uuid(),'name','TEST Checklist','instructions','Инструкция','template_id',tpl,'review_mode','manager','items',jsonb_build_array(jsonb_build_object('id',check_id,'title','Отметить выполнение','kind','check','required',true),jsonb_build_object('id',photo,'title','Фото','kind','photo','required',true)),'recurrence',jsonb_build_object('unit','week','interval',1,'anchor',d-7),'starts_on',d-7,'enabled',true,'penalty_enabled',true,'fine_amount',300,'reward_amount',300,'predecessor_id',null,'predecessor_offset',0,'equipment_groups','[]'::jsonb);
 def:=(public.schedule_task_command('definition.save',body)->>'id')::uuid;
 if (public.schedule_task_command('definition.save',body)->>'id')::uuid<>def or (select count(*) from public.schedule_task_definitions where venue_id=v and name='TEST Checklist')<>1 then raise exception 'Повтор создания продублировал задачу';end if;
 select count(*) into before_count from public.schedule_task_occurrences where definition_id=def;
 result:=public.schedule_task_preview(d,d+14);
 if jsonb_array_length(result)<3 or (select count(*) from public.schedule_task_occurrences where definition_id=def)<>before_count then raise exception 'Предпросмотр изменил задания или пропустил повтор';end if;
 -- No cutover: the worker is a no-op.
 perform public.schedule_process_tasks();
 if exists(select 1 from public.schedule_task_occurrences where definition_id=def) then raise exception 'Задания появились до перехода';end if;
 insert into public.schedule_task_settings(venue_id,account_id,enabled_from,legacy_stopped) values(v,a,d-7,true) on conflict(venue_id) do update set enabled_from=d-7,legacy_stopped=true;
 rules:='{"medical":{"reminders":false,"reminder_after_hire_days":3,"reminder_before_expiry_days":30,"submission_fine":false,"submission_after_hire_months":1,"submission_amount":3000,"expiry_fine":false,"expiry_amount":3000,"expiry_frequency":"once_per_expiry_case","reimbursement":false,"reimbursement_amount":3000,"reimbursement_after_exam_months":3,"reimbursement_requires_exam_after_hire":true},"uniform":{"enabled":false,"installments":4,"payment_days":[3,18]},"tasks":{"missing_enabled":true,"missing_kind":"deduction","missing_amount":200,"extra_reward_enabled":true,"extra_reward_medium":"bonus"},"gifts":{"enabled":false,"tenure_boundary_days":90,"holidays":[],"tenure":[]}}'::jsonb;
 insert into public.payroll_automation_settings(venue_id,account_id,version,config) values(v,a,1,rules) on conflict(venue_id) do update set config=rules;
 insert into public.payroll_settings(venue_id,account_id,starts_on,quickresto_venue_id,enabled) values(v,a,date_trunc('month',d-7)::date,1,false) on conflict(venue_id) do nothing;
 insert into public.schedule_shifts(venue_id,user_id,template_id,title,color,starts_at,ends_at,published) values(v,staff_id,tpl,'TEST Tasks','blue',(d::timestamp+interval '9 hours') at time zone 'Europe/Moscow',(d::timestamp+interval '17 hours') at time zone 'Europe/Moscow',true) returning id into shift;
 perform public.schedule_process_tasks();
 select id,version into occ,ver from public.schedule_task_occurrences where definition_id=def and business_date=d;
 if occ is null or not exists(select 1 from public.schedule_task_occurrences where id=occ and status='assigned' and employee_id=employee and user_id=staff_id) then raise exception 'Не назначен сотрудник опубликованной смены';end if;
 perform set_config('request.jwt.claim.sub',staff_id::text,true);perform set_config('app.ctx_ready','0',true);
 begin perform public.schedule_task_command('run.submit',jsonb_build_object('id',occ,'version',ver,'answers',jsonb_build_object(check_id,true)));raise exception 'Пропущено обязательное фото';exception when others then if sqlerrm='Пропущено обязательное фото' then raise;end if;end;
 begin perform public.schedule_task_command('run.submit',jsonb_build_object('id',occ,'version',ver,'answers',jsonb_build_object(check_id,true,photo,'https://example.com/fake.jpg')));raise exception 'Принято чужое фото';exception when others then if sqlerrm='Принято чужое фото' then raise;end if;end;
 insert into storage.objects(bucket_id,name,metadata) values('task-evidence',occ||'/'||photo||'/fixture.jpg','{"mimetype":"image/jpeg"}');
 perform public.schedule_task_command('run.submit',jsonb_build_object('id',occ,'version',ver,'answers',jsonb_build_object(check_id,true,photo,occ||'/'||photo||'/fixture.jpg')));
 update public.schedule_task_occurrences set deadline_at=now()-interval '1 hour' where id=occ;
 perform public.schedule_process_tasks();
 if not exists(select 1 from public.schedule_task_occurrences where id=occ and status='submitted' and adjustment_id is null) then raise exception 'Непроверенный отчёт оштрафован';end if;
 select version into ver from public.schedule_task_occurrences where id=occ;
 begin perform public.schedule_task_command('run.approve',jsonb_build_object('id',occ,'version',ver));raise exception 'Сотрудник принял свой отчёт';exception when others then if sqlerrm='Сотрудник принял свой отчёт' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);perform set_config('app.ctx_ready','0',true);
 perform public.schedule_task_command('run.approve',jsonb_build_object('id',occ,'version',ver));
 perform public.schedule_process_tasks();
 if exists(select 1 from public.payroll_adjustments where automation_key='task:'||occ||':result') then raise exception 'Премия за обычное выполнение';end if;
 -- A missed occurrence creates exactly one deduction and one carry on an available day.
 def_past:=(public.schedule_task_command('definition.save',body||jsonb_build_object('request_key',gen_random_uuid(),'name','TEST Past Only','recurrence',jsonb_build_object('unit','week','interval',52,'anchor',d-7)))->>'id')::uuid;
 perform public.schedule_process_tasks();
 insert into public.schedule_shifts(venue_id,user_id,template_id,title,color,starts_at,ends_at,published) values(v,staff_id,tpl,'TEST Past Tasks','blue',((d-7)::timestamp+interval '9 hours') at time zone 'Europe/Moscow',((d-7)::timestamp+interval '17 hours') at time zone 'Europe/Moscow',true) returning id into shift;
 select id into occ from public.schedule_task_occurrences where definition_id=def_past and business_date=d-7;
 perform public.schedule_process_tasks();perform public.schedule_process_tasks();
 select count(*) into count_after from public.payroll_adjustments where automation_key='task:'||occ||':result' and amount=-300 and medium='money';
 if count_after<>1 then raise exception 'Штраф не идемпотентен: %',count_after;end if;
 if (select count(*) from public.schedule_task_occurrences where definition_id=def_past and business_date=d and transferred)<>1 then raise exception 'Перенос потерян или задвоен';end if;
 -- A changed assigned shift blocks a stale deduction.
 update public.schedule_task_occurrences set settled_at=null,status='assigned',deadline_at=now()-interval '1 hour',answers=jsonb_build_object(check_id,true) where id=occ;
 update public.schedule_shifts set published=false where id=shift;
 perform public.schedule_process_tasks();
 if not exists(select 1 from public.schedule_task_occurrences where id=occ and status='assigned' and blocker<>'') then raise exception 'Отмена смены не заблокировала начисление';end if;
 -- Automatic acceptance produces a transferred-task reward through the existing bonus queue.
 def_auto:=(public.schedule_task_command('definition.save',body||jsonb_build_object('request_key',gen_random_uuid(),'name','TEST Auto','review_mode','auto'))->>'id')::uuid;
 perform public.schedule_process_tasks();
 select id,version into occ_auto,ver from public.schedule_task_occurrences where definition_id=def_auto and business_date=d;
 update public.schedule_task_occurrences set transferred=true where id=occ_auto;
 insert into storage.objects(bucket_id,name,metadata) values('task-evidence',occ_auto||'/'||photo||'/fixture.jpg','{"mimetype":"image/jpeg"}');
 perform set_config('request.jwt.claim.sub',staff_id::text,true);perform set_config('app.ctx_ready','0',true);
 perform public.schedule_task_command('run.submit',jsonb_build_object('id',occ_auto,'version',ver,'answers',jsonb_build_object(check_id,true,photo,occ_auto||'/'||photo||'/fixture.jpg')));
 if not exists(select 1 from public.schedule_task_occurrences where id=occ_auto and status='completed') then raise exception 'Автоприёмка не завершила задачу';end if;
 perform public.schedule_process_tasks();perform public.schedule_process_tasks();
 select id into bonus_id from public.payroll_adjustments where automation_key='task:'||occ_auto||':result' and medium='bonus' and amount=300 and external_state='review';
 if bonus_id is null or (select count(*) from public.payroll_adjustments where automation_key='task:'||occ_auto||':result')<>1 then raise exception 'Премия потеряна или задвоена';end if;
 update public.payroll_employees set quickresto_guest_id=900001,quickresto_bonus_account_id=900002 where id=employee;
 insert into public.payroll_execution_policy(venue_id,account_id,bonus_from,legacy_stopped,activated_at) values(v,a,d,true,now()) on conflict(venue_id) do update set bonus_from=d,legacy_stopped=true,activated_at=now();
 perform public.payroll_prepare_bonus_operations();perform public.payroll_prepare_bonus_operations();
 if (select count(*) from public.payroll_bonus_operations where adjustment_id=bonus_id and direction='credit' and amount=300)<>1 then raise exception 'Премия задачи не вошла в существующий исполнитель бонусов';end if;
 -- Unknown Telegram delivery is quarantined, not retried into a duplicate message.
 insert into public.schedule_task_messages(venue_id,account_id,business_date,message_key,chat_id,kind,payload,available_at) values(v,a,d,'fixture','-1000','daily','[]',now()-interval '1 day') returning id into msg_id;
 claim:=public.schedule_claim_task_message();
 if claim->>'id' is distinct from msg_id::text then raise exception 'Очередь не выдала сообщение';end if;
 perform public.schedule_finish_task_message(msg_id,(claim->>'lease_token')::uuid,null,'Тест неопределённого ответа',true);
 if exists(select 1 from public.schedule_task_messages where id=msg_id and state<>'review') or public.schedule_claim_task_message() is not null then raise exception 'Неопределённая отправка повторилась';end if;
 -- Role grants: the browser must not invoke the privileged worker.
 if has_function_privilege('authenticated','public.schedule_process_tasks()','execute') or has_function_privilege('anon','public.schedule_process_tasks()','execute') then raise exception 'Открыт привилегированный исполнитель';end if;
 if has_table_privilege('authenticated','public.schedule_task_occurrences','update') then raise exception 'Прямое изменение заданий разрешено';end if;
 -- Evaluate real authenticated RLS, rather than a superuser-filtered query.
 insert into public.schedule_task_occurrences(venue_id,account_id,definition_id,business_date,snapshot,user_id)
 select v,a,def,d+2,snapshot,owner_id from public.schedule_task_occurrences where id=occ_auto returning id into other;
 insert into storage.objects(bucket_id,name,metadata) values('task-evidence',other||'/'||photo||'/other.jpg','{"mimetype":"image/jpeg"}');
 perform set_config('request.jwt.claim.sub',staff_id::text,true);perform set_config('app.ctx_ready','0',true);
 execute 'set local role authenticated';
 if not exists(select 1 from public.schedule_task_occurrences where id=occ_auto) then raise exception 'Своя задача скрыта RLS';end if;
 if exists(select 1 from public.schedule_task_occurrences where id=other) then raise exception 'RLS показал чужое задание';end if;
 if exists(select 1 from storage.objects where bucket_id='task-evidence' and name=other||'/'||photo||'/other.jpg') then raise exception 'RLS показал чужую фотографию';end if;
 execute 'reset role';
 update public.schedule_task_occurrences set predecessor_occurrence_id=other where id=occ_auto;
 execute 'set local role authenticated';
 if not exists(select 1 from public.schedule_task_occurrences where id=other) or not exists(select 1 from storage.objects where bucket_id='task-evidence' and name=other||'/'||photo||'/other.jpg') then raise exception 'Предыдущий отчёт и фото недоступны ответственному следующей задачи';end if;
 execute 'reset role';
 raise notice 'PASS: preview, cutover gate, assignment, required evidence, pending review, self-approval, ordinary completion, exactly-once deduction/carry/reward, bonus queue integration, unknown delivery quarantine, changed shift, worker/table grants, authenticated report/photo RLS';
end $$;

-- Regression scenarios from review: repeated carries, ambiguity after draft, late acceptance and correction deadlines.
do $$
declare owner_id uuid;staff_id uuid;v uuid;a uuid;d date;tpl uuid;employee uuid;def uuid;prep_def uuid;prep uuid;original uuid;carried uuid;second_carry uuid;started uuid;duplicate uuid;late uuid;returned uuid;shift uuid;future_occ uuid;future_shift uuid;dependent_def uuid;dependent uuid;late_prep uuid;correction_def uuid;expired_return uuid;new_carry uuid;ver integer;check_id uuid:=gen_random_uuid();snap jsonb;prep_snap jsonb;
begin
 select id into owner_id from auth.users where email='owner@test.com';
 select id into staff_id from auth.users where email='waiter@test.com';
 select active_venue_id into v from public.profiles where id=owner_id;
 select account_id,(now() at time zone coalesce(timezone,'Europe/Moscow'))::date into a,d from public.venues where id=v;
 select id into employee from public.payroll_employees where venue_id=v and local_user_id=staff_id;
 update public.schedule_task_settings set enabled_from=d-10 where venue_id=v;
 insert into public.schedule_templates(venue_id,name,color,start_time,end_time) values(v,'TEST Review Regressions','blue','09:00','17:00') returning id into tpl;
 insert into public.schedule_task_definitions(account_id,venue_id,name,template_id,review_mode,items,recurrence,starts_on,enabled,penalty_enabled,fine_amount,reward_amount)
 values(a,v,'TEST Reviewed Task',tpl,'manager',jsonb_build_array(jsonb_build_object('id',check_id,'title','Проверено','kind','check','required',true)),jsonb_build_object('unit','week','interval',52,'anchor',d),d-10,true,true,300,300) returning id into def;
 select to_jsonb(t)||jsonb_build_object('task_rules',s.config->'tasks') into snap from public.schedule_task_definitions t join public.payroll_automation_settings s on s.venue_id=t.venue_id where t.id=def;
 insert into public.schedule_task_definitions(account_id,venue_id,name,template_id,review_mode,items,recurrence,starts_on,enabled,penalty_enabled,fine_amount,reward_amount)
 values(a,v,'TEST Preparation',tpl,'auto','[]',jsonb_build_object('unit','week','interval',52,'anchor',d-2),d-10,false,false,0,0) returning id into prep_def;
 select to_jsonb(t) into prep_snap from public.schedule_task_definitions t where id=prep_def;
 insert into public.schedule_task_occurrences(venue_id,account_id,definition_id,business_date,snapshot,status,settled_at) values(v,a,prep_def,d-2,prep_snap,'completed',now()) returning id into prep;
 -- Freeze equipment [7] and the original completed preparation on a missed dependent task.
 insert into public.schedule_task_occurrences(venue_id,account_id,definition_id,business_date,snapshot,status,settled_at,predecessor_occurrence_id,equipment)
 values(v,a,def,d-1,snap||jsonb_build_object('predecessor_id',prep_def,'predecessor_offset',1,'equipment_groups',jsonb_build_array(jsonb_build_array(7),jsonb_build_array(8))),'missed',now(),prep,'[7]') returning id into original;
 insert into public.schedule_shifts(venue_id,user_id,template_id,title,color,starts_at,ends_at,published)
 select v,staff_id,tpl,'TEST Regression Shift','blue',(day::timestamp+interval '9 hours') at time zone 'Europe/Moscow',(day::timestamp+interval '17 hours') at time zone 'Europe/Moscow',true from unnest(array[d,d+1,d-3,d-9,d-8]) day;
 perform public.schedule_process_tasks();perform public.schedule_process_tasks();
 select id into carried from public.schedule_task_occurrences where definition_id=def and business_date=d;
 if not exists(select 1 from public.schedule_task_occurrences where id=carried and status='assigned' and predecessor_occurrence_id=prep and equipment='[7]' and transferred_from_id=original) then raise exception 'Первый перенос потерял исходную подготовку или оборудование';end if;
 update public.schedule_task_occurrences set status='missed',settled_at=now() where id=carried;
 perform public.schedule_process_tasks();perform public.schedule_process_tasks();
 select id into second_carry from public.schedule_task_occurrences where definition_id=def and business_date=d+1;
 if not exists(select 1 from public.schedule_task_occurrences where id=second_carry and status='assigned' and predecessor_occurrence_id=prep and equipment='[7]' and transferred_from_id=carried) then raise exception 'Повторный перенос потерял исходную подготовку или оборудование';end if;
 -- A second published shift appearing after a draft must hold the charge without destroying the report.
 select id into shift from public.schedule_shifts where template_id=tpl and (starts_at at time zone 'Europe/Moscow')::date=d-3;
 insert into public.schedule_task_occurrences(venue_id,account_id,definition_id,business_date,snapshot,status,shift_id,employee_id,user_id,answers,deadline_at)
 values(v,a,def,d-3,snap,'in_progress',shift,employee,staff_id,jsonb_build_object(check_id,true),now()-interval '1 hour') returning id into started;
 insert into public.schedule_shifts(venue_id,user_id,template_id,title,color,starts_at,ends_at,published)
 select venue_id,user_id,template_id,'TEST Duplicate','blue',starts_at,ends_at,true from public.schedule_shifts where id=shift returning id into duplicate;
 perform public.schedule_process_tasks();
 if not exists(select 1 from public.schedule_task_occurrences where id=started and status='in_progress' and blocker<>'' and answers=jsonb_build_object(check_id,true) and settled_at is null) or exists(select 1 from public.payroll_adjustments where automation_key='task:'||started||':result') then raise exception 'Неоднозначная начатая задача оштрафована или потеряла отчёт';end if;
 delete from public.schedule_shifts where id=duplicate;
 perform public.schedule_process_tasks();
 if (select count(*) from public.payroll_adjustments where automation_key='task:'||started||':result' and amount=-300)<>1 then raise exception 'После исправления назначения начисление не восстановилось';end if;
 -- Approval after eight days still earns the transferred-task reward in an open period.
 select id into shift from public.schedule_shifts where template_id=tpl and (starts_at at time zone 'Europe/Moscow')::date=d-9;
 insert into public.schedule_task_occurrences(venue_id,account_id,definition_id,business_date,snapshot,status,shift_id,employee_id,user_id,answers,deadline_at,submitted_at,transferred)
 values(v,a,def,d-9,snap,'submitted',shift,employee,staff_id,jsonb_build_object(check_id,true),now()-interval '8 days',now()-interval '8 days',true) returning id,version into late,ver;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);perform set_config('app.ctx_ready','0',true);
 perform public.schedule_task_command('run.approve',jsonb_build_object('id',late,'version',ver));
 perform public.schedule_process_tasks();perform public.schedule_process_tasks();
 if (select count(*) from public.payroll_adjustments where automation_key='task:'||late||':result' and amount=300 and medium='bonus')<>1 then raise exception 'Поздняя приёмка потеряла или задвоила премию';end if;
 -- A late manager return requires an explicit new deadline and cannot cause an immediate fine.
 select id into shift from public.schedule_shifts where template_id=tpl and (starts_at at time zone 'Europe/Moscow')::date=d-8;
 insert into public.schedule_task_occurrences(venue_id,account_id,definition_id,business_date,snapshot,status,shift_id,employee_id,user_id,answers,deadline_at,submitted_at)
 values(v,a,def,d-8,snap,'submitted',shift,employee,staff_id,jsonb_build_object(check_id,true),now()-interval '7 days',now()-interval '7 days') returning id,version into returned,ver;
 begin perform public.schedule_task_command('run.return',jsonb_build_object('id',returned,'version',ver,'comment','Исправить'));raise exception 'Возврат без срока разрешён';exception when others then if sqlerrm='Возврат без срока разрешён' then raise;end if;end;
 perform public.schedule_task_command('run.return',jsonb_build_object('id',returned,'version',ver,'comment','Исправить','correct_until',now()+interval '2 days'));
 perform public.schedule_process_tasks();
 if not exists(select 1 from public.schedule_task_occurrences where id=returned and status='returned' and deadline_at>now() and settled_at is null) then raise exception 'Возврат просроченного отчёта сразу оштрафован или заблокирован';end if;
 select version into ver from public.schedule_task_occurrences where id=returned;
 perform set_config('request.jwt.claim.sub',staff_id::text,true);perform set_config('app.ctx_ready','0',true);
 perform public.schedule_task_command('run.submit',jsonb_build_object('id',returned,'version',ver,'answers',jsonb_build_object(check_id,true)));
 if not exists(select 1 from public.schedule_task_occurrences where id=returned and status='submitted') then raise exception 'Исправленный старый отчёт не отправлен';end if;
 -- Existing calendar deletion must detach a future assignment and allow a replacement shift.
 insert into public.schedule_shifts(venue_id,user_id,template_id,title,color,starts_at,ends_at,published)
 values(v,staff_id,tpl,'TEST Future Delete','blue',((d+2)::timestamp+interval '9 hours') at time zone 'Europe/Moscow',((d+2)::timestamp+interval '17 hours') at time zone 'Europe/Moscow',true) returning id,version into future_shift,ver;
 insert into public.schedule_task_occurrences(venue_id,account_id,definition_id,business_date,snapshot) values(v,a,def,d+2,snap) returning id into future_occ;
 perform public.schedule_process_tasks();
 if not exists(select 1 from public.schedule_task_occurrences where id=future_occ and shift_id=future_shift and status='assigned') then raise exception 'Будущая задача не назначена';end if;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);perform set_config('app.ctx_ready','0',true);
 perform public.schedule_command('shift.delete',jsonb_build_object('id',future_shift,'version',ver));
 if not exists(select 1 from public.schedule_task_occurrences where id=future_occ and shift_id is null) or not exists(select 1 from public.schedule_task_history where entity_id=future_occ and details->'before'->>'shift_id'=future_shift::text and details->'after'->>'shift_id' is null) then raise exception 'Удаление смены не отделило задачу или потеряло аудит';end if;
 perform public.schedule_process_tasks();
 if not exists(select 1 from public.schedule_task_occurrences where id=future_occ and status='blocked') then raise exception 'Удалённая смена оставила активное назначение';end if;
 insert into public.schedule_shifts(venue_id,user_id,template_id,title,color,starts_at,ends_at,published)
 values(v,staff_id,tpl,'TEST Future Replacement','blue',((d+2)::timestamp+interval '9 hours') at time zone 'Europe/Moscow',((d+2)::timestamp+interval '17 hours') at time zone 'Europe/Moscow',true) returning id into future_shift;
 perform public.schedule_process_tasks();
 if not exists(select 1 from public.schedule_task_occurrences where id=future_occ and shift_id=future_shift and status='assigned') then raise exception 'Замена удалённой смены не переназначила задачу';end if;
 -- A prerequisite accepted after the dependent deadline cannot instantly penalize its assignee.
 insert into public.schedule_shifts(venue_id,user_id,template_id,title,color,starts_at,ends_at,published)
 values(v,staff_id,tpl,'TEST Late Preparation','blue',((d-4)::timestamp+interval '9 hours') at time zone 'Europe/Moscow',((d-4)::timestamp+interval '17 hours') at time zone 'Europe/Moscow',true) returning id into shift;
 insert into public.schedule_task_occurrences(venue_id,account_id,definition_id,business_date,snapshot,status,shift_id,employee_id,user_id,submitted_at)
 values(v,a,prep_def,d-4,prep_snap,'submitted',shift,employee,staff_id,now()-interval '3 days') returning id,version into late_prep,ver;
 insert into public.schedule_task_definitions(account_id,venue_id,name,template_id,review_mode,items,recurrence,starts_on,enabled,penalty_enabled,fine_amount,reward_amount,predecessor_id,predecessor_offset)
 select account_id,venue_id,'TEST Late Dependent',template_id,review_mode,items,recurrence,starts_on,false,true,300,300,prep_def,1 from public.schedule_task_definitions where id=def returning id into dependent_def;
 insert into public.schedule_task_occurrences(venue_id,account_id,definition_id,business_date,snapshot,blocker)
 values(v,a,dependent_def,d-3,snap||jsonb_build_object('id',dependent_def,'predecessor_id',prep_def,'predecessor_offset',1),'Ожидается выполнение предыдущей задачи') returning id into dependent;
 perform public.schedule_task_command('run.approve',jsonb_build_object('id',late_prep,'version',ver));
 perform public.schedule_process_tasks();perform public.schedule_process_tasks();
 if not exists(select 1 from public.schedule_task_occurrences where id=dependent and status='blocked' and blocker like 'Срок истёк%' and settled_at is null) or exists(select 1 from public.payroll_adjustments where automation_key='task:'||dependent||':result') or exists(select 1 from public.schedule_task_occurrences where transferred_from_id=dependent) then raise exception 'Поздняя подготовка автоматически оштрафовала зависимую задачу';end if;
 -- Missing an extended correction deadline must never create a chain of backdated fines.
 insert into public.schedule_task_definitions(account_id,venue_id,name,template_id,review_mode,items,recurrence,starts_on,enabled,penalty_enabled,fine_amount,reward_amount)
 select account_id,venue_id,'TEST Expired Correction',template_id,review_mode,items,recurrence,starts_on,false,true,300,300 from public.schedule_task_definitions where id=def returning id into correction_def;
 insert into public.schedule_shifts(venue_id,user_id,template_id,title,color,starts_at,ends_at,published)
 values(v,staff_id,tpl,'TEST Old Returned Shift','blue',((d-5)::timestamp+interval '9 hours') at time zone 'Europe/Moscow',((d-5)::timestamp+interval '17 hours') at time zone 'Europe/Moscow',true) returning id into shift;
 insert into public.schedule_task_occurrences(venue_id,account_id,definition_id,business_date,snapshot,status,shift_id,employee_id,user_id,answers,deadline_at,submitted_at)
 values(v,a,correction_def,d-5,snap||jsonb_build_object('id',correction_def),'returned',shift,employee,staff_id,jsonb_build_object(check_id,true),now()-interval '1 hour',now()-interval '4 days') returning id into expired_return;
 perform public.schedule_process_tasks();perform public.schedule_process_tasks();perform public.schedule_process_tasks();
 select id into new_carry from public.schedule_task_occurrences where definition_id=correction_def and transferred_from_id=expired_return;
 if not exists(select 1 from public.schedule_task_occurrences where id=new_carry and business_date=d and status='assigned' and deadline_at>now() and settled_at is null) then raise exception 'Просроченное исправление перенесено задним числом';end if;
 if (select count(*) from public.payroll_adjustments where automation_key='task:'||expired_return||':result' and amount=-300)<>1 or exists(select 1 from public.payroll_adjustments where automation_key='task:'||new_carry||':result') or exists(select 1 from public.schedule_task_occurrences where definition_id=correction_def and business_date between d-4 and d-1) then raise exception 'Просроченное исправление породило цепочку штрафов';end if;
 raise notice 'PASS: repeated prerequisite/equipment carry, ambiguous started assignment recovery, late approval reward, correction deadline/carry without backdated fines, calendar shift deletion/replacement, late prerequisite reconciliation';
end $$;
rollback;
