-- ============================================================
-- 060_fix_storage_name_ambiguity.sql
-- БАГ из миграции 045 (повторённый в 059): в политиках
-- account_attachments_select / _delete стояло `where af.storage_path = name`.
-- Postgres связал bare `name` с `account_files.name` (там тоже есть
-- столбец `name` — оригинальное имя файла), а не с `storage.objects.name`.
-- Из-за этого EXISTS никогда не возвращал rows → SELECT/DELETE на
-- storage.objects денились → загрузка изображений падала с
-- `Object not found` сразу после успешного upload + insert.
--
-- Лечим явной квалификацией `storage.objects.name`.
-- ============================================================

drop policy if exists "account_attachments_select" on storage.objects;
create policy "account_attachments_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'account-attachments'
    and exists (
      select 1 from public.account_files af
      where af.storage_path = storage.objects.name
    )
  );

drop policy if exists "account_attachments_delete" on storage.objects;
create policy "account_attachments_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'account-attachments'
    and exists (
      select 1 from public.account_files af
      where af.storage_path = storage.objects.name
    )
    and (
      public.has_permission('finance.delete_attachments')
      or public.has_permission('kb.manage_attachments')
    )
  );
