-- ============================================================
-- 092_kb_save_page_comment_only_strict.sql
-- Codex #79 P1 — расширение invariant'ов для comment-only fallback'а.
--
-- Проблема: 091-я версия `kb_save_page_comment_only` валидировала
-- только `plain_text` неизменность. Если юзер на UNLOCKED-странице
-- успел поменять title/icon (canEdit=true), а к моменту flush'а другой
-- юзер ставит lock, fallback в saveKbPage переотправит payload в
-- comment-only RPC. plain_text совпадёт (title/icon в plain_text не
-- входят), но title/icon обновлены НЕ будут — изменения silently
-- теряются, а UI показывает «сохранено».
--
-- Фикс: RPC дополнительно проверяет title / icon / icon_color
-- неизменность. Если хоть что-то отличается — это не «только comment-
-- mark'и», а реальный edit, → reject.
--
-- Сигнатура меняется (новые параметры) — DROP + CREATE.
-- ============================================================

drop function if exists public.kb_save_page_comment_only(uuid, jsonb, text);

create or replace function public.kb_save_page_comment_only(
  p_id            uuid,
  p_content       jsonb,
  p_plain_text    text,
  p_title         text,
  p_icon          text,
  p_icon_color    text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_account_id uuid := public.get_active_account_id();
  v_page       public.kb_pages%rowtype;
  v_version    integer;
begin
  if v_uid is null then
    raise exception 'kb_save_page_comment_only: не авторизован' using errcode = '28000';
  end if;
  if v_account_id is null then
    raise exception 'kb_save_page_comment_only: нет активного account' using errcode = '28000';
  end if;
  if not public.has_permission('kb.comment_pages') then
    raise exception 'kb_save_page_comment_only: требуется kb.comment_pages' using errcode = '42501';
  end if;

  select * into v_page from public.kb_pages where id = p_id;
  if not found then
    raise exception 'kb_save_page_comment_only: страница % не найдена', p_id using errcode = 'P0002';
  end if;
  if v_page.account_id != v_account_id then
    raise exception 'kb_save_page_comment_only: cross-tenant' using errcode = '42501';
  end if;
  if v_page.deleted_at is not null then
    raise exception 'kb_save_page_comment_only: страница удалена' using errcode = '42501';
  end if;

  -- Строгие invariant'ы: ничего кроме content не должно меняться.
  -- plain_text:
  if coalesce(v_page.plain_text, '') is distinct from coalesce(p_plain_text, '') then
    raise exception
      'kb_save_page_comment_only: plain_text изменён (требуется kb_save_page)'
      using errcode = '42501';
  end if;
  -- title:
  if coalesce(v_page.title, '') is distinct from coalesce(p_title, '') then
    raise exception
      'kb_save_page_comment_only: title изменён (требуется kb_save_page)'
      using errcode = '42501';
  end if;
  -- icon:
  if coalesce(v_page.icon, '') is distinct from coalesce(p_icon, '') then
    raise exception
      'kb_save_page_comment_only: icon изменён (требуется kb_save_page)'
      using errcode = '42501';
  end if;
  -- icon_color:
  if coalesce(v_page.icon_color, '') is distinct from coalesce(p_icon_color, '') then
    raise exception
      'kb_save_page_comment_only: icon_color изменён (требуется kb_save_page)'
      using errcode = '42501';
  end if;

  update public.kb_pages
     set content    = p_content,
         plain_text = p_plain_text,
         updated_by = v_uid
   where id = p_id;

  -- Не создаём version snapshot. Возвращаем текущий latest version.
  select coalesce(max(version_number), 0) into v_version
    from public.kb_page_versions where page_id = p_id;

  return v_version;
end;
$$;

comment on function public.kb_save_page_comment_only(uuid, jsonb, text, text, text, text) is
  'Comment-mark-only save с строгими invariant''ами: title/icon/'
  'icon_color/plain_text должны совпадать с текущими значениями. '
  'Защищает от silent-drop''а title/icon edits на race с lock-toggle. '
  'Codex #79 P1.';

revoke all on function public.kb_save_page_comment_only(uuid, jsonb, text, text, text, text) from public;
grant execute on function public.kb_save_page_comment_only(uuid, jsonb, text, text, text, text) to authenticated;
