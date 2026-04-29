-- ============================================================
-- 036_legal_entities_tenant_consistency.sql
--
-- Hardens the venues → legal_entities link so a venue cannot point
-- at a legal_entity from a different account.
--
-- Stage 2A's migration 033 added:
--   venues.default_legal_entity_id uuid REFERENCES legal_entities(id)
-- which only checks that the target legal_entity exists at all. Both
-- venues.account_id and legal_entities.account_id are independently
-- enforced FKs to accounts(id), but PostgreSQL has no built-in way
-- to enforce that they REFER TO THE SAME account.
--
-- The fix is the standard composite-FK pattern:
--   1. Add a UNIQUE key on legal_entities (account_id, id) so it can
--      be referenced as a composite parent. (id alone is already PK,
--      so the new key is redundant for uniqueness but required for
--      composite-FK targeting.)
--   2. Drop the simple FK on venues.default_legal_entity_id.
--   3. Add a composite FK from venues (account_id, default_legal_entity_id)
--      to legal_entities (account_id, id). With default MATCH SIMPLE,
--      this passes when default_legal_entity_id IS NULL (untouched
--      venue) and enforces account match when both columns are set.
--
-- Reported by Codex on PR #3:
--   "default_legal_entity_id is constrained only by legal_entities.id,
--    so PostgreSQL will accept linking a venue to a legal entity from
--    a different account."
-- ============================================================

-- 1. Composite-uniqueness target on legal_entities.
alter table public.legal_entities
  add constraint legal_entities_account_id_id_key
    unique (account_id, id);

-- 2. Drop the simple FK that only checked id existence.
alter table public.venues
  drop constraint if exists venues_default_legal_entity_id_fkey;

-- 3. Replace with the composite FK that ties venue.account_id to
--    legal_entity.account_id. ON DELETE RESTRICT preserves stage 2A
--    semantics: cannot drop a legal_entity that has a venue pointing
--    at it.
alter table public.venues
  add constraint venues_default_legal_entity_tenant_fkey
    foreign key (account_id, default_legal_entity_id)
    references public.legal_entities (account_id, id)
    on delete restrict;
