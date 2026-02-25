-- ============================================================
-- 012_staff_fired_status.sql
-- Мягкое увольнение сотрудников (soft-delete)
-- ============================================================

-- Добавляем статус и дату увольнения в user_venue_roles
alter table public.user_venue_roles
  add column if not exists status   text not null default 'active'
    check (status in ('active', 'fired')),
  add column if not exists fired_at timestamptz;

-- Пересоздаём get_venue_staff: возвращаем только активных
-- (DROP нужен, т.к. изменения return type не допускаются через OR REPLACE)
drop function if exists public.get_venue_staff(uuid);
create function public.get_venue_staff(p_venue_id uuid)
returns table (
  uvr_id     uuid,
  user_id    uuid,
  role_id    uuid,
  role_name  text,
  role_code  text,
  first_name text,
  last_name  text,
  email      text,
  avatar_url text,
  joined_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    uvr.id          as uvr_id,
    uvr.user_id,
    uvr.role_id,
    r.name          as role_name,
    r.code          as role_code,
    p.first_name,
    p.last_name,
    au.email,
    p.avatar_url,
    uvr.created_at  as joined_at
  from public.user_venue_roles uvr
  join public.profiles  p  on p.id  = uvr.user_id
  join public.roles     r  on r.id  = uvr.role_id
  join auth.users       au on au.id = uvr.user_id
  where uvr.venue_id = p_venue_id
    and uvr.status   = 'active'
  order by uvr.created_at;
$$;

-- Функция для получения уволенных сотрудников
create or replace function public.get_fired_staff(p_venue_id uuid)
returns table (
  uvr_id     uuid,
  user_id    uuid,
  role_id    uuid,
  role_name  text,
  role_code  text,
  first_name text,
  last_name  text,
  email      text,
  avatar_url text,
  fired_at   timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    uvr.id          as uvr_id,
    uvr.user_id,
    uvr.role_id,
    r.name          as role_name,
    r.code          as role_code,
    p.first_name,
    p.last_name,
    au.email,
    p.avatar_url,
    uvr.fired_at
  from public.user_venue_roles uvr
  join public.profiles  p  on p.id  = uvr.user_id
  join public.roles     r  on r.id  = uvr.role_id
  join auth.users       au on au.id = uvr.user_id
  where uvr.venue_id = p_venue_id
    and uvr.status   = 'fired'
  order by uvr.fired_at desc;
$$;
