begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('staff-documents','staff-documents',false,10485760,array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
on conflict(id) do nothing;
do $$ begin
 if exists(select 1 from storage.buckets where id='staff-documents' and public) then raise exception 'Staff documents must be private';end if;
end $$;

-- Documents follow the existing permission explicitly covering personal data/documents.
create function private.staff_document_access(p_name text,p_write boolean) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare pieces text[];v uuid:=public.get_active_venue_id();a uuid:=public.get_active_account_id();target uuid;begin
 if auth.uid() is null or a is null or v is null or p_write is null or
  not public.has_permission('people.view_staff') or not public.has_permission('people.view_staff_details') or
  (p_write and not public.has_permission('people.edit_staff')) then return false;end if;
 pieces:=regexp_match(p_name,'^([0-9a-fA-F-]{36})/([0-9a-fA-F-]{36})/passport/([^/]+)$');
 if pieces is null then return false;end if;
 begin
  if pieces[1]::uuid<>v then return false;end if;target:=pieces[2]::uuid;
 exception when invalid_text_representation then return false;end;
 if not exists(select 1 from public.venues where id=v and account_id=a and archived_at is null) or
  not exists(select 1 from public.user_venue_roles where venue_id=v and user_id=auth.uid() and status='active') or
  not exists(select 1 from public.user_venue_roles where venue_id=v and user_id=target and status in ('active','fired')) then return false;end if;
 if not p_write and not exists(select 1 from public.staff_account_details where account_id=a and user_id=target and p_name=any(passport_photos)) then return false;end if;
 return true;
end $$;
revoke all on function private.staff_document_access(text,boolean) from public,anon,service_role;
grant execute on function private.staff_document_access(text,boolean) to authenticated;

drop policy if exists staff_docs_select on storage.objects;
drop policy if exists staff_docs_insert on storage.objects;
drop policy if exists staff_docs_update on storage.objects;
drop policy if exists staff_docs_delete on storage.objects;
create policy staff_docs_select on storage.objects for select to authenticated
 using(bucket_id='staff-documents' and private.staff_document_access(name,false));
create policy staff_docs_insert on storage.objects for insert to authenticated
 with check(bucket_id='staff-documents' and private.staff_document_access(name,true));
create policy staff_docs_update on storage.objects for update to authenticated
 using(bucket_id='staff-documents' and private.staff_document_access(name,true))
 with check(bucket_id='staff-documents' and private.staff_document_access(name,true));
create policy staff_docs_delete on storage.objects for delete to authenticated
 using(bucket_id='staff-documents' and private.staff_document_access(name,true));
-- A wider unrelated SELECT policy must never expose staff scans.
create policy staff_docs_read_boundary on storage.objects as restrictive for select to authenticated
 using(bucket_id<>'staff-documents' or private.staff_document_access(name,false));
create policy staff_details_privacy on public.staff_account_details as restrictive for select to authenticated
 using(auth.uid() is not null and account_id=(select public.get_active_account_id()) and
 (select public.has_permission('people.view_staff_details')) and
 exists(select 1 from public.user_venue_roles u where u.venue_id=(select public.get_active_venue_id()) and u.user_id=staff_account_details.user_id and u.status in ('active','fired')));

-- Reference changes are atomic, version checked and audited by the existing HR triggers.
-- Removing a reference keeps the private bytes for recovery; unlinked objects cannot be signed.
create function public.staff_change_document(p_account_id uuid,p_user_id uuid,p_expected_paths text[],p_add_path text default null,p_remove_path text default null)
returns text[] language plpgsql security definer set search_path='' as $$
declare paths text[];next_paths text[];changed text:=coalesce(p_add_path,p_remove_path);begin
 if auth.uid() is null or p_account_id is distinct from public.get_active_account_id() or
  not public.has_permission('people.view_staff') or not public.has_permission('people.view_staff_details') or not public.has_permission('people.edit_staff') then raise exception 'Нет доступа к документам сотрудника';end if;
 if p_expected_paths is null or array_position(p_expected_paths,null) is not null or cardinality(p_expected_paths)>100 or
  (p_add_path is null)=(p_remove_path is null) or not coalesce(private.staff_document_access(changed,true),false) or split_part(changed,'/',2)::uuid is distinct from p_user_id then raise exception 'Проверьте документ и сотрудника';end if;
 perform pg_advisory_xact_lock(hashtextextended('staff-documents:'||p_account_id||':'||p_user_id,0));
 select passport_photos into paths from public.staff_account_details where account_id=p_account_id and user_id=p_user_id for update;
 paths:=coalesce(paths,array[]::text[]);
 if p_add_path is not null then
  if not exists(select 1 from storage.objects where bucket_id='staff-documents' and name=p_add_path) then raise exception 'Загруженный файл не найден';end if;
  next_paths:=case when p_add_path=any(p_expected_paths) then p_expected_paths else array_append(p_expected_paths,p_add_path) end;
 else next_paths:=array_remove(p_expected_paths,p_remove_path);end if;
 if paths=next_paths then return paths;end if;
 if paths is distinct from p_expected_paths then raise exception 'Список документов изменился. Обновите карточку';end if;
 if cardinality(next_paths)>100 then raise exception 'Слишком много документов';end if;
 perform public.upsert_staff_account_details(p_account_id,p_user_id,jsonb_build_object('passport_photos',to_jsonb(next_paths)));
 return next_paths;
end $$;
revoke all on function public.staff_change_document(uuid,uuid,text[],text,text) from public,anon,service_role;
grant execute on function public.staff_change_document(uuid,uuid,text[],text,text) to authenticated;
notify pgrst,'reload schema';
commit;
