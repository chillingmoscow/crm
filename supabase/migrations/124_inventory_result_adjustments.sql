-- ============================================================
-- 124_inventory_result_adjustments.sql
-- Management layer for inventory results: resort, exclusions,
-- comments, finalization and suggestion settings.
-- ============================================================

alter table public.accounts
  add column if not exists inventory_ai_suggestions_enabled boolean not null default false;

comment on column public.accounts.inventory_ai_suggestions_enabled is
  'Enable opt-in AI suggestions for inventory resort candidates. Suggestions are never applied automatically.';

alter table public.inventory_documents
  add column if not exists results_finalized_at timestamptz,
  add column if not exists results_finalized_by uuid references public.profiles(id) on delete set null,
  add column if not exists results_reopened_at timestamptz,
  add column if not exists results_reopened_by uuid references public.profiles(id) on delete set null;

alter table public.inventory_document_items
  add column if not exists result_comment text,
  add column if not exists result_comment_updated_by uuid references public.profiles(id) on delete set null,
  add column if not exists result_comment_updated_at timestamptz,
  add column if not exists excluded_from_totals boolean not null default false,
  add column if not exists exclude_reason text,
  add column if not exists excluded_by uuid references public.profiles(id) on delete set null,
  add column if not exists excluded_at timestamptz;

create table if not exists public.inventory_result_resorts (
  id                          uuid primary key default gen_random_uuid(),
  account_id                  uuid not null references public.accounts(id) on delete cascade,
  document_id                 uuid not null references public.inventory_documents(id) on delete cascade,
  group_id                    uuid references public.inventory_product_groups(id) on delete set null,
  group_name                  text,
  measure_unit_key            text not null,
  reason                      text not null,
  status                      text not null default 'active'
                                check (status in ('active', 'voided')),
  offset_amount               numeric not null default 0,
  residual_shortfall_sum      numeric not null default 0,
  residual_surplus_sum        numeric not null default 0,
  source_shortfall_sum        numeric not null default 0,
  source_surplus_sum          numeric not null default 0,
  suggestion_source           text not null default 'manual'
                                check (suggestion_source in ('manual', 'history', 'ai')),
  suggestion_confidence       numeric,
  created_by                  uuid references public.profiles(id) on delete set null,
  created_at                  timestamptz not null default now(),
  voided_by                   uuid references public.profiles(id) on delete set null,
  voided_at                   timestamptz,
  void_reason                 text,
  metadata                    jsonb not null default '{}'::jsonb,
  constraint inventory_result_resorts_account_id_id_key unique (account_id, id),
  constraint inventory_result_resorts_document_tenant_fkey
    foreign key (account_id, document_id)
    references public.inventory_documents(account_id, id)
    on delete cascade
);

create table if not exists public.inventory_result_resort_items (
  id                           uuid primary key default gen_random_uuid(),
  account_id                   uuid not null references public.accounts(id) on delete cascade,
  resort_id                    uuid not null references public.inventory_result_resorts(id) on delete cascade,
  document_id                  uuid not null references public.inventory_documents(id) on delete cascade,
  document_item_id             uuid not null references public.inventory_document_items(id) on delete cascade,
  inventory_product_id         uuid references public.inventory_products(id) on delete set null,
  external_product_id          text,
  product_name                 text not null,
  role                         text not null check (role in ('shortage', 'surplus')),
  source_difference_amount     numeric not null default 0,
  source_difference_sum        numeric not null default 0,
  offset_amount                numeric not null default 0,
  remaining_difference_amount  numeric not null default 0,
  remaining_difference_sum     numeric not null default 0,
  snapshot                     jsonb not null default '{}'::jsonb,
  created_at                   timestamptz not null default now(),
  constraint inventory_result_resort_items_unique unique (resort_id, document_item_id),
  constraint inventory_result_resort_items_resort_tenant_fkey
    foreign key (account_id, resort_id)
    references public.inventory_result_resorts(account_id, id)
    on delete cascade,
  constraint inventory_result_resort_items_document_tenant_fkey
    foreign key (account_id, document_id)
    references public.inventory_documents(account_id, id)
    on delete cascade
);

