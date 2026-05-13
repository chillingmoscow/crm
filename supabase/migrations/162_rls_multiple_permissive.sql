-- ============================================================
-- 162_rls_multiple_permissive.sql
--
-- Закрывает Supabase Advisor warning `multiple_permissive_policies`
-- (~25 warnings, 12 уникальных пар политик).
--
-- Postgres вычисляет каждую PERMISSIVE policy для одной (role, action)
-- отдельно и OR'ит результаты. Дублирование = двойной overhead на каждой
-- строке. Где предикаты независимы — мерджим в одну policy с явным OR.
-- Где `FOR ALL` пересекается на SELECT с отдельной `_select` polici'ей —
-- разделяем `FOR ALL` на `FOR INSERT/UPDATE/DELETE` (3 policy без SELECT).
--
-- Семантика прав не меняется (см. подробные комментарии у каждой группы).
-- `(select auth.uid())` используется напрямую — это форма из 161 для
-- закрытия `auth_rls_initplan`; миграции 161 и 162 независимы по
-- файлам и могут лечь в любом порядке.
-- ============================================================

-- ── Группа A: FOR ALL → split INSERT/UPDATE/DELETE ──────────────
-- Эти таблицы имеют пару *_select (для view) + *_write (FOR ALL для manage).
-- FOR ALL неявно включает SELECT → дубль с *_select. Решение: переписать
-- *_write на три отдельные policy для INSERT/UPDATE/DELETE.

-- bank_account_groups
drop policy if exists "bank_account_groups_write" on public.bank_account_groups;

create policy "bank_account_groups_insert" on public.bank_account_groups
  for insert
  with check (
    (account_id = get_active_account_id())
    and has_permission('finance.manage_bank_accounts')
  );
create policy "bank_account_groups_update" on public.bank_account_groups
  for update
  using (
    (account_id = get_active_account_id())
    and has_permission('finance.manage_bank_accounts')
  )
  with check (
    (account_id = get_active_account_id())
    and has_permission('finance.manage_bank_accounts')
  );
create policy "bank_account_groups_delete" on public.bank_account_groups
  for delete
  using (
    (account_id = get_active_account_id())
    and has_permission('finance.manage_bank_accounts')
  );

-- counterparty_groups
drop policy if exists "counterparty_groups_write" on public.counterparty_groups;

create policy "counterparty_groups_insert" on public.counterparty_groups
  for insert
  with check (
    (account_id = get_active_account_id())
    and has_permission('finance.manage_counterparties')
  );
create policy "counterparty_groups_update" on public.counterparty_groups
  for update
  using (
    (account_id = get_active_account_id())
    and has_permission('finance.manage_counterparties')
  )
  with check (
    (account_id = get_active_account_id())
    and has_permission('finance.manage_counterparties')
  );
create policy "counterparty_groups_delete" on public.counterparty_groups
  for delete
  using (
    (account_id = get_active_account_id())
    and has_permission('finance.manage_counterparties')
  );

-- finance_categories
drop policy if exists "finance_categories_write" on public.finance_categories;

create policy "finance_categories_insert" on public.finance_categories
  for insert
  with check (
    (account_id = get_active_account_id())
    and has_permission('finance.manage_categories')
  );
create policy "finance_categories_update" on public.finance_categories
  for update
  using (
    (account_id = get_active_account_id())
    and has_permission('finance.manage_categories')
  )
  with check (
    (account_id = get_active_account_id())
    and has_permission('finance.manage_categories')
  );
create policy "finance_categories_delete" on public.finance_categories
  for delete
  using (
    (account_id = get_active_account_id())
    and has_permission('finance.manage_categories')
  );

-- finance_category_groups
drop policy if exists "finance_category_groups_write" on public.finance_category_groups;

create policy "finance_category_groups_insert" on public.finance_category_groups
  for insert
  with check (
    (account_id = get_active_account_id())
    and has_permission('finance.manage_categories')
  );
create policy "finance_category_groups_update" on public.finance_category_groups
  for update
  using (
    (account_id = get_active_account_id())
    and has_permission('finance.manage_categories')
  )
  with check (
    (account_id = get_active_account_id())
    and has_permission('finance.manage_categories')
  );
create policy "finance_category_groups_delete" on public.finance_category_groups
  for delete
  using (
    (account_id = get_active_account_id())
    and has_permission('finance.manage_categories')
  );

-- kb_page_embeddings — у write более строгий with_check (EXISTS на kb_pages).
drop policy if exists "kb_page_embeddings_write" on public.kb_page_embeddings;

create policy "kb_page_embeddings_insert" on public.kb_page_embeddings
  for insert
  with check (
    account_id = get_active_account_id()
    and has_permission('kb.create_pages')
    and exists (
      select 1 from public.kb_pages kp
       where kp.id = kb_page_embeddings.page_id
         and kp.account_id = get_active_account_id()
    )
  );
create policy "kb_page_embeddings_update" on public.kb_page_embeddings
  for update
  using (
    account_id = get_active_account_id()
    and has_permission('kb.create_pages')
  )
  with check (
    account_id = get_active_account_id()
    and has_permission('kb.create_pages')
    and exists (
      select 1 from public.kb_pages kp
       where kp.id = kb_page_embeddings.page_id
         and kp.account_id = get_active_account_id()
    )
  );
