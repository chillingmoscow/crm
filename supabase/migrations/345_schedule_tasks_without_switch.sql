-- Задачи без общего выключателя заведения + расписание сообщений в Telegram.
--
-- 1. Задача работает, когда она включена (статус «Работает») и наступила её
--    дата. Выключатель «Задачи работают» / «С какого дня» / пауза в
--    schedule_task_settings больше ничего не решают: колонки enabled_from,
--    paused, legacy_stopped остаются (expand/contract), но не читаются.
--    Чтобы включение задачи с прошедшей датой начала не создало пропуски и
--    штрафы задним числом, у задачи появляется active_from — день включения
--    по часам заведения. Отчёты создаются только с max(starts_on, active_from).
-- 2. schedule_task_settings теперь — только сообщения в Telegram: чат и дни/
--    время списка задач, чаты, дни и время напоминания сдать график.
--    Настраивается в «Интеграции → Telegram».
begin;

-- 1. Дата включения задачи.
alter table public.schedule_task_definitions add column active_from date;

update public.schedule_task_definitions d
   set active_from = greatest(d.starts_on, coalesce(st.enabled_from, (now() at time zone coalesce(v.timezone, 'Europe/Moscow'))::date))
  from public.venues v
  left join public.schedule_task_settings st on st.venue_id = v.id
 where v.id = d.venue_id and d.enabled and d.deleted_at is null;

create or replace function private.schedule_task_definition_active_from()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.enabled and (tg_op = 'INSERT' or not old.enabled or old.active_from is null) then
    select (now() at time zone coalesce(v.timezone, 'Europe/Moscow'))::date
      into new.active_from
      from public.venues v
     where v.id = new.venue_id;
  elsif not new.enabled then
    new.active_from := null;
  end if;
  return new;
end
$$;
revoke all on function private.schedule_task_definition_active_from() from public, anon, authenticated;

create trigger schedule_task_definition_active_from
  before insert or update on public.schedule_task_definitions
  for each row execute function private.schedule_task_definition_active_from();

-- 2. Расписание сообщений.
alter table public.schedule_task_settings
  add column daily_days smallint[] not null default '{1,2,3,4,5,6,7}',
  add column daily_time time not null default '12:00',
  add column schedule_open_day smallint not null default 1,
  add column schedule_deadline_day smallint not null default 3,
  add column schedule_time time not null default '14:00',
  add constraint schedule_task_settings_daily_days
    check (cardinality(daily_days) between 1 and 7 and daily_days <@ '{1,2,3,4,5,6,7}'::smallint[]),
  add constraint schedule_task_settings_schedule_days
    check (schedule_open_day between 1 and 7 and schedule_deadline_day between 1 and 7
           and schedule_open_day <> schedule_deadline_day);

alter table public.schedule_task_messages drop constraint if exists schedule_task_messages_kind_check;
alter table public.schedule_task_messages add constraint schedule_task_messages_kind_check
  check (kind in ('daily', 'monday', 'wednesday', 'schedule_open', 'schedule_deadline'));

-- 3. Обработчик задач: по заведениям, где есть включённые задачи или
--    незакрытые отчёты; без проверки выключателя.
CREATE OR REPLACE FUNCTION public.schedule_process_tasks()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare settings record;today date;tz text;entry jsonb;o public.schedule_task_occurrences;
 def public.schedule_task_definitions;s public.schedule_shifts;e public.payroll_employees;
 n integer;count_shifts integer;blocked_reason text;group_index integer;occurrence_index integer;assignment_deadline timestamptz;rules jsonb;kind text;medium text;amount numeric;
 adjustment uuid;created integer:=0;settled integer:=0;
