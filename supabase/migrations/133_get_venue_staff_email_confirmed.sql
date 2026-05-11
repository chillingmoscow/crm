-- ============================================================
-- get_venue_staff: добавляем `email_confirmed` в выдачу, чтобы
-- список сотрудников и карточка различали активных юзеров и тех,
-- кому приглашение отправлено, но email пока не подтверждён.
--
-- email_confirmed = (auth.users.email_confirmed_at is not null)
--
-- Используется в UI для:
--   • бейдж "Активен" / "Ожидает подтверждения" в хедере карточки;
--   • бейдж в строке списка staff;
--   • разрешение админу править личные поля до подтверждения.
-- ============================================================

drop function if exists public.get_venue_staff(uuid);
create function public.get_venue_staff(p_venue_id uuid)
returns table (
  uvr_id          uuid,
  user_id         uuid,
  role_id         uuid,
  role_name       text,
  role_code       text,
  first_name      text,
  last_name       text,
  email           text,
  email_confirmed boolean,
  avatar_url      text,
  phone           text,
  telegram_id     text,
  gender          text,
  birth_date      date,
  employment_date date,
  joined_at       timestamptz
)
language sql
stable
security definer
set search_path = public
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
    p.avatar_url,
    p.phone,
    p.telegram_id,
    p.gender,
    p.birth_date,
    coalesce(sad.employment_date, uvr.created_at::date)             as employment_date,
    uvr.created_at                                                  as joined_at
  from public.user_venue_roles uvr
  join public.profiles  p  on p.id  = uvr.user_id
  join public.roles     r  on r.id  = uvr.role_id
  join public.venues    v  on v.id  = uvr.venue_id
  join auth.users       au on au.id = uvr.user_id
  left join public.staff_account_details sad
    on sad.account_id = v.account_id and sad.user_id = uvr.user_id
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
