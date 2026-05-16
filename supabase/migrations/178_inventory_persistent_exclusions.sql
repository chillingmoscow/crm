-- ============================================================
-- 178_inventory_persistent_exclusions.sql
-- Account-local rules for inventory rows that should be ignored
-- in current and future management totals.
-- ============================================================

alter table public.inventory_result_resorts
  alter column reason set default 'Ручной пересорт';

alter table public.inventory_result_events
  drop constraint if exists inventory_result_events_event_type_check;

alter table public.inventory_result_events
  add constraint inventory_result_events_event_type_check
  check (
    event_type in (
      'comment_updated',
      'exclude_enabled',
      'exclude_disabled',
      'persistent_exclusion_enabled',
      'persistent_exclusion_disabled',
      'resort_created',
      'resort_voided',
      'results_finalized',
      'results_reopened',
      'results_refreshed',
      'suggestion_applied',
      'suggestion_dismissed'
    )
  );

create table if not exists public.inventory_result_exclusion_rules (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references public.accounts(id) on delete cascade,
  inventory_product_id uuid references public.inventory_products(id) on delete cascade,
  external_product_id  text,
  product_name         text not null,
  reason               text,
  status               text not null default 'active'
                         check (status in ('active', 'deleted')),
  created_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  deleted_by           uuid references public.profiles(id) on delete set null,
  deleted_at           timestamptz,
  delete_reason        text,
  metadata             jsonb not null default '{}'::jsonb,
  constraint inventory_result_exclusion_rules_product_required
    check (inventory_product_id is not null or external_product_id is not null),
  constraint inventory_result_exclusion_rules_product_tenant_fkey
    foreign key (account_id, inventory_product_id)
    references public.inventory_products(account_id, id)
    on delete cascade
);

create unique index if not exists inventory_result_exclusion_rules_active_product_idx
  on public.inventory_result_exclusion_rules(account_id, inventory_product_id)
  where status = 'active' and inventory_product_id is not null;

create unique index if not exists inventory_result_exclusion_rules_active_external_idx
  on public.inventory_result_exclusion_rules(account_id, external_product_id)
  where status = 'active' and inventory_product_id is null and external_product_id is not null;

create index if not exists inventory_result_exclusion_rules_account_idx
  on public.inventory_result_exclusion_rules(account_id, status, created_at desc);

alter table public.inventory_result_exclusion_rules enable row level security;

create policy "inventory_result_exclusion_rules_select"
  on public.inventory_result_exclusion_rules for select
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.view_results')
  );

create policy "inventory_result_exclusion_rules_write"
  on public.inventory_result_exclusion_rules for all
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.adjust_results')
  )
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('inventory.adjust_results')
  );

revoke all on public.inventory_result_exclusion_rules from anon, authenticated;

grant select, insert, update, delete
  on public.inventory_result_exclusion_rules
  to authenticated;

grant select, insert, update, delete
  on public.inventory_result_exclusion_rules
  to service_role;
