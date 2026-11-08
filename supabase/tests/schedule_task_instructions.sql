begin;
do $$
declare u uuid;staff uuid;a uuid;v uuid;page uuid;tpl uuid;def uuid;occ uuid;file_a uuid;file_b uuid;path_a text;path_b text;body jsonb;snap jsonb;denied boolean;
begin
 select id into u from auth.users where email='owner@test.com';select id into staff from auth.users where email='waiter@test.com';
 select active_venue_id into v from public.profiles where id=u;select account_id into a from public.venues where id=v;
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 insert into public.kb_pages(account_id,title,slug,content) values(a,'TEST Task Instruction','test-task-'||gen_random_uuid(),jsonb_build_array(jsonb_build_object('type','paragraph','content',jsonb_build_array(jsonb_build_object('type','text','text','Исходная версия'))))) returning id into page;
 path_a:=a||'/test-task/'||gen_random_uuid()||'.png';path_b:=a||'/test-task/'||gen_random_uuid()||'.png';
 insert into public.account_files(account_id,storage_path,name,mime_type,size_bytes,uploaded_by) values(a,path_a,'TEST instruction','image/png',32,u) returning id into file_a;
 insert into public.account_files(account_id,storage_path,name,mime_type,size_bytes,uploaded_by) values(a,path_b,'TEST private','image/png',32,u) returning id into file_b;
 insert into public.kb_page_attachments(page_id,file_id,attached_by) values(page,file_a,u),(page,file_b,u);
 update public.kb_pages set content=content||jsonb_build_array(jsonb_build_object('type','image','props',jsonb_build_object('url','kbfile://'||path_a))) where id=page;
 insert into storage.objects(bucket_id,name) values('account-attachments',path_a),('account-attachments',path_b);
 insert into public.schedule_templates(venue_id,name,color,start_time,end_time) values(v,'TEST KB Task','blue','09:00','17:00') returning id into tpl;
 body:=jsonb_build_object('request_key',gen_random_uuid(),'name','TEST KB Task','instructions','','instruction_page_id',page,'template_id',tpl,'review_mode','manager','items',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'title','Отметка','kind','check','required',true)),'recurrence',jsonb_build_object('unit','week','interval',1,'anchor',current_date),'starts_on',current_date,'enabled',false,'penalty_enabled',false,'fine_amount',0,'reward_amount',0);
 def:=(public.schedule_task_command('definition.save',body)->>'id')::uuid;
 select to_jsonb(d) into snap from public.schedule_task_definitions d where id=def;
 if not(snap->'instruction_snapshot'->'files' @> jsonb_build_array(jsonb_build_object('path',path_a))) or snap->'instruction_snapshot'->'files' @> jsonb_build_array(jsonb_build_object('path',path_b)) then raise exception 'Снимок включает чужое вложение или потерял своё';end if;
 insert into public.schedule_task_occurrences(account_id,venue_id,definition_id,business_date,snapshot,user_id,status) values(a,v,def,current_date,snap,staff,'in_progress') returning id into occ;
 update public.kb_pages set content='[{"type":"paragraph","content":[{"type":"text","text":"Новая версия"}]}]',updated_at=now() where id=page;
 update public.kb_pages set content=content||jsonb_build_array(jsonb_build_object('type','image','props',jsonb_build_object('url','kbfile://'||path_b))) where id=page;
 if not private.schedule_task_instruction_live_file_read(path_b) then raise exception 'Управляющий не видит новое изображение связанной страницы';end if;
 if (select snapshot from public.schedule_task_occurrences where id=occ)<>snap then raise exception 'Изменение страницы переписало отчёт';end if;
 if private.schedule_task_instruction(page,a)->'content'=snap->'instruction_snapshot'->'content' then raise exception 'Новые назначения не получают новую версию страницы';end if;
 -- Remove broad KB access inside this rolled-back test; task-only access must suffice.
 update public.role_permissions set granted=false where role_id in(select role_id from public.user_venue_roles where user_id=staff and venue_id=v) and permission_id in(select id from public.permissions where code in('kb.view_pages','schedule.view_all','schedule.checklist_edit','schedule.checklist_create','schedule.review'));
 perform set_config('request.jwt.claim.sub',staff::text,true);perform set_config('app.ctx_ready','0',true);
 execute 'set local role authenticated';
 if exists(select 1 from public.kb_pages where id=page) then raise exception 'Сотрудник получил доступ ко всей странице KB';end if;
 if exists(select 1 from public.schedule_task_definitions where id=def) then raise exception 'Исторический исполнитель получил текущую настройку шаблона';end if;
 if not exists(select 1 from public.schedule_task_occurrences where id=occ) then raise exception 'Своя инструкция недоступна';end if;
 if not exists(select 1 from storage.objects where bucket_id='account-attachments' and name=path_a) then raise exception 'Изображение инструкции недоступно без прав KB';end if;
 if exists(select 1 from storage.objects where bucket_id='account-attachments' and name=path_b) then raise exception 'Открыт посторонний файл';end if;
 execute 'reset role';
 raise notice 'PASS: KB page/body/files snapshot, frozen reports, latest page for new assignments, task-only image access without broad KB access, unrelated file denied';
end $$;
rollback;
