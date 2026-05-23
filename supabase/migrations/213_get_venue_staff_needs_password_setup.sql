-- ============================================================
-- get_venue_staff: добавляем `needs_password_setup` в выдачу.
--
-- Флаг `auth.users.raw_user_meta_data->>'needs_password_setup'`
-- ставится при выдаче приглашения импортированному сотруднику
-- (setImportedStaffEmailAndInvite) и снимается при успешной активации
-- (acceptInvitation). Это надёжный признак «приглашён, но ещё не
-- активировал», который ПЕРЕЖИВАЕТ потерю строки в `invitations`
-- (например, если прежний инвайт уничтожался старым багом переотправки
-- до #441). Без него список сотрудников показывал «Активен» для юзера,
-- у которого инвайт-строки уже нет, хотя пароль он так и не задал.
--
-- Карточка сотрудника ([userId]) считает needs_password_setup напрямую
-- из user_metadata; этот столбец нужен, чтобы СПИСОК сотрудников был с
-- ней консистентен.
--
-- Сигнатуру копируем из 173 (последняя версия) и добавляем один столбец.
-- ============================================================

drop function if exists public.get_venue_staff(uuid);
create function public.get_venue_staff(p_venue_id uuid)
returns table (
  uvr_id              uuid,
  user_id             uuid,
  role_id             uuid,
  role_name           text,
  role_code           text,
  first_name          text,
  last_name           text,
  email               text,
  email_confirmed     boolean,
  needs_password_setup boolean,
  avatar_url          text,
  phone               text,
  telegram_id         text,
  gender              text,
  birth_date          date,
  employment_date     date,
  medical_book_date   date,
  joined_at           timestamptz,
  department_id       uuid,
  department_name     text
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    uvr.id                                                          as uvr_id,
    uvr.user_id,
    uvr.role_id,
    r.name                                                          as role_name,
    r.code                                                          as role_code,
    p.first_name,
    p.last_name,
    au.email,
    (au.email_confirmed_at is not null)                             as email_confirmed,
    coalesce((au.raw_user_meta_data->>'needs_password_setup')::boolean, false)
                                                                    as needs_password_setup,
    p.avatar_url,
    p.phone,
    p.telegram_id,
    p.gender,
    p.birth_date,
    coalesce(sad.employment_date, uvr.created_at::date)             as employment_date,
    sad.medical_book_date                                           as medical_book_date,
    uvr.created_at                                                  as joined_at,
    r.department_id                                                 as department_id,
    d.name                                                          as department_name
  from public.user_venue_roles uvr
  join public.profiles  p  on p.id  = uvr.user_id
  join public.roles     r  on r.id  = uvr.role_id
  join public.venues    v  on v.id  = uvr.venue_id
  join auth.users       au on au.id = uvr.user_id
  left join public.staff_account_details sad
    on sad.account_id = v.account_id and sad.user_id = uvr.user_id
  left join public.departments d on d.id = r.department_id
  where uvr.venue_id = p_venue_id
    and uvr.status   = 'active'
    -- caller должен сам быть активным членом этого venue
    and exists (
      select 1
      from public.user_venue_roles caller_uvr
      where caller_uvr.user_id = auth.uid()
        and caller_uvr.venue_id = p_venue_id
        and caller_uvr.status   = 'active'
    )
  order by uvr.created_at;
$$;
