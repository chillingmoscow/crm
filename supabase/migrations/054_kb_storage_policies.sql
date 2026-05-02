-- ============================================================
-- 054_kb_storage_policies.sql
-- Stage 8.6 — расширяем storage-политики bucket'а account-attachments
-- так, чтобы пользователи с `kb.manage_attachments` могли заливать
-- и удалять файлы (изображения и вложения внутри KB-страниц).
--
-- Миграция 050 уже расширила INSERT-политику account_files. Здесь
-- добавляем тот же шаг для самих storage-объектов.
-- ============================================================

-- INSERT: разрешаем либо finance.upload_attachments, либо kb.manage_attachments.
drop policy if exists "account_attachments_insert" on storage.objects;
create policy "account_attachments_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'account-attachments'
    and (storage.foldername(name))[1] = public.get_active_account_id()::text
    and (
      public.has_permission('finance.upload_attachments')
      or public.has_permission('kb.manage_attachments')
    )
  );

-- DELETE: то же самое для удаления собственных файлов.
drop policy if exists "account_attachments_delete" on storage.objects;
create policy "account_attachments_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'account-attachments'
    and exists (
      select 1 from public.account_files af
      where af.storage_path = name
    )
    and (
      public.has_permission('finance.delete_attachments')
      or public.has_permission('kb.manage_attachments')
    )
  );

-- SELECT-политика на storage.objects не трогается: она делегирует
-- авторизацию RLS на account_files, а account_files_select мы уже
-- расширили в 050 (ветка «прикреплён к видимой странице БЗ»).
