-- Замена сотрудника на опубликованной смене: уведомляем обоих.
--
-- Триггер, а не правка schedule_command: сотрудника на смене меняют
-- несколько путей (shift.assign, shift.edit, перенос мышью, обновление по
-- шаблону), и уведомление должно уходить при любом из них.
-- Черновики не трогаем — их сотрудники ещё не видели. Разовые сотрудники
-- без аккаунта уведомлений не получают. Тот, кто сделал замену сам, себе
-- уведомление не получает. Пуш отправит общий диспетчер (pushed_at is null).
begin;

create or replace function private.schedule_person_name(p_user uuid, p_casual uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    (select nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '')
       from public.profiles p where p.id = p_user),
    (select e.name from public.payroll_employees e where e.id = p_casual),
    'сотрудник'
  )
$$;
revoke all on function private.schedule_person_name(uuid, uuid) from public, anon, authenticated;

create or replace function private.schedule_notify_replacement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  actor uuid := (select auth.uid());
  tz text;
  shift_day date;
  span text;
  who_old text;
  who_new text;
  had_old boolean := old.user_id is not null or old.payroll_employee_id is not null;
begin
  if not (old.published and new.published) then
    return new;
  end if;
  if old.user_id is not distinct from new.user_id
     and old.payroll_employee_id is not distinct from new.payroll_employee_id then
    return new;
  end if;

  select v.timezone into tz from public.venues v where v.id = new.venue_id;
  tz := coalesce(tz, 'Europe/Moscow');
  shift_day := (new.starts_at at time zone tz)::date;
  span := to_char(new.starts_at at time zone tz, 'DD.MM') || ', '
       || to_char(new.starts_at at time zone tz, 'HH24:MI') || '–'
       || to_char(new.ends_at at time zone tz, 'HH24:MI') || ' · ' || new.title;
  who_old := private.schedule_person_name(old.user_id, old.payroll_employee_id);
  who_new := private.schedule_person_name(new.user_id, new.payroll_employee_id);

  if old.user_id is not null
     and old.user_id is distinct from new.user_id
     and old.user_id is distinct from actor then
    insert into public.notifications(user_id, venue_id, type, category, title, body, link,
                                     actor_user_id, entity_type, entity_id, payload)
    values (old.user_id, new.venue_id, 'schedule.shift_unassigned', 'schedule',
            'Вас сняли со смены',
            span || case when new.user_id is not null or new.payroll_employee_id is not null
                         then '. Вместо вас — ' || who_new else '' end,
            '/schedule?date=' || shift_day, actor, 'schedule_shift', new.id,
            jsonb_build_object('date', shift_day, 'replacement', who_new, 'preview_kind', 'generic'));
  end if;

  if new.user_id is not null
     and new.user_id is distinct from old.user_id
     and new.user_id is distinct from actor then
    insert into public.notifications(user_id, venue_id, type, category, title, body, link,
                                     actor_user_id, entity_type, entity_id, payload)
    values (new.user_id, new.venue_id, 'schedule.shift_assigned', 'schedule',
            'Вас поставили на смену',
            span || case when had_old then '. Вместо: ' || who_old else '' end,
            '/schedule?date=' || shift_day, actor, 'schedule_shift', new.id,
            jsonb_build_object('date', shift_day, 'replaced', case when had_old then who_old end,
                               'preview_kind', 'generic'));
  end if;

  return new;
end
$$;
revoke all on function private.schedule_notify_replacement() from public, anon, authenticated;

drop trigger if exists schedule_shift_replacement_notify on public.schedule_shifts;
create trigger schedule_shift_replacement_notify
  after update of user_id, payroll_employee_id on public.schedule_shifts
  for each row execute function private.schedule_notify_replacement();

commit;
