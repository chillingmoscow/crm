alter table public.kb_collection_views
  add column if not exists description text not null default '',
  add column if not exists column_widths_json jsonb not null default '{}'::jsonb,
  add constraint kb_collection_views_column_widths_object
    check (jsonb_typeof(column_widths_json) = 'object');

comment on column public.kb_collection_views.description is
  'Optional per-view description shown in collection view tabs.';

comment on column public.kb_collection_views.column_widths_json is
  'Per-view table column widths keyed by field id; __title stores the page/title column width.';
