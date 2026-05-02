-- ============================================================
-- copy_role_permissions(p_source_role_id, p_target_role_id)
--
-- Copies all `granted = true` permissions from source role into
-- target role atomically. Used by the "New role" drawer when the
-- user picks "На основе существующей роли".
--
-- Source role visibility uses the same rules as
-- get_effective_role_permissions: system roles (account_id is null)
-- and roles owned by the active account are visible.
--
-- Target role MUST be a custom role owned by the active account
-- (we never write into system roles' role_permissions table —
-- those are seeded once in 002 and overridden per-account via
-- account_role_permissions). Owner role cannot be a target.
--
-- Caller must hold `people.manage_roles`.
-- ============================================================

create or replace function public.copy_role_permissions(
  p_source_role_id uuid,
  p_target_role_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id        uuid;
  v_source_account_id uuid;
  v_target_account_id uuid;
  v_target_code       text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.has_permission('people.manage_roles') then
    raise exception 'Insufficient permissions';
  end if;

  v_account_id := public.get_active_account_id();
  if v_account_id is null then
    raise exception 'Active account is not set';
  end if;

  -- Source: system role OR owned by active account
  select r.account_id into v_source_account_id
  from public.roles r
  where r.id = p_source_role_id;

  if not found then
    raise exception 'Source role not found';
  end if;

  if v_source_account_id is not null and v_source_account_id <> v_account_id then
    raise exception 'Source role is outside active account';
  end if;

  -- Target: must be custom + owned by active account + not owner
  select r.account_id, r.code into v_target_account_id, v_target_code
  from public.roles r
  where r.id = p_target_role_id;

  if not found then
    raise exception 'Target role not found';
  end if;

  if v_target_account_id is null then
    raise exception 'Target must be a custom (account-scoped) role';
  end if;

  if v_target_account_id <> v_account_id then
    raise exception 'Target role is outside active account';
  end if;

  if v_target_code = 'owner' then
    raise exception 'Owner role cannot be modified';
  end if;

  -- Copy effective grants from source. For system source roles we
  -- read account_role_permissions overrides on top of base
  -- role_permissions; for custom source we just read role_permissions.
  insert into public.role_permissions (role_id, permission_id, granted)
  select
    p_target_role_id,
    rp.permission_id,
    case
      when v_source_account_id is null
        then coalesce(arp.granted, rp.granted)
      else rp.granted
    end as effective_granted
  from public.role_permissions rp
  left join public.account_role_permissions arp
    on arp.account_id = v_account_id
   and arp.role_id    = p_source_role_id
   and arp.permission_id = rp.permission_id
  where rp.role_id = p_source_role_id
    -- only carry granted=true; explicit denies left default-false on target
    and (
      case
        when v_source_account_id is null
          then coalesce(arp.granted, rp.granted)
        else rp.granted
      end
    ) = true
  on conflict (role_id, permission_id)
  do update set granted = excluded.granted;
end;
$$;

grant execute on function public.copy_role_permissions(uuid, uuid)
  to authenticated;
