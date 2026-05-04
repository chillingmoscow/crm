-- ============================================================
-- 091_kb_save_page_comment_only.sql
-- Sprint E follow-up — разрешить сохранение comment-mark'ов на
-- заблокированной странице.
--
-- Зачем: сейчас `kb_save_page` (миграция 086) reject'ит ЛЮБОЙ save
-- на странице где `locked_at IS NOT NULL`. Юзер с правом
-- `kb.comment_pages` не может оставить комментарий, потому что добавление
-- comment-mark'а в content jsonb идёт через тот же путь что и edit'ы,
-- и попадает под общий guard.
--
-- Notion-подход: lock защищает контент (нельзя править текст), но
-- НЕ обсуждение (комментировать всё ещё можно). Решение —
-- параллельный RPC с гарантией «изменился ТОЛЬКО content (mark'и),
-- plain_text неизменён». Гарантия не идеальна (теоретически можно
-- модифицировать content без изменения plain_text — например,
-- добавить лишнюю инлайн-ноду со странным mark'ом), но достаточна
-- для целей: lock защищает от случайных правок, не от полностью
-- продуманного злоупотребления.
--
-- Permissions:
--   • caller должен быть авторизован
--   • активный аккаунт совпадает с page.account_id
--   • caller имеет `kb.comment_pages`
--   • плюс — page живая (deleted_at is null)
--
-- НЕ проверяем locked_at (whole point — позволить save на locked'ах).
-- НЕ создаём kb_page_versions snapshot (не «edit», просто сохранение
-- mark'а; история версий должна отражать содержимое, а не позиции
-- comment-разметки).
-- ============================================================

create or replace function public.kb_save_page_comment_only(
  p_id            uuid,
  p_content       jsonb,
  p_plain_text    text
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

  -- Гарантия «только comment-mark'и»: plain_text должен совпадать
  -- с текущим. Если нет — клиент пытается прокинуть real-edit под
  -- видом comment-only, отвергаем.
  if coalesce(v_page.plain_text, '') is distinct from coalesce(p_plain_text, '') then
    raise exception
      'kb_save_page_comment_only: plain_text изменён (для real-edit нужен kb_save_page)'
      using errcode = '42501';
  end if;

  update public.kb_pages
     set content    = p_content,
         plain_text = p_plain_text,
         updated_by = v_uid
   where id = p_id;

  -- Не создаём version snapshot (не структурное изменение). Возвращаем
  -- текущий latest version_number — клиент использует его для
  -- staleness-checks.
  select coalesce(max(version_number), 0) into v_version
    from public.kb_page_versions where page_id = p_id;

  return v_version;
end;
$$;

comment on function public.kb_save_page_comment_only(uuid, jsonb, text) is
  'Comment-mark-only save: разрешает обновление content+plain_text на '
  'странице с locked_at != null. Гейт kb.comment_pages + invariant '
  '«plain_text неизменён». Не создаёт kb_page_versions snapshot. '
  'Используется фоллбэком в saveKbPage когда основной kb_save_page '
  'rejects по lock-guard.';

revoke all on function public.kb_save_page_comment_only(uuid, jsonb, text) from public;
grant execute on function public.kb_save_page_comment_only(uuid, jsonb, text) to authenticated;
