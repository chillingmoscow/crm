-- ============================================================
-- 124_kb_collections_views.sql
-- KB collections: one page-owned collection with many persisted views.
-- ============================================================

create table public.kb_collections (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  page_id         uuid not null,
  collection_key  text not null,
  title           text not null default 'Коллекция',
  schema_json     jsonb not null default '{"version":1,"fields":[]}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz,
  created_by      uuid references public.profiles(id),
  updated_by      uuid references public.profiles(id),

  constraint kb_collections_account_id_unique unique (account_id, id),
  constraint kb_collections_account_page_unique unique (account_id, page_id),
  constraint kb_collections_account_key_unique unique (account_id, collection_key),
  constraint kb_collections_page_tenant_fkey
    foreign key (account_id, page_id)
    references public.kb_pages (account_id, id)
    on delete cascade,
  constraint kb_collections_key_not_blank check (length(btrim(collection_key)) > 0),
  constraint kb_collections_title_not_blank check (length(btrim(title)) > 0),
  constraint kb_collections_schema_object check (jsonb_typeof(schema_json) = 'object')
);

create table public.kb_collection_views (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts(id) on delete cascade,
  collection_id     uuid not null,
  name              text not null default 'Галерея',
  view_type         text not null default 'list',
  visible_field_ids jsonb,
  field_order_ids   jsonb,
  position          integer not null default 0,
  source_block_id   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz,
  created_by        uuid references public.profiles(id),
  updated_by        uuid references public.profiles(id),

  constraint kb_collection_views_collection_tenant_fkey
    foreign key (account_id, collection_id)
    references public.kb_collections (account_id, id)
    on delete cascade,
  constraint kb_collection_views_name_not_blank check (length(btrim(name)) > 0),
  constraint kb_collection_views_type_check check (view_type in ('list', 'table')),
  constraint kb_collection_views_visible_array_or_null
    check (visible_field_ids is null or jsonb_typeof(visible_field_ids) = 'array'),
  constraint kb_collection_views_order_array_or_null
    check (field_order_ids is null or jsonb_typeof(field_order_ids) = 'array')
);

create index kb_collections_page_idx
  on public.kb_collections(account_id, page_id);

create index kb_collection_views_collection_idx
  on public.kb_collection_views(account_id, collection_id, position);

create unique index kb_collection_views_source_block_unique
  on public.kb_collection_views(collection_id, source_block_id)
  where source_block_id is not null;

comment on table public.kb_collections is
  'Page-owned KB collection schema. One collection per KB page in v1.';

comment on table public.kb_collection_views is
  'Persisted KB collection views: layout type and per-view field visibility/order.';

create or replace function public.kb_collections_touch_updated()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger trg_kb_collections_touch_updated
  before update on public.kb_collections
  for each row execute function public.kb_collections_touch_updated();

create trigger trg_kb_collection_views_touch_updated
  before update on public.kb_collection_views
  for each row execute function public.kb_collections_touch_updated();

alter table public.kb_collections enable row level security;
alter table public.kb_collection_views enable row level security;

create policy "kb_collections_select"
  on public.kb_collections for select
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('kb.view_pages')
    and exists (
      select 1 from public.kb_pages p
      where p.account_id = kb_collections.account_id
        and p.id = kb_collections.page_id
        and p.deleted_at is null
    )
  );

create policy "kb_collections_insert"
  on public.kb_collections for insert
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('kb.view_pages')
    and exists (
      select 1 from public.kb_pages p
      where p.account_id = kb_collections.account_id
        and p.id = kb_collections.page_id
        and p.deleted_at is null
        and (
          public.has_permission('kb.edit_any_page')
          or (
            public.has_permission('kb.edit_own_pages')
            and p.created_by = auth.uid()
          )
        )
    )
  );

create policy "kb_collections_update"
  on public.kb_collections for update
  using (
    account_id = public.get_active_account_id()
    and exists (
      select 1 from public.kb_pages p
      where p.account_id = kb_collections.account_id
        and p.id = kb_collections.page_id
        and p.deleted_at is null
        and (
          public.has_permission('kb.edit_any_page')
          or (
            public.has_permission('kb.edit_own_pages')
            and p.created_by = auth.uid()
          )
        )
    )
  )
  with check (
    account_id = public.get_active_account_id()
    and exists (
      select 1 from public.kb_pages p
      where p.account_id = kb_collections.account_id
        and p.id = kb_collections.page_id
        and p.deleted_at is null
        and (
          public.has_permission('kb.edit_any_page')
          or (
            public.has_permission('kb.edit_own_pages')
            and p.created_by = auth.uid()
          )
        )
    )
  );

create policy "kb_collection_views_select"
  on public.kb_collection_views for select
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('kb.view_pages')
    and exists (
      select 1
      from public.kb_collections c
      join public.kb_pages p
        on p.account_id = c.account_id
       and p.id = c.page_id
      where c.account_id = kb_collection_views.account_id
        and c.id = kb_collection_views.collection_id
        and p.deleted_at is null
    )
  );

create policy "kb_collection_views_insert"
  on public.kb_collection_views for insert
  with check (
    account_id = public.get_active_account_id()
    and exists (
      select 1
      from public.kb_collections c
      join public.kb_pages p
        on p.account_id = c.account_id
       and p.id = c.page_id
      where c.account_id = kb_collection_views.account_id
        and c.id = kb_collection_views.collection_id
        and p.deleted_at is null
        and (
          public.has_permission('kb.edit_any_page')
          or (
            public.has_permission('kb.edit_own_pages')
            and p.created_by = auth.uid()
          )
        )
    )
  );

create policy "kb_collection_views_update"
  on public.kb_collection_views for update
  using (
    account_id = public.get_active_account_id()
    and exists (
      select 1
      from public.kb_collections c
      join public.kb_pages p
        on p.account_id = c.account_id
       and p.id = c.page_id
      where c.account_id = kb_collection_views.account_id
        and c.id = kb_collection_views.collection_id
        and p.deleted_at is null
        and (
          public.has_permission('kb.edit_any_page')
          or (
            public.has_permission('kb.edit_own_pages')
            and p.created_by = auth.uid()
          )
        )
    )
  )
  with check (
    account_id = public.get_active_account_id()
    and exists (
      select 1
      from public.kb_collections c
      join public.kb_pages p
        on p.account_id = c.account_id
       and p.id = c.page_id
      where c.account_id = kb_collection_views.account_id
        and c.id = kb_collection_views.collection_id
        and p.deleted_at is null
        and (
          public.has_permission('kb.edit_any_page')
          or (
            public.has_permission('kb.edit_own_pages')
            and p.created_by = auth.uid()
          )
        )
    )
  );

create policy "kb_collection_views_delete"
  on public.kb_collection_views for delete
  using (
    account_id = public.get_active_account_id()
    and exists (
      select 1
      from public.kb_collections c
      join public.kb_pages p
        on p.account_id = c.account_id
       and p.id = c.page_id
      where c.account_id = kb_collection_views.account_id
        and c.id = kb_collection_views.collection_id
        and p.deleted_at is null
        and (
          public.has_permission('kb.edit_any_page')
          or (
            public.has_permission('kb.edit_own_pages')
            and p.created_by = auth.uid()
          )
        )
    )
  );

grant select, insert, update, delete on
  public.kb_collections,
  public.kb_collection_views
to anon, authenticated;