create table if not exists public.inventory_result_events (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  document_id      uuid not null references public.inventory_documents(id) on delete cascade,
  document_item_id uuid references public.inventory_document_items(id) on delete set null,
  resort_id        uuid references public.inventory_result_resorts(id) on delete set null,
  event_type       text not null check (
    event_type in (
      'comment_updated',
      'exclude_enabled',
      'exclude_disabled',
      'resort_created',
      'resort_voided',
      'results_finalized',
      'results_reopened',
      'results_refreshed',
      'suggestion_applied',
      'suggestion_dismissed'
    )
  ),
  message          text not null,
  payload          jsonb not null default '{}'::jsonb,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint inventory_result_events_document_tenant_fkey
    foreign key (account_id, document_id)
    references public.inventory_documents(account_id, id)
    on delete cascade
);

create index if not exists inventory_result_resorts_document_idx
  on public.inventory_result_resorts(document_id, status, created_at desc);
create index if not exists inventory_result_resort_items_document_idx
  on public.inventory_result_resort_items(document_id, document_item_id);
create index if not exists inventory_result_resort_items_product_idx
  on public.inventory_result_resort_items(account_id, inventory_product_id)
  where inventory_product_id is not null;
create index if not exists inventory_result_events_document_idx
  on public.inventory_result_events(document_id, created_at desc);
create index if not exists inventory_document_items_result_flags_idx
  on public.inventory_document_items(document_id)
  where excluded_from_totals = true or result_comment is not null;

insert into public.permissions (id, code, description, module) values
  ('10000000-0000-0000-0000-000000000089', 'inventory.comment_results',      'Комментировать результаты инвентаризации',             'inventory'),
  ('10000000-0000-0000-0000-000000000090', 'inventory.adjust_results',       'Делать пересорт и исключать строки из итогов',         'inventory'),
  ('10000000-0000-0000-0000-000000000091', 'inventory.finalize_results',     'Финализировать и переоткрывать итоги инвентаризации',  'inventory'),
  ('10000000-0000-0000-0000-000000000092', 'inventory.use_ai_suggestions',   'Использовать AI-подсказки пересорта',                  'inventory')
on conflict (id) do nothing;

insert into public.role_permissions (role_id, permission_id, granted)
select r.id, p.id, true
from public.roles r
join public.permissions p
  on p.code in (
    'inventory.comment_results',
    'inventory.adjust_results',
    'inventory.finalize_results',
    'inventory.use_ai_suggestions'
  )
where r.code in ('owner', 'admin', 'manager')
on conflict (role_id, permission_id) do update set granted = excluded.granted;

alter table public.inventory_result_resorts enable row level security;
alter table public.inventory_result_resort_items enable row level security;
alter table public.inventory_result_events enable row level security;

create policy "inventory_result_resorts_select"
  on public.inventory_result_resorts for select
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.view_results')
  );

create policy "inventory_result_resorts_write"
  on public.inventory_result_resorts for all
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.adjust_results')
  )
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.adjust_results')
  );

create policy "inventory_result_resort_items_select"
  on public.inventory_result_resort_items for select
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.view_results')
  );

create policy "inventory_result_resort_items_write"
  on public.inventory_result_resort_items for all
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.adjust_results')
  )
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.adjust_results')
  );

create policy "inventory_result_events_select"
  on public.inventory_result_events for select
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.view_results')
  );

create policy "inventory_result_events_insert"
  on public.inventory_result_events for insert
  with check (
    account_id = public.get_active_account_id()
    and (
      public.has_permission('inventory.comment_results')
      or public.has_permission('inventory.adjust_results')
      or public.has_permission('inventory.finalize_results')
    )
  );

revoke all
  on public.inventory_result_resorts,
     public.inventory_result_resort_items,
     public.inventory_result_events
  from anon, authenticated;

grant select, insert
  on public.inventory_result_events
  to authenticated;

grant select, insert, update, delete
  on public.inventory_result_resorts,
     public.inventory_result_resort_items
  to authenticated;

grant select, insert, update, delete
  on public.inventory_result_resorts,
     public.inventory_result_resort_items,
     public.inventory_result_events
  to service_role;
