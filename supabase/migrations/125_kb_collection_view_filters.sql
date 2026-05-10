-- ============================================================
-- 125_kb_collection_view_filters.sql
-- Per-view filter settings for KB collections.
-- ============================================================

alter table public.kb_collection_views
  add column filters_json jsonb not null default '[]'::jsonb,
  add constraint kb_collection_views_filters_array
    check (jsonb_typeof(filters_json) = 'array');

comment on column public.kb_collection_views.filters_json is
  'Per-view collection filters. Shape is validated in TypeScript.';
