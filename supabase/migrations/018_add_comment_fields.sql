-- ============================================================
-- 018_add_comment_fields.sql
-- Add comment column to roles, profiles, and venues.
-- Also update roles_update_manage policy to allow editing
-- non-owner system roles (account_id IS NULL, code != 'owner').
-- ============================================================

-- ── New columns ──────────────────────────────────────────────
alter table public.roles    add column if not exists comment text;
alter table public.profiles add column if not exists comment text;
alter table public.venues   add column if not exists comment text;

-- ── roles UPDATE policy — allow non-owner system roles ───────
drop policy if exists "roles_update_manage" on public.roles;
create policy "roles_update_manage"
  on public.roles for update
  using (
    public.has_permission('platform.manage_roles')
    and code != 'owner'
    and (
      account_id = public.get_active_account_id()
      or account_id is null
    )
  );
