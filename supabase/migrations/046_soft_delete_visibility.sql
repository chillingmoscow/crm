-- ============================================================
-- 046_soft_delete_visibility.sql
-- Allow manage-level users to see soft-deleted rows in finance tables
-- so the restore UX actually works.
--
-- Background: migration 042 baked `deleted_at is null` into the SELECT
-- policies of counterparties / bank_accounts / transactions. That made
-- soft-deleted rows invisible to *every* user, including the ones who
-- should be able to find and restore them. Result: «Показать удалённых»
-- toggles never returned anything, and the detail page redirected away
-- from a soft-deleted row before the «Восстановить» button could be
-- clicked.
--
-- Fix: gate the deleted_at filter on `not has_permission(<manage>)`.
-- View-only users keep the original behaviour (no deleted rows). Manage
-- users see everything.
--
-- For transactions, "manage" maps to `finance.delete_transaction` since
-- restore is the inverse of soft-delete and that's the permission with
-- the closest semantic.
-- ============================================================

-- ─── counterparties ─────────────────────────────────────────────────
drop policy if exists "counterparties_select" on public.counterparties;
create policy "counterparties_select"
  on public.counterparties for select
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('finance.view_counterparties')
    and (
      deleted_at is null
      or public.has_permission('finance.manage_counterparties')
    )
  );

-- ─── bank_accounts ──────────────────────────────────────────────────
drop policy if exists "bank_accounts_select" on public.bank_accounts;
create policy "bank_accounts_select"
  on public.bank_accounts for select
  using (
    account_id = public.get_active_account_id()
    and (
      legal_entity_id = public.get_active_legal_entity_id()
      or public.has_permission('finance.view_all_legal_entities')
    )
    and (
      venue_id is null
      or venue_id = public.get_active_venue_id()
      or public.has_permission('finance.view_all_venues')
    )
    and public.has_permission('finance.view_bank_accounts')
    and (
      deleted_at is null
      or public.has_permission('finance.manage_bank_accounts')
    )
  );

-- ─── transactions ──────────────────────────────────────────────────
drop policy if exists "transactions_select" on public.transactions;
create policy "transactions_select"
  on public.transactions for select
  using (
    account_id = public.get_active_account_id()
    and (
      legal_entity_id = public.get_active_legal_entity_id()
      or public.has_permission('finance.view_all_legal_entities')
    )
    and (
      venue_id is null
      or venue_id = public.get_active_venue_id()
      or public.has_permission('finance.view_all_venues')
    )
    and public.has_permission('finance.view_transactions')
    and (
      deleted_at is null
      or public.has_permission('finance.delete_transaction')
    )
  );
