-- ============================================================
-- 022_account_scoped_system_role_permissions.sql
-- Account-scoped overrides for system role permissions
-- ============================================================

create table if not exists public.account_role_permissions (
  account_id    uuid not null references public.accounts(id) on delete cascade,
  role_id       uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  granted       boolean not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (account_id, role_id, permission_id)
);

create index if not exists account_role_permissions_account_idx
  on public.account_role_permissions (account_id, role_id);

alter table public.account_role_permissions enable row level security;

-- Visible only inside active account.
drop policy if exists "account_role_permissions_select" on public.account_role_permissions;
create policy "account_role_permissions_select"
  on public.account_role_permissions for select
  using (account_id = public.get_active_account_id());

-- Manage only when caller can manage roles, role is non-owner system role.
drop policy if exists "account_role_permissions_insert_manage" on public.account_role_permissions;
create policy "account_role_permissions_insert_manage"
  on public.account_role_permissions for insert
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('platform.manage_roles')
    and exists (
      select 1 from public.roles r
      where r.id = account_role_permissions.role_id
        and r.account_id is null
        and r.code != 'owner'
    )
  );

drop policy if exists "account_role_permissions_update_manage" on public.account_role_permissions;
create policy "account_role_permissions_update_manage"
  on public.account_role_permissions for update
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('platform.manage_roles')
    and exists (
      select 1 from public.roles r
      where r.id = account_role_permissions.role_id
        and r.account_id is null
        and r.code != 'owner'
    )
  );

drop policy if exists "account_role_permissions_delete_manage" on public.account_role_permissions;
create policy "account_role_permissions_delete_manage"
  on public.account_role_permissions for delete
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('platform.manage_roles')
    and exists (
      select 1 from public.roles r
      where r.id = account_role_permissions.role_id
        and r.account_id is null
        and r.code != 'owner'
    )
  );

-- Effective permissions helper for UI/API.
create or replace function public.get_effective_role_permissions(p_role_ids uuid[] default null)
returns table (
  role_id uuid,
  permission_id uuid,
  granted boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with active as (
    select public.get_active_account_id() as account_id
  ),
  visible_roles as (
    select r.id, r.account_id
    from public.roles r
    where (p_role_ids is null or r.id = any(p_role_ids))
      and (
        r.account_id is null
        or r.account_id = (select account_id from active)
      )
  )
  select
    rp.role_id,
    rp.permission_id,
    case
      when vr.account_id is null then coalesce(arp.granted, rp.granted)
      else rp.granted
    end as granted
  from public.role_permissions rp
  join visible_roles vr on vr.id = rp.role_id
  left join active a on true
  left join public.account_role_permissions arp
    on arp.account_id = a.account_id
   and arp.role_id = rp.role_id
   and arp.permission_id = rp.permission_id;
$$;

-- Write helper used by server actions.
create or replace function public.set_effective_role_permission(
  p_role_id uuid,
  p_permission_id uuid,
  p_granted boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_role_account_id uuid;
  v_role_code text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.has_permission('platform.manage_roles') then
    raise exception 'Insufficient permissions';
  end if;

  v_account_id := public.get_active_account_id();
  if v_account_id is null then
    raise exception 'Active account is not set';
  end if;

  select r.account_id, r.code
    into v_role_account_id, v_role_code
  from public.roles r
  where r.id = p_role_id;

  if not found then
    raise exception 'Role not found';
  end if;

  if v_role_code = 'owner' then
    raise exception 'Owner role cannot be modified';
  end if;

  perform 1 from public.permissions p where p.id = p_permission_id;
  if not found then
    raise exception 'Permission not found';
  end if;

  if v_role_account_id is null then
    -- System role: account-scoped override.
    insert into public.account_role_permissions (
      account_id, role_id, permission_id, granted, updated_at
    )
    values (
      v_account_id, p_role_id, p_permission_id, p_granted, now()
    )
    on conflict (account_id, role_id, permission_id)
    do update set granted = excluded.granted, updated_at = now();
  elsif v_role_account_id = v_account_id then
    -- Custom role: account-owned source of truth.
    insert into public.role_permissions (role_id, permission_id, granted)
    values (p_role_id, p_permission_id, p_granted)
    on conflict (role_id, permission_id)
    do update set granted = excluded.granted;
  else
    raise exception 'Role is outside active account';
  end if;
end;
$$;

-- Permission checks now resolve system role overrides from account scope.
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
    join public.roles r on r.id = uvr.role_id
    join public.role_permissions rp on rp.role_id = uvr.role_id
    join public.permissions p on p.id = rp.permission_id
    left join public.account_role_permissions arp
      on r.account_id is null
     and arp.account_id = public.get_active_account_id()
     and arp.role_id = rp.role_id
     and arp.permission_id = rp.permission_id
    where uvr.user_id = auth.uid()
      and uvr.venue_id = public.get_active_venue_id()
      and uvr.status = 'active'
      and p.code = permission_code
      and coalesce(arp.granted, rp.granted) = true
  );
$$;

-- Tighten direct role_permissions mutation back to account custom roles only.
drop policy if exists "role_permissions_insert_manage" on public.role_permissions;
create policy "role_permissions_insert_manage"
  on public.role_permissions for insert
  with check (
    public.has_permission('platform.manage_roles')
    and exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and r.account_id = public.get_active_account_id()
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
        and r.account_id = public.get_active_account_id()
    )
  );

drop policy if exists "role_permissions_delete_manage" on public.role_permissions;
create policy "role_permissions_delete_manage"
  on public.role_permissions for delete
  using (
    public.has_permission('platform.manage_roles')
    and exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and r.account_id = public.get_active_account_id()
    )
  );
