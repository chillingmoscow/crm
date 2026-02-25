-- ============================================================
-- 017_role_permissions_for_system_roles.sql
-- Allow managing permissions on non-owner system roles.
-- Previously only custom (account-specific) roles could have
-- their permissions edited. Now any role except owner can be
-- modified by someone with platform.manage_roles.
-- ============================================================

-- ── role_permissions INSERT ───────────────────────────────────
drop policy if exists "role_permissions_insert_manage" on public.role_permissions;
create policy "role_permissions_insert_manage"
  on public.role_permissions for insert
  with check (
    public.has_permission('platform.manage_roles')
    and exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and r.code != 'owner'
        and (
          r.account_id = public.get_active_account_id()
          or r.account_id is null
        )
    )
  );

-- ── role_permissions UPDATE ───────────────────────────────────
drop policy if exists "role_permissions_update_manage" on public.role_permissions;
create policy "role_permissions_update_manage"
  on public.role_permissions for update
  using (
    public.has_permission('platform.manage_roles')
    and exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and r.code != 'owner'
        and (
          r.account_id = public.get_active_account_id()
          or r.account_id is null
        )
    )
  );

-- ── role_permissions DELETE ───────────────────────────────────
drop policy if exists "role_permissions_delete_manage" on public.role_permissions;
create policy "role_permissions_delete_manage"
  on public.role_permissions for delete
  using (
    public.has_permission('platform.manage_roles')
    and exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and r.code != 'owner'
        and (
          r.account_id = public.get_active_account_id()
          or r.account_id is null
        )
    )
  );
