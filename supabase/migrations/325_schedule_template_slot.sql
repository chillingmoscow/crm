begin;

create or replace function public.schedule_create_template_slot(p_input jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_venue_id uuid := public.get_active_venue_id();
  target_template_id uuid := (p_input->>'template_id')::uuid;
  slot_day date := (p_input->>'date')::date;
  employee_user uuid := nullif(p_input->>'user_id', '')::uuid;
  casual_employee uuid := nullif(p_input->>'payroll_employee_id', '')::uuid;
  template public.schedule_templates;
  zone text;
  day_start timestamptz;
  day_end timestamptz;
  variant jsonb;
  start_time time;
  end_time time;
begin
  if auth.uid() is null or target_venue_id is null
    or not public.has_permission('schedule.view_all')
    or not public.has_permission('schedule.shift_create')
    or not public.has_permission('schedule.shift_assign') then
    raise exception 'Нет права назначать смены по шаблону';
  end if;
  if target_template_id is null or slot_day is null
    or num_nonnulls(employee_user, casual_employee) <> 1 then
    raise exception 'Выберите сотрудника и смену';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'schedule-template-slot:' || target_venue_id::text || ':' || target_template_id::text || ':' || slot_day::text, 0
  ));
  select t.* into template from public.schedule_templates t
  where t.id = target_template_id and t.venue_id = target_venue_id and not t.archived;
  if not found or template.version is distinct from (p_input->>'template_version')::integer then
    raise exception 'Шаблон изменился. Обновите расписание';
  end if;
  start_time := template.start_time;
  end_time := template.end_time;
  if jsonb_array_length(template.variants) > 0 then
    select v into variant from jsonb_array_elements(template.variants) as variants(v)
    where v->'days' @> jsonb_build_array(extract(isodow from slot_day)::integer);
    if not found then raise exception 'Шаблон не действует в этот день'; end if;
    start_time := (variant->>'start_time')::time;
    end_time := (variant->>'end_time')::time;
  end if;

  select v.timezone into zone from public.venues v where v.id = target_venue_id;
  if zone is null then raise exception 'Не удалось определить часовой пояс заведения'; end if;
  day_start := slot_day::timestamp at time zone zone;
  day_end := (slot_day + 1)::timestamp at time zone zone;
  if exists (
    select 1 from public.schedule_shifts s
    where s.venue_id = target_venue_id
      and s.template_id = target_template_id
      and s.starts_at >= day_start and s.starts_at < day_end
  ) then
    raise exception 'Смена по этому шаблону уже есть. Обновите расписание';
  end if;

  -- Use the same per-employee lock as schedule_command for simultaneous assignments.
  perform pg_advisory_xact_lock(hashtextextended(coalesce(employee_user, casual_employee)::text, 0));
  if exists (
    select 1 from public.schedule_shifts s
    where s.venue_id = target_venue_id
      and s.starts_at >= day_start and s.starts_at < day_end
      and (s.user_id = employee_user or s.payroll_employee_id = casual_employee)
  ) then
    raise exception 'У сотрудника уже есть смена в этот день';
  end if;

  return public.schedule_command('shift.create', jsonb_build_object(
    'template_id', template.id, 'date', slot_day,
    'start_time', start_time, 'end_time', end_time,
    'title', template.name, 'color', template.color,
    'role_id', template.role_id, 'department_id', template.department_id,
    'break_minutes', template.break_minutes, 'arrival_minutes', template.arrival_minutes,
    'checklist_ids', case when casual_employee is null then to_jsonb(template.checklist_ids) else '[]'::jsonb end,
    'user_id', employee_user, 'payroll_employee_id', casual_employee,
    'payroll_model_id', p_input->>'payroll_model_id'
  ));
end;
$$;

revoke all on function public.schedule_create_template_slot(jsonb) from public, anon;
grant execute on function public.schedule_create_template_slot(jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
