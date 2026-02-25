-- ============================================================
-- 014_profile_access_policies.sql
-- Доступ к профилям других сотрудников для менеджеров
-- ============================================================

-- Все участники заведения могут читать профили других участников того же заведения
drop policy if exists "profiles_select_venue_staff" on public.profiles;
create policy "profiles_select_venue_staff"
  on public.profiles for select
  using (
    exists (
      select 1 from public.user_venue_roles uvr
      where uvr.user_id = profiles.id
        and uvr.venue_id = public.get_active_venue_id()
        and uvr.status   = 'active'
    )
  );

-- Менеджеры могут обновлять профили сотрудников своего заведения
drop policy if exists "profiles_update_venue_staff" on public.profiles;
create policy "profiles_update_venue_staff"
  on public.profiles for update
  using (
    id != auth.uid()
    and public.has_permission('platform.manage_staff')
    and exists (
      select 1 from public.user_venue_roles uvr
      where uvr.user_id = profiles.id
        and uvr.venue_id = public.get_active_venue_id()
        and uvr.status   = 'active'
    )
  );
