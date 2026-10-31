-- Local prepared archive fixture. Permissions, notifications and commands roll back.
begin;
do $test$
declare u uuid;v uuid;r uuid;n integer;x uuid;f uuid;d date;
begin
 select id into u from auth.users where email='owner@test.com';perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 v:=public.get_active_venue_id();select business_date into d from public.sales_day_archive where venue_id=v order by business_date desc limit 1;
 if d is null then raise exception 'Prepare day archive fixture first';end if;
 perform set_config('test.day_owner',u::text,true);perform set_config('test.day_venue',v::text,true);perform set_config('test.day_date',d::text,true);
 perform set_config('test.day_finance',md5(jsonb_build_object('transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t),'accruals',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_accruals t),'adjustments',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_adjustments t),'banks',(select jsonb_agg(to_jsonb(t) order by id) from public.bank_accounts t))::text),true);
 insert into public.roles(venue_id,name,code) values(v,'Sales comment QA','sales_comment_qa') returning id into r;
 insert into public.role_permissions(role_id,permission_id,granted) select r,id,true from public.permissions where code='sales.view_shifts';
 for n in 1..3 loop
  x:=gen_random_uuid();insert into auth.users(id,aud,role,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values(x,'authenticated','authenticated','sales-comment-'||x||'@qa.invalid','{}','{}',now(),now());
  insert into public.profiles(id,first_name,active_venue_id) values(x,'QA',v) on conflict(id) do update set active_venue_id=v;
  insert into public.user_venue_roles(user_id,venue_id,role_id,status,fired_at) values(x,v,r,'active',case when n=3 then now() else null end);
  perform set_config('test.day_user_'||n,x::text,true);
 end loop;
 -- A separate active role with no sales permission.
 insert into public.roles(venue_id,name,code) values(v,'No sales QA','no_sales_comment_qa') returning id into f;
 insert into public.role_permissions(role_id,permission_id,granted) select f,id,true from public.permissions where code='org.view_audit';
 update public.user_venue_roles set role_id=f where user_id=current_setting('test.day_user_2')::uuid and venue_id=v;
end $test$;
set local role authenticated;
do $test$
declare u uuid:=current_setting('test.day_owner')::uuid;v uuid:=current_setting('test.day_venue')::uuid;d date:=current_setting('test.day_date')::date;c uuid;k uuid:=gen_random_uuid();n bigint;
begin
 c:=public.sales_day_comment_command(v,'create',jsonb_build_object('date',d,'body','QA comment','request_key',k));
 perform set_config('test.day_comment',c::text,true);
 select count(*) into n from public.sales_day_comment_history where comment_id=c;
 if n<>1 or public.sales_day_comment_command(v,'create',jsonb_build_object('date',d,'body','QA comment','request_key',k))<>c or (select count(*) from public.sales_day_comment_history where comment_id=c)<>n then raise exception 'Creation replay duplicated history';end if;
 begin perform public.sales_day_comment_command(v,'create',jsonb_build_object('date',d,'body','Other payload','request_key',k));raise exception 'Conflicting key accepted';exception when raise_exception then if sqlerrm not like 'Этот запрос уже%' then raise;end if;end;
 begin perform public.sales_day_comment_command(gen_random_uuid(),'edit',jsonb_build_object('id',c,'date',d,'body','Bad','version',1));raise exception 'Other venue accepted';exception when raise_exception then if sqlerrm not like 'Заведение изменилось%' then raise;end if;end;
 begin perform public.sales_day_comment_command(v,'edit',jsonb_build_object('id',c,'date',d-1,'body','Bad','version',1));raise exception 'Other day accepted';exception when raise_exception then if sqlerrm not like 'Дата смены изменилась%' then raise;end if;end;
 perform public.sales_day_comment_command(v,'edit',jsonb_build_object('id',c,'date',d,'body','Changed','version',1));
 begin perform public.sales_day_comment_command(v,'edit',jsonb_build_object('id',c,'date',d,'body','Lost change','version',1));raise exception 'Stale edit accepted';exception when raise_exception then if sqlerrm not like 'Комментарий изменился%' then raise;end if;end;
 perform public.sales_day_comment_command(v,'edit',jsonb_build_object('id',c,'date',d,'body','Changed','version',1));
 perform public.sales_day_comment_command(v,'delete',jsonb_build_object('id',c,'date',d,'version',2));
 perform public.sales_day_comment_command(v,'delete',jsonb_build_object('id',c,'date',d,'version',2));
 if public.sales_day_comment_command(v,'create',jsonb_build_object('date',d,'body','QA comment','request_key',k))<>c or not exists(select 1 from public.sales_day_comments where id=c and deleted_at is not null and body='Changed') then raise exception 'Replay changed edited/deleted comment';end if;
 perform public.sales_day_comment_command(v,'restore',jsonb_build_object('id',c,'date',d,'version',3));
 if (select count(*) from public.sales_day_comment_history where comment_id=c)<>4 then raise exception 'No-op duplicated history';end if;
 if has_table_privilege('authenticated','public.sales_day_comments','UPDATE') or has_table_privilege('authenticated','public.sales_day_comment_history','INSERT') or has_function_privilege('anon','public.sales_day_comment_command(uuid,text,jsonb)','EXECUTE') then raise exception 'Unsafe direct grants';end if;
end $test$;
reset role;
do $$ declare c uuid:=current_setting('test.day_comment')::uuid;begin
 if not exists(select 1 from public.notifications where entity_id=c and user_id=current_setting('test.day_user_1')::uuid) then raise exception 'Eligible reader not notified';end if;
 if exists(select 1 from public.notifications where entity_id=c and (user_id in (current_setting('test.day_owner')::uuid,current_setting('test.day_user_2')::uuid,current_setting('test.day_user_3')::uuid) or payload->>'preview_kind'<>'generic' or body like '%QA comment%')) then raise exception 'Notification audience/body leak';end if;
 if exists(select user_id from public.notifications where entity_id=c group by user_id having count(*)<>1) then raise exception 'Notifications duplicated';end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.day_user_1'),true),set_config('app.ctx_ready','0',true);
set local role authenticated;
do $$ declare v uuid:=current_setting('test.day_venue')::uuid;d date:=current_setting('test.day_date')::date;c uuid:=current_setting('test.day_comment')::uuid;begin
 if not exists(select 1 from public.sales_day_archive where venue_id=v) or not exists(select 1 from public.sales_day_comments where id=c) then raise exception 'Sales reader cannot see day/comments';end if;
 if exists(select 1 from public.payroll_day_archive_members) then raise exception 'Individual salary leaked without payroll.view';end if;
 begin perform public.sales_day_comment_command(v,'edit',jsonb_build_object('id',c,'date',d,'body','Other author','version',4));raise exception 'Foreign edit accepted';exception when raise_exception then if sqlerrm not like 'Можно изменять только свой%' then raise;end if;end;
 begin perform public.sales_day_comment_command(v,'delete',jsonb_build_object('id',c,'date',d,'version',4));raise exception 'Foreign delete accepted';exception when raise_exception then if sqlerrm not like 'Нет доступа к изменению%' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.day_user_2'),true),set_config('app.ctx_ready','0',true);
do $$ begin
 if exists(select 1 from public.sales_day_comments) or exists(select 1 from public.sales_day_comment_history) or exists(select 1 from public.sales_day_archive) or exists(select 1 from public.audit_logs where action_code like 'sales.comment.%') then raise exception 'Non-sales audience leak through discussion/archive/global audit';end if;
 begin perform public.sales_day_comment_command(current_setting('test.day_venue')::uuid,'create',jsonb_build_object('date',current_setting('test.day_date'),'body','Denied','request_key',gen_random_uuid()));raise exception 'Non-sales writer accepted';exception when raise_exception then if sqlerrm not like 'Нет доступа к обсуждению%' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','',true),set_config('app.ctx_ready','0',true);
do $$ begin if exists(select 1 from public.sales_day_archive) or exists(select 1 from public.sales_day_comments) then raise exception 'Anonymous leak';end if;end $$;
reset role;
do $$ begin
 if current_setting('test.day_finance') is distinct from md5(jsonb_build_object('transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t),'accruals',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_accruals t),'adjustments',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_adjustments t),'banks',(select jsonb_agg(to_jsonb(t) order by id) from public.bank_accounts t))::text) then raise exception 'Finance/payroll changed';end if;
 raise notice 'PASS: scoped comments/history, wage privacy, own edits, optimistic concurrency, no-op/replay, single eligible notification, direct grants, anonymous denial, unchanged finance/payroll';
end $$;
rollback;
