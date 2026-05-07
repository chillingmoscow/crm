-- 117_kb_notion_style_lock.sql
-- Notion-style KB lock:
--   - locked_at is a UI guard against accidental edits, not a hard
--     backend write lock for users who already have edit permission.
--   - kb.lock_pages controls only global lock/unlock.
--   - existing live pages become locked by default on rollout.

-- Existing pages should start in the Notion-style locked state. New pages
-- keep the existing product behavior: created unlocked and can be locked
-- explicitly from the page menu.
update public.kb_pages
   set locked_at = coalesce(locked_at, now())
 where locked_at is null
   and deleted_at is null;

comment on column public.kb_pages.locked_at is
  'Notion-style UI lock timestamp. NULL = globally unlocked. '
  'When set, the client opens the page read-only by default, but a user '
  'with edit permission may locally choose "Редактировать" without '
  'changing this column.';

comment on column public.kb_pages.locked_by is
  'Who globally locked the page via kb_set_page_lock. May be NULL for '
  'system/default locks created by migrations.';

create or replace function public.kb_save_page(
  p_id uuid,
  p_title text,
  p_icon text,
  p_icon_color text,
  p_content jsonb,
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
  v_can_edit_any       boolean := public.has_permission('kb.edit_any_page');
  v_can_edit_own       boolean := public.has_permission('kb.edit_own_pages');
  v_content_changed    boolean;
  v_title_changed      boolean;
  v_icon_changed       boolean;
  v_icon_color_changed boolean;
  v_version            integer;
  v_saved_version      integer := null;
begin
  if v_uid is null then
    raise exception 'Не авторизован' using errcode = '42501';
  end if;

  select * into v_page from public.kb_pages where id = p_id;
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

  update public.kb_pages
     set title = coalesce(nullif(trim(p_title), ''), 'Без названия'),
         icon = nullif(trim(coalesce(p_icon, '')), ''),
         icon_color = nullif(trim(coalesce(p_icon_color, '')), ''),
         content = coalesce(p_content, '[]'::jsonb),
         plain_text = coalesce(p_plain_text, ''),
         updated_by = v_uid
   where id = p_id;

  if v_content_changed or v_title_changed then
    select coalesce(max(version_number), 0) + 1
      into v_version
      from public.kb_page_versions
     where page_id = p_id;

    insert into public.kb_page_versions (
      page_id,
      account_id,
      version_number,
      title,
      content,
      plain_text,
      text_length,
      created_by
    ) values (
      p_id,
      v_page.account_id,
      v_version,
      coalesce(nullif(trim(p_title), ''), 'Без названия'),
      coalesce(p_content, '[]'::jsonb),
      coalesce(p_plain_text, ''),
      char_length(coalesce(p_plain_text, '')),
      v_uid
    );
    v_saved_version := v_version;
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

comment on function public.kb_save_page(uuid, text, text, text, jsonb, text, uuid[]) is
  'Saves a KB page using ordinary edit permissions. Since migration 117, '
  'locked_at is a Notion-style UI guard and is not a backend save blocker.';

grant execute on function public.kb_save_page(uuid, text, text, text, jsonb, text, uuid[]) to authenticated;
