-- ============================================================
-- 175_inventory_role_permissions_and_integration_access.sql
-- Align inventory permissions with default venue roles and make
-- integration settings respect `settings.manage_integrations`.
-- ============================================================

-- Existing preset roles created before inventory module appeared should get
-- the same defaults as freshly seeded roles.
insert into public.role_permissions (role_id, permission_id, granted)
select r.id, p.id, true
from public.roles r
join public.permissions p on p.module = 'inventory'
where r.code in ('custom_manager', 'custom_admin')
on conflict (role_id, permission_id)
do update set granted = excluded.granted;

insert into public.role_permissions (role_id, permission_id, granted)
select r.id, p.id, true
from public.roles r
join public.permissions p on p.code = 'inventory.fill_assigned_documents'
where r.code in ('custom_hostess', 'custom_waiter')
on conflict (role_id, permission_id)
do update set granted = excluded.granted;

-- Keep future default/preset roles aligned even if they are created by an
-- older function body on an already migrated database.
create or replace function public.apply_default_inventory_permissions_to_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.code in ('custom_manager', 'custom_admin') then
    insert into public.role_permissions (role_id, permission_id, granted)
    select new.id, p.id, true
    from public.permissions p
    where p.module = 'inventory'
    on conflict (role_id, permission_id)
    do update set granted = excluded.granted;
  elsif new.code in ('custom_hostess', 'custom_waiter') then
    insert into public.role_permissions (role_id, permission_id, granted)
    select new.id, p.id, true
    from public.permissions p
    where p.code = 'inventory.fill_assigned_documents'
    on conflict (role_id, permission_id)
    do update set granted = excluded.granted;
  end if;

  return new;
end;
$$;

drop trigger if exists roles_apply_default_inventory_permissions on public.roles;
create trigger roles_apply_default_inventory_permissions
after insert on public.roles
for each row
execute function public.apply_default_inventory_permissions_to_role();

revoke all on function public.apply_default_inventory_permissions_to_role() from public;

-- The integration UI is permission-gated by `settings.manage_integrations`.
-- These policies keep owner-only behavior via old policies, and additionally
-- allow permitted admins to manage integration data in the active account.
create policy "integration_connections_manage_integrations_select"
  on public.integration_connections for select
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('settings.manage_integrations')
  );

create policy "integration_connections_manage_integrations_insert"
  on public.integration_connections for insert
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('settings.manage_integrations')
  );

create policy "integration_connections_manage_integrations_update"
  on public.integration_connections for update
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('settings.manage_integrations')
  )
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('settings.manage_integrations')
  );

create policy "integration_connections_manage_integrations_delete"
  on public.integration_connections for delete
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('settings.manage_integrations')
  );

create policy "external_entity_links_manage_integrations_select"
  on public.external_entity_links for select
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('settings.manage_integrations')
  );

create policy "external_entity_links_manage_integrations_insert"
  on public.external_entity_links for insert
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('settings.manage_integrations')
  );

create policy "external_entity_links_manage_integrations_update"
  on public.external_entity_links for update
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('settings.manage_integrations')
  )
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('settings.manage_integrations')
  );

create policy "external_entity_links_manage_integrations_delete"
  on public.external_entity_links for delete
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('settings.manage_integrations')
  );

create policy "integration_import_runs_manage_integrations_select"
  on public.integration_import_runs for select
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('settings.manage_integrations')
  );

create policy "integration_import_runs_manage_integrations_insert"
  on public.integration_import_runs for insert
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('settings.manage_integrations')
  );

create policy "integration_import_runs_manage_integrations_update"
  on public.integration_import_runs for update
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('settings.manage_integrations')
  )
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('settings.manage_integrations')
  );

create policy "integration_import_runs_manage_integrations_delete"
  on public.integration_import_runs for delete
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('settings.manage_integrations')
  );

create policy "integration_external_snapshots_manage_integrations_select"
  on public.integration_external_snapshots for select
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('settings.manage_integrations')
  );

create policy "integration_external_snapshots_manage_integrations_insert"
  on public.integration_external_snapshots for insert
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('settings.manage_integrations')
  );

create policy "integration_external_snapshots_manage_integrations_update"
  on public.integration_external_snapshots for update
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('settings.manage_integrations')
  )
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('settings.manage_integrations')
  );

create policy "integration_external_snapshots_manage_integrations_delete"
  on public.integration_external_snapshots for delete
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('settings.manage_integrations')
  );
