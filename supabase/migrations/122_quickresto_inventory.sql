-- ============================================================
-- 122_quickresto_inventory.sql
-- Local inventory foundation with Quick Resto sync links.
-- ============================================================

create type public.inventory_document_status_enum as enum (
  'synced',
  'assigned',
  'in_progress',
  'ready_for_review',
  'processed',
  'results_blocked',
  'sync_error'
);

alter table public.external_entity_links
  drop constraint if exists external_entity_links_entity_type_check;

alter table public.external_entity_links
  add constraint external_entity_links_entity_type_check
  check (
    entity_type in (
      'venue',
      'role',
      'staff',
      'ingredient',
      'ingredient_group',
      'store',
      'inventory_document'
    )
  );

create table public.inventory_product_groups (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  external_id        text not null,
  name               text not null,
  item_title         text,
  parent_external_id text,
  parent_group_id    uuid references public.inventory_product_groups(id) on delete set null,
  primary_image_file_id uuid references public.account_files(id) on delete set null,
  raw_payload        jsonb not null default '{}'::jsonb,
  synced_at          timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint inventory_product_groups_external_unique unique (account_id, external_id)
);

create table public.inventory_products (
  id                     uuid primary key default gen_random_uuid(),
  account_id             uuid not null references public.accounts(id) on delete cascade,
  external_id            text not null,
  external_version       integer,
  name                   text not null,
  item_title             text,
  article                text,
  barcode                text,
  measure_unit_id        integer,
  measure_unit_name      text,
  measure_unit_full_name text,
  measure_unit_code      text,
  ratio                  numeric,
  group_id               uuid references public.inventory_product_groups(id) on delete set null,
  parent_external_id     text,
  tags                   jsonb not null default '[]'::jsonb,
  current_prime_cost     numeric,
  store_quantity_kg      numeric,
  stock_limit            numeric,
  primary_image_file_id  uuid references public.account_files(id) on delete set null,
  raw_payload            jsonb not null default '{}'::jsonb,
  synced_at              timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint inventory_products_external_unique unique (account_id, external_id)
);

create table public.inventory_stores (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts(id) on delete cascade,
  external_id    text not null,
  title          text not null,
  store_code     text,
  description    text,
  local_venue_id uuid references public.venues(id) on delete set null,
  raw_payload    jsonb not null default '{}'::jsonb,
  synced_at      timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint inventory_stores_external_unique unique (account_id, external_id)
);

