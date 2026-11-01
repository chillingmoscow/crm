-- Synthetic file metadata only. No scans or external calls; all changes roll back.
begin;
do $$ begin
 if not exists(select 1 from storage.buckets where id='staff-documents' and not public and allowed_mime_types @> array['image/heic','image/heif']) then raise exception 'Existing bucket MIME upgrade missing';end if;
end $$;
do $$
declare owner_id uuid;v uuid;a uuid;target uuid;viewer uuid;roster uuid;r uuid;path text;
begin
 select id into owner_id from auth.users where email='owner@test.com';
 perform set_config('request.jwt.claim.sub',owner_id::text,true);perform set_config('app.ctx_ready','0',true);
 v:=public.get_active_venue_id();a:=public.get_active_account_id();
 if owner_id is null or a is null or v is null then raise exception 'Owner fixture missing';end if;
 perform set_config('qa.docs_owner',owner_id::text,true);perform set_config('qa.docs_venue',v::text,true);perform set_config('qa.docs_account',a::text,true);
 insert into public.roles(venue_id,name,code) values(v,'Documents roster QA','documents_roster_qa') returning id into r;
 insert into public.role_permissions(role_id,permission_id,granted) select r,id,true from public.permissions where code='people.view_staff';
 target:=gen_random_uuid();roster:=gen_random_uuid();
 insert into auth.users(id,aud,role,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
 select id,'authenticated','authenticated','documents-'||id||'@qa.invalid','{}','{}',now(),now() from unnest(array[target,roster])id;
 insert into public.profiles(id,first_name,active_venue_id) select id,'QA',v from unnest(array[target,roster])id on conflict(id) do update set active_venue_id=v;
 insert into public.user_venue_roles(user_id,venue_id,role_id,status) select id,v,r,'active' from unnest(array[target,roster])id;
 insert into public.roles(venue_id,name,code) values(v,'Documents viewer QA','documents_viewer_qa') returning id into r;
 insert into public.role_permissions(role_id,permission_id,granted) select r,id,true from public.permissions where code in ('people.view_staff','people.view_staff_details');
 viewer:=gen_random_uuid();
 insert into auth.users(id,aud,role,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values(viewer,'authenticated','authenticated','documents-'||viewer||'@qa.invalid','{}','{}',now(),now());
 insert into public.profiles(id,first_name,active_venue_id) values(viewer,'QA',v) on conflict(id) do update set active_venue_id=v;
 insert into public.user_venue_roles(user_id,venue_id,role_id,status) values(viewer,v,r,'active');
 path:=v||'/'||target||'/passport/qa__document__sample.jpg';
 insert into storage.objects(bucket_id,name,metadata) values('staff-documents',path,'{"mimetype":"image/jpeg","size":32}'),('staff-documents',path||'.second','{"mimetype":"image/jpeg","size":32}');
 insert into public.staff_account_details(account_id,user_id,employment_date,medical_book_number,medical_book_date,comment)
 values(a,target,'2026-10-01','QA-PRIVATE','2027-10-01','Preserve other HR data');
 perform set_config('qa.docs_target',target::text,true);perform set_config('qa.docs_viewer',viewer::text,true);perform set_config('qa.docs_roster',roster::text,true);perform set_config('qa.docs_path',path,true);
 perform set_config('qa.docs_hr',md5((select (to_jsonb(h)-array['passport_photos','updated_at','updated_by'])::text from public.staff_account_details h where account_id=a and user_id=target)),true);
 if private.staff_document_access(path,false) then raise exception 'Unlinked file can be read';end if;
 if private.staff_document_access(gen_random_uuid()||'/'||target||'/passport/qa.jpg',true) or private.staff_document_access(v||'/'||gen_random_uuid()||'/passport/qa.jpg',true) then raise exception 'Foreign venue or employee accepted';end if;
end $$;
-- Deliberately broad, rollback-only policy proves the staff boundary cannot be bypassed.
create policy qa_docs_broad_read on storage.objects for select to authenticated using(true);
set local role authenticated;
do $$
declare path text:=current_setting('qa.docs_path');a uuid:=current_setting('qa.docs_account')::uuid;u uuid:=current_setting('qa.docs_target')::uuid;p text[];n integer;
begin
 if exists(select 1 from storage.objects where bucket_id='staff-documents' and name=path) then raise exception 'Unlinked object leaked through broad policy';end if;
 p:=public.staff_change_document(a,u,array[]::text[],path,null);
 if p<>array[path] or not exists(select 1 from storage.objects where bucket_id='staff-documents' and name=path) then raise exception 'Linked file not readable';end if;
 select count(*) into n from public.audit_logs where entity_id=u and action_code='staff.account_details_updated';
 if not exists(select 1 from public.audit_logs l where l.entity_id=u and l.action_code='staff.account_details_updated' and l.user_id=auth.uid() and l.details->'changes' @> jsonb_build_array(jsonb_build_object('field','passport_photos','old','[]'::jsonb,'new',to_jsonb(p)))) then raise exception 'Document attachment audit missing';end if;
 if public.staff_change_document(a,u,array[]::text[],path,null)<>p then raise exception 'Attach replay failed';end if;
 if (select count(*) from public.audit_logs where entity_id=u and action_code='staff.account_details_updated')<>n then raise exception 'Attach replay duplicated audit';end if;
 begin perform public.staff_change_document(a,u,array[]::text[],path||'.second',null);raise exception 'Stale tab replaced current list';exception when raise_exception then if sqlerrm<>'Список документов изменился. Обновите карточку' then raise;end if;end;
 begin perform public.staff_change_document(a,current_setting('qa.docs_viewer')::uuid,p,path||'.second',null);raise exception 'Wrong employee attached';exception when raise_exception then if sqlerrm<>'Проверьте документ и сотрудника' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('qa.docs_roster'),true),set_config('app.ctx_ready','0',true);
do $$ begin
 if exists(select 1 from storage.objects where bucket_id='staff-documents' and name=current_setting('qa.docs_path')) or exists(select 1 from public.staff_account_details where user_id=current_setting('qa.docs_target')::uuid) then raise exception 'Roster-only role read private data';end if;
 begin perform public.staff_change_document(current_setting('qa.docs_account')::uuid,current_setting('qa.docs_target')::uuid,array[current_setting('qa.docs_path')],null,current_setting('qa.docs_path'));raise exception 'Roster-only role changed documents';exception when raise_exception then if sqlerrm<>'Нет доступа к документам сотрудника' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('qa.docs_viewer'),true),set_config('app.ctx_ready','0',true);
