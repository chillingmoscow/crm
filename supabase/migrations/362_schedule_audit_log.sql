-- «Расписание» в общем журнале событий (/org/audit).
--
-- Команды расписания уже ведут свои истории: schedule_command пишет в
-- schedule_events, задачи — в schedule_task_history, заявки на замену —
-- строки schedule_shift_swaps. Общий журнал получает события из них
-- триггерами, а не правкой schedule_command: тело этой функции уже
-- точечно патчили миграции 326, 328 и 340, и полное пересоздание из
-- 319 откатило бы эти правки.
--
-- Коды — schedule.<объект>.<глагол>: раздел журнала берётся по префиксу
-- `schedule.`, категория действия — по суффиксу.
--
-- Шум не пишем:
--   • массовая публикация (shift.publish_many, до 300 смен) и обновление
--     смен по шаблону (schedule_apply_template) — одна строка на команду
--     с количеством; поштучные события внутри команды отключает
--     транзакционный флаг app.schedule_audit_batch;
--   • события без автора (обработчик задач schedule_process_tasks,
--     cron) — только во внутренней истории расписания;
--   • старт и сохранение черновика чек-листа сотрудником, автоматическая
--     отмена заявки при изменении смены (voided) — следствия, а не
--     решения.
--
-- Видеть события расписания в общем журнале — как видеть всю историю
-- графика: право schedule.view_all в текущем заведении (ограничивающая
-- политика, как у продаж и склада).
begin;

