-- Разовое назначение задачи на день из графика («Добавить → Задача»).
--
-- Регулярная задача — правило «каждые N недель/месяцев», привязанное к
-- шаблону смены; обработчик (schedule_process_tasks) создаёт задание на
-- день и отдаёт его сотруднику единственной опубликованной смены этого
-- шаблона. Разовое назначение встраивается в тот же механизм: создаём
-- задание на выбранный день со снимком задачи, где шаблон смены — выбранный
-- (или шаблон смены сотрудника выбранной должности). Дальше привязку к
-- смене, сроки, проверку и начисления делает обычный обработчик.
--
-- Ограничения текущей схемы (одно задание задачи на день):
--   • если задача уже стоит на этот день — отказ;
--   • по должности — только если в этот день одна смена этой должности по
--     шаблону; если несколько — просим выбрать шаблон смены.
begin;

create or replace function public.schedule_task_assign_once(
  p_definition uuid,
  p_date date,
  p_template uuid default null,
  p_role uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  venue uuid := public.get_active_venue_id();
  account uuid := public.get_active_account_id();
  actor uuid := (select auth.uid());
  def public.schedule_task_definitions;
  settings public.schedule_task_settings;
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

  select * into settings from public.schedule_task_settings where venue_id = venue;
  if not found or settings.enabled_from is null or not settings.legacy_stopped or settings.paused then
    raise exception 'Задачи в заведении не включены';
  end if;

  select coalesce(v.timezone, 'Europe/Moscow') into zone from public.venues v where v.id = venue;
  today := (now() at time zone zone)::date;
  if p_date is null or p_date < today then
    raise exception 'Выберите сегодняшний или будущий день';
  end if;
  if p_date < settings.enabled_from then
    raise exception 'Задачи работают с %', to_char(settings.enabled_from, 'DD.MM.YYYY');
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
$$;

revoke all on function public.schedule_task_assign_once(uuid, date, uuid, uuid) from public, anon;
grant execute on function public.schedule_task_assign_once(uuid, date, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
