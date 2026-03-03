-- ============================================================
-- 029_quickresto_integration.sql
-- Quick Resto integration storage and import tracking
-- ============================================================

create table if not exists public.integration_connections (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts(id) on delete cascade,
  provider          text not null,
  login             text not null,
  password_encrypted text not null,
  password_iv       text not null,
  password_tag      text not null,
  status            text not null default 'active' check (status in ('active', 'disabled')),
  last_tested_at    timestamptz,
  created_by        uuid not null references public.profiles(id) on delete restrict,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint integration_connections_provider_unique unique (account_id, provider)
);

create table if not exists public.external_entity_links (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  provider    text not null,
  entity_type text not null check (entity_type in ('venue', 'role', 'staff')),
  external_id text not null,
  local_table text not null,
  local_id    uuid not null,
  created_at  timestamptz not null default now(),
  constraint external_entity_links_unique unique (account_id, provider, entity_type, external_id)
);

create table if not exists public.integration_import_runs (
  id                          uuid primary key default gen_random_uuid(),
  account_id                  uuid not null references public.accounts(id) on delete cascade,
  provider                    text not null,
  selected_entities           text[] not null,
  selected_external_venue_ids text[] not null default '{}',
  status                      text not null check (status in ('running', 'success', 'partial', 'failed')),
  summary                     jsonb not null default '{}'::jsonb,
  error_text                  text,
  started_at                  timestamptz not null default now(),
  finished_at                 timestamptz,
  created_by                  uuid not null references public.profiles(id) on delete restrict
);

create table if not exists public.integration_external_snapshots (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  provider    text not null,
  entity_type text not null,
  external_id text not null,
  payload     jsonb not null,
  fetched_at  timestamptz not null default now(),
  constraint integration_external_snapshots_unique unique (account_id, provider, entity_type, external_id)
);

create index if not exists integration_connections_account_idx
  on public.integration_connections(account_id);
create index if not exists external_entity_links_account_idx
  on public.external_entity_links(account_id);
create index if not exists integration_import_runs_account_idx
  on public.integration_import_runs(account_id);
create index if not exists integration_external_snapshots_account_idx
  on public.integration_external_snapshots(account_id);

alter table public.integration_connections enable row level security;
alter table public.external_entity_links enable row level security;
alter table public.integration_import_runs enable row level security;
alter table public.integration_external_snapshots enable row level security;

create policy "integration_connections_owner_select"
  on public.integration_connections for select
  using (
    exists (
      select 1 from public.accounts a
      where a.id = integration_connections.account_id
        and a.owner_id = auth.uid()
    )
  );

create policy "integration_connections_owner_insert"
  on public.integration_connections for insert
  with check (
    exists (
      select 1 from public.accounts a
      where a.id = integration_connections.account_id
        and a.owner_id = auth.uid()
    )
  );

create policy "integration_connections_owner_update"
  on public.integration_connections for update
  using (
    exists (
      select 1 from public.accounts a
      where a.id = integration_connections.account_id
        and a.owner_id = auth.uid()
    )
  );

create policy "external_entity_links_owner_select"
  on public.external_entity_links for select
  using (
    exists (
      select 1 from public.accounts a
      where a.id = external_entity_links.account_id
        and a.owner_id = auth.uid()
    )
  );

create policy "external_entity_links_owner_insert"
  on public.external_entity_links for insert
  with check (
    exists (
      select 1 from public.accounts a
      where a.id = external_entity_links.account_id
        and a.owner_id = auth.uid()
    )
  );

create policy "external_entity_links_owner_update"
  on public.external_entity_links for update
  using (
    exists (
      select 1 from public.accounts a
      where a.id = external_entity_links.account_id
        and a.owner_id = auth.uid()
    )
  );

create policy "integration_import_runs_owner_select"
  on public.integration_import_runs for select
  using (
    exists (
      select 1 from public.accounts a
      where a.id = integration_import_runs.account_id
        and a.owner_id = auth.uid()
    )
  );

create policy "integration_import_runs_owner_insert"
  on public.integration_import_runs for insert
  with check (
    exists (
      select 1 from public.accounts a
      where a.id = integration_import_runs.account_id
        and a.owner_id = auth.uid()
    )
  );

create policy "integration_import_runs_owner_update"
  on public.integration_import_runs for update
  using (
    exists (
      select 1 from public.accounts a
      where a.id = integration_import_runs.account_id
        and a.owner_id = auth.uid()
    )
  );

create policy "integration_external_snapshots_owner_select"
  on public.integration_external_snapshots for select
  using (
    exists (
      select 1 from public.accounts a
      where a.id = integration_external_snapshots.account_id
        and a.owner_id = auth.uid()
    )
  );

create policy "integration_external_snapshots_owner_insert"
  on public.integration_external_snapshots for insert
  with check (
    exists (
      select 1 from public.accounts a
      where a.id = integration_external_snapshots.account_id
        and a.owner_id = auth.uid()
    )
  );

create policy "integration_external_snapshots_owner_update"
  on public.integration_external_snapshots for update
  using (
    exists (
      select 1 from public.accounts a
      where a.id = integration_external_snapshots.account_id
        and a.owner_id = auth.uid()
    )
  );
