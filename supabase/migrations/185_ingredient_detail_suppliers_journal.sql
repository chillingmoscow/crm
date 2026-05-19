-- ============================================================
-- 185_ingredient_detail_suppliers_journal.sql
-- Этап 1 разведения «Номенклатура» vs «Документы».
-- Аддитивно: локальное поле описания на inventory_products,
-- связка ингредиент↔поставщик (counterparties), журнал событий.
-- Структуру inventory_products не меняем (переименование — Этап 4).
-- ============================================================

-- 1.1 Локальное редактируемое поле (не из QuickResto; sync его не трогает,
--     т.к. upsert задаёт явный набор QR-колонок без local_*).
alter table public.inventory_products
  add column if not exists local_description text;

comment on column public.inventory_products.local_description is
  'Локальное редактируемое описание/комментарий. НЕ синхронизируется из '
  'QuickResto: upsert при синке задаёт только QR-колонки.';

-- 1.2 Связка ингредиент ↔ контрагент-поставщик (M2M).
create table public.ingredient_suppliers (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  ingredient_id   uuid not null,
  counterparty_id uuid not null,
  supplier_article text,
  supplier_price   numeric,
  is_preferred     boolean not null default false,
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint ingredient_suppliers_account_id_id_key unique (account_id, id),
  constraint ingredient_suppliers_unique
    unique (account_id, ingredient_id, counterparty_id),
  constraint ingredient_suppliers_ingredient_fkey
    foreign key (account_id, ingredient_id)
    references public.inventory_products(account_id, id)
    on delete cascade,
  constraint ingredient_suppliers_counterparty_fkey
    foreign key (account_id, counterparty_id)
    references public.counterparties(account_id, id)
    on delete cascade
);

-- Композитные индексы под композитные FK (cascade-delete покрытие).
create index ingredient_suppliers_ingredient_idx
  on public.ingredient_suppliers(account_id, ingredient_id);
create index ingredient_suppliers_counterparty_idx
  on public.ingredient_suppliers(account_id, counterparty_id);

-- 1.3 Журнал событий позиции номенклатуры.
create table public.ingredient_journal (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  ingredient_id uuid not null,
  event_type    text not null,
  payload       jsonb not null default '{}'::jsonb,
  actor_id      uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint ingredient_journal_event_type_check
    check (event_type in (
      'synced',
      'description_updated',
      'photo_updated',
      'supplier_added',
      'supplier_updated',
      'supplier_removed'
    )),
  constraint ingredient_journal_ingredient_fkey
    foreign key (account_id, ingredient_id)
    references public.inventory_products(account_id, id)
    on delete cascade
);

create index ingredient_journal_ingredient_idx
  on public.ingredient_journal(account_id, ingredient_id, created_at desc);

-- touch updated_at: переиспользуем существующую public.tg_inventory_touch_updated
-- (создана в 122_quickresto_inventory.sql).
create trigger trg_ingredient_suppliers_touch_updated
  before update on public.ingredient_suppliers
  for each row execute function public.tg_inventory_touch_updated();

-- ============================================================
-- RLS. Паттерн по 122; права переиспользуем
-- (inventory.view_products / inventory.manage_products).
-- get_active_account_id()/has_permission() — stable, без InitPlan-обёртки
-- (прямых auth.uid()/current_setting в политиках нет).
-- Одиночные permissive-политики на (role, action): select отдельно,
-- мутации разнесены FOR INSERT/UPDATE/DELETE, чтобы не пересекаться с select.
-- ============================================================

alter table public.ingredient_suppliers enable row level security;
alter table public.ingredient_journal  enable row level security;

create policy "ingredient_suppliers_select"
  on public.ingredient_suppliers for select
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.view_products')
  );

create policy "ingredient_suppliers_insert"
  on public.ingredient_suppliers for insert
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.manage_products')
  );

create policy "ingredient_suppliers_update"
  on public.ingredient_suppliers for update
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.manage_products')
  )
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.manage_products')
  );

create policy "ingredient_suppliers_delete"
  on public.ingredient_suppliers for delete
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.manage_products')
  );

create policy "ingredient_journal_select"
  on public.ingredient_journal for select
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.view_products')
  );

create policy "ingredient_journal_insert"
  on public.ingredient_journal for insert
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.manage_products')
  );

create policy "ingredient_journal_update"
  on public.ingredient_journal for update
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.manage_products')
  )
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.manage_products')
  );

create policy "ingredient_journal_delete"
  on public.ingredient_journal for delete
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.manage_products')
  );

revoke all
  on public.ingredient_suppliers,
     public.ingredient_journal
  from anon, authenticated;

grant select
  on public.ingredient_suppliers,
     public.ingredient_journal
  to authenticated;

grant select, insert, update, delete
  on public.ingredient_suppliers,
     public.ingredient_journal
  to service_role;
