-- 215_inventory_store_venue_autobind.sql
--
-- Проблема: акты инвентаризации (documents, document_kind='inventory')
-- скоупятся по venue (RLS documents_select, миграция 195) через
-- documents.venue_id, который берётся от склада (stores.local_venue_id)
-- триггерами из 194. Если склад НЕ привязан к заведению
-- (local_venue_id IS NULL), у всех его актов venue_id=NULL, и видимость
-- такого акта требует inventory.view_all_venues / inventory.manage_stores.
-- Обычная роль с одним лишь inventory.view_documents в итоге не видит НИ
-- ОДНОГО акта — хотя владелец «выдал доступ».
--
-- На проде это и случилось: 3 склада с local_venue_id=NULL → 11 актов с
-- venue_id=NULL → сотрудник видит пусто, владелец (view_all_venues) — всё.
--
-- Причина NULL: склады синхронизировались в момент, когда
-- resolveDefaultVenueId возвращал NULL (до создания QR-venue-линка / до
-- логики привязки), а перепривязка склада к venue в коде происходит ТОЛЬКО
-- на full-синке и только если defaultVenueId на тот момент != NULL.
-- Получается «залипший» NULL, который последующие синки не лечат.
--
-- Ожидание пользователя: при настройке интеграции QuickResto подключается
-- заведение (external_entity_links provider='quickresto', entity_type='venue'),
-- и склады этой интеграции должны АВТОМАТИЧЕСКИ привязываться к нему.
--
-- Фикс (на уровне БД):
--   1. helper resolve_default_store_venue(account) — QR-venue-линк (если он
--      ОДНОЗНАЧЕН: ровно одно live QR-смапленное заведение) ИЛИ единственное
--      live-заведение аккаунта. Иначе NULL (неоднозначно → ручная привязка).
--   2. BEFORE INSERT-триггер на stores: новый склад без venue получает его из
--      резолвера. ТОЛЬКО на INSERT — чтобы не ломать ручное «Не привязан»
--      (явный UPDATE local_venue_id=NULL через UI/API) (Codex P1).
--   3. Разовый backfill существующих NULL-складов — он же через триггер 194
--      (stores→documents) проставит venue_id всем их актам.

-- 1. Резолвер дефолтного venue для склада.
--    SECURITY DEFINER: вызывается из триггера/бэкфилла под владельцем и должен
--    читать external_entity_links / venues независимо от RLS. EXECUTE у public
--    отзываем ниже — иначе тенант мог бы дёрнуть его как RPC с чужим account_id
--    и в обход RLS узнать venue другого аккаунта (Codex P1).
create or replace function public.resolve_default_store_venue(p_account_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    -- Приоритет: venue, смапленное на QuickResto. Берём ТОЛЬКО если оно
    -- однозначно — ровно одно live QR-смапленное заведение в аккаунте.
    -- Иначе (0 или >1, мульти-клауд #362) не гадаем → NULL.
    (
      select v.id
      from public.external_entity_links l
      join public.venues v
        on v.id = l.local_id
       and v.account_id = p_account_id
       and v.archived_at is null
      where l.account_id = p_account_id
        and l.provider = 'quickresto'
        and l.entity_type = 'venue'
        and (
          select count(distinct v2.id)
          from public.external_entity_links l2
          join public.venues v2
            on v2.id = l2.local_id
           and v2.account_id = p_account_id
           and v2.archived_at is null
          where l2.account_id = p_account_id
            and l2.provider = 'quickresto'
            and l2.entity_type = 'venue'
        ) = 1
      limit 1
    ),
    -- Fallback: единственное live-заведение аккаунта.
    (
      select v.id
      from public.venues v
      where v.account_id = p_account_id
        and v.archived_at is null
        and (
          select count(*)
          from public.venues v2
          where v2.account_id = p_account_id
            and v2.archived_at is null
        ) = 1
      limit 1
    )
  );
$$;

-- Закрываем прямой вызов резолвера тенантами (cross-tenant leak, Codex P1).
revoke all on function public.resolve_default_store_venue(uuid) from public;
revoke all on function public.resolve_default_store_venue(uuid) from anon, authenticated;

-- 2. BEFORE INSERT-триггер: автопривязка нового склада к venue, когда
--    local_venue_id пуст. На UPDATE НЕ вешаем — чтобы явное «Не привязан»
--    (UPDATE local_venue_id=NULL) сохранялось (Codex P1).
create or replace function public.tg_stores_set_venue_from_qr_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.local_venue_id is null then
    new.local_venue_id := public.resolve_default_store_venue(new.account_id);
  end if;
  return new;
end;
$$;

revoke all on function public.tg_stores_set_venue_from_qr_link() from public;
revoke all on function public.tg_stores_set_venue_from_qr_link() from anon, authenticated;

drop trigger if exists trg_stores_set_venue_from_qr_link on public.stores;
create trigger trg_stores_set_venue_from_qr_link
  before insert on public.stores
  for each row
  execute function public.tg_stores_set_venue_from_qr_link();

-- 3. Backfill существующих складов без venue. UPDATE на не-NULL значение
--    меняет local_venue_id → срабатывает триггер 194
--    (trg_stores_propagate_venue_to_documents) и проставляет documents.venue_id
--    всем актам этих складов. Где резолвер вернул NULL (нет однозначного
--    QR-линка и заведений != 1) — склад остаётся непривязанным (нужна ручная
--    привязка в /org/stores).
update public.stores s
set local_venue_id = public.resolve_default_store_venue(s.account_id)
where s.local_venue_id is null
  and public.resolve_default_store_venue(s.account_id) is not null;
