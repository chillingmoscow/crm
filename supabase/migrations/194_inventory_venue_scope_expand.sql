-- ============================================================
-- 194_inventory_venue_scope_expand.sql
-- Venue-scoping инвентаря — Pass 1 (expand, аддитивно, без RLS).
-- Зеркало finance-паттерна (миграции 034 + 042).
--
--  - Право inventory.view_all_venues (по умолчанию только роль owner;
--    остальным выдаётся вручную через управление ролями).
--  - Денормализованный documents.venue_id (из store.local_venue_id),
--    бэкфилл, индекс, триггер-консистентность.
--  - stores: venue уже = local_venue_id (новой колонки не вводим).
--  - document_items: без колонки (наследует через join к documents).
--
-- RLS НЕ трогаем здесь — смена политик в Pass 2 (документы.venue_id
-- уже будет на проде → нет рассинхрона код↔БД).
-- ============================================================

-- 1. Право «видеть инвентарь всех заведений» (id — следующий
--    свободный в ОБЩЕМ id-пространстве permissions после ...093
--    (kb.view_version_history); пространство сквозное, не по модулю).
insert into public.permissions (id, code, description, module) values
  ('10000000-0000-0000-0000-000000000094',
   'inventory.view_all_venues',
   'Видеть инвентарь всех заведений одновременно',
   'inventory')
on conflict (id) do nothing;

-- По умолчанию выдаём только владельцу. Остальным ролям —
-- вручную через управление ролями (право grantable, не дефолтное).
insert into public.role_permissions (role_id, permission_id, granted)
select r.id, p.id, true
from public.roles r
join public.permissions p on p.code = 'inventory.view_all_venues'
where r.code = 'owner'
on conflict (role_id, permission_id) do update set granted = excluded.granted;

-- 2. Денормализованный venue_id на documents (источник —
--    store.local_venue_id). Аддитивно, nullable.
alter table public.documents
  add column if not exists venue_id uuid
    references public.venues(id) on delete set null;

create index if not exists documents_account_venue_idx
  on public.documents(account_id, venue_id);

-- Бэкфилл существующих документов из их склада.
update public.documents d
set venue_id = s.local_venue_id
from public.stores s
where s.id = d.store_id
  and d.venue_id is null
  and s.local_venue_id is not null;

-- 3. Триггер-консистентность: venue_id документа всегда = venue его
--    склада. (Смена venue у склада — bulk-update в
--    updateInventoryStoreVenue, см. inventory/actions.ts.)
create or replace function public.tg_documents_set_venue_from_store()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.store_id is null then
    new.venue_id := null;
  else
    new.venue_id := (
      select s.local_venue_id from public.stores s where s.id = new.store_id
    );
  end if;
  return new;
end;
$$;

create trigger trg_documents_set_venue_from_store
  before insert or update of store_id on public.documents
  for each row execute function public.tg_documents_set_venue_from_store();

-- 4. inventory.view_all_venues — НЕ дефолтное право (как finance.view_all_venues:
--    грантится явно, не модульным авто-триггером). Триггер
--    apply_default_inventory_permissions_to_role() (миграция 175) грантит
--    ВСЕ module='inventory' права новым custom_admin/custom_manager —
--    исключаем из него этот код. SET search_path/security definer
--    обязаны быть в новом определении (OR REPLACE сбрасывает атрибуты,
--    memory feedback_create_or_replace_search_path).
create or replace function public.apply_default_inventory_permissions_to_role()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.code in ('custom_manager', 'custom_admin') then
    insert into public.role_permissions (role_id, permission_id, granted)
    select new.id, p.id, true
    from public.permissions p
    where p.module = 'inventory'
      and p.code <> 'inventory.view_all_venues'
    on conflict (role_id, permission_id)
    do update set granted = excluded.granted;
  elsif new.code in ('custom_hostess', 'custom_waiter') then
    insert into public.role_permissions (role_id, permission_id, granted)
    select new.id, p.id, true
    from public.permissions p
    where p.code = 'inventory.fill_assigned_documents'
    on conflict (role_id, permission_id)
    do update set granted = excluded.granted;
  end if;

  return new;
end;
$$;
revoke all on function public.apply_default_inventory_permissions_to_role() from public;

-- Снять авто-применённые не-owner гранты (на момент миграции дефолт =
-- только owner; будущие ручные гранты через управление ролями
-- сохраняются — триггер срабатывает лишь при создании роли).
delete from public.role_permissions rp
using public.permissions p, public.roles r
where rp.permission_id = p.id
  and rp.role_id = r.id
  and p.code = 'inventory.view_all_venues'
  and r.code <> 'owner';
