-- ============================================================
-- 1. Fix get_user_venues: include owner venues that have no
--    user_venue_roles entry (created before auto-add was added)
-- ============================================================
create or replace function public.get_user_venues()
returns table (
  venue_id   uuid,
  venue_name text,
  role_code  text,
  role_name  text
)
language sql
stable
security definer
set search_path = public
as $$
  -- Regular staff entries via user_venue_roles
  select
    v.id   as venue_id,
    v.name as venue_name,
    r.code as role_code,
    r.name as role_name
  from public.user_venue_roles uvr
  join public.venues v on v.id = uvr.venue_id
  join public.roles  r on r.id = uvr.role_id
  where uvr.user_id = auth.uid()

  union

  -- Owner venues that may lack a user_venue_roles entry
  select
    v.id   as venue_id,
    v.name as venue_name,
    r.code as role_code,
    r.name as role_name
  from public.venues v
  join public.accounts a on a.id = v.account_id
  join public.roles    r on r.code = 'owner' and r.account_id is null
  where a.owner_id = auth.uid()
    and not exists (
      select 1
      from public.user_venue_roles uvr2
      where uvr2.venue_id = v.id
        and uvr2.user_id  = auth.uid()
    );
$$;

-- ============================================================
-- 2. Add missing DELETE policy for invitations
-- ============================================================
create policy "invitations_delete_manager"
  on public.invitations for delete
  using (
    venue_id = public.get_active_venue_id()
    and public.has_permission('platform.manage_staff')
  );
