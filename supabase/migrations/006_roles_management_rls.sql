-- ============================================================
-- 006_roles_management_rls.sql
-- RLS-политики для управления ролями и правами (CRUD)
-- + вспомогательная функция get_active_account_id
-- ============================================================

-- Вспомогательная функция: возвращает account_id активного заведения
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
  where p.id = auth.uid();
$$;

-- ============================================================
-- roles — DML-политики (только для кастомных ролей аккаунта)
-- ============================================================

create policy "roles_insert_manage"
  on public.roles for insert
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('platform.manage_roles')
  );

create policy "roles_update_manage"
  on public.roles for update
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('platform.manage_roles')
  );

create policy "roles_delete_manage"
  on public.roles for delete
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('platform.manage_roles')
  );

-- ============================================================
-- role_permissions — DML-политики (только кастомных ролей)
-- ============================================================

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
