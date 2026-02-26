-- ============================================================
-- 023_role_permissions_backward_compat.sql
-- Keep legacy UI writes working while preserving account isolation
-- ============================================================

-- Re-open direct mutations for non-owner system roles OR custom roles,
-- but route system-role writes to account-scoped overrides via trigger.
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

-- Intercept legacy writes for system roles and store account-scoped override.
create or replace function public.redirect_system_role_permission_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_account_id uuid;
  v_role_code text;
  v_account_id uuid;
begin
  select r.account_id, r.code
    into v_role_account_id, v_role_code
  from public.roles r
  where r.id = NEW.role_id;

  -- Only reroute authenticated app writes for system non-owner roles.
  if auth.uid() is not null
     and v_role_account_id is null
     and v_role_code != 'owner' then
    v_account_id := public.get_active_account_id();
    if v_account_id is null then
      raise exception 'Active account is not set';
    end if;

    insert into public.account_role_permissions (
      account_id, role_id, permission_id, granted, updated_at
    )
    values (
      v_account_id, NEW.role_id, NEW.permission_id, NEW.granted, now()
    )
    on conflict (account_id, role_id, permission_id)
    do update set granted = excluded.granted, updated_at = now();

    return null;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_role_permissions_redirect_system on public.role_permissions;
create trigger trg_role_permissions_redirect_system
before insert or update on public.role_permissions
for each row
execute function public.redirect_system_role_permission_write();
