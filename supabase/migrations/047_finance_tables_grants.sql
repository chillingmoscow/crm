-- ============================================================
-- 047_finance_tables_grants.sql
-- Backfill table-level GRANTs for stage 3/3B tables.
--
-- Background: migration 021 set ALTER DEFAULT PRIVILEGES so that
-- future tables created in `public` would inherit
-- SELECT/INSERT/UPDATE/DELETE for anon + authenticated. But ALTER
-- DEFAULT PRIVILEGES is *per role* — it only applies to tables
-- created by the role that ran the ALTER. Migration 021 itself was
-- applied via the Supabase CLI as the `postgres` role, so the
-- defaults are scoped to `postgres`-created tables.
--
-- When stages 3/3B were pushed via `psql -U supabase_admin -1 -f …`
-- (the SSH workflow documented in memory/self_hosted_supabase.md),
-- the new tables landed under `supabase_admin` ownership and didn't
-- pick up the defaults. End result: PostgREST queries from the
-- authenticated role hit `permission denied for table bank_accounts`
-- (and the same for every other stage-3/3B table) before RLS even
-- got a chance to run.
--
-- This migration:
--   1. Grants explicit SELECT/INSERT/UPDATE/DELETE on each affected
--      table to anon + authenticated.
--   2. Grants USAGE/SELECT on sequences (transactions.public_id is
--      bigserial → has an auto-created sequence).
--   3. Sets ALTER DEFAULT PRIVILEGES under `supabase_admin` too, so
--      any future migrations pushed via the same SSH workflow don't
--      hit the issue again.
-- ============================================================

-- 1. Backfill grants on existing tables.
--    Listed explicitly (not "all tables") so the migration is a
--    no-op if re-run on an environment that already has them.
grant select, insert, update, delete on
  public.bank_account_groups,
  public.bank_accounts,
  public.finance_category_groups,
  public.finance_categories,
  public.counterparty_groups,
  public.counterparties,
  public.transactions,
  public.account_files,
  public.transaction_attachments,
  public.counterparty_attachments,
  public.legal_entity_attachments
to anon, authenticated;

-- 2. Sequences. transactions.public_id is bigserial, so the auto-
--    created sequence needs USAGE+SELECT for INSERT to work via
--    PostgREST. Other tables use uuid PKs, no sequences.
grant usage, select on sequence public.transactions_public_id_seq to
  anon, authenticated;

-- 3. Future-proof: future tables created by supabase_admin will now
--    auto-grant the same privileges. Migration 021 only set this for
--    tables created by `postgres`.
--
-- DO-block with explicit insufficient-privilege handler because the
-- local supabase CLI runs `db reset` as the `postgres` role, which
-- cannot ALTER DEFAULT PRIVILEGES *for another role*. On prod (where
-- this migration is pushed via `psql -U supabase_admin`) all three
-- statements succeed; locally they're skipped silently. Either way
-- the explicit GRANTs above already cover the existing tables.
do $$
begin
  alter default privileges for role supabase_admin in schema public
    grant select, insert, update, delete on tables to anon, authenticated;
  alter default privileges for role supabase_admin in schema public
    grant usage, select on sequences to anon, authenticated;
  alter default privileges for role supabase_admin in schema public
    grant execute on routines to anon, authenticated;
exception
  when insufficient_privilege then
    raise notice 'Skipping ALTER DEFAULT PRIVILEGES for supabase_admin (current role lacks privilege; expected on local CLI).';
end;
$$;
