alter table public.kb_collection_views
  add column sorts_json jsonb not null default '[]'::jsonb,
  add constraint kb_collection_views_sorts_array
    check (jsonb_typeof(sorts_json) = 'array');

comment on column public.kb_collection_views.sorts_json is
  'Per-view collection sorts. Shape is validated in TypeScript.';
