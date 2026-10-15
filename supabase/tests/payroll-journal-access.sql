begin;
do $$
declare owner_id uuid;staff_id uuid:=gen_random_uuid();a uuid;v uuid;role_id uuid;e uuid;other uuid;entry uuid;private_entry uuid;request uuid:=gen_random_uuid();
begin
 select id into owner_id from auth.users where email='owner@test.com';
 perform set_config('request.jwt.claim.sub',owner_id::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 insert into auth.users(id,email) values(staff_id,'payroll-rollback@example.invalid');
 insert into public.profiles(id,first_name,active_venue_id) values(staff_id,'Rollback staff',v) on conflict(id) do update set active_venue_id=v;
 insert into public.roles(venue_id,name,code) values(v,'No payroll permissions rollback','payroll_no_permissions_rollback') returning id into role_id;
 insert into public.user_venue_roles(user_id,venue_id,role_id,status) values(staff_id,v,role_id,'active');
 insert into public.payroll_employees(account_id,venue_id,local_user_id,name,role_name) values(a,v,staff_id,'Own rollback record','Test') returning id into e;
 insert into public.payroll_employees(account_id,venue_id,name,role_name) values(a,v,'Other rollback record','Test') returning id into other;
 entry:=public.payroll_journal_command('create',jsonb_build_object('request_key',gen_random_uuid(),'employee_id',e,'date','2026-09-21','kind','bonus','medium','money','amount',10,'reason','Own record'));
 private_entry:=public.payroll_journal_command('create',jsonb_build_object('request_key',gen_random_uuid(),'employee_id',other,'date','2026-09-21','kind','bonus','medium','money','amount',20,'reason','Other record'));
 perform set_config('request.jwt.claim.sub',staff_id::text,true);perform set_config('app.ctx_ready','0',true);
 if not private.payroll_read(a,v,e) or private.payroll_read(a,v,other) then raise exception 'Own employee permission boundary failed';end if;
 perform public.payroll_journal_command('comment',jsonb_build_object('id',entry,'body','Own comment','request_key',request));
 if not exists(select 1 from public.notifications where user_id=owner_id and entity_id=entry and type='staff.payroll_comment') then raise exception 'Comment did not notify the creator';end if;
 begin perform public.payroll_journal_command('comment',jsonb_build_object('id',private_entry,'body','Forbidden comment','request_key',gen_random_uuid()));raise exception 'foreign-comment-accepted';exception when others then if sqlerrm='foreign-comment-accepted' then raise;end if;end;
 begin perform public.payroll_journal_command('delete',jsonb_build_object('id',entry,'reason','Forbidden deletion'));raise exception 'own-deletion-accepted';exception when others then if sqlerrm='own-deletion-accepted' then raise;end if;end;
 execute 'set local role authenticated';
 if exists(select 1 from public.payroll_adjustments where id=private_entry) or not exists(select 1 from public.payroll_adjustments where id=entry) then raise exception 'Adjustment RLS failed';end if;
 if exists(select 1 from public.payroll_adjustment_history where adjustment_id=private_entry) then raise exception 'History RLS leaked';end if;
 if has_function_privilege('authenticated','public.payroll_resolve_bonus(uuid,numeric,bigint,bigint)','execute') then raise exception 'Bonus resolver is client accessible';end if;
 execute 'reset role';
 raise notice 'PASS: employee sees own journal, can comment, creator notification, cannot read others or delete, history RLS, service-only bonus resolver';
end $$;
rollback;
