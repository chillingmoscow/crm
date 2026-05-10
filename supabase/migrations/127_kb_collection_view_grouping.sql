alter table public.kb_collection_views
  add column grouping_json jsonb not null default '{}'::jsonb,
  add constraint kb_collection_views_grouping_object
    check (jsonb_typeof(grouping_json) = 'object');

comment on column public.kb_collection_views.grouping_json is
  'Per-view collection grouping. Shape is validated in TypeScript.';
