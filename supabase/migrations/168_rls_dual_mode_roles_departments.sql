-- ─────────────────────────────────────────────────────────────────────────────
-- 168_rls_dual_mode_roles_departments.sql
--
-- Stage B из плана venue-scoped roles + departments (см.
-- .claude/plans/tidy-fluttering-micali.md). RLS policies теперь принимают
-- ОБА варианта:
--   • Legacy: account_id = get_active_account_id()
--   • Venue-scoped: venue_id принадлежит одному из active venues юзера
--                   (для departments — get_active_venue_id() AND account_id match)
--
-- Цель: пока stage C (data migration) не отработал, на проде смешаны старые
-- account-scoped записи и новые venue-scoped, которые создаёт код Stage B.
-- RLS должны видеть обе версии и разрешать запись новых.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── roles_select ────────────────────────────────────────────────────────────
-- К имеющейся (account_id OR system) добавляем (venue_id = active OR
-- venue_id принадлежит venue с активным uvr). Strict-venue ветка
-- (только active venue) даёт правильный UX для будущего, но в Stage B
-- удобнее «любой venue моего аккаунта» — чтобы при смене активного
-- venue юзер не «терял» roles из недавно созданного. После Stage D
-- логику пересмотрим.

drop policy if exists "roles_select" on public.roles;
create policy "roles_select" on public.roles
  for select
  using (
    -- Legacy account-scoped роль
    (
      account_id is not null
      and venue_id is null
      and exists (
        select 1 from public.user_venue_roles uvr
          join public.venues v on v.id = uvr.venue_id
         where uvr.user_id = (select auth.uid())
           and uvr.status = 'active'
           and v.account_id = roles.account_id
      )
    )
    or
    -- Venue-scoped роль: видим если являемся active member venue
    -- этого аккаунта (любого, не обязательно активного).
    (
      venue_id is not null
      and exists (
        select 1 from public.user_venue_roles uvr
          join public.venues v on v.id = uvr.venue_id
         where uvr.user_id = (select auth.uid())
           and uvr.status = 'active'
           and v.account_id = (
             select account_id from public.venues
             where id = roles.venue_id
           )
      )
    )
    or
    -- Системная роль (owner): account_id NULL, venue_id NULL.
    (
      account_id is null
      and venue_id is null
      and (select auth.uid()) is not null
    )
  );

-- ── roles_insert_manage ─────────────────────────────────────────────────────
-- Stage B пишет venue_id + account_id одновременно. WITH CHECK должен
-- принимать оба варианта:

drop policy if exists "roles_insert_manage" on public.roles;
create policy "roles_insert_manage"
  on public.roles for insert
  with check (
    public.has_permission('people.manage_roles')
    and (
      -- Legacy: только account_id
      (
        account_id = public.get_active_account_id()
        and venue_id is null
      )
      or
      -- Dual: account_id из активного аккаунта + venue_id принадлежит
      -- venue этого аккаунта (чаще всего active_venue).
      (
        account_id = public.get_active_account_id()
        and venue_id is not null
        and exists (
          select 1 from public.venues v
          where v.id = roles.venue_id
            and v.account_id = public.get_active_account_id()
        )
      )
    )
  );

drop policy if exists "roles_update_manage" on public.roles;
create policy "roles_update_manage"
  on public.roles for update
  using (
    public.has_permission('people.manage_roles')
    and (
      (account_id = public.get_active_account_id() and venue_id is null)
      or
      (
        venue_id is not null
        and exists (
          select 1 from public.venues v
          where v.id = roles.venue_id
            and v.account_id = public.get_active_account_id()
        )
      )
    )
  );

drop policy if exists "roles_delete_manage" on public.roles;
create policy "roles_delete_manage"
  on public.roles for delete
  using (
    public.has_permission('people.manage_roles')
    and (
      (account_id = public.get_active_account_id() and venue_id is null)
      or
      (
        venue_id is not null
        and exists (
          select 1 from public.venues v
          where v.id = roles.venue_id
            and v.account_id = public.get_active_account_id()
        )
      )
    )
  );

-- ── departments policies (4 штуки из 158, все account-scoped) ──────────────

drop policy if exists "dep_select_member" on public.departments;
create policy "dep_select_member"
  on public.departments for select
  using (
    public.has_permission('people.view_roles')
    and (
      -- Legacy account-scoped
      (
        venue_id is null
        and exists (
          select 1
          from public.user_venue_roles uvr
          join public.venues v on v.id = uvr.venue_id
          where uvr.user_id = (select auth.uid())
            and uvr.status = 'active'
            and v.account_id = departments.account_id
        )
      )
      or
      -- Venue-scoped: member любого venue этого аккаунта
      (
        venue_id is not null
        and exists (
          select 1
          from public.user_venue_roles uvr
          join public.venues v on v.id = uvr.venue_id
          where uvr.user_id = (select auth.uid())
            and uvr.status = 'active'
            and v.account_id = (
              select account_id from public.venues
              where id = departments.venue_id
            )
        )
      )
    )
  );

drop policy if exists "dep_insert_manage" on public.departments;
create policy "dep_insert_manage"
  on public.departments for insert
  with check (
    public.has_permission('people.manage_roles')
    and account_id = public.get_active_account_id()
    and (
      venue_id is null
      or exists (
        select 1 from public.venues v
        where v.id = departments.venue_id
          and v.account_id = public.get_active_account_id()
      )
    )
  );

drop policy if exists "dep_update_manage" on public.departments;
create policy "dep_update_manage"
  on public.departments for update
  using (
    public.has_permission('people.manage_roles')
    and account_id = public.get_active_account_id()
    and (
      venue_id is null
      or exists (
        select 1 from public.venues v
        where v.id = departments.venue_id
          and v.account_id = public.get_active_account_id()
      )
    )
  )
  with check (
    public.has_permission('people.manage_roles')
    and account_id = public.get_active_account_id()
    and (
      venue_id is null
      or exists (
        select 1 from public.venues v
        where v.id = departments.venue_id
          and v.account_id = public.get_active_account_id()
      )
    )
  );

drop policy if exists "dep_delete_manage" on public.departments;
create policy "dep_delete_manage"
  on public.departments for delete
  using (
    public.has_permission('people.manage_roles')
    and account_id = public.get_active_account_id()
  );
