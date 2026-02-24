-- ============================================================
-- 009_staff_management.sql
-- DELETE-политика для user_venue_roles + RPC для списка сотрудников
-- ============================================================

-- DELETE: менеджер/владелец может удалять сотрудников
create policy "user_venue_roles_delete"
  on public.user_venue_roles for delete
  using (public.has_permission('platform.manage_staff'));

-- ============================================================
-- RPC: получение списка сотрудников заведения с email
-- security definer — читает auth.users напрямую без RLS
-- ============================================================
create or replace function public.get_venue_staff(p_venue_id uuid)
returns table (
  uvr_id     uuid,
  user_id    uuid,
  role_id    uuid,
  role_name  text,
  role_code  text,
  first_name text,
  last_name  text,
  email      text,
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
    uvr.created_at  as joined_at
  from public.user_venue_roles uvr
  join public.profiles  p  on p.id  = uvr.user_id
  join public.roles     r  on r.id  = uvr.role_id
  join auth.users       au on au.id = uvr.user_id
  where uvr.venue_id = p_venue_id
  order by uvr.created_at;
$$;
