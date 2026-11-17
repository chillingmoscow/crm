-- Стажировки кандидатов видны в графике всем, кто видит весь график
-- (schedule.view_all), а не только тем, кто работает с кандидатами.
--
-- Функция была security invoker: RLS кандидатов пропускала только
-- people.manage_candidates. Теперь security definer с явными проверками
-- аккаунта, заведения и права графика. Отдаём только то, что нужно
-- календарю; карточка кандидата по-прежнему закрыта правом кандидатов.
begin;

create or replace function public.candidate_calendar_trials()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'candidate_id', c.id, 'full_name', c.full_name,
    'desired_position', c.desired_position, 'hired_user_id', c.hired_user_id,
    'appointment_date', a.appointment_date, 'starts_at', a.starts_at,
    'timezone', a.timezone, 'location', a.location, 'outcome', a.outcome
  ) order by a.appointment_date, a.starts_at, a.id), '[]'::jsonb)
  from public.candidate_appointments a
  join public.candidates c on c.id = a.candidate_id and c.account_id = a.account_id
  where (select auth.uid()) is not null
    and a.venue_id = (select public.get_active_venue_id())
    and a.account_id = (select public.get_active_account_id())
    and (select public.has_permission('schedule.view_all'))
    and a.kind = 'trial' and a.outcome in ('scheduled', 'passed')
    and c.status in ('trial', 'hired') and c.archived_at is null;
$$;
revoke all on function public.candidate_calendar_trials() from public, anon;
grant execute on function public.candidate_calendar_trials() to authenticated;

commit;