create table public.inventory_documents (
  id                       uuid primary key default gen_random_uuid(),
  account_id               uuid not null references public.accounts(id) on delete cascade,
  external_id              text not null,
  document_number          text not null,
  invoice_date             timestamptz,
  store_id                 uuid references public.inventory_stores(id) on delete set null,
  external_store_id        text,
  assigned_to              uuid references public.profiles(id) on delete set null,
  status                   public.inventory_document_status_enum not null default 'synced',
  processed                boolean not null default false,
  base_last_update_date    timestamptz,
  last_qr_update_date      timestamptz,
  shortfall_sum            numeric,
  surplus_sum              numeric,
  results_has_line_amounts boolean not null default false,
  comment                  text,
  qr_payload               jsonb not null default '{}'::jsonb,
  synced_at                timestamptz not null default now(),
  submitted_at             timestamptz,
  submitted_by             uuid references public.profiles(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint inventory_documents_external_unique unique (account_id, external_id)
);

alter table public.inventory_product_groups
  add constraint inventory_product_groups_account_id_id_key unique (account_id, id);
alter table public.inventory_products
  add constraint inventory_products_account_id_id_key unique (account_id, id);
alter table public.inventory_stores
  add constraint inventory_stores_account_id_id_key unique (account_id, id);
alter table public.inventory_documents
  add constraint inventory_documents_account_id_id_key unique (account_id, id);

create table public.inventory_document_items (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references public.accounts(id) on delete cascade,
  document_id          uuid not null references public.inventory_documents(id) on delete cascade,
  external_item_id     text not null,
  inventory_product_id uuid references public.inventory_products(id) on delete set null,
  external_product_id  text,
  product_name         text not null,
  article              text,
  barcode              text,
  measure_unit_id      integer,
  measure_unit_name    text,
  actual_amount        numeric,
  submitted_amount     numeric,
  calculated_amount    numeric,
  difference_amount    numeric,
  prime_cost           numeric,
  difference_sum       numeric,
  sort_order           integer not null default 0,
  raw_payload          jsonb not null default '{}'::jsonb,
  result_payload       jsonb not null default '{}'::jsonb,
  updated_at           timestamptz not null default now(),
  constraint inventory_document_items_unique unique (document_id, external_item_id),
  constraint inventory_document_items_document_tenant_fkey
    foreign key (account_id, document_id)
    references public.inventory_documents(account_id, id)
    on delete cascade
);

create index inventory_product_groups_account_idx on public.inventory_product_groups(account_id);
create index inventory_product_groups_image_idx on public.inventory_product_groups(primary_image_file_id) where primary_image_file_id is not null;
create index inventory_products_account_idx on public.inventory_products(account_id);
create index inventory_products_group_idx on public.inventory_products(group_id);
create index inventory_products_image_idx on public.inventory_products(primary_image_file_id) where primary_image_file_id is not null;
create index inventory_stores_account_idx on public.inventory_stores(account_id);
create index inventory_documents_account_idx on public.inventory_documents(account_id);
create index inventory_documents_assigned_idx on public.inventory_documents(assigned_to) where assigned_to is not null;
create index inventory_documents_status_idx on public.inventory_documents(account_id, status);
create index inventory_document_items_document_idx on public.inventory_document_items(document_id, sort_order);
create index inventory_document_items_product_idx on public.inventory_document_items(inventory_product_id) where inventory_product_id is not null;

create or replace function public.tg_inventory_touch_updated()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_inventory_product_groups_touch_updated
  before update on public.inventory_product_groups
  for each row execute function public.tg_inventory_touch_updated();

create trigger trg_inventory_products_touch_updated
  before update on public.inventory_products
  for each row execute function public.tg_inventory_touch_updated();

create trigger trg_inventory_stores_touch_updated
  before update on public.inventory_stores
  for each row execute function public.tg_inventory_touch_updated();

create trigger trg_inventory_documents_touch_updated
  before update on public.inventory_documents
  for each row execute function public.tg_inventory_touch_updated();

create or replace function public.tg_inventory_item_touch_updated()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_inventory_document_items_touch_updated
  before update on public.inventory_document_items
  for each row execute function public.tg_inventory_item_touch_updated();

insert into public.permissions (id, code, description, module) values
  ('10000000-0000-0000-0000-000000000080', 'inventory.view_products',          'Видеть складские позиции',                         'inventory'),
  ('10000000-0000-0000-0000-000000000081', 'inventory.manage_products',        'Редактировать складские позиции и фото',           'inventory'),
  ('10000000-0000-0000-0000-000000000082', 'inventory.view_stores',            'Видеть склады инвентаризации',                     'inventory'),
  ('10000000-0000-0000-0000-000000000083', 'inventory.manage_stores',          'Связывать склады с заведениями',                   'inventory'),
  ('10000000-0000-0000-0000-000000000084', 'inventory.view_documents',         'Видеть акты инвентаризации',                       'inventory'),
  ('10000000-0000-0000-0000-000000000085', 'inventory.manage_documents',       'Назначать и управлять актами инвентаризации',      'inventory'),
  ('10000000-0000-0000-0000-000000000086', 'inventory.fill_assigned_documents','Заполнять назначенные акты инвентаризации',        'inventory'),
  ('10000000-0000-0000-0000-000000000087', 'inventory.view_results',           'Видеть результаты инвентаризации',                 'inventory'),
  ('10000000-0000-0000-0000-000000000088', 'inventory.sync_quickresto',        'Синхронизировать инвентаризацию с Quick Resto',    'inventory')
on conflict (id) do nothing;

insert into public.role_permissions (role_id, permission_id, granted)
select r.id, p.id, true
from public.roles r
join public.permissions p on p.module = 'inventory'
where r.code in ('owner', 'admin', 'manager')
on conflict (role_id, permission_id) do update set granted = excluded.granted;

insert into public.role_permissions (role_id, permission_id, granted)
select r.id, p.id, true
from public.roles r
join public.permissions p on p.code = 'inventory.fill_assigned_documents'
where r.code in ('hostess', 'waiter')
on conflict (role_id, permission_id) do update set granted = excluded.granted;

alter table public.inventory_product_groups enable row level security;
alter table public.inventory_products enable row level security;
alter table public.inventory_stores enable row level security;
alter table public.inventory_documents enable row level security;
alter table public.inventory_document_items enable row level security;

create policy "inventory_product_groups_select"
  on public.inventory_product_groups for select
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.view_products')
  );

create policy "inventory_product_groups_write"
  on public.inventory_product_groups for all
  using (account_id = public.get_active_account_id() and public.has_permission('inventory.manage_products'))
  with check (account_id = public.get_active_account_id() and public.has_permission('inventory.manage_products'));

create policy "inventory_products_select"
  on public.inventory_products for select
  using (
    account_id = public.get_active_account_id()
    and (
      public.has_permission('inventory.view_products')
      or exists (
        select 1
        from public.inventory_document_items idi
        join public.inventory_documents d on d.id = idi.document_id
        where idi.inventory_product_id = inventory_products.id
          and d.assigned_to = auth.uid()
          and public.has_permission('inventory.fill_assigned_documents')
      )
    )
  );

