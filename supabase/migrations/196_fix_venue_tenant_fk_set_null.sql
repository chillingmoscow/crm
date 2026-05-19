-- ============================================================
-- 196_fix_venue_tenant_fk_set_null.sql
-- Фикс: удаление заведения падало с «null value in column account_id».
-- Причина: composite tenant-FK (account_id, venue_id) → venues(...)
-- ON DELETE SET NULL ставил NULL ОБОИМ столбцам (venue_id И account_id),
-- но account_id NOT NULL → нарушение констрейнта → DELETE откатывался.
-- PG15+ поддерживает column-list для SET NULL: только venue_id.
-- Затронуты: bank_accounts (миграция 053), transactions (миграция 040).
-- ============================================================

alter table public.bank_accounts
  drop constraint bank_accounts_venue_tenant_fkey;
alter table public.bank_accounts
  add constraint bank_accounts_venue_tenant_fkey
  foreign key (account_id, venue_id) references public.venues(account_id, id)
  on delete set null (venue_id);

alter table public.transactions
  drop constraint transactions_venue_tenant_fkey;
alter table public.transactions
  add constraint transactions_venue_tenant_fkey
  foreign key (account_id, venue_id) references public.venues(account_id, id)
  on delete set null (venue_id);
