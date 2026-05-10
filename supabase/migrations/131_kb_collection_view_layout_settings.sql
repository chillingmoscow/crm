alter table public.kb_collection_views
  add column if not exists layout_settings_json jsonb not null default '{}'::jsonb,
  add constraint kb_collection_views_layout_settings_object
    check (jsonb_typeof(layout_settings_json) = 'object');

comment on column public.kb_collection_views.layout_settings_json is
  'Per-view layout toggles such as page icon, vertical lines, wrapping and data source title visibility.';
