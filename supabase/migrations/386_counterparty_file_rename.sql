-- ============================================================
-- 386_counterparty_file_rename.sql
-- Переименование документов контрагента.
--
-- До этой миграции у account_files не было политики UPDATE: файл нельзя
-- было переименовать. Открываем ровно это:
--   * пользователь может менять только колонку name (storage_path, размер,
--     тип и прочее пользовательским клиентом не меняются);
--   * только у файлов, прикреплённых к контрагенту активного аккаунта;
--   * только с правом finance.upload_attachments (кто может загрузить
--     документ, тот может и назвать его по-человечески).
-- Длину и запрещённые символы проверяет приложение (src/lib/files/file-name.ts).
-- ============================================================

revoke update on public.account_files from anon, authenticated;
grant update (name) on public.account_files to authenticated;

create policy "account_files_update_counterparty_name"
  on public.account_files for update
  to authenticated
  using (
    account_id = (select public.get_active_account_id())
    and (select public.has_permission('finance.upload_attachments'))
    and exists (
      select 1
      from public.counterparty_attachments ca
      join public.counterparties c on c.id = ca.counterparty_id
      where ca.file_id = account_files.id
        and c.account_id = account_files.account_id
    )
  )
  with check (
    account_id = (select public.get_active_account_id())
    and (select public.has_permission('finance.upload_attachments'))
  );

-- REVOKE/GRANT от роли, которая не владеет таблицей, выдают только
-- WARNING и молча ничего не меняют — проверяем результат.
do $$
begin
  if not has_column_privilege('authenticated', 'public.account_files', 'name', 'UPDATE') then
    raise exception 'Право переименовывать файлы не выдалось: применяйте миграцию от владельца таблицы (supabase_admin)';
  end if;
  if has_column_privilege('authenticated', 'public.account_files', 'storage_path', 'UPDATE')
    or has_column_privilege('anon', 'public.account_files', 'name', 'UPDATE')
  then
    raise exception 'Лишние права на изменение файлов не сняты: применяйте миграцию от владельца таблицы (supabase_admin)';
  end if;
end
$$;