create policy "kb_page_embeddings_delete" on public.kb_page_embeddings
  for delete
  using (
    account_id = get_active_account_id()
    and has_permission('kb.create_pages')
  );

-- kb_page_links — using = with_check, общий предикат.
drop policy if exists "kb_page_links_write" on public.kb_page_links;

create policy "kb_page_links_insert" on public.kb_page_links
  for insert
  with check (
    account_id = (select get_active_account_id())
    and (
      (select has_permission('kb.edit_any_page'))
      or (
        (select has_permission('kb.edit_own_pages'))
        and exists (
          select 1 from public.kb_pages p
           where p.id = kb_page_links.from_page_id
             and p.created_by = (select auth.uid())
        )
      )
    )
  );
create policy "kb_page_links_update" on public.kb_page_links
  for update
  using (
    account_id = (select get_active_account_id())
    and (
      (select has_permission('kb.edit_any_page'))
      or (
        (select has_permission('kb.edit_own_pages'))
        and exists (
          select 1 from public.kb_pages p
           where p.id = kb_page_links.from_page_id
             and p.created_by = (select auth.uid())
        )
      )
    )
  )
  with check (
    account_id = (select get_active_account_id())
    and (
      (select has_permission('kb.edit_any_page'))
      or (
        (select has_permission('kb.edit_own_pages'))
        and exists (
          select 1 from public.kb_pages p
           where p.id = kb_page_links.from_page_id
             and p.created_by = (select auth.uid())
        )
      )
    )
  );
create policy "kb_page_links_delete" on public.kb_page_links
  for delete
  using (
    account_id = (select get_active_account_id())
    and (
      (select has_permission('kb.edit_any_page'))
      or (
        (select has_permission('kb.edit_own_pages'))
        and exists (
          select 1 from public.kb_pages p
           where p.id = kb_page_links.from_page_id
             and p.created_by = (select auth.uid())
        )
      )
    )
  );


-- ── Группа B: merge двух SELECT в одну с OR ─────────────────────

-- accounts: owner аккаунта ИЛИ staff любого venue в этом аккаунте.
drop policy if exists "accounts_select_owner" on public.accounts;
drop policy if exists "accounts_select_staff" on public.accounts;

create policy "accounts_select" on public.accounts
  for select
  using (
    owner_id = (select auth.uid())
    or exists (
      select 1
        from public.user_venue_roles uvr
        join public.venues v on v.id = uvr.venue_id
       where uvr.user_id = (select auth.uid())
         and uvr.status = 'active'
         and v.account_id = accounts.id
    )
  );

-- profiles SELECT: свой профиль ИЛИ профиль staff в active venue (caller тоже в active venue).
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_select_venue_staff" on public.profiles;

create policy "profiles_select" on public.profiles
  for select
  using (
    id = (select auth.uid())
    or (
      exists (
        select 1 from public.user_venue_roles uvr
         where uvr.user_id = profiles.id
           and uvr.venue_id = get_active_venue_id()
           and uvr.status = 'active'
      )
      and exists (
        select 1 from public.user_venue_roles caller_uvr
         where caller_uvr.user_id = (select auth.uid())
           and caller_uvr.venue_id = get_active_venue_id()
           and caller_uvr.status = 'active'
      )
    )
  );

-- profiles UPDATE: свой профиль ИЛИ чужой при наличии people.edit_staff.
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_update_venue_staff" on public.profiles;

create policy "profiles_update" on public.profiles
  for update
  using (
    id = (select auth.uid())
    or (
      id <> (select auth.uid())
      and has_permission('people.edit_staff')
      and exists (
        select 1 from public.user_venue_roles uvr
         where uvr.user_id = profiles.id
           and uvr.venue_id = get_active_venue_id()
           and uvr.status = 'active'
      )
    )
  );

-- roles: account-scoped роли своего account ИЛИ системные роли (account_id IS NULL).
drop policy if exists "roles_select_account" on public.roles;
drop policy if exists "roles_select_system" on public.roles;

create policy "roles_select" on public.roles
  for select
  using (
    (
      account_id is not null
      and exists (
        select 1 from public.user_venue_roles uvr
          join public.venues v on v.id = uvr.venue_id
         where uvr.user_id = (select auth.uid())
           and uvr.status = 'active'
           and v.account_id = roles.account_id
      )
    )
    or (
      account_id is null
      and (select auth.uid()) is not null
    )
  );

-- user_venue_roles: своя строка ИЛИ права на people.view_staff (для менеджера).
drop policy if exists "user_venue_roles_select_own" on public.user_venue_roles;
drop policy if exists "user_venue_roles_select_manager" on public.user_venue_roles;

create policy "user_venue_roles_select" on public.user_venue_roles
  for select
  using (
    user_id = (select auth.uid())
    or has_permission('people.view_staff')
  );

-- venues: account-owner (is_account_owner helper) ИЛИ член active venue.
drop policy if exists "venues_select_account_owner" on public.venues;
drop policy if exists "venues_select_member" on public.venues;

create policy "venues_select" on public.venues
  for select
  using (
    is_account_owner(account_id)
    or exists (
      select 1 from public.user_venue_roles uvr
       where uvr.user_id = (select auth.uid())
         and uvr.venue_id = venues.id
         and uvr.status = 'active'
    )
  );
