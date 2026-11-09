-- Варианты шаблона смены по дням недели (миграция 317): schedule_command
-- отклоняет повтор дней и некорректные варианты, сохраняет корректные
-- в нормализованном виде, а start_time/end_time = первому варианту.
-- Запуск на локальном seed; все изменения откатываются.
begin;
do $$
declare owner_id uuid; waiter_id uuid; venue uuid; tpl uuid; copy_id uuid; body jsonb; r public.schedule_templates; slot jsonb; shift_input jsonb; shift_id uuid;
begin
 select id into owner_id from auth.users where email='owner@test.com';
 select id into waiter_id from auth.users where email='waiter@test.com';
 if owner_id is null or waiter_id is null then raise exception 'Нужны локальные seed-пользователи';end if;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform set_config('app.ctx_ready','0',true);
 select uv.venue_id into venue from public.user_venue_roles uv
 where uv.user_id=waiter_id and uv.status='active' and exists(select 1 from public.user_venue_roles own where own.user_id=owner_id and own.venue_id=uv.venue_id and own.status='active') order by uv.venue_id limit 1;
 if venue is null then raise exception 'Нужно общее заведение seed-пользователей';end if;
 update public.profiles set active_venue_id=venue where id=owner_id;
 perform set_config('app.ctx_ready','0',true);

 body:=jsonb_build_object('name','Мастер','subtitle','день','color','blue','start_time','09:00','end_time','17:00','break_minutes',30,'arrival_minutes',15,'department_id',null,'role_id',null,'checklist_ids','[]'::jsonb);

 -- Повтор дня между вариантами.
 begin
  perform public.schedule_command('template.create',body||jsonb_build_object('variants',jsonb_build_array(
   jsonb_build_object('days',jsonb_build_array(1,2),'start_time','10:00','end_time','18:00'),
   jsonb_build_object('days',jsonb_build_array(2,3),'start_time','11:00','end_time','19:00'))));
  raise exception 'Повтор дня пропущен';
 exception when others then if sqlerrm<>'Дни недели в вариантах шаблона не должны повторяться' then raise;end if;end;
 -- Повтор дня внутри варианта.
 begin
  perform public.schedule_command('template.create',body||jsonb_build_object('variants',jsonb_build_array(
   jsonb_build_object('days',jsonb_build_array(4,4),'start_time','10:00','end_time','18:00'))));
  raise exception 'Повтор дня внутри варианта пропущен';
 exception when others then if sqlerrm<>'Дни недели в вариантах шаблона не должны повторяться' then raise;end if;end;
 -- Вариант без дней.
 begin
  perform public.schedule_command('template.create',body||jsonb_build_object('variants',jsonb_build_array(
   jsonb_build_object('days','[]'::jsonb,'start_time','10:00','end_time','18:00'))));
  raise exception 'Вариант без дней пропущен';
 exception when others then if sqlerrm<>'Укажите дни недели для каждого варианта шаблона' then raise;end if;end;
 -- День вне 1..7.
 begin
  perform public.schedule_command('template.create',body||jsonb_build_object('variants',jsonb_build_array(
   jsonb_build_object('days',jsonb_build_array(8),'start_time','10:00','end_time','18:00'))));
  raise exception 'День 8 пропущен';
 exception when others then if sqlerrm<>'Неверный день недели в варианте шаблона' then raise;end if;end;
 -- Неверное время.
 begin
  perform public.schedule_command('template.create',body||jsonb_build_object('variants',jsonb_build_array(
   jsonb_build_object('days',jsonb_build_array(1),'start_time','25:00','end_time','18:00'))));
  raise exception 'Неверное время пропущено';
 exception when others then if sqlerrm<>'Неверное время в варианте шаблона' then raise;end if;end;
 -- Больше 7 вариантов.
 begin
  perform public.schedule_command('template.create',body||jsonb_build_object('variants',(select jsonb_agg(jsonb_build_object('days',jsonb_build_array(g),'start_time','10:00','end_time','18:00')) from generate_series(1,8) g)));
  raise exception '8 вариантов пропущено';
 exception when others then if sqlerrm<>'В шаблоне может быть не больше 7 вариантов' then raise;end if;end;

 -- Корректный шаблон из трёх вариантов «Мастер · день».
 tpl:=(public.schedule_command('template.create',body||jsonb_build_object('variants',jsonb_build_array(
  jsonb_build_object('days',jsonb_build_array(5,1,3,4),'start_time','12:50','end_time','00:30'),
  jsonb_build_object('days',jsonb_build_array(2),'start_time','11:50:00','end_time','00:30'),
  jsonb_build_object('days',jsonb_build_array(6,7),'start_time','13:20','end_time','00:30'))))->>'id')::uuid;
 select * into r from public.schedule_templates where id=tpl;
 if r.name<>'Мастер' or r.subtitle<>'день' or r.break_minutes<>0 or r.arrival_minutes<>0 then raise exception 'Название, подзаголовок или устаревшие поля сохранены неверно';end if;
 if r.variants<>'[{"days":[1,3,4,5],"start_time":"12:50","end_time":"00:30"},{"days":[2],"start_time":"11:50","end_time":"00:30"},{"days":[6,7],"start_time":"13:20","end_time":"00:30"}]'::jsonb then raise exception 'Варианты сохранены неверно: %',r.variants;end if;
 if r.start_time<>'12:50' or r.end_time<>'00:30' then raise exception 'start/end не равны первому варианту: %–%',r.start_time,r.end_time;end if;

 -- Редактирование без ключа variants сохраняет варианты; копия тоже.
 perform public.schedule_command('template.edit',(body - 'subtitle')||jsonb_build_object('id',tpl,'version',r.version,'name','Мастер 2'));
 select * into r from public.schedule_templates where id=tpl;
 if jsonb_array_length(r.variants)<>3 or r.name<>'Мастер 2' or r.subtitle<>'день' then raise exception 'Редактирование потеряло варианты';end if;
 copy_id:=(public.schedule_command('template.copy',(body - 'subtitle')||jsonb_build_object('id',tpl))->>'id')::uuid;
 if not exists(select 1 from public.schedule_templates where id=copy_id and variants=r.variants and subtitle=r.subtitle) then raise exception 'Копия потеряла варианты или подзаголовок';end if;

 -- Пустые варианты — прежнее поведение: start/end из ввода на все дни.
 perform public.schedule_command('template.edit',body||jsonb_build_object('id',tpl,'version',r.version,'variants','[]'::jsonb,'subtitle',''));
 select * into r from public.schedule_templates where id=tpl;
 if r.subtitle<>'' or r.variants<>'[]'::jsonb or r.start_time<>'09:00' or r.end_time<>'17:00' then raise exception 'Пустые варианты обработаны неверно';end if;

 -- Шаблон без ключа variants создаётся с пустым списком.
 tpl:=(public.schedule_command('template.create',body)->>'id')::uuid;
 if (select variants from public.schedule_templates where id=tpl)<>'[]'::jsonb then raise exception 'Новый шаблон без вариантов: не пустой список';end if;

 -- Новый режим и обычный редактор работают с одним слотом.
 tpl:=(public.schedule_command('template.create',body||jsonb_build_object('variants',jsonb_build_array(
  jsonb_build_object('days',jsonb_build_array(5),'start_time','17:00','end_time','05:00'))))->>'id')::uuid;
 slot:=jsonb_build_object('template_id',tpl,'template_version',1,'date','2035-01-05','user_id',waiter_id);
 shift_id:=(public.schedule_create_template_slot(slot)->>'id')::uuid;
 if not exists(select 1 from public.schedule_shifts where id=shift_id and user_id=waiter_id
   and ends_at-starts_at=interval '12 hours' and not published) then
  raise exception 'Шаблон должен создать назначенный ночной черновик';
 end if;
 shift_input:=jsonb_build_object('template_id',tpl,'date','2035-01-05','start_time','17:00','end_time','05:00',
   'title','Вечер','color','blue','checklist_ids','[]'::jsonb);
 begin
  perform public.schedule_command('shift.create',shift_input);
  raise exception 'Обычный редактор создал второй слот';
 exception when others then
  if sqlerrm<>'Смена по этому шаблону уже есть. Обновите расписание' then raise; end if;
 end;
 begin
  perform public.schedule_command('shift.copy',shift_input||jsonb_build_object('id',shift_id));
  raise exception 'Копирование создало второй слот';
 exception when others then
  if sqlerrm<>'Смена по этому шаблону уже есть. Обновите расписание' then raise; end if;
 end;
 begin
  perform public.schedule_command('shift.edit',shift_input||jsonb_build_object('id',shift_id,'version',1,'date','2035-01-06'));
  raise exception 'Редактор перенёс смену на неактивный день';
 exception when others then
  if sqlerrm<>'Шаблон не действует в этот день' then raise; end if;
 end;
 perform public.schedule_command('shift.edit',shift_input||jsonb_build_object('id',shift_id,'version',1,'user_id',owner_id));
 if not exists(select 1 from public.schedule_shifts where id=shift_id and user_id=owner_id) then
  raise exception 'Действующую смену нельзя переназначить';
 end if;
 raise notice 'PASS: общий слот для обоих режимов, ночная смена, копирование, неактивный день и переназначение';
 raise notice 'PASS: варианты шаблона — повтор дней, пустые дни, дни вне 1..7, время, лимит, нормализация, сохранение подзаголовка, редактирование и копия';
end $$;
rollback;
