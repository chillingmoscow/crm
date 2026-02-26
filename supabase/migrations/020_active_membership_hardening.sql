-- ============================================================
-- 020_active_membership_hardening.sql
-- Ensure fired members lose access immediately across RLS checks
-- ============================================================

-- Active venue is valid only if user has ACTIVE membership in it.
create or replace function public.get_active_venue_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.active_venue_id
  from public.profiles p
  where p.id = auth.uid()
    and exists (
      select 1
      from public.user_venue_roles uvr
      where uvr.user_id = auth.uid()
        and uvr.venue_id = p.active_venue_id
        and uvr.status = 'active'
    );
$$;

-- Permissions are granted only for ACTIVE memberships.
create or replace function public.has_permission(permission_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_venue_roles uvr
    join public.role_permissions rp on rp.role_id = uvr.role_id
    join public.permissions p on p.id = rp.permission_id
    where uvr.user_id = auth.uid()
      and uvr.venue_id = public.get_active_venue_id()
      and uvr.status = 'active'
      and p.code = permission_code
      and rp.granted = true
  );
$$;

-- Active account can be resolved only from an ACTIVE venue membership.
create or replace function public.get_active_account_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select v.account_id
  from public.profiles p
  join public.venues v on v.id = p.active_venue_id
  where p.id = auth.uid()
    and exists (
      select 1
      from public.user_venue_roles uvr
      where uvr.user_id = auth.uid()
        and uvr.venue_id = p.active_venue_id
        and uvr.status = 'active'
    );
$$;

-- Staff-level visibility must require ACTIVE membership.
drop policy if exists "accounts_select_staff" on public.accounts;
create policy "accounts_select_staff"
  on public.accounts for select
  using (
    exists (
      select 1
      from public.user_venue_roles uvr
      join public.venues v on v.id = uvr.venue_id
      where uvr.user_id = auth.uid()
        and uvr.status = 'active'
        and v.account_id = accounts.id
    )
  );

drop policy if exists "venues_select_member" on public.venues;
create policy "venues_select_member"
  on public.venues for select
  using (
    exists (
      select 1 from public.user_venue_roles uvr
      where uvr.user_id = auth.uid()
        and uvr.venue_id = venues.id
        and uvr.status = 'active'
    )
  );

drop policy if exists "roles_select_account" on public.roles;
create policy "roles_select_account"
  on public.roles for select
  using (
    account_id is not null and
    exists (
      select 1
      from public.user_venue_roles uvr
      join public.venues v on v.id = uvr.venue_id
      where uvr.user_id = auth.uid()
        and uvr.status = 'active'
        and v.account_id = roles.account_id
    )
  );