begin
 -- Задачи работают по самой задаче: включена и наступила её дата. Общего выключателя заведения нет.
 for settings in select v.id as venue_id,v.account_id from public.venues v
   where exists(select 1 from public.schedule_task_definitions td where td.venue_id=v.id and td.account_id=v.account_id and td.enabled and td.deleted_at is null)
      or exists(select 1 from public.schedule_task_occurrences tor where tor.venue_id=v.id and tor.settled_at is null) loop
  -- Один тик на заведение: параллельный вызов пропускает занятое заведение.
  if not pg_try_advisory_xact_lock(hashtextextended('schedule-tasks-tick:'||settings.venue_id::text,0)) then continue;end if;
  -- Share the venue lock with payroll approval until the journal and salary overlays are settled.
  perform pg_advisory_xact_lock(hashtextextended(settings.venue_id::text,0));
  select coalesce(timezone,'Europe/Moscow') into tz from public.venues where id=settings.venue_id and account_id=settings.account_id;
  if tz is null then continue;end if;today:=(now() at time zone tz)::date;
  -- Only dates at/after the day the task was switched on are generated: no backdated misses.
  for entry in select value from jsonb_array_elements(private.schedule_task_plan(settings.venue_id,today-7,today+7)) loop
   if not coalesce((entry->'snapshot'->>'enabled')::boolean,false) or (entry->>'business_date')::date<coalesce((entry->'snapshot'->>'active_from')::date,'infinity'::date) then continue;end if;
   insert into public.schedule_task_occurrences(venue_id,account_id,definition_id,business_date,snapshot)
   values(settings.venue_id,settings.account_id,(entry->>'definition_id')::uuid,(entry->>'business_date')::date,entry->'snapshot') on conflict(definition_id,business_date) do nothing;
   get diagnostics n=row_count;created:=created+n;
  end loop;
  -- Rebind untouched assignments when the published shift is filled or corrected.
  for o in select * from public.schedule_task_occurrences where venue_id=settings.venue_id and business_date between today-7 and today+7 and status in ('blocked','assigned') and answers='{}'::jsonb and settled_at is null for update loop
   if o.evidence_started then continue;end if;
   select count(*) into count_shifts from public.schedule_shifts where venue_id=o.venue_id and template_id=(o.snapshot->>'template_id')::uuid and published and (starts_at at time zone tz)::date=o.business_date;
   blocked_reason:='';s:=null;e:=null;
   if count_shifts=0 then blocked_reason:='Нет опубликованной смены нужного шаблона';
   elsif count_shifts>1 then blocked_reason:='Найдено несколько смен. Уточните назначение в графике';
   else
    select * into s from public.schedule_shifts where venue_id=o.venue_id and template_id=(o.snapshot->>'template_id')::uuid and published and (starts_at at time zone tz)::date=o.business_date;
    select count(*) into n from public.payroll_employees where venue_id=o.venue_id and account_id=o.account_id and active and (id=s.payroll_employee_id or (s.payroll_employee_id is null and local_user_id=s.user_id));
    if n<>1 then blocked_reason:='Нет однозначного соответствия сотруднику ведомости';else
     select * into e from public.payroll_employees where venue_id=o.venue_id and account_id=o.account_id and active and (id=s.payroll_employee_id or (s.payroll_employee_id is null and local_user_id=s.user_id));
     if coalesce(s.user_id,e.local_user_id) is null then blocked_reason:='У сотрудника нет аккаунта для выполнения задачи';end if;
     if e.hired_on>o.business_date then blocked_reason:='Смена раньше даты приёма сотрудника';end if;
     if not exists(select 1 from public.user_venue_roles uv where uv.user_id=coalesce(s.user_id,e.local_user_id) and uv.venue_id=o.venue_id and uv.status='active') then blocked_reason:='У сотрудника нет активного доступа в заведение';end if;
    end if;
   end if;
   if nullif(o.snapshot->>'instruction_page_id','') is not null and (o.snapshot->'instruction_snapshot' is null or o.snapshot->'instruction_snapshot'='null'::jsonb) then blocked_reason:='Страница инструкции недоступна. Проверьте шаблон задачи';end if;
   assignment_deadline:=case when s.id is not null then greatest(s.ends_at,((o.business_date+1)::timestamp+interval '11 hours 30 minutes') at time zone tz) end;
   if blocked_reason='' and assignment_deadline<=now() and (o.status='blocked' or o.shift_id is distinct from s.id or o.employee_id is distinct from e.id or o.user_id is distinct from coalesce(s.user_id,e.local_user_id)) then
    blocked_reason:='Срок истёк до доступности задачи. Нужна сверка без автоматического штрафа';
   end if;
   group_index:=jsonb_array_length(coalesce(o.snapshot->'equipment_groups','[]'));
   if o.snapshot->'recurrence'->>'unit'='month' then
    occurrence_index:=((extract(year from o.business_date)::integer-extract(year from (o.snapshot->'recurrence'->>'anchor')::date)::integer)*12+extract(month from o.business_date)::integer-extract(month from (o.snapshot->'recurrence'->>'anchor')::date)::integer)/greatest((o.snapshot->'recurrence'->>'interval')::integer,1);
   else
    occurrence_index:=(o.business_date-(o.snapshot->'recurrence'->>'anchor')::date)/(7*greatest((o.snapshot->'recurrence'->>'interval')::integer,1));
   end if;
   update public.schedule_task_occurrences set shift_id=s.id,employee_id=e.id,user_id=coalesce(s.user_id,e.local_user_id),employee_name=e.name,
    deadline_at=assignment_deadline,
    status=case when blocked_reason='' then 'assigned' else 'blocked' end,blocker=blocked_reason,
    equipment=case when o.transferred then o.equipment when group_index>0 then (o.snapshot->'equipment_groups')->(occurrence_index%group_index) else '[]'::jsonb end,
    version=version+case when shift_id is distinct from s.id or employee_id is distinct from e.id or user_id is distinct from coalesce(s.user_id,e.local_user_id) or schedule_task_occurrences.blocker is distinct from blocked_reason then 1 else 0 end,updated_at=now() where id=o.id;
  end loop;
  update public.schedule_task_occurrences set status='blocked',blocker='Давнее задание после перерыва. Нужна сверка',version=version+1 where venue_id=settings.venue_id and business_date<today-7 and settled_at is null and status in ('assigned','in_progress','returned') and submitted_at is null and deadline_at<=now();
  for o in select * from public.schedule_task_occurrences where venue_id=settings.venue_id and settled_at is null and
   (status='completed' or (status in ('assigned','in_progress','returned') and deadline_at<=now() and (business_date>=today-7 or submitted_at is not null))) and business_date<=today for update loop
   -- A changed/cancelled shift or a closed salary month must never produce a stale charge.
   select count(*) into count_shifts from public.schedule_shifts where venue_id=o.venue_id and template_id=(o.snapshot->>'template_id')::uuid and published and (starts_at at time zone tz)::date=o.business_date;
   if count_shifts<>1 or not exists(select 1 from public.schedule_shifts current_shift where current_shift.id=o.shift_id and current_shift.venue_id=o.venue_id and current_shift.published and current_shift.template_id=(o.snapshot->>'template_id')::uuid and (current_shift.starts_at at time zone tz)::date=o.business_date and (current_shift.payroll_employee_id=o.employee_id or (current_shift.payroll_employee_id is null and current_shift.user_id=o.user_id)))
    or not exists(select 1 from public.payroll_employees where id=o.employee_id and venue_id=o.venue_id and active and (hired_on is null or hired_on<=o.business_date))
    or not exists(select 1 from public.user_venue_roles uv where uv.user_id=o.user_id and uv.venue_id=o.venue_id and uv.status='active') then
    update public.schedule_task_occurrences set blocker='Смена или сотрудник изменились. Нужна проверка',status=case when o.status='assigned' and o.answers='{}'::jsonb and not o.evidence_started then 'blocked' else o.status end,version=version+case when o.blocker='Смена или сотрудник изменились. Нужна проверка' then 0 else 1 end where id=o.id;continue;
   end if;
   if exists(select 1 from public.payroll_periods where venue_id=o.venue_id and month=date_trunc('month',o.business_date)::date and status<>'draft') then
    update public.schedule_task_occurrences set blocker='Зарплатный период закрыт. Нужна сверка начисления' where id=o.id;continue;
   end if;
   rules:=o.snapshot->'task_rules';kind:=null;medium:=null;amount:=null;adjustment:=null;
   if o.status<>'completed' then
    if coalesce((o.snapshot->>'penalty_enabled')::boolean,true) then
     if rules is null or rules='null'::jsonb then update public.schedule_task_occurrences set blocker='Не подтверждены зарплатные правила задач' where id=o.id;continue;end if;
     if (rules->>'missing_enabled')::boolean then
      kind:=case when rules->>'missing_kind'='deduction' then 'deduction' else 'warning' end;
      medium:=case when kind='warning' then 'none' else 'money' end;
      amount:=case when kind='warning' then 0 else -coalesce((o.snapshot->>'fine_amount')::numeric,(rules->>'missing_amount')::numeric) end;
     end if;
    end if;
    update public.schedule_task_occurrences set status='missed',version=version+1 where id=o.id;
   elsif o.transferred and (o.snapshot->>'reward_amount')::numeric>0 then
    if rules is null or rules='null'::jsonb then update public.schedule_task_occurrences set blocker='Не подтверждены зарплатные правила задач' where id=o.id;continue;end if;
    if (rules->>'extra_reward_enabled')::boolean then kind:='bonus';medium:=rules->>'extra_reward_medium';amount:=(o.snapshot->>'reward_amount')::numeric;end if;
   end if;
   if kind is not null then
    if not exists(select 1 from public.payroll_settings where venue_id=o.venue_id and account_id=o.account_id) then
     update public.schedule_task_occurrences set blocker='Сначала настройте зарплату заведения',status=o.status where id=o.id;continue;
    end if;
    insert into public.payroll_adjustments(account_id,venue_id,employee_id,business_date,kind,medium,amount,reason,source_ref,approved,managed,origin,automation_key,rule_snapshot,external_state)
    values(o.account_id,o.venue_id,o.employee_id,o.business_date,kind,medium,amount,case when kind='bonus' then 'Выполнение перенесённой задачи «' else 'Задача «' end||(o.snapshot->>'name')||case when kind='bonus' then '»' else '» не выполнена' end,'task:'||o.id,true,true,'task','task:'||o.id||':result',o.snapshot,case when medium='bonus' then 'review' else 'not_required' end)
    on conflict(venue_id,automation_key) where automation_key is not null do nothing returning id into adjustment;
    if adjustment is null then select id into adjustment from public.payroll_adjustments where venue_id=o.venue_id and automation_key='task:'||o.id||':result';end if;
   end if;
   update public.schedule_task_occurrences set adjustment_id=adjustment,settled_at=now(),blocker='',updated_at=now() where id=o.id;
   insert into public.schedule_task_history(venue_id,entity_id,action,details) values(o.venue_id,o.id,'result.settled',jsonb_build_object('adjustment_id',adjustment,'kind',kind));settled:=settled+1;
  end loop;
  -- Carry once to an available day, including after a delayed review/correction deadline. Reuse only untouched assignments.
  for o in select * from public.schedule_task_occurrences where venue_id=settings.venue_id and status='missed' and not transfer_created and exists(select 1 from public.schedule_task_definitions d where d.id=definition_id and d.deleted_at is null) for update loop
   insert into public.schedule_task_occurrences(venue_id,account_id,definition_id,business_date,snapshot,transferred,transferred_from_id,equipment)
   values(o.venue_id,o.account_id,o.definition_id,greatest(o.business_date+1,today),o.snapshot,true,o.id,o.equipment)
   on conflict(definition_id,business_date) do update set transferred=true,transferred_from_id=excluded.transferred_from_id,snapshot=excluded.snapshot,equipment=excluded.equipment,
    -- The carried snapshot may belong to a different shift template. Never expose its old binding.
    shift_id=null,employee_id=null,user_id=null,employee_name=null,deadline_at=null,
    status='blocked',blocker='Перенос ожидает назначения смены',updated_at=now(),version=schedule_task_occurrences.version+1
   where schedule_task_occurrences.status in ('assigned','blocked') and schedule_task_occurrences.answers='{}'::jsonb and schedule_task_occurrences.settled_at is null and (schedule_task_occurrences.transferred_from_id is null or schedule_task_occurrences.transferred_from_id=excluded.transferred_from_id)
    and not schedule_task_occurrences.evidence_started;
   get diagnostics n=row_count;
   if n>0 then
    update public.schedule_task_occurrences set transfer_created=true,blocker='' where id=o.id;
   else
    update public.schedule_task_occurrences set blocker='Перенос ожидает свободного дня: текущее задание уже занято другим отчётом' where id=o.id;
   end if;
  end loop;
 end loop;
 return jsonb_build_object('created',created,'settled',settled);
