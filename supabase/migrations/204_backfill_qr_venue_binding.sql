-- ============================================================
-- 204_backfill_qr_venue_binding.sql
-- Backfill: для аккаунтов, где QR-данные привязались к НЕ-QR-venue из-за
-- старого `resolveDefaultVenueId` (использовал активное venue из profile
-- вместо QR-смапленного venue из external_entity_links).
--
-- Симптом на проде: stores.local_venue_id указывают на venue, отличное
-- от смапленного через external_entity_links(entity_type='venue').
-- Документы (через триггер из stores) тоже смотрят туда же.
--
-- Fix (исходник в коде — миграция 204 + commit с resolveDefaultVenueId
-- refactor): новая sync будет привязывать к QR-venue. Эта миграция
-- разово переклеивает существующие данные.
--
-- Безопасно: затрагивает только stores, документы перепривяжутся
-- автоматически через триггер trg_stores_propagate_venue_to_documents
-- (миграция 194). Аккаунты без QR-маппинга — пропускаются (предикат
-- NOT NULL на target).
-- ============================================================

with qr_venue_per_account as (
  -- Берём по ОДНОМУ qr-venue на аккаунт (если их случайно несколько,
  -- выбираем самый старый — это исторически первый импортированный).
  select distinct on (account_id)
    account_id,
    local_id::uuid as qr_venue_id
  from public.external_entity_links
  where provider = 'quickresto'
    and entity_type = 'venue'
  order by account_id, created_at asc
)
update public.stores s
   set local_venue_id = q.qr_venue_id
  from qr_venue_per_account q
 where s.account_id = q.account_id
   and s.local_venue_id is distinct from q.qr_venue_id
   -- Только sync-managed stores (есть external_link в quickresto).
   -- Ручные stores (если такие есть) — не трогаем.
   and exists (
     select 1 from public.external_entity_links el
     where el.account_id = s.account_id
       and el.provider = 'quickresto'
       and el.entity_type = 'store'
       and el.local_id::uuid = s.id
   );

-- documents.venue_id обновится через триггер
-- trg_stores_propagate_venue_to_documents (миграция 194), но он стреляет
-- only on stores UPDATE с distinct venue_id — ровно наш сценарий.
-- Дополнительно — явный backfill для documents, у которых store_id
-- остался на старом store но local_venue_id уже обновлён триггером:
-- (no-op в большинстве случаев, защита от частичного триггер-state).
update public.documents d
   set venue_id = s.local_venue_id
  from public.stores s
 where s.id = d.store_id
   and d.venue_id is distinct from s.local_venue_id;
