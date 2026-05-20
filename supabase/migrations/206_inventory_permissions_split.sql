-- ============================================================
-- 206_inventory_permissions_split.sql
-- Split the single `inventory` permissions module into 5 domain
-- groups so the role-edit UI renders meaningful sections instead
-- of one 14-row clump. Only `permissions.module` is updated;
-- permission `code` values stay the same, so no callsites in app
-- code or RLS policies need to change.
--
-- Groupings:
--   inventory_products    — каталог ингредиентов
--   inventory_stores      — склады и их привязка к venue
--   inventory_documents   — акты инвентаризации и их жизненный цикл
--   inventory_integration — Quick Resto sync
--   inventory_scope       — расширенный доступ (view_all_venues)
--
-- The trigger function apply_default_inventory_permissions_to_role()
-- (defined in 175_inventory_role_permissions_and_integration_access.sql)
-- filters by `p.module = 'inventory'`. After this migration there are
-- no rows with that exact value, so the trigger would stop granting
-- inventory perms to newly-created custom_manager/custom_admin roles.
-- Recreate the function with the new IN-list.
-- ============================================================

update public.permissions
   set module = 'inventory_products'
 where code in ('inventory.view_products', 'inventory.manage_products');

update public.permissions
   set module = 'inventory_stores'
 where code in ('inventory.view_stores', 'inventory.manage_stores');

update public.permissions
   set module = 'inventory_documents'
 where code in (
   'inventory.view_documents',
   'inventory.manage_documents',
   'inventory.fill_assigned_documents',
   'inventory.view_results',
   'inventory.comment_results',
   'inventory.adjust_results',
   'inventory.finalize_results',
   'inventory.use_ai_suggestions'
 );

update public.permissions
   set module = 'inventory_integration'
 where code = 'inventory.sync_quickresto';

update public.permissions
   set module = 'inventory_scope'
 where code = 'inventory.view_all_venues';

-- Recreate trigger function to whitelist the new module names.
-- SET search_path сохраняется в теле, т.к. CREATE OR REPLACE сбрасывает
-- attributes из предыдущего ALTER (см. memory feedback_create_or_replace_search_path).
create or replace function public.apply_default_inventory_permissions_to_role()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.code in ('custom_manager', 'custom_admin') then
    insert into public.role_permissions (role_id, permission_id, granted)
    select new.id, p.id, true
    from public.permissions p
    where p.module in (
      'inventory_products',
      'inventory_stores',
      'inventory_documents',
      'inventory_integration',
      'inventory_scope'
    )
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

revoke all on function public.apply_default_inventory_permissions_to_role() from public;