end $function$;

-- 4. Разовая задача на день: без проверки выключателя.
CREATE OR REPLACE FUNCTION public.schedule_task_assign_once(p_definition uuid, p_date date, p_template uuid DEFAULT NULL::uuid, p_role uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  venue uuid := public.get_active_venue_id();
  account uuid := public.get_active_account_id();
  actor uuid := (select auth.uid());
  def public.schedule_task_definitions;
  zone text;
  today date;
  template uuid;
  matches integer;
  rules jsonb;
  ident uuid;
begin
  if actor is null or venue is null or account is null then
    raise exception 'Нет доступа к заведению';
  end if;
  if not public.has_permission('schedule.checklist_edit') then
    raise exception 'Нет доступа к назначению задач';
  end if;
  if (p_template is null) = (p_role is null) then
    raise exception 'Выберите шаблон смены или должность';
  end if;

  select * into def from public.schedule_task_definitions
   where id = p_definition and venue_id = venue and account_id = account and deleted_at is null;
  if not found then raise exception 'Задача не найдена'; end if;

  select coalesce(v.timezone, 'Europe/Moscow') into zone from public.venues v where v.id = venue;
  today := (now() at time zone zone)::date;
  if p_date is null or p_date < today then
    raise exception 'Выберите сегодняшний или будущий день';
  end if;

  if p_role is not null then
    select count(*), min(s.template_id::text)::uuid into matches, template
      from public.schedule_shifts s
     where s.venue_id = venue and s.role_id = p_role and s.template_id is not null
       and (s.starts_at at time zone zone)::date = p_date;
    if matches = 0 then
      raise exception 'В этот день нет смены этой должности';
    end if;
    if matches > 1 then
      raise exception 'В этот день несколько смен этой должности — выберите шаблон смены';
    end if;
  else
    if not exists (select 1 from public.schedule_templates t
                    where t.id = p_template and t.venue_id = venue and not t.archived) then
      raise exception 'Шаблон смены не найден';
    end if;
    template := p_template;
  end if;

  if exists (select 1 from public.schedule_task_occurrences o
              where o.definition_id = def.id and o.business_date = p_date) then
    raise exception 'Эта задача уже стоит на этот день';
  end if;

  select config->'tasks' into rules from public.payroll_automation_settings
   where venue_id = venue and version > 0;

  insert into public.schedule_task_occurrences(venue_id, account_id, definition_id, business_date, snapshot)
  values (
    venue, account, def.id, p_date,
    to_jsonb(def) || jsonb_build_object(
      'template_id', template,
      'one_off', true,
      'assigned_by', actor,
      'task_rules', rules,
      'instruction_snapshot', case when def.instruction_page_id is not null
        then private.schedule_task_instruction(def.instruction_page_id, def.account_id)
        else def.instruction_snapshot end
    )
  )
  returning id into ident;

  return jsonb_build_object('id', ident, 'template_id', template);
end
$function$;

-- 5. Сообщения: дни и время из настроек. Окно 3 часа после времени отправки —
--    пропущенный тик догоняет, а сохранённая позже настройка не шлёт
--    сегодняшнее сообщение задним числом.
create or replace function public.schedule_claim_task_message()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  st public.schedule_task_settings;
  tz text;
  local_time timestamp;
  today date;
  weekday integer;
  tasks jsonb;
  chat text;
  reminder text;
  msg public.schedule_task_messages;
  token uuid := gen_random_uuid();
begin
  update public.schedule_task_messages
     set state = 'review', error = 'Ответ Telegram неизвестен. Проверьте чат перед повтором'
   where state = 'sending' and claimed_at < now() - interval '3 minutes';

  for st in
    select s.* from public.schedule_task_settings s
     where s.chat_id is not null or jsonb_array_length(s.reminder_chat_ids) > 0
  loop
    select coalesce(v.timezone, 'Europe/Moscow') into tz
      from public.venues v where v.id = st.venue_id and v.account_id = st.account_id;
    if tz is null then continue; end if;
    local_time := now() at time zone tz;
    today := local_time::date;
    weekday := extract(isodow from today)::integer;

    if st.chat_id is not null and weekday = any(st.daily_days)
       and local_time >= today + st.daily_time
       and local_time < today + st.daily_time + interval '3 hours' then
      select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.snapshot->>'name', 'employee', o.employee_name, 'blocked', o.blocker) order by o.snapshot->>'name'), '[]')
        into tasks
        from public.schedule_task_occurrences o
       where o.venue_id = st.venue_id and o.business_date = today;
      if jsonb_array_length(tasks) > 0 then
        insert into public.schedule_task_messages(venue_id, account_id, business_date, message_key, chat_id, kind, payload)
        values (st.venue_id, st.account_id, today, 'daily:' || today, st.chat_id, 'daily', tasks)
        on conflict do nothing;
      end if;
    end if;

    reminder := case weekday
      when st.schedule_open_day then 'schedule_open'
      when st.schedule_deadline_day then 'schedule_deadline'
    end;
    if reminder is not null
       and local_time >= today + st.schedule_time
       and local_time < today + st.schedule_time + interval '3 hours' then
      for chat in select jsonb_array_elements_text(st.reminder_chat_ids) loop
        insert into public.schedule_task_messages(venue_id, account_id, business_date, message_key, chat_id, kind, payload)
        values (st.venue_id, st.account_id, today, 'schedule:' || today, chat, reminder,
                jsonb_build_object('deadline_day', st.schedule_deadline_day))
        on conflict do nothing;
      end loop;
    end if;
  end loop;

  update public.schedule_task_messages m set state = 'expired'
    from public.venues v
   where v.id = m.venue_id and m.state in ('pending', 'error')
     and m.business_date < (now() at time zone coalesce(v.timezone, 'Europe/Moscow'))::date;

  select m.* into msg
    from public.schedule_task_messages m
   where m.state in ('pending', 'error') and m.attempts < 5 and m.available_at <= now()
   order by m.available_at, m.id
   for update skip locked
   limit 1;
  if msg.id is null then return null; end if;

  update public.schedule_task_messages
     set state = 'sending', lease_token = token, claimed_at = now(), attempts = attempts + 1
   where id = msg.id;
  return to_jsonb(msg) || jsonb_build_object('lease_token', token);
