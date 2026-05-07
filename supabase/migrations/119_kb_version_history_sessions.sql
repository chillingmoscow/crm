-- 119_kb_version_history_sessions.sql
-- KB version history sessions:
--   - store full lightweight page snapshot metadata for restore
--   - collapse autosave snapshots from the same author within 15 minutes
--   - version page properties through the same session row

alter table public.kb_page_versions
  add column if not exists icon text,
  add column if not exists icon_color text,
  add column if not exists properties jsonb,
  add column if not exists updated_at timestamptz,
  add column if not exists change_kinds text[] not null default '{}'::text[];

update public.kb_page_versions v
   set icon = coalesce(v.icon, p.icon),
       icon_color = coalesce(v.icon_color, p.icon_color),
       updated_at = coalesce(v.updated_at, v.created_at),
       change_kinds = case
         when coalesce(array_length(v.change_kinds, 1), 0) = 0
           then array['content']::text[]
         else v.change_kinds
       end
  from public.kb_pages p
 where p.id = v.page_id
   and (
     v.icon is null
     or v.icon_color is null
     or v.updated_at is null
     or coalesce(array_length(v.change_kinds, 1), 0) = 0
   );

alter table public.kb_page_versions
  alter column updated_at set default now(),
  alter column updated_at set not null;

create index if not exists kb_page_versions_page_updated_idx
  on public.kb_page_versions(page_id, updated_at desc);

comment on column public.kb_page_versions.icon is
  'Page icon snapshot for version restore. Legacy rows may contain the current page icon.';
comment on column public.kb_page_versions.icon_color is
  'Page icon color snapshot for version restore. Legacy rows may contain the current page icon color.';
comment on column public.kb_page_versions.properties is
  'Page properties snapshot for version restore. NULL means legacy row without property snapshot.';
comment on column public.kb_page_versions.updated_at is
  'Last autosave time folded into this version-session row.';
comment on column public.kb_page_versions.change_kinds is
  'Lightweight labels for what changed in this version/session: title, content, icon, properties, restore.';