create policy "inventory_products_write"
  on public.inventory_products for all
  using (account_id = public.get_active_account_id() and public.has_permission('inventory.manage_products'))
  with check (account_id = public.get_active_account_id() and public.has_permission('inventory.manage_products'));

create policy "inventory_stores_select"
  on public.inventory_stores for select
  using (
    account_id = public.get_active_account_id()
    and (
      public.has_permission('inventory.view_stores')
      or public.has_permission('inventory.view_documents')
      or exists (
        select 1
        from public.inventory_documents d
        where d.store_id = inventory_stores.id
          and d.assigned_to = auth.uid()
          and public.has_permission('inventory.fill_assigned_documents')
      )
    )
  );

create policy "inventory_stores_write"
  on public.inventory_stores for all
  using (account_id = public.get_active_account_id() and public.has_permission('inventory.manage_stores'))
  with check (account_id = public.get_active_account_id() and public.has_permission('inventory.manage_stores'));

create policy "inventory_documents_select"
  on public.inventory_documents for select
  using (
    account_id = public.get_active_account_id()
    and (
      public.has_permission('inventory.view_documents')
      or (
        assigned_to = auth.uid()
        and public.has_permission('inventory.fill_assigned_documents')
      )
    )
  );

create policy "inventory_documents_insert"
  on public.inventory_documents for insert
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.manage_documents')
  );

create policy "inventory_documents_update_manage"
  on public.inventory_documents for update
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.manage_documents')
  )
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.manage_documents')
  );

create policy "inventory_documents_delete"
  on public.inventory_documents for delete
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.manage_documents')
  );

create policy "inventory_document_items_select"
  on public.inventory_document_items for select
  using (
    exists (
      select 1
      from public.inventory_documents d
      where d.id = inventory_document_items.document_id
        and d.account_id = public.get_active_account_id()
        and (
          public.has_permission('inventory.view_documents')
          or (
            d.assigned_to = auth.uid()
            and public.has_permission('inventory.fill_assigned_documents')
          )
        )
    )
  );

create policy "inventory_document_items_write_manage"
  on public.inventory_document_items for all
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.manage_documents')
  )
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.manage_documents')
  );

drop policy if exists "account_files_select" on public.account_files;
create policy "account_files_select"
  on public.account_files for select
  using (
    account_id = public.get_active_account_id()
    and (
      exists (
        select 1 from public.transaction_attachments ta
        join public.transactions t on t.id = ta.transaction_id
        where ta.file_id = account_files.id
          and t.account_id = public.get_active_account_id()
          and public.has_permission('finance.view_attachments')
      )
      or exists (
        select 1 from public.counterparty_attachments ca
        join public.counterparties c on c.id = ca.counterparty_id
        where ca.file_id = account_files.id
          and c.account_id = public.get_active_account_id()
          and public.has_permission('finance.view_attachments')
      )
      or exists (
        select 1 from public.legal_entity_attachments la
        join public.legal_entities le on le.id = la.legal_entity_id
        where la.file_id = account_files.id
          and le.account_id = public.get_active_account_id()
          and public.has_permission('org.view_legal_entities')
      )
      or exists (
        select 1 from public.inventory_product_groups ipg
        where ipg.primary_image_file_id = account_files.id
          and ipg.account_id = public.get_active_account_id()
          and public.has_permission('inventory.view_products')
      )
      or exists (
        select 1 from public.inventory_products ip
        where ip.primary_image_file_id = account_files.id
          and ip.account_id = public.get_active_account_id()
          and public.has_permission('inventory.view_products')
      )
      or exists (
        select 1
        from public.inventory_products ip
        join public.inventory_document_items idi on idi.inventory_product_id = ip.id
        join public.inventory_documents d on d.id = idi.document_id
        where ip.primary_image_file_id = account_files.id
          and ip.account_id = public.get_active_account_id()
          and d.assigned_to = auth.uid()
          and public.has_permission('inventory.fill_assigned_documents')
      )
      or uploaded_by = auth.uid()
    )
  );

revoke all
  on public.inventory_product_groups,
     public.inventory_products,
     public.inventory_stores,
     public.inventory_documents,
     public.inventory_document_items
  from anon, authenticated;

grant select
  on public.inventory_product_groups,
     public.inventory_products,
     public.inventory_stores,
     public.inventory_documents,
     public.inventory_document_items
  to authenticated;

grant select, insert, update, delete
  on public.inventory_product_groups,
     public.inventory_products,
     public.inventory_stores,
     public.inventory_documents,
     public.inventory_document_items
  to service_role;

grant usage on type public.inventory_document_status_enum to authenticated, service_role;
