begin;

-- Imported illustrations follow the same KB page permission as their text.
-- A task-only user still gets just the files in the assigned report snapshot.
create policy notion_kb_files_read on public.account_files for select to authenticated
using (
 account_id=(select public.get_active_account_id())
 and split_part(storage_path,'/',2)='task-instructions'
 and (select public.has_permission('kb.view_pages'))
 and exists(
   select 1 from public.kb_page_attachments a
   join public.kb_pages p on p.id=a.page_id
   where a.file_id=account_files.id and p.account_id=account_files.account_id and p.deleted_at is null
 )
);

commit;