end
$$;
revoke all on function public.schedule_claim_task_message() from public, anon, authenticated;
grant execute on function public.schedule_claim_task_message() to service_role;

-- 6. Премии за задачи больше не ждут выключателя заведения.
create or replace function private.schedule_task_bonus_enabled(p_account uuid, p_venue uuid, p_date date)
returns boolean
language sql
stable
set search_path = ''
as $$
  -- Паузы заведения больше нет: задачу останавливают переводом в черновик,
  -- уже начисленная премия проводится как обычно.
  select true
$$;
revoke all on function private.schedule_task_bonus_enabled(uuid, uuid, date) from public, anon, authenticated;

do $migration$
declare body text;
begin
  select pg_get_functiondef('public.payroll_prepare_bonus_operations()'::regprocedure) into body;
  if position('(r.origin in (''lateness'',''manual'') or (r.origin=''task'' and exists(select 1 from public.schedule_task_settings st where st.venue_id=r.venue_id and st.account_id=r.account_id and st.legacy_stopped and not st.paused and st.enabled_from<=r.business_date)))' in body) = 0 then
    raise exception 'Не найдена ожидаемая версия payroll_prepare_bonus_operations';
  end if;
  body := replace(body,
    '(r.origin in (''lateness'',''manual'') or (r.origin=''task'' and exists(select 1 from public.schedule_task_settings st where st.venue_id=r.venue_id and st.account_id=r.account_id and st.legacy_stopped and not st.paused and st.enabled_from<=r.business_date)))',
    'r.origin in (''lateness'',''manual'',''task'')');
  execute body;
end
$migration$;

-- 7. Выбор чата теперь в «Интеграции → Telegram» (там свои права).
drop function if exists public.schedule_task_chat_choices();

notify pgrst, 'reload schema';
commit;
