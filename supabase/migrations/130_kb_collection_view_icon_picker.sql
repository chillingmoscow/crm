alter table public.kb_collection_views
  drop constraint if exists kb_collection_views_icon_allowed;

update public.kb_collection_views
set icon = case icon
  when 'table' then 'database'
  when 'list' then 'list-checks'
  when 'gallery' then 'list-checks'
  else icon
end;

comment on column public.kb_collection_views.icon is
  'Per-view tab icon key from KB icon registry or legacy free text.';
