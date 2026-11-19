begin;

-- Применение изменённого шаблона к уже созданным сменам с выбранной даты.
--
-- Смена хранит копию полей шаблона (время, название, цвет, должность), поэтому
-- правка шаблона её не меняет. Эта функция по запросу менеджера переносит
-- текущие значения шаблона во все смены по нему, начиная с p_from.
--
-- Каждая смена обновляется через schedule_command('shift.edit'), чтобы
-- действовали все обычные проверки: права, пересечение смен сотрудника,
-- начатые чек-листы, модель оплаты разового сотрудника, история изменений.
-- Смена, которую обновить нельзя, пропускается с причиной; остальные
-- применяются. Смены, уже учтённые в зарплате, не трогаем.
create or replace function public.schedule_apply_template(
  p_template uuid,
  p_from date,
  p_previous_title text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  target_venue uuid := public.get_active_venue_id();
  template public.schedule_templates;
  zone text;
  shift public.schedule_shifts;
  shift_day date;
  variant jsonb;
  start_time time;
  end_time time;
  next_title text;
  updated_count integer := 0;
  unchanged_count integer := 0;
  skipped jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or target_venue is null
    or not public.has_permission('schedule.template_edit')
    or not public.has_permission('schedule.shift_edit') then
    raise exception 'Нет права применять шаблон к сменам';
  end if;
  if p_from is null then raise exception 'Укажите дату'; end if;

  select t.* into template from public.schedule_templates t
  where t.id = p_template and t.venue_id = target_venue;
  if not found then raise exception 'Шаблон не найден'; end if;
  select v.timezone into zone from public.venues v where v.id = target_venue;
  if zone is null then raise exception 'Не удалось определить часовой пояс заведения'; end if;

  for shift in
    select s.* from public.schedule_shifts s
    where s.venue_id = target_venue
      and s.template_id = template.id
      and s.starts_at >= (p_from::timestamp at time zone zone)
    order by s.starts_at, s.id
  loop
    shift_day := (shift.starts_at at time zone zone)::date;

    if exists (select 1 from public.payroll_attendance a where a.shift_id = shift.id) then
      skipped := skipped || jsonb_build_object('date', shift_day, 'reason', 'Смена уже учтена в зарплате');
      continue;
    end if;

    start_time := template.start_time;
    end_time := template.end_time;
    if jsonb_array_length(template.variants) > 0 then
      select x into variant from jsonb_array_elements(template.variants) as variants(x)
      where x->'days' @> jsonb_build_array(extract(isodow from shift_day)::integer);
      if not found then
        skipped := skipped || jsonb_build_object('date', shift_day, 'reason', 'Шаблон не действует в этот день');
        continue;
      end if;
      start_time := (variant->>'start_time')::time;
      end_time := (variant->>'end_time')::time;
    end if;

    -- Своё название смены сохраняем; название шаблона — обновляем.
    next_title := case
      when shift.title = template.name or shift.title = p_previous_title then template.name
      else shift.title
    end;

    if (shift.starts_at at time zone zone)::time = start_time
      and (shift.ends_at at time zone zone)::time = end_time
      and shift.title = next_title
      and shift.color = template.color
      and shift.role_id is not distinct from template.role_id
      and shift.department_id is not distinct from template.department_id then
      unchanged_count := unchanged_count + 1;
      continue;
    end if;

    begin
      perform public.schedule_command('shift.edit', jsonb_build_object(
        'id', shift.id,
        'version', shift.version,
        'date', shift_day,
        'start_time', to_char(start_time, 'HH24:MI'),
        'end_time', to_char(end_time, 'HH24:MI'),
        'title', next_title,
        'color', template.color,
        'role_id', template.role_id,
        'department_id', template.department_id,
        'template_id', template.id,
        'user_id', shift.user_id,
        'payroll_employee_id', shift.payroll_employee_id,
        'payroll_model_id', shift.payroll_model_id,
        'note', shift.note,
        'checklist_ids', to_jsonb(shift.checklist_ids)
      ));
      updated_count := updated_count + 1;
    exception when others then
      skipped := skipped || jsonb_build_object('date', shift_day, 'reason', sqlerrm);
    end;
  end loop;

  return jsonb_build_object(
    'updated', updated_count,
    'unchanged', unchanged_count,
    'skipped', skipped
  );
end;
$$;

revoke all on function public.schedule_apply_template(uuid, date, text) from public, anon;
grant execute on function public.schedule_apply_template(uuid, date, text) to authenticated;

notify pgrst, 'reload schema';
commit;