-- ---------------------------------------------------------------------------
-- 1. Запись и сводка смены
-- ---------------------------------------------------------------------------
create or replace function private.schedule_audit_write(
  p_venue uuid,
  p_actor uuid,
  p_code text,
  p_entity_type text,
  p_entity_id uuid,
  p_details jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  acc uuid := public.venue_account_id(p_venue);
begin
  if acc is null or p_actor is null then
    return;
  end if;
  insert into public.audit_logs(account_id, venue_id, user_id, action_code, entity_type, entity_id, details)
  values (acc, p_venue, p_actor, p_code, p_entity_type, p_entity_id,
          jsonb_strip_nulls(coalesce(p_details, '{}'::jsonb)));
end
$$;
revoke all on function private.schedule_audit_write(uuid, uuid, text, text, uuid, jsonb)
  from public, anon, authenticated;

-- Смена (строка schedule_shifts как jsonb) → поля для фразы журнала.
-- Дата и время — по часовому поясу заведения.
create or replace function private.schedule_audit_shift(p_shift jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case when p_shift is null or p_shift->>'id' is null then null else
    jsonb_build_object(
      'title', nullif(p_shift->>'title', ''),
      'date', to_char(((p_shift->>'starts_at')::timestamptz at time zone z.tz)::date, 'YYYY-MM-DD'),
      'start', to_char((p_shift->>'starts_at')::timestamptz at time zone z.tz, 'HH24:MI'),
      'end', to_char((p_shift->>'ends_at')::timestamptz at time zone z.tz, 'HH24:MI'),
      'employee', case
        when p_shift->>'user_id' is null and p_shift->>'payroll_employee_id' is null then null
        else private.schedule_person_name(
          nullif(p_shift->>'user_id', '')::uuid,
          nullif(p_shift->>'payroll_employee_id', '')::uuid)
      end,
      'role', (select r.name from public.roles r where r.id = nullif(p_shift->>'role_id', '')::uuid)
    )
  end
  from (select coalesce(
    (select v.timezone from public.venues v where v.id = nullif(p_shift->>'venue_id', '')::uuid),
    'Europe/Moscow') as tz) z
$$;
revoke all on function private.schedule_audit_shift(jsonb) from public, anon, authenticated;

-- Что поменялось в смене: «поле: было → стало», как details.changes
-- остальных событий журнала.
create or replace function private.schedule_audit_shift_changes(p_before jsonb, p_after jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with b as (select private.schedule_audit_shift(p_before) as s),
       a as (select private.schedule_audit_shift(p_after) as s),
       pairs(field, old, new) as (
         select 'shift_date', b.s->'date', a.s->'date' from a, b
         union all
         select 'shift_time',
                to_jsonb((b.s->>'start') || '–' || (b.s->>'end')),
                to_jsonb((a.s->>'start') || '–' || (a.s->>'end')) from a, b
         union all
         select 'shift_employee', b.s->'employee', a.s->'employee' from a, b
         union all
         select 'shift_role', b.s->'role', a.s->'role' from a, b
         union all
         select 'shift_title', b.s->'title', a.s->'title' from a, b
         union all
         select 'note', to_jsonb(nullif(p_before->>'note', '')), to_jsonb(nullif(p_after->>'note', ''))
       )
  select coalesce(jsonb_agg(jsonb_build_object('field', field, 'old', old, 'new', new)), '[]'::jsonb)
    from pairs
   where old is distinct from new
$$;
revoke all on function private.schedule_audit_shift_changes(jsonb, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Смены, шаблоны, чек-листы, проверка чек-листов — из schedule_events
-- ---------------------------------------------------------------------------
create or replace function private.schedule_events_to_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  code text;
  entity_type text;
  details jsonb;
  tpl public.schedule_templates;
  ck public.schedule_checklists;
  run public.schedule_runs;
begin
  if new.actor_id is null then
    return new;
  end if;
  -- Поштучные события внутри массовой команды: её итог пишет сама команда.
  if current_setting('app.schedule_audit_batch', true) = '1'
     and new.action in ('shift.publish', 'shift.edit') then
    return new;
  end if;

  if new.action like 'shift.%' then
    entity_type := 'schedule_shift';
    case new.action
      when 'shift.create', 'shift.copy' then
        code := 'schedule.shift.created';
        details := private.schedule_audit_shift(new.details->'after')
          || jsonb_build_object('copied', new.action = 'shift.copy');
      when 'shift.edit' then
        code := 'schedule.shift.updated';
        details := private.schedule_audit_shift(new.details->'after')
          || jsonb_build_object('changes',
               private.schedule_audit_shift_changes(new.details->'before', new.details->'after'));
      when 'shift.delete' then
        code := 'schedule.shift.deleted';
        details := private.schedule_audit_shift(new.details->'before');
      when 'shift.publish' then
        code := 'schedule.shift.published';
        details := private.schedule_audit_shift(new.details->'after');
      when 'shift.assign' then
        code := 'schedule.shift.assigned';
        details := private.schedule_audit_shift(new.details->'after')
          || jsonb_build_object('previous_employee',
               private.schedule_audit_shift(new.details->'before')->'employee');
      else
        -- shift.swap — решение по заявке пишет триггер schedule_shift_swaps.
        return new;
    end case;

  elsif new.action like 'template.%' then
    select * into tpl from public.schedule_templates where id = new.entity_id;
    entity_type := 'schedule_template';
    details := jsonb_build_object('name', tpl.name, 'copied', new.action = 'template.copy');
    code := case new.action
      when 'template.create' then 'schedule.template.created'
      when 'template.copy' then 'schedule.template.created'
      when 'template.edit' then 'schedule.template.updated'
      when 'template.archive' then
        case when tpl.archived then 'schedule.template.archived' else 'schedule.template.restored' end
    end;

  elsif new.action like 'checklist.%' then
    select * into ck from public.schedule_checklists where id = new.entity_id;
    entity_type := 'schedule_checklist';
    details := jsonb_build_object('name', ck.name);
    code := case new.action
      when 'checklist.create' then 'schedule.checklist.created'
      when 'checklist.edit' then 'schedule.checklist.updated'
      when 'checklist.publish' then 'schedule.checklist.published'
      when 'checklist.archive' then
        case when ck.archived then 'schedule.checklist.archived' else 'schedule.checklist.restored' end
    end;

  elsif new.action = 'qualification.save' then
    code := 'schedule.qualification.updated';
    entity_type := 'staff';
    details := jsonb_build_object('employee', private.schedule_person_name(new.entity_id, null));

  elsif new.action in ('run.approve', 'run.return') then
    select * into run from public.schedule_runs where id = new.entity_id;
    code := case new.action when 'run.approve' then 'schedule.run.approved' else 'schedule.run.returned' end;
    entity_type := 'schedule_run';
    details := jsonb_build_object(
      'checklist', run.snapshot->>'name',
      'employee', private.schedule_person_name(run.user_id, null),
      'date', (select private.schedule_audit_shift(to_jsonb(s))->>'date'
                 from public.schedule_shifts s where s.id = run.shift_id),
      'comment', nullif(trim(coalesce(new.details->>'comment', '')), ''));

  else
    -- run.start / run.submit — работа сотрудника, видна в истории смены.
    return new;
  end if;

  if code is not null then
    perform private.schedule_audit_write(new.venue_id, new.actor_id, code, entity_type, new.entity_id, details);
  end if;
  return new;
end
$$;
revoke all on function private.schedule_events_to_audit() from public, anon, authenticated;

drop trigger if exists schedule_events_audit on public.schedule_events;
create trigger schedule_events_audit
  after insert on public.schedule_events
  for each row execute function private.schedule_events_to_audit();

-- ---------------------------------------------------------------------------
-- 3. Заявки на замену — из schedule_shift_swaps
-- ---------------------------------------------------------------------------
create or replace function private.schedule_swaps_to_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  actor uuid := (select auth.uid());
  code text;
  details jsonb;
begin
  if actor is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    code := 'schedule.swap.requested';
  elsif old.status = 'pending' and new.status <> 'pending' then
    code := case new.status
      when 'approved' then 'schedule.swap.approved'
      when 'rejected' then 'schedule.swap.rejected'
      when 'cancelled' then 'schedule.swap.cancelled'
    end;  -- voided: смену изменили в обход заявки, это событие смены
  elsif old.candidate_answer is distinct from new.candidate_answer then
    code := 'schedule.swap.answered';
  end if;
  if code is null then
    return new;
  end if;

  select coalesce(private.schedule_audit_shift(to_jsonb(s)), '{}'::jsonb) into details
    from public.schedule_shifts s where s.id = new.shift_id;
  details := coalesce(details, '{}'::jsonb) || jsonb_build_object(
    'from_employee', private.schedule_person_name(new.from_user_id, null),
    'to_employee', private.schedule_person_name(new.to_user_id, null),
    'answer', case when code = 'schedule.swap.answered' then new.candidate_answer end,
    'comment', nullif(case when code = 'schedule.swap.requested' then new.comment
                           when code = 'schedule.swap.rejected' then new.decision_comment end, ''),
    'shift_id', new.shift_id);
  -- В сводке смены «employee» — текущий сотрудник; для заявки это лишнее.
  details := details - 'employee';

  perform private.schedule_audit_write(new.venue_id, actor, code, 'schedule_swap', new.id, details);
  return new;
end
$$;
revoke all on function private.schedule_swaps_to_audit() from public, anon, authenticated;

drop trigger if exists schedule_shift_swaps_audit on public.schedule_shift_swaps;
create trigger schedule_shift_swaps_audit
  after insert or update of status, candidate_answer on public.schedule_shift_swaps
  for each row execute function private.schedule_swaps_to_audit();

-- ---------------------------------------------------------------------------
-- 4. Задачи — из schedule_task_history
-- ---------------------------------------------------------------------------
create or replace function private.schedule_task_history_to_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  b jsonb := new.details->'before';
  a jsonb := new.details->'after';
  code text;
  entity_type text;
  details jsonb;
begin
  -- Без автора — обработчик задач и cron: только внутренняя история.
  if new.actor_id is null then
    return new;
  end if;

  case new.action
    when 'definition.created' then
      code := 'schedule.task.created';
      entity_type := 'schedule_task';
      details := jsonb_build_object('name', a->>'name');
    when 'definition.updated' then
      -- Удаление тоже обновляет строку; его пишет definition.deleted.
      if a->>'deleted_at' is not null then
        return new;
      end if;
      code := 'schedule.task.updated';
      entity_type := 'schedule_task';
      details := jsonb_build_object('name', a->>'name', 'changes', (
        select coalesce(jsonb_agg(jsonb_build_object('field', f, 'old', b->f, 'new', a->f)), '[]'::jsonb)
          from unnest(array['name', 'enabled', 'review_mode', 'penalty_enabled', 'fine_amount', 'reward_amount', 'starts_on']) f
         where b->f is distinct from a->f));
    when 'definition.deleted' then
      code := 'schedule.task.deleted';
      entity_type := 'schedule_task';
      details := jsonb_build_object('name', b->>'name');
    when 'settings.save' then
      code := 'schedule.task_settings.updated';
      entity_type := 'venue';
      details := jsonb_build_object(
        'venue_name', (select v.name from public.venues v where v.id = new.venue_id),
        'changes', (
        select coalesce(jsonb_agg(jsonb_build_object('field', f, 'old', b->f, 'new', a->f)), '[]'::jsonb)
          from unnest(array['enabled_from', 'paused']) f
         where b->f is distinct from a->f));
    when 'run.approve', 'run.return' then
      code := case new.action when 'run.approve' then 'schedule.task_report.approved'
                              else 'schedule.task_report.returned' end;
      entity_type := 'schedule_task_report';
      details := jsonb_build_object(
        'name', a->'snapshot'->>'name',
        'employee', a->>'employee_name',
        'date', a->>'business_date',
        'comment', nullif(trim(coalesce(new.details->>'comment', '')), ''));
    when 'assignment.created' then
      -- Разовое назначение из графика; регулярные создаёт обработчик.
      if coalesce(a->'snapshot'->>'one_off', '') <> 'true' then
        return new;
      end if;
      code := 'schedule.task.assigned';
      entity_type := 'schedule_task_report';
      details := jsonb_build_object('name', a->'snapshot'->>'name', 'date', a->>'business_date');
    else
      return new;
  end case;

  perform private.schedule_audit_write(new.venue_id, new.actor_id, code, entity_type, new.entity_id, details);
  return new;
end
$$;
revoke all on function private.schedule_task_history_to_audit() from public, anon, authenticated;

drop trigger if exists schedule_task_history_audit on public.schedule_task_history;
create trigger schedule_task_history_audit
  after insert on public.schedule_task_history
  for each row execute function private.schedule_task_history_to_audit();

-- ---------------------------------------------------------------------------
-- 5. Массовые команды — одна строка на команду
-- ---------------------------------------------------------------------------
create or replace function private.schedule_audit_published_many(p_venue uuid, p_actor uuid, p_shifts jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  tz text := coalesce((select timezone from public.venues where id = p_venue), 'Europe/Moscow');
  first_day date;
  last_day date;
  total integer;
begin
  select count(*), min((s.starts_at at time zone tz)::date), max((s.starts_at at time zone tz)::date)
    into total, first_day, last_day
    from public.schedule_shifts s
   where s.venue_id = p_venue
     and s.id in (select (x->>'id')::uuid from jsonb_array_elements(p_shifts) x);
  perform private.schedule_audit_write(p_venue, p_actor, 'schedule.shifts.published', 'venue', p_venue,
    jsonb_build_object('count', total, 'from', first_day, 'to', last_day));
end
$$;
revoke all on function private.schedule_audit_published_many(uuid, uuid, jsonb) from public, anon, authenticated;

-- schedule_command('shift.publish_many'): флаг на время цикла и итоговая
-- строка. Одну смену пишем как обычную публикацию — с её временем и
-- сотрудником.
do $$
declare
  definition text := pg_get_functiondef('public.schedule_command(text,jsonb)'::regprocedure);
  guard text := $g$jsonb_array_length(p_input->'shifts') not between 1 and 300 then raise exception 'Выберите смены';end if;$g$;
  finish text := $f$return jsonb_build_object('id',null);$f$;
begin
  if (length(definition) - length(replace(definition, guard, ''))) / length(guard) <> 1
     or (length(definition) - length(replace(definition, finish, ''))) / length(finish) <> 1 then
    raise exception 'Изменилась реализация schedule_command: блок shift.publish_many не найден';
  end if;
  definition := replace(definition, guard, guard || $g$
  perform set_config('app.schedule_audit_batch', case when jsonb_array_length(p_input->'shifts') > 1 then '1' else '' end, true);$g$);
  definition := replace(definition, finish, $f$perform set_config('app.schedule_audit_batch', '', true);
  if jsonb_array_length(p_input->'shifts') > 1 then perform private.schedule_audit_published_many(v, u, p_input->'shifts'); end if;
  $f$ || finish);
  execute definition;
end $$;

-- schedule_apply_template: функция с правами вызывающего, поэтому итог
-- пишет через public.log_audit (контекст — активные аккаунт и заведение,
-- автор — auth.uid()). Ничего не обновилось — строки нет.
do $$
declare
  definition text := pg_get_functiondef('public.schedule_apply_template(uuid,date,text)'::regprocedure);
  guard text := $g$if zone is null then raise exception 'Не удалось определить часовой пояс заведения'; end if;$g$;
  finish text := $f$return jsonb_build_object($f$;
begin
  if (length(definition) - length(replace(definition, guard, ''))) / length(guard) <> 1
     or (length(definition) - length(replace(definition, finish, ''))) / length(finish) <> 1 then
    raise exception 'Изменилась реализация schedule_apply_template: точки записи журнала не найдены';
  end if;
  definition := replace(definition, guard, guard || $g$
  perform set_config('app.schedule_audit_batch', '1', true);$g$);
  definition := replace(definition, finish, $f$perform set_config('app.schedule_audit_batch', '', true);
  if updated_count > 0 then
    perform public.log_audit('schedule.template.applied', 'schedule_template', template.id,
      jsonb_build_object('name', template.name, 'from', p_from, 'count', updated_count,
                         'unchanged', unchanged_count, 'skipped', jsonb_array_length(skipped)));
  end if;
  $f$ || finish);
  execute definition;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Кто видит события расписания в общем журнале
-- ---------------------------------------------------------------------------
drop policy if exists schedule_audit_read on public.audit_logs;
create policy schedule_audit_read on public.audit_logs
  as restrictive
  for select
  to authenticated
  using (
    action_code not like 'schedule.%'
    or (
      account_id = (select public.get_active_account_id())
      and venue_id = (select public.get_active_venue_id())
      and (select public.has_permission('schedule.view_all'))
    )
  );

-- Проверка: служебные функции журнала не вызываются из клиента.
do $$
begin
  if has_function_privilege('authenticated', 'private.schedule_audit_write(uuid,uuid,text,text,uuid,jsonb)', 'execute')
     or has_function_privilege('anon', 'private.schedule_audit_write(uuid,uuid,text,text,uuid,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'private.schedule_audit_published_many(uuid,uuid,jsonb)', 'execute') then
    raise exception 'private.schedule_audit_* остались доступны клиенту';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
