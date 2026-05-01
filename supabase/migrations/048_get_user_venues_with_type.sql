-- ============================================================
-- get_user_venues: add venue_type to the returned columns so the
-- venue switcher in the sidebar can show "Ресторан · Владелец"
-- instead of the literal word "Заведение".
--
-- Postgres doesn't allow changing the OUT signature of a function
-- with CREATE OR REPLACE, so we drop and recreate.
-- ============================================================

drop function if exists public.get_user_venues();

create or replace function public.get_user_venues()
returns table (
  venue_id   uuid,
  venue_name text,
  venue_type text,
  role_code  text,
  role_name  text
)
language sql
stable
security definer
set search_path = public
as $$
  -- Active staff entries via user_venue_roles
  select
    v.id           as venue_id,
    v.name         as venue_name,
    v.type::text   as venue_type,
    r.code         as role_code,
    r.name         as role_name
  from public.user_venue_roles uvr
  join public.venues v on v.id = uvr.venue_id
  join public.roles  r on r.id = uvr.role_id
  where uvr.user_id = auth.uid()
    and uvr.status  = 'active'

  union

  -- Owner venues: always visible regardless of user_venue_roles presence
  select
    v.id           as venue_id,
    v.name         as venue_name,
    v.type::text   as venue_type,
    r.code         as role_code,
    r.name         as role_name
  from public.venues v
  join public.accounts a on a.id = v.account_id
  join public.roles    r on r.code = 'owner' and r.account_id is null
  where a.owner_id = auth.uid();
$$;
