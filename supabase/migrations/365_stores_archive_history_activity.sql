-- 365_stores_archive_history_activity.sql
--
-- Справочник складов (/org/stores), три доработки:
--
-- 1. Архив складов. Склад, который удалили в Quick Resto или просто больше не
--    используют, висел в списке навсегда (синхронизация склады не удаляет).
--    Колонки по конвенции — archived_at / archived_by (docs/CONVENTIONS.md §2).
--
--    Осознанные отступления от конвенции:
--    - RLS не делится на live/archive. На архивный склад продолжают ссылаться
--      его акты: список актов, итоги и расчёт недостачи показывают название
--      склада. Спрятать строку политикой — значит потерять название в актах.
--      Архивные склады отфильтровываются в коде списка и выборов.
--    - Удаления навсегда нет: склад приходит из Quick Resto, удалённый у нас он
--      вернулся бы со следующей синхронизацией, а акты потеряли бы склад
--      (FK documents.store_id ON DELETE SET NULL).
--    - Архивирует тот, кто управляет складами (inventory.manage_stores), а не
--      только владелец. Owner-only в конвенции защищает от потери активного
--      заведения при архивации venue (Codex P1 #371); у склада такого контекста
--      нет, а прятать мёртвые склады должен тот, кто их настраивает.
--    - Расчёт недостачи архив не меняет: акты архивного склада считаются как
--      раньше. Архив — про список, а не про деньги.
--
-- 2. История склада в общем журнале (audit_logs, «Организация → Журнал
--    событий»): смена заведения (store.venue_changed), архив (store.archived),
--    возврат (store.restored). Раньше писалась только история подразделения
--    (store_department_history, миграция 307), а смена заведения — нет.
--    Заведение склада менялось service-role'ом из server action, auth.uid() там
--    пуст, и автора записать было бы нельзя. Поэтому смена заведения переходит
--    на RPC set_store_venue, которое вызывается клиентом пользователя.
--
-- 3. store_act_stats() — число актов инвентаризации и дата последнего по
--    каждому складу аккаунта: столбец «Последний акт» показывает, жив ли склад.
--    Плюс индекс documents(store_id, invoice_date): по store_id не было индекса
--    вовсе, хотя на нём стоят FK и подзапрос политики stores_select.

begin;

-- ── 1. Архив ───────────────────────────────────────────────────────────────

alter table public.stores
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null;

-- FK-индекс (advisor unindexed_foreign_keys); строк с автором мало — частичный.
create index if not exists stores_archived_by_idx
  on public.stores (archived_by) where archived_by is not null;

comment on column public.stores.archived_at is
  'Склад скрыт из справочника и выборов. Акты и расчёт недостачи не меняются. Миграция 365.';

-- ── 3. Индекс для статистики актов и подзапроса stores_select ──────────────

create index if not exists documents_store_invoice_idx
  on public.documents (store_id, invoice_date desc) where store_id is not null;

-- ── 2. Журнал: смена заведения, архив, возврат ─────────────────────────────

create or replace function public.stores_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_old_name text;
  v_new_name text;
begin
  begin
    if old.archived_at is null and new.archived_at is not null then
      perform public.log_audit_with_context(
        'store.archived', 'store', new.id,
        jsonb_build_object('title', new.title),
        new.account_id, (select auth.uid()), new.local_venue_id, null
      );
    elsif old.archived_at is not null and new.archived_at is null then
      perform public.log_audit_with_context(
        'store.restored', 'store', new.id,
        jsonb_build_object('title', new.title),
        new.account_id, (select auth.uid()), new.local_venue_id, null
      );
    end if;

    if old.local_venue_id is distinct from new.local_venue_id then
      v_old_name := (select v.name from public.venues v where v.id = old.local_venue_id);
      -- Заведение удаляют (FK обнуляет привязку): к этому моменту его строки уже
      -- нет. Имя берём из последней записи, где склад к нему привязывали.
      if v_old_name is null and old.local_venue_id is not null then
        select a.details ->> 'new_venue_name' into v_old_name
          from public.audit_logs a
         where a.entity_type = 'store' and a.entity_id = new.id
           and a.action_code = 'store.venue_changed'
           and a.details ->> 'new_venue_id' = old.local_venue_id::text
         order by a.created_at desc
         limit 1;
      end if;
      v_new_name := (select v.name from public.venues v where v.id = new.local_venue_id);
      perform public.log_audit_with_context(
        'store.venue_changed', 'store', new.id,
        jsonb_build_object(
          'title', new.title,
          'old_venue_id', old.local_venue_id,
          'old_venue_name', v_old_name,
          'new_venue_id', new.local_venue_id,
          'new_venue_name', v_new_name
        ),
        -- venue_id журнала — новое заведение. Удаляемое передавать нельзя:
        -- audit_logs.venue_id ссылается на venues.
        new.account_id, (select auth.uid()), new.local_venue_id, null
      );
    end if;
  exception
    -- Аккаунт или заведение удаляются в этой же транзакции: журнал писать
    -- некуда, а откатывать из-за него удаление нельзя (как в venues_audit_trigger).
    when foreign_key_violation then null;
  end;
  return new;
end;
$$;

revoke all on function public.stores_audit_trigger() from public, anon, authenticated;

drop trigger if exists stores_audit_trigger on public.stores;
create trigger stores_audit_trigger
  after update on public.stores
  for each row
  when (old.local_venue_id is distinct from new.local_venue_id
        or old.archived_at is distinct from new.archived_at)
  execute function public.stores_audit_trigger();

-- ── RPC: смена заведения клиентом пользователя ─────────────────────────────
-- authenticated не имеет UPDATE на stores (только SELECT), поэтому единственный
-- пользовательский путь — эта функция. Повтор с тем же значением ничего не
-- меняет и в журнал не пишет.
create or replace function public.set_store_venue(p_store_id uuid, p_venue_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  a uuid := public.get_active_account_id();
  v_current uuid;
begin
  if (select auth.uid()) is null or a is null or not public.has_permission('inventory.manage_stores') then
    raise exception 'Недостаточно прав для привязки склада к заведению';
  end if;
  select s.local_venue_id into v_current
    from public.stores s where s.id = p_store_id and s.account_id = a for update;
  if not found then raise exception 'Склад не найден'; end if;
  if p_venue_id is not distinct from v_current then return p_store_id; end if;
  if p_venue_id is not null then
    if not exists (select 1 from public.venues v where v.id = p_venue_id and v.account_id = a) then
      raise exception 'Заведение не найдено';
    end if;
    if exists (select 1 from public.venues v where v.id = p_venue_id and v.archived_at is not null) then
      raise exception 'Заведение в архиве: выберите другое';
    end if;
  end if;
  update public.stores set local_venue_id = p_venue_id
   where id = p_store_id and account_id = a;
  return p_store_id;
end;
$$;

revoke all on function public.set_store_venue(uuid, uuid) from public, anon, service_role;
grant execute on function public.set_store_venue(uuid, uuid) to authenticated;

-- ── RPC: архив и возврат ───────────────────────────────────────────────────
create or replace function public.set_store_archived(p_store_id uuid, p_archived boolean)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  a uuid := public.get_active_account_id();
begin
  if (select auth.uid()) is null or a is null or not public.has_permission('inventory.manage_stores') then
    raise exception 'Недостаточно прав для архивации склада';
  end if;
  if p_archived is null then raise exception 'Не указано действие'; end if;
  perform 1 from public.stores where id = p_store_id and account_id = a for update;
  if not found then raise exception 'Склад не найден'; end if;
  update public.stores
     set archived_at = case when p_archived then now() end,
         archived_by = case when p_archived then (select auth.uid()) end
   where id = p_store_id and account_id = a
     and (archived_at is not null) is distinct from p_archived;
  return p_store_id;
end;
$$;

revoke all on function public.set_store_archived(uuid, boolean) from public, anon, service_role;
grant execute on function public.set_store_archived(uuid, boolean) to authenticated;

-- ── Статистика актов по складам ────────────────────────────────────────────
-- SECURITY DEFINER: справочник складов аккаунтный (manage_stores видит все
-- склады), а акты под RLS видны по заведениям. Наружу уходят только число и
-- дата — ни сумм, ни людей.
create or replace function public.store_act_stats()
returns table (store_id uuid, acts_count bigint, last_act_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select d.store_id, count(*), max(d.invoice_date)
    from public.documents d
   where d.account_id = (select public.get_active_account_id())
     and d.store_id is not null
     and d.document_kind = 'inventory'
     and (select public.has_permission('inventory.view_stores'))
   group by d.store_id;
$$;

revoke all on function public.store_act_stats() from public, anon, service_role;
grant execute on function public.store_act_stats() to authenticated;

-- ── Проверки ──────────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.set_store_venue(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public.set_store_archived(uuid, boolean)', 'execute')
     or has_function_privilege('anon', 'public.store_act_stats()', 'execute')
     or has_function_privilege('authenticated', 'public.stores_audit_trigger()', 'execute') then
    raise exception '365: лишние права на функции складов';
  end if;
  if not has_function_privilege('authenticated', 'public.set_store_venue(uuid, uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.set_store_archived(uuid, boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.store_act_stats()', 'execute') then
    raise exception '365: authenticated не может вызвать функции складов';
  end if;
  if not has_column_privilege('authenticated', 'public.stores', 'archived_at', 'select') then
    raise exception '365: authenticated не читает stores.archived_at';
  end if;
end;
$$;

commit;
