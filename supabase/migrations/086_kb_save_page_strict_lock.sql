-- ============================================================
-- 086_kb_save_page_strict_lock.sql
-- Bugfix Sprint — Lock = strict для всех.
--
-- Зачем: оригинальный design в 078 разрешал caller'у с
-- `kb.lock_pages` писать на заблокированную страницу (с UI-banner'ом
-- «вы редактируете заблокированную страницу»). Прод-feedback показал,
-- что это путает: «banner есть, но я почему-то могу печатать».
--
-- Новое решение: lock = strict для всех, включая admin'а с lock-
-- permission. Чтобы edit'ить — сначала разблокировать через явную
-- кнопку в banner'е. Двух режимов нет.
--
-- Что делает миграция:
--   • CREATE OR REPLACE kb_save_page без `v_can_lock` ветки.
--     Любой save на `locked_at IS NOT NULL` → reject (42501).
-- ============================================================

create or replace function public.kb_save_page(
  p_id            uuid,
  p_title         text,
  p_icon          text,
  p_icon_color    text,
  p_content       jsonb,
  p_plain_text    text,
  p_link_targets  uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid              uuid := auth.uid();
  v_account_id       uuid := public.get_active_account_id();
  v_page             public.kb_pages%rowtype;
  v_can_edit_any     boolean := public.has_permission('kb.edit_any_page');
  v_can_edit_own     boolean := public.has_permission('kb.edit_own_pages');
  v_changed          boolean;
  v_next_version     integer;
begin
  if v_uid is null then
    raise exception 'kb_save_page: не авторизован' using errcode = '28000';
  end if;
  if v_account_id is null then
    raise exception 'kb_save_page: нет активного account' using errcode = '28000';
  end if;

  select * into v_page from public.kb_pages where id = p_id;
  if not found then
    raise exception 'kb_save_page: страница % не найдена', p_id using errcode = 'P0002';
  end if;
  if v_page.account_id != v_account_id then
    raise exception 'kb_save_page: страница принадлежит другому account' using errcode = '42501';
  end if;
  if not (
    v_can_edit_any
    or (v_can_edit_own and v_page.created_by = v_uid)
  ) then
    raise exception 'kb_save_page: нет права на редактирование' using errcode = '42501';
  end if;

  -- Strict lock guard (Bugfix Sprint, 2026-05). Любой write на
  -- locked-странице отвергается, независимо от kb.lock_pages. Чтобы
  -- сохранить — сначала разблокировать через kb_set_page_lock.
  if v_page.locked_at is not null then
    raise exception
      'kb_save_page: страница заблокирована (locked_at = %)',
      v_page.locked_at
      using errcode = '42501',
            hint = 'Снимите блокировку через kb_set_page_lock или попросите '
                   'admin''а разблокировать страницу';
  end if;

  v_changed :=
    coalesce(v_page.title, '') is distinct from coalesce(p_title, '')
    or coalesce(v_page.icon, '') is distinct from coalesce(p_icon, '')
    or coalesce(v_page.icon_color, '') is distinct from coalesce(p_icon_color, '')
    or v_page.content is distinct from p_content;

  update public.kb_pages
     set title       = p_title,
         icon        = p_icon,
         icon_color  = p_icon_color,
         content     = p_content,
         plain_text  = p_plain_text,
         updated_by  = v_uid
   where id = p_id;

  if v_changed then
    select coalesce(max(version_number), 0) + 1
      into v_next_version
      from public.kb_page_versions
     where page_id = p_id;

    insert into public.kb_page_versions (
      page_id, account_id, version_number, title, content, created_by
    ) values (
      p_id, v_account_id, v_next_version, p_title, p_content, v_uid
    );
  else
    select coalesce(max(version_number), 0) into v_next_version
      from public.kb_page_versions where page_id = p_id;
  end if;

  delete from public.kb_page_links where from_page_id = p_id;

  if p_link_targets is not null and array_length(p_link_targets, 1) > 0 then
    insert into public.kb_page_links (from_page_id, to_page_id, account_id)
    select p_id, t, v_account_id
      from unnest(p_link_targets) as t
     where t != p_id
       and exists (
         select 1 from public.kb_pages
          where id = t and account_id = v_account_id
       )
    on conflict do nothing;
  end if;

  return v_next_version;
end;
$$;

comment on function public.kb_save_page(uuid, text, text, text, jsonb, text, uuid[]) is
  'Атомарное сохранение KB-страницы: контент + версия + backlinks. '
  'С 086 — strict lock guard: любой write на locked-странице отвергается '
  '(независимо от kb.lock_pages permission). Чтобы edit''ить — сначала '
  'разблокировать через kb_set_page_lock. Возвращает version_number.';

grant execute on function public.kb_save_page(uuid, text, text, text, jsonb, text, uuid[])
  to authenticated;
