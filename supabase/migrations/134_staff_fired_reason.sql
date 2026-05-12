-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 134_staff_fired_reason.sql
-- Adds optional fired_reason on user_venue_roles + extends get_fired_staff RPC
-- so the dismissed-list UI can show why each person was let go.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.user_venue_roles
  add column if not exists fired_reason text;

comment on column public.user_venue_roles.fired_reason is
  'Free-form reason captured at dismissal time. NULL for pre-existing rows.';

drop function if exists public.get_fired_staff(uuid);

create function public.get_fired_staff(p_venue_id uuid)
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
set search_path = public
as $$
  select
    uvr.id           as uvr_id,
    uvr.user_id,
    uvr.role_id,
    r.name           as role_name,
    r.code           as role_code,
    p.first_name,
    p.last_name,
    au.email,
    p.avatar_url,
    uvr.fired_at,
    uvr.fired_reason
  from public.user_venue_roles uvr
  join public.profiles  p  on p.id  = uvr.user_id
  join public.roles     r  on r.id  = uvr.role_id
  join auth.users       au on au.id = uvr.user_id
  where uvr.venue_id = p_venue_id
    and uvr.status   = 'fired'
    and exists (
      select 1
      from public.user_venue_roles caller_uvr
      where caller_uvr.user_id  = auth.uid()
        and caller_uvr.venue_id = p_venue_id
        and caller_uvr.status   = 'active'
    )
  order by uvr.fired_at desc;
$$;

grant execute on function public.get_fired_staff(uuid) to authenticated;
