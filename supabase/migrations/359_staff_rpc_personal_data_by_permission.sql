-- ============================================================
-- Персональные данные коллег — только при праве на детали сотрудника.
--
-- get_venue_staff (последняя версия — 213) и get_fired_staff (134) —
-- security definer и проверяли только «вызывающий — активный сотрудник
-- заведения». Поэтому любой бариста прямым вызовом RPC из браузера получал
-- email, телефон, Telegram, пол, дату рождения, дату трудоустройства и срок
-- медкнижки всех коллег, а по уволенным — email и причину увольнения.
-- RLS на staff_account_details (миграция 305) при этом обходился: функция
-- читает таблицу от имени владельца.
--
-- Теперь эти поля отдаются только тем, у кого в этом заведении есть оба права
-- `people.view_staff` и `people.view_staff_details` — тот же набор, что
-- проверяют карточка сотрудника, документы (305) и ссылка на карточку из
-- «Расписания». Остальным — имя, аватар, должность, подразделение и дата, с
-- которой человек в команде (joined_at). Свою строку сотрудник видит целиком.
--
-- Флаги email_confirmed / needs_password_setup оставлены: это состояние
-- аккаунта, а не личные данные, и без права на детали интерфейс их не
-- показывает.
--
-- Права считаются по активному заведению (has_permission), поэтому полные
-- данные отдаются только для p_venue_id = активному заведению. Оба вызывающих
-- (страница «Сотрудники» и «Расписание») передают именно его.
--
-- Сигнатуры не меняются — create or replace, гранты сохраняются.
-- ============================================================

begin;

create or replace function public.get_venue_staff(p_venue_id uuid)
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
  with caller as (
    select (
      p_venue_id = public.get_active_venue_id()
      and public.has_permission('people.view_staff')
      and public.has_permission('people.view_staff_details')
    ) as can_see_details
  )
  select
    uvr.id                                                          as uvr_id,
    uvr.user_id,
    uvr.role_id,
    r.name                                                          as role_name,
    r.code                                                          as role_code,
    p.first_name,
    p.last_name,
    case when x.visible then au.email end                           as email,
    (au.email_confirmed_at is not null)                             as email_confirmed,
    coalesce((au.raw_user_meta_data->>'needs_password_setup')::boolean, false)
                                                                    as needs_password_setup,
    p.avatar_url,
    case when x.visible then p.phone end                            as phone,
    case when x.visible then p.telegram_id end                      as telegram_id,
    case when x.visible then p.gender end                           as gender,
    case when x.visible then p.birth_date end                       as birth_date,
    case when x.visible
      then coalesce(sad.employment_date, uvr.created_at::date) end  as employment_date,
    case when x.visible then sad.medical_book_date end              as medical_book_date,
    uvr.created_at                                                  as joined_at,
    r.department_id                                                 as department_id,
    d.name                                                          as department_name
  from caller c
  cross join public.user_venue_roles uvr
  join public.profiles  p  on p.id  = uvr.user_id
  join public.roles     r  on r.id  = uvr.role_id
  join public.venues    v  on v.id  = uvr.venue_id
  join auth.users       au on au.id = uvr.user_id
  left join public.staff_account_details sad
    on sad.account_id = v.account_id and sad.user_id = uvr.user_id
  left join public.departments d on d.id = r.department_id
  cross join lateral (
    select coalesce(c.can_see_details, false)
           or uvr.user_id = (select auth.uid()) as visible
  ) x
  where uvr.venue_id = p_venue_id
    and uvr.status   = 'active'
    -- caller должен сам быть активным членом этого venue
    and exists (
      select 1
      from public.user_venue_roles caller_uvr
      where caller_uvr.user_id = (select auth.uid())
        and caller_uvr.venue_id = p_venue_id
        and caller_uvr.status   = 'active'
    )
  order by uvr.created_at;
$$;

create or replace function public.get_fired_staff(p_venue_id uuid)
returns table (
  uvr_id       uuid,
  user_id      uuid,
  role_id      uuid,
  role_name    text,
  role_code    text,
  first_name   text,
  last_name    text,
  email        text,
  avatar_url   text,
  fired_at     timestamptz,
  fired_reason text
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with caller as (
    select coalesce(
      p_venue_id = public.get_active_venue_id()
      and public.has_permission('people.view_staff')
      and public.has_permission('people.view_staff_details'),
      false
    ) as can_see_details
  )
  select
    uvr.id           as uvr_id,
    uvr.user_id,
    uvr.role_id,
    r.name           as role_name,
    r.code           as role_code,
    p.first_name,
    p.last_name,
    case when c.can_see_details then au.email end        as email,
    p.avatar_url,
    uvr.fired_at,
    case when c.can_see_details then uvr.fired_reason end as fired_reason
  from caller c
  cross join public.user_venue_roles uvr
  join public.profiles  p  on p.id  = uvr.user_id
  join public.roles     r  on r.id  = uvr.role_id
  join auth.users       au on au.id = uvr.user_id
  where uvr.venue_id = p_venue_id
    and uvr.status   = 'fired'
    and exists (
      select 1
      from public.user_venue_roles caller_uvr
      where caller_uvr.user_id  = (select auth.uid())
        and caller_uvr.venue_id = p_venue_id
        and caller_uvr.status   = 'active'
    )
  order by uvr.fired_at desc;
$$;

-- Анонимному вызову обе функции и так ничего не отдают (auth.uid() is null),
-- но выдавать им execute незачем.
revoke execute on function public.get_venue_staff(uuid) from public, anon;
revoke execute on function public.get_fired_staff(uuid) from public, anon;
grant execute on function public.get_venue_staff(uuid) to authenticated, service_role;
grant execute on function public.get_fired_staff(uuid) to authenticated, service_role;

commit;
