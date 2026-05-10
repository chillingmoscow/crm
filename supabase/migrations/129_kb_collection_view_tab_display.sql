alter table public.kb_collection_views
  add column if not exists icon text,
  add column if not exists tab_display text not null default 'text-icon';

alter table public.kb_collection_views
  add constraint kb_collection_views_icon_allowed
  check (icon is null or icon in ('gallery', 'table', 'list'));

alter table public.kb_collection_views
  add constraint kb_collection_views_tab_display_allowed
  check (tab_display in ('text-icon', 'text', 'icon'));

update public.kb_collection_views
set icon = case
  when view_type = 'table' then 'table'
  else 'gallery'
end
where icon is null;

comment on column public.kb_collection_views.icon is
  'Per-view tab icon key.';

comment on column public.kb_collection_views.tab_display is
  'Per-view tab display mode: text-icon, text, or icon.';
