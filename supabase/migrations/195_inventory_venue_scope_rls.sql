-- ============================================================
-- 195_inventory_venue_scope_rls.sql
-- Venue-scoping инвентаря — Pass 2 (RLS, security-смена).
-- Зеркало finance 042 + правило unassigned (решение пользователя):
-- записи без venue видны ТОЛЬКО держателям inventory.view_all_venues
-- ИЛИ inventory.manage_stores (не finance-style blanket).
--
-- documents.venue_id уже на проде (194) → рассинхрона код↔БД нет.
-- Меняем только *_select; write/insert/update/delete (account+manage)
-- не трогаем (venue-ограничение фокусируем на видимости — решение).
-- (select auth.uid()) — InitPlan-форма (advisor auth_rls_initplan).
-- ============================================================

drop policy "documents_select" on public.documents;
create policy "documents_select"
  on public.documents for select
  using (
    account_id = public.get_active_account_id()
    and (
      public.has_permission('inventory.view_all_venues'::text)
      or (venue_id is not null and venue_id = public.get_active_venue_id())
      or (venue_id is null and public.has_permission('inventory.manage_stores'::text))
      or (assigned_to = (select auth.uid())
          and public.has_permission('inventory.fill_assigned_documents'::text))
    )
    and (
      public.has_permission('inventory.view_documents'::text)
      or (assigned_to = (select auth.uid())
          and public.has_permission('inventory.fill_assigned_documents'::text))
    )
  );

drop policy "document_items_select" on public.document_items;
create policy "document_items_select"
  on public.document_items for select
  using (
    exists (
      select 1
      from public.documents d
      where d.id = document_items.document_id
        and d.account_id = public.get_active_account_id()
        and (
          public.has_permission('inventory.view_all_venues'::text)
          or (d.venue_id is not null and d.venue_id = public.get_active_venue_id())
          or (d.venue_id is null and public.has_permission('inventory.manage_stores'::text))
          or (d.assigned_to = (select auth.uid())
              and public.has_permission('inventory.fill_assigned_documents'::text))
        )
        and (
          public.has_permission('inventory.view_documents'::text)
          or (d.assigned_to = (select auth.uid())
              and public.has_permission('inventory.fill_assigned_documents'::text))
        )
    )
  );

drop policy "stores_select" on public.stores;
create policy "stores_select"
  on public.stores for select
  using (
    account_id = public.get_active_account_id()
    and (
      public.has_permission('inventory.view_all_venues'::text)
      or (local_venue_id is not null and local_venue_id = public.get_active_venue_id())
      or (local_venue_id is null and public.has_permission('inventory.manage_stores'::text))
      or exists (
        select 1 from public.documents d
        where d.store_id = stores.id
          and d.assigned_to = (select auth.uid())
          and public.has_permission('inventory.fill_assigned_documents'::text)
      )
    )
    and (
      public.has_permission('inventory.view_stores'::text)
      or public.has_permission('inventory.view_documents'::text)
      or exists (
        select 1 from public.documents d
        where d.store_id = stores.id
          and d.assigned_to = (select auth.uid())
          and public.has_permission('inventory.fill_assigned_documents'::text)
      )
    )
  );
