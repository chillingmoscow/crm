-- All fixtures and financial effects are rolled back.
begin;
do $$
declare u uuid;a uuid;v uuid;e uuid;entry uuid;payload jsonb;n integer;
begin
 select id into u from auth.users where email='owner@test.com';
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 insert into public.payroll_employees(account_id,venue_id,name,role_name,opening_confirmed)
 values(a,v,'Audit rollback fixture','Test',true) returning id into e;
 payload:=jsonb_build_object('id',gen_random_uuid(),'request_key',gen_random_uuid(),'employee_id',e,'date','2026-09-20','kind','bonus','medium','money','amount',1000,'reason','Audit fixture');
 entry:=public.payroll_journal_command('create',payload);
 perform public.payroll_journal_command('create',payload);
 if (select count(*) from public.audit_logs where entity_id=entry and action_code='payroll.adjustment.created' and user_id=u and account_id=a and venue_id=v)<>1 then raise exception 'Missing or duplicate scoped creation audit';end if;
 update public.payroll_adjustments set amount=1100,reason='Updated audit fixture' where id=entry;
 if not exists(select 1 from public.audit_logs where entity_id=entry and action_code='payroll.adjustment.updated' and details->'changes' @> '[{"field":"amount","old":1000,"new":1100}]') then raise exception 'Missing old/new values';end if;
 select count(*) into n from public.audit_logs where entity_id=entry;
 update public.payroll_adjustments set amount=amount where id=entry;
 if (select count(*) from public.audit_logs where entity_id=entry)<>n then raise exception 'No-op generated an event';end if;
 perform public.payroll_journal_command('comment',jsonb_build_object('id',entry,'body','Audit comment','request_key',u));
 perform public.payroll_journal_command('comment',jsonb_build_object('id',entry,'body','Audit comment','request_key',u));
 if (select count(*) from public.audit_logs where entity_id=entry and action_code='payroll.adjustment.commented' and user_id=u)<>1 then raise exception 'Missing or duplicate comment audit';end if;
 insert into storage.objects(bucket_id,name) values('payroll-photos',a||'/'||v||'/'||entry||'/rollback.jpg');
 perform public.payroll_journal_command('photo',jsonb_build_object('id',entry,'path',a||'/'||v||'/'||entry||'/rollback.jpg','name','rollback.jpg'));
 if (select count(*) from public.audit_logs where entity_id=entry and action_code='payroll.adjustment.photo_added' and user_id=u)<>1 then raise exception 'Missing photo audit';end if;
 perform public.payroll_journal_command('delete',jsonb_build_object('id',entry,'reason','Audit rollback deletion'));
 perform public.payroll_journal_command('delete',jsonb_build_object('id',entry,'reason','Repeated delete'));
 if (select count(*) from public.audit_logs where entity_id=entry and action_code='payroll.adjustment.deleted' and details->>'delete_reason'='Audit rollback deletion')<>1 then raise exception 'Missing or duplicate deletion audit';end if;
 -- Background changes keep the affected venue, without borrowing a user session.
 perform set_config('request.jwt.claim.sub','',true);perform set_config('app.ctx_ready','0',true);
 update public.payroll_adjustments set reason='Background adjustment audit' where id=entry;
 if not exists(select 1 from public.audit_logs where entity_id=entry and action_code='payroll.adjustment.updated' and user_id is null and account_id=a and venue_id=v and details->>'reason'='Background adjustment audit') then raise exception 'Background scope was lost';end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='audit_logs' and policyname='payroll_audit_salary_access' and permissive='RESTRICTIVE') then raise exception 'Salary audit is not protected';end if;
 raise notice 'PASS: create, edit diff, no-op, retry, comment, photo, delete, actor, system scope, restrictive policy';
end $$;
rollback;
