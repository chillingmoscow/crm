-- ============================================================
-- Миграция 107: kb_register_attachment — single RPC для регистрации
-- KB-вложения (аккаунт-файл + pivot к странице) одним round-trip'ом.
--
-- ПРОБЛЕМА:
--   Старый flow в `uploadKbAttachment` (см. attachments.ts) делал
--   4 sequential round-trip'а к Supabase:
--     1. auth.getUser()             — JWT-validate + auth schema read
--     2. rpc('get_active_account_id') — 1 PG-connection
--     3. storage.upload(...)         — HTTP к storage-service
--     4. from('account_files').insert(...)  — 1 PG-connection
--     5. from('kb_page_attachments').insert(...) — 1 PG-connection
--
--   Под нагрузкой (concurrent uploads, многопользовательский режим)
--   self-hosted PgBouncer pool исчерпывался → "Timed out acquiring
--   connection from connection pool" → загрузка 1MB могла занимать
--   30+ секунд и падать. См. memory/kb_upload_pool_timeout.md.
--
-- РЕШЕНИЕ:
--   Эта миграция вводит SECURITY INVOKER функцию, которая внутри
--   одной серверной транзакции выполняет:
--     • резолв активного account_id (через get_active_account_id());
--     • INSERT в account_files (RLS в силе — авторизация под юзером);
--     • INSERT в kb_page_attachments (RLS в силе — kb.manage_attachments);
--   и возвращает file_id.
--
--   Эффект: 4 round-trip'а → 2 (1 storage upload + 1 RPC). PG pool
--   footprint per upload падает с 3 connections до 1.
--
-- БЕЗОПАСНОСТЬ:
--   SECURITY INVOKER (а не DEFINER): RLS политики на account_files и
--   kb_page_attachments применяются как у обычного INSERT'а от юзера.
--   Функция НЕ обходит permissions; она только консолидирует round-trip'ы.
--
-- АТОМАРНОСТЬ:
--   Оба INSERT'а в одной transaction'е. Если pivot-INSERT упал
--   (например, нет kb.manage_attachments на конкретной странице),
--   account_files-INSERT auto-rollback'ается. Storage-объект
--   остаётся — caller обязан удалить его при ошибке RPC (тот же
--   pattern что в старом коде с compensating-delete'ом).
-- ============================================================

CREATE OR REPLACE FUNCTION public.kb_register_attachment(
  p_storage_path text,
  p_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_page_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_account_id uuid;
  v_file_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Не авторизован' USING ERRCODE = '42501';
  END IF;

  v_account_id := public.get_active_account_id();
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Активный аккаунт не определён' USING ERRCODE = '42501';
  END IF;

  -- account_files — RLS-policy `account_files_insert` (миграция 055)
  -- проверит:
  --   • account_id = get_active_account_id() (мы это и передаём);
  --   • uploaded_by = auth.uid() (тоже наше);
  --   • has_permission('kb.manage_attachments') OR
  --     has_permission('finance.upload_attachments').
  -- Failure → exception с понятной ошибкой PG (не наш бизнес-message).
  INSERT INTO public.account_files
    (account_id, uploaded_by, storage_path, name, mime_type, size_bytes)
  VALUES
    (v_account_id, v_user_id, p_storage_path, p_name, p_mime_type, p_size_bytes)
  RETURNING id INTO v_file_id;

  -- kb_page_attachments — RLS-policy `kb_page_attachments_insert`
  -- (миграция 055) проверит:
  --   • has_permission('kb.manage_attachments');
  --   • EXISTS kb_pages WHERE id = p_page_id AND account_id =
  --     get_active_account_id() — страница должна быть в нашем
  --     аккаунте.
  -- Если упадёт — account_files INSERT в этой же транзакции откатится.
  INSERT INTO public.kb_page_attachments
    (page_id, file_id, attached_by)
  VALUES
    (p_page_id, v_file_id, v_user_id);

  RETURN v_file_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kb_register_attachment(text, text, text, bigint, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.kb_register_attachment(text, text, text, bigint, uuid) IS
  'Регистрирует KB-вложение: создаёт account_files + kb_page_attachments одним RPC. SECURITY INVOKER (RLS в силе). См. миграцию 107.';