do $$ begin
 if not exists(select 1 from storage.objects where bucket_id='staff-documents' and name=current_setting('qa.docs_path')) then raise exception 'Private viewer cannot read linked file';end if;
 if private.staff_document_access(current_setting('qa.docs_path'),true) then raise exception 'Viewer has write access';end if;
 begin insert into storage.objects(bucket_id,name) values('staff-documents',current_setting('qa.docs_venue')||'/'||current_setting('qa.docs_target')||'/passport/denied.jpg');raise exception 'Viewer uploaded a file';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('qa.docs_owner'),true),set_config('app.ctx_ready','0',true);
do $$ declare p text[];begin
 p:=public.staff_change_document(current_setting('qa.docs_account')::uuid,current_setting('qa.docs_target')::uuid,array[current_setting('qa.docs_path')],null,current_setting('qa.docs_path'));
 if cardinality(p)<>0 or exists(select 1 from storage.objects where bucket_id='staff-documents' and name=current_setting('qa.docs_path')) then raise exception 'Detached file remains readable';end if;
 if cardinality(public.staff_change_document(current_setting('qa.docs_account')::uuid,current_setting('qa.docs_target')::uuid,array[current_setting('qa.docs_path')],null,current_setting('qa.docs_path')))<>0 then raise exception 'Detach replay failed';end if;
end $$;
reset role;
do $$ begin
 if not exists(select 1 from storage.objects where bucket_id='staff-documents' and name=current_setting('qa.docs_path')) then raise exception 'Detach irreversibly deleted private bytes';end if;
 if current_setting('qa.docs_hr')<>md5((select (to_jsonb(h)-array['passport_photos','updated_at','updated_by'])::text from public.staff_account_details h where account_id=current_setting('qa.docs_account')::uuid and user_id=current_setting('qa.docs_target')::uuid)) then raise exception 'Document update changed other HR fields';end if;
 if has_function_privilege('anon','public.staff_change_document(uuid,uuid,text[],text,text)','execute') or (select public from storage.buckets where id='staff-documents') then raise exception 'Unsafe public access';end if;
 raise notice 'PASS: private linked files, explicit document permission, foreign scope denied, optimistic updates, replay, preserved HR data and recoverable detach';
end $$;
rollback;