create or replace function public.kb_upsert_page_version_session(
  p_page_id uuid,
  p_account_id uuid,
  p_title text,
  p_icon text,
  p_icon_color text,
  p_content jsonb,
  p_plain_text text,
  p_properties jsonb,
  p_created_by uuid,
  p_change_kinds text[],
  p_force_new_version boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_latest public.kb_page_versions%rowtype;
  v_version integer;
  v_change_kinds text[];
begin
  select *
    into v_latest
    from public.kb_page_versions
   where page_id = p_page_id
   order by version_number desc
   limit 1
   for update;

  if found
     and not p_force_new_version
     and v_latest.created_by is not distinct from p_created_by
     and coalesce(v_latest.updated_at, v_latest.created_at) >= now() - interval '15 minutes'
     and not exists (
       select 1
         from public.kb_page_reads r
        where r.page_id = p_page_id
          and r.read_version = v_latest.version_number
     )
  then
    select coalesce(array_agg(distinct kind order by kind), '{}'::text[])
      into v_change_kinds
      from unnest(coalesce(v_latest.change_kinds, '{}'::text[]) || coalesce(p_change_kinds, '{}'::text[])) as kind;

    update public.kb_page_versions
       set title = p_title,
           icon = p_icon,
           icon_color = p_icon_color,
           content = p_content,
           plain_text = coalesce(p_plain_text, ''),
           text_length = char_length(coalesce(p_plain_text, '')),
           properties = p_properties,
           updated_at = now(),
           change_kinds = v_change_kinds
     where id = v_latest.id
     returning version_number into v_version;

    return v_version;
  end if;

  select coalesce(max(version_number), 0) + 1
    into v_version
    from public.kb_page_versions
   where page_id = p_page_id;

  insert into public.kb_page_versions (
    page_id,
    account_id,
    version_number,
    title,
    icon,
    icon_color,
    content,
    plain_text,
    text_length,
    properties,
    created_by,
    updated_at,
    change_kinds
  ) values (
    p_page_id,
    p_account_id,
    v_version,
    p_title,
    p_icon,
    p_icon_color,
    p_content,
    coalesce(p_plain_text, ''),
    char_length(coalesce(p_plain_text, '')),
    p_properties,
    p_created_by,
    now(),
    coalesce(p_change_kinds, '{}'::text[])
  );

  return v_version;
end;
$$;

revoke all on function public.kb_upsert_page_version_session(
  uuid, uuid, text, text, text, jsonb, text, jsonb, uuid, text[], boolean
) from public;

create or replace function public.kb_save_page(
  p_id uuid,
  p_title text,
  p_icon text,
  p_icon_color text,
  p_content jsonb,
  p_plain_text text,
  p_link_targets uuid[],
  p_force_new_version boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid                uuid := auth.uid();
  v_page               public.kb_pages%rowtype;
  v_can_edit_any       boolean := public.has_permission('kb.edit_any_page');
  v_can_edit_own       boolean := public.has_permission('kb.edit_own_pages');
  v_content_changed    boolean;
  v_title_changed      boolean;
  v_icon_changed       boolean;
  v_icon_color_changed boolean;
  v_change_kinds       text[] := '{}'::text[];
  v_saved_version      integer := null;
begin
  if v_uid is null then
    raise exception 'Не авторизован' using errcode = '42501';
  end if;

  select * into v_page from public.kb_pages where id = p_id for update;
  if not found or v_page.deleted_at is not null then
    raise exception 'Страница не найдена' using errcode = 'P0002';
  end if;
  if v_page.account_id <> public.get_active_account_id() then
    raise exception 'Страница из другого аккаунта' using errcode = '42501';
  end if;
  if not (v_can_edit_any or (v_can_edit_own and v_page.created_by = v_uid)) then
    raise exception 'Нет права редактировать страницу' using errcode = '42501';
  end if;

  v_content_changed := coalesce(v_page.content, '[]'::jsonb) is distinct from coalesce(p_content, '[]'::jsonb);
  v_title_changed := coalesce(v_page.title, '') is distinct from coalesce(p_title, '');
  v_icon_changed := coalesce(v_page.icon, '') is distinct from coalesce(p_icon, '');
  v_icon_color_changed := coalesce(v_page.icon_color, '') is distinct from coalesce(p_icon_color, '');

  if v_title_changed then
    v_change_kinds := v_change_kinds || array['title']::text[];
  end if;
  if v_content_changed then
    v_change_kinds := v_change_kinds || array['content']::text[];
  end if;
  if v_icon_changed or v_icon_color_changed then
    v_change_kinds := v_change_kinds || array['icon']::text[];
  end if;
  if p_force_new_version then
    v_change_kinds := v_change_kinds || array['restore']::text[];
  end if;

  update public.kb_pages
     set title = coalesce(nullif(trim(p_title), ''), 'Без названия'),
         icon = nullif(trim(coalesce(p_icon, '')), ''),
         icon_color = nullif(trim(coalesce(p_icon_color, '')), ''),
         content = coalesce(p_content, '[]'::jsonb),
         plain_text = coalesce(p_plain_text, ''),
         updated_by = v_uid
   where id = p_id;

  if p_force_new_version
     or v_content_changed
     or v_title_changed
     or v_icon_changed
     or v_icon_color_changed
  then
    v_saved_version := public.kb_upsert_page_version_session(
      p_id,
      v_page.account_id,
      coalesce(nullif(trim(p_title), ''), 'Без названия'),
      nullif(trim(coalesce(p_icon, '')), ''),
      nullif(trim(coalesce(p_icon_color, '')), ''),
      coalesce(p_content, '[]'::jsonb),
      coalesce(p_plain_text, ''),
      v_page.properties,
      v_uid,
      v_change_kinds,
      p_force_new_version
    );
  end if;

  delete from public.kb_page_links where from_page_id = p_id;
  if p_link_targets is not null and array_length(p_link_targets, 1) > 0 then
    insert into public.kb_page_links (from_page_id, to_page_id, account_id)
    select p_id, target_id, v_page.account_id
      from unnest(p_link_targets) as target_id
     where target_id <> p_id
       and exists (
         select 1 from public.kb_pages p
          where p.id = target_id
            and p.account_id = v_page.account_id
            and p.deleted_at is null
       )
    on conflict do nothing;
  end if;

  return v_saved_version;
end;
$$;

comment on function public.kb_save_page(uuid, text, text, text, jsonb, text, uuid[], boolean) is
  'Saves a KB page and folds autosave snapshots by author/page into a 15-minute version session.';

grant execute on function public.kb_save_page(uuid, text, text, text, jsonb, text, uuid[], boolean) to authenticated;

-- Remove the pre-session overload so PostgREST has one unambiguous RPC
-- shape. All app calls pass p_force_new_version explicitly.
drop function if exists public.kb_save_page(uuid, text, text, text, jsonb, text, uuid[]);

create or replace function public.kb_save_page_properties(
  p_id uuid,
  p_properties jsonb,
  p_force_new_version boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_page         public.kb_pages%rowtype;
  v_can_edit_any boolean := public.has_permission('kb.edit_any_page');
  v_can_edit_own boolean := public.has_permission('kb.edit_own_pages');
  v_saved_version integer := null;
begin
  if v_uid is null then
    raise exception 'Не авторизован' using errcode = '42501';
  end if;

  select * into v_page from public.kb_pages where id = p_id for update;
  if not found or v_page.deleted_at is not null then
    raise exception 'Страница не найдена' using errcode = 'P0002';
  end if;
  if v_page.account_id <> public.get_active_account_id() then
    raise exception 'Страница из другого аккаунта' using errcode = '42501';
  end if;
  if not (v_can_edit_any or (v_can_edit_own and v_page.created_by = v_uid)) then
    raise exception 'Нет права редактировать страницу' using errcode = '42501';
  end if;

  if coalesce(v_page.properties, '[]'::jsonb) is not distinct from coalesce(p_properties, '[]'::jsonb)
     and not p_force_new_version
  then
    return null;
  end if;

  update public.kb_pages
     set properties = coalesce(p_properties, '[]'::jsonb),
         updated_by = v_uid
   where id = p_id;

  v_saved_version := public.kb_upsert_page_version_session(
    p_id,
    v_page.account_id,
    v_page.title,
    v_page.icon,
    v_page.icon_color,
    coalesce(v_page.content, '[]'::jsonb),
    coalesce(v_page.plain_text, ''),
    coalesce(p_properties, '[]'::jsonb),
    v_uid,
    case
      when p_force_new_version then array['restore', 'properties']::text[]
      else array['properties']::text[]
    end,
    p_force_new_version
  );

  return v_saved_version;
end;
$$;

comment on function public.kb_save_page_properties(uuid, jsonb, boolean) is
  'Saves KB page properties and records them in the same 15-minute version-session history.';

grant execute on function public.kb_save_page_properties(uuid, jsonb, boolean) to authenticated;

create or replace function public.kb_restore_page_version(
  p_page_id uuid,
  p_version_number integer,
  p_plain_text text,
  p_link_targets uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid                uuid := auth.uid();
  v_page               public.kb_pages%rowtype;
  v_version            public.kb_page_versions%rowtype;
  v_can_edit_any       boolean := public.has_permission('kb.edit_any_page');
  v_can_edit_own       boolean := public.has_permission('kb.edit_own_pages');
  v_restored_title     text;
  v_restored_icon      text;
  v_restored_icon_color text;
  v_restored_content   jsonb;
  v_restored_plain_text text;
  v_restored_properties jsonb;
  v_change_kinds       text[] := array['restore']::text[];
  v_saved_version      integer;
begin
  if v_uid is null then
    raise exception 'Не авторизован' using errcode = '42501';
  end if;

  select * into v_page from public.kb_pages where id = p_page_id for update;
  if not found or v_page.deleted_at is not null then
    raise exception 'Страница не найдена' using errcode = 'P0002';
  end if;
  if v_page.account_id <> public.get_active_account_id() then
    raise exception 'Страница из другого аккаунта' using errcode = '42501';
  end if;
  if not (v_can_edit_any or (v_can_edit_own and v_page.created_by = v_uid)) then
    raise exception 'Нет права редактировать страницу' using errcode = '42501';
  end if;

  select *
    into v_version
    from public.kb_page_versions
   where page_id = p_page_id
     and version_number = p_version_number;
  if not found or v_version.account_id <> v_page.account_id then
    raise exception 'Версия не найдена' using errcode = 'P0002';
  end if;

  v_restored_title := coalesce(nullif(trim(v_version.title), ''), 'Без названия');
  v_restored_icon := nullif(trim(coalesce(v_version.icon, '')), '');
  v_restored_icon_color := nullif(trim(coalesce(v_version.icon_color, '')), '');
  v_restored_content := coalesce(v_version.content, '[]'::jsonb);
  v_restored_plain_text := coalesce(p_plain_text, v_version.plain_text, '');
  v_restored_properties := case
    when v_version.properties is null then coalesce(v_page.properties, '[]'::jsonb)
    else v_version.properties
  end;

  if coalesce(v_page.title, '') is distinct from v_restored_title then
    v_change_kinds := v_change_kinds || array['title']::text[];
  end if;
  if coalesce(v_page.content, '[]'::jsonb) is distinct from v_restored_content then
    v_change_kinds := v_change_kinds || array['content']::text[];
  end if;
  if coalesce(v_page.icon, '') is distinct from coalesce(v_restored_icon, '')
     or coalesce(v_page.icon_color, '') is distinct from coalesce(v_restored_icon_color, '')
  then
    v_change_kinds := v_change_kinds || array['icon']::text[];
  end if;
  if coalesce(v_page.properties, '[]'::jsonb) is distinct from v_restored_properties then
    v_change_kinds := v_change_kinds || array['properties']::text[];
  end if;

  update public.kb_pages
     set title = v_restored_title,
         icon = v_restored_icon,
         icon_color = v_restored_icon_color,
         content = v_restored_content,
         plain_text = v_restored_plain_text,
         properties = v_restored_properties,
         updated_by = v_uid
   where id = p_page_id;

  v_saved_version := public.kb_upsert_page_version_session(
    p_page_id,
    v_page.account_id,
    v_restored_title,
    v_restored_icon,
    v_restored_icon_color,
    v_restored_content,
    v_restored_plain_text,
    v_restored_properties,
    v_uid,
    v_change_kinds,
    true
  );

  delete from public.kb_page_links where from_page_id = p_page_id;
  if p_link_targets is not null and array_length(p_link_targets, 1) > 0 then
    insert into public.kb_page_links (from_page_id, to_page_id, account_id)
    select p_page_id, target_id, v_page.account_id
      from unnest(p_link_targets) as target_id
     where target_id <> p_page_id
       and exists (
         select 1 from public.kb_pages p
          where p.id = target_id
            and p.account_id = v_page.account_id
            and p.deleted_at is null
       )
    on conflict do nothing;
  end if;

  return v_saved_version;
end;
$$;

comment on function public.kb_restore_page_version(uuid, integer, text, uuid[]) is
  'Atomically restores a KB page version, including content, metadata, properties, backlinks, and a new restore snapshot.';

revoke all on function public.kb_restore_page_version(uuid, integer, text, uuid[]) from public;
grant execute on function public.kb_restore_page_version(uuid, integer, text, uuid[]) to authenticated;
