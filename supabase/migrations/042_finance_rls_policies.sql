-- ============================================================
-- 042_finance_rls_policies.sql
-- RLS-политики для всех таблиц блока Finance (миграции 037-040)
-- + bank_account_groups / finance_category_groups / counterparty_groups.
--
-- Базовый паттерн (см. docs/MERGE_PLAN.md §4.4):
--   1. account_id = get_active_account_id()
--   2. опционально: legal_entity_id = get_active_legal_entity_id()
--      или has_permission('finance.view_all_legal_entities')
--   3. опционально: venue_id = get_active_venue_id()
--      или has_permission('finance.view_all_venues')
--   4. has_permission('finance.<verb>_<resource>')
--   5. soft-delete фильтр (deleted_at is null) для read-политик
--
-- Группы (bank_account_groups, finance_category_groups, counterparty_groups)
-- — справочники без привязки к юрлицу/venue, RLS попроще.
-- ============================================================

-- ───────────────────────── bank_accounts ─────────────────────────
alter table public.bank_accounts enable row level security;

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
    and deleted_at is null
  );

create policy "bank_accounts_insert"
  on public.bank_accounts for insert
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('finance.manage_bank_accounts')
  );

create policy "bank_accounts_update"
  on public.bank_accounts for update
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('finance.manage_bank_accounts')
  );

create policy "bank_accounts_delete"
  on public.bank_accounts for delete
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('finance.manage_bank_accounts')
  );

alter table public.bank_account_groups enable row level security;

create policy "bank_account_groups_select"
  on public.bank_account_groups for select
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('finance.view_bank_accounts')
  );

create policy "bank_account_groups_write"
  on public.bank_account_groups for all
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('finance.manage_bank_accounts')
  )
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('finance.manage_bank_accounts')
  );

-- ───────────────────────── finance_categories ─────────────────────────
alter table public.finance_categories enable row level security;

create policy "finance_categories_select"
  on public.finance_categories for select
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('finance.view_categories')
  );

create policy "finance_categories_write"
  on public.finance_categories for all
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('finance.manage_categories')
  )
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('finance.manage_categories')
  );

alter table public.finance_category_groups enable row level security;

create policy "finance_category_groups_select"
  on public.finance_category_groups for select
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('finance.view_categories')
  );

create policy "finance_category_groups_write"
  on public.finance_category_groups for all
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('finance.manage_categories')
  )
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('finance.manage_categories')
  );

-- ───────────────────────── counterparties ─────────────────────────
alter table public.counterparties enable row level security;

create policy "counterparties_select"
  on public.counterparties for select
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('finance.view_counterparties')
    and deleted_at is null
  );

create policy "counterparties_insert"
  on public.counterparties for insert
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('finance.manage_counterparties')
  );

create policy "counterparties_update"
  on public.counterparties for update
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('finance.manage_counterparties')
  );

create policy "counterparties_delete"
  on public.counterparties for delete
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('finance.manage_counterparties')
  );

alter table public.counterparty_groups enable row level security;

create policy "counterparty_groups_select"
  on public.counterparty_groups for select
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('finance.view_counterparties')
  );

create policy "counterparty_groups_write"
  on public.counterparty_groups for all
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('finance.manage_counterparties')
  )
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('finance.manage_counterparties')
  );

-- ───────────────────────── transactions ─────────────────────────
alter table public.transactions enable row level security;

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
    and deleted_at is null
  );

-- INSERT гейтит на finance.create_transaction.
create policy "transactions_insert"
  on public.transactions for insert
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('finance.create_transaction')
  );

-- UPDATE: либо своя транзакция (created_by = self) с finance.update_transaction,
-- либо чужая с finance.update_any_transaction.
create policy "transactions_update"
  on public.transactions for update
  using (
    account_id = public.get_active_account_id()
    and (
      (created_by = auth.uid() and public.has_permission('finance.update_transaction'))
      or public.has_permission('finance.update_any_transaction')
    )
  );

-- Soft delete делается UPDATE deleted_at = now() — гейтится на
-- finance.delete_transaction (не на update). Hard DELETE из приложения
-- не предусмотрен (используем soft).
create policy "transactions_delete"
  on public.transactions for delete
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('finance.delete_transaction')
  );
