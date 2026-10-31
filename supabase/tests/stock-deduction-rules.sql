-- Local source fixture required. All settings and audit changes roll back.
begin;
do $test$
declare u uuid;a uuid;v uuid;r uuid;x uuid;role_id uuid;c jsonb;
begin
 select id into u from auth.users where email='owner@test.com';perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);a:=public.get_active_account_id();v:=public.get_active_venue_id();
 select id into role_id from public.roles where venue_id=v and archived_at is null order by id limit 1;
 c:=jsonb_build_object('enabled',true,'companyAllowance',10000,'multiplier',1.1,'ingredientTolerance',250,'distribution','groups','split','pending','inventoryExclusions','[]'::jsonb,'roleSpecificCategories','[]'::jsonb,'writeoffReasons','["Бой посуды"]'::jsonb,'excludedRoleIds','[]'::jsonb,'groups',jsonb_build_array(jsonb_build_object('id','qa','name','QA','share',100,'roleIds',jsonb_build_array(role_id),'categories','[]'::jsonb)));
 perform set_config('test.stock_cfg',c::text,true);perform set_config('test.stock_owner',u::text,true);perform set_config('test.stock_a',a::text,true);perform set_config('test.stock_v',v::text,true);perform set_config('test.stock_date',((now() at time zone 'Europe/Moscow')::date)::text,true);
 perform set_config('test.stock_money',md5(jsonb_build_object('transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t),'accruals',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_accruals t),'adjustments',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_adjustments t),'banks',(select jsonb_agg(to_jsonb(t) order by id) from public.bank_accounts t),'notifications',(select jsonb_agg(to_jsonb(t) order by id) from public.notifications t))::text),true);
 insert into public.roles(venue_id,name,code) values(v,'Stock rules QA','stock_rules_qa') returning id into r;
 insert into public.role_permissions(role_id,permission_id,granted) select r,id,true from public.permissions where code='inventory.view_results';
 x:=gen_random_uuid();insert into auth.users(id,aud,role,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values(x,'authenticated','authenticated','stock-rules-'||x||'@qa.invalid','{}','{}',now(),now());
 insert into public.profiles(id,first_name,active_venue_id) values(x,'QA',v) on conflict(id) do update set active_venue_id=v;
 insert into public.user_venue_roles(user_id,venue_id,role_id,status) values(x,v,r,'active');perform set_config('test.stock_reader',x::text,true);
 insert into public.roles(venue_id,name,code) values(v,'No rules QA','no_stock_rules_qa') returning id into r;
 insert into public.role_permissions(role_id,permission_id,granted) select r,id,true from public.permissions where code='org.view_audit';
 x:=gen_random_uuid();insert into auth.users(id,aud,role,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values(x,'authenticated','authenticated','stock-rules-denied-'||x||'@qa.invalid','{}','{}',now(),now());
 insert into public.profiles(id,first_name,active_venue_id) values(x,'QA',v) on conflict(id) do update set active_venue_id=v;
 insert into public.user_venue_roles(user_id,venue_id,role_id,status) values(x,v,r,'active');perform set_config('test.stock_denied',x::text,true);
 perform set_config('test.stock_version',(select coalesce(max(version),0)::text from public.stock_deduction_rules where venue_id=v),true);
end $test$;
set local role authenticated;
do $test$
declare v uuid:=current_setting('test.stock_v')::uuid;a uuid:=current_setting('test.stock_a')::uuid;cfg jsonb:=current_setting('test.stock_cfg')::jsonb;d date:=current_setting('test.stock_date')::date;n integer:=current_setting('test.stock_version')::integer;x uuid;y uuid;
begin
 x:=public.stock_save_deduction_rules(v,n,d,cfg,'QA initial');
 if public.stock_save_deduction_rules(v,n,d,cfg,'QA initial')<>x then raise exception 'Lost response created another version';end if;
 if (select count(*) from public.stock_deduction_rules where venue_id=v and version>n)<>1 then raise exception 'Replay duplicated a rule';end if;
 y:=public.stock_save_deduction_rules(v,n+1,d+1,jsonb_set(cfg,'{companyAllowance}','5000'),'QA dated change');
 if (select config->>'companyAllowance' from public.stock_deduction_rules where id=x)<>'10000' or x=y then raise exception 'Old version overwritten';end if;
 begin perform public.stock_save_deduction_rules(v,n,d,cfg,'QA stale');raise exception 'Stale save accepted';exception when raise_exception then if sqlerrm not like 'Правила изменились%' then raise;end if;end;
 begin perform public.stock_save_deduction_rules(gen_random_uuid(),n+2,d,cfg,'QA scope');raise exception 'Other venue accepted';exception when raise_exception then if sqlerrm not like 'Заведение изменилось%' then raise;end if;end;
 begin perform public.stock_save_deduction_rules(v,n+2,d-1,cfg,'QA retro');raise exception 'Backdate accepted';exception when raise_exception then if sqlerrm not like 'Новые правила%' then raise;end if;end;
 begin perform public.stock_save_deduction_rules(v,n+2,d,cfg||'{"extra":true}','QA unknown');raise exception 'Unknown config accepted';exception when raise_exception then if sqlerrm not like 'Проверьте правила%' then raise;end if;end;
 begin perform public.stock_save_deduction_rules(v,n+2,d,jsonb_set(cfg,'{companyAllowance}','-1'),'QA negative');raise exception 'Negative allowance accepted';exception when raise_exception then if sqlerrm not like 'Проверьте суммы%' then raise;end if;end;
 begin perform public.stock_save_deduction_rules(v,n+2,d,jsonb_set(cfg,'{groups,0,share}','101'),'QA shares');raise exception 'Over 100 accepted';exception when raise_exception then if sqlerrm not like 'Проверьте группы%' then raise;end if;end;
 begin perform public.stock_save_deduction_rules(v,n+2,d,jsonb_set(cfg,'{groups,0,roleIds}',jsonb_build_array(gen_random_uuid())),'QA foreign role');raise exception 'Foreign role accepted';exception when raise_exception then if sqlerrm not like 'Должность повторяется%' then raise;end if;end;
 begin perform public.stock_save_deduction_rules(v,n+2,d,jsonb_set(cfg,'{excludedRoleIds}',cfg->'groups'->0->'roleIds'),'QA duplicate role');raise exception 'Role in exclusion and group accepted';exception when raise_exception then if sqlerrm not like 'Исключённая должность%' then raise;end if;end;
 begin perform public.stock_save_deduction_rules(v,n+2,d,jsonb_set(cfg,'{excludedRoleIds}',jsonb_build_array(upper(cfg#>>'{groups,0,roleIds,0}'))),'QA case duplicate');raise exception 'Case-variant role accepted twice';exception when raise_exception then if sqlerrm not like 'Исключённая должность%' then raise;end if;end;
 begin perform public.stock_save_deduction_rules(v,n+2,d,jsonb_set(cfg,'{writeoffReasons}','["Ｂ","B"]'),'QA Unicode');raise exception 'Unicode duplicate accepted';exception when raise_exception then if sqlerrm not like 'Проверьте списки%' then raise;end if;end;
 if has_table_privilege('authenticated','public.stock_deduction_rules','INSERT') or has_table_privilege('authenticated','public.stock_deduction_rules','UPDATE') or has_table_privilege('authenticated','public.stock_deduction_rules','DELETE') or has_function_privilege('anon','public.stock_save_deduction_rules(uuid,integer,date,jsonb,text)','EXECUTE') then raise exception 'Unsafe direct grants';end if;
 if has_table_privilege('service_role','public.stock_deduction_rules','INSERT') or has_table_privilege('service_role','public.stock_deduction_rules','UPDATE') or has_table_privilege('service_role','public.stock_deduction_rules','DELETE') then raise exception 'Service can rewrite rule history';end if;
 if not exists(select 1 from public.audit_logs where action_code='stock.deductions.rules_saved' and details->>'version'=(n+1)::text and user_id=auth.uid()) then raise exception 'No actor/audit';end if;
end $test$;
select set_config('request.jwt.claim.sub',current_setting('test.stock_reader'),true),set_config('app.ctx_ready','0',true);
do $$ begin
 if not exists(select 1 from public.stock_deduction_rules) then raise exception 'Inventory reader cannot read rules';end if;
 begin perform public.stock_save_deduction_rules(current_setting('test.stock_v')::uuid,0,current_setting('test.stock_date')::date,current_setting('test.stock_cfg')::jsonb,'QA non-owner');raise exception 'Non-owner saved';exception when raise_exception then if sqlerrm not like 'Настройки удержаний%' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.stock_denied'),true),set_config('app.ctx_ready','0',true);
do $$ begin if exists(select 1 from public.stock_deduction_rules) or exists(select 1 from public.audit_logs where action_code like 'stock.deductions.%') then raise exception 'Rules/audit leak to non-reader';end if;end $$;
select set_config('request.jwt.claim.sub','',true),set_config('app.ctx_ready','0',true);
do $$ begin if exists(select 1 from public.stock_deduction_rules) then raise exception 'Rules leak without user';end if;end $$;
reset role;
do $$ begin
 if current_setting('test.stock_money') is distinct from md5(jsonb_build_object('transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t),'accruals',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_accruals t),'adjustments',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_adjustments t),'banks',(select jsonb_agg(to_jsonb(t) order by id) from public.bank_accounts t),'notifications',(select jsonb_agg(to_jsonb(t) order by id) from public.notifications t))::text) then raise exception 'Settings changed money/payroll';end if;
 raise notice 'PASS: owner-only dated immutable rules, retry/version safety, scope, active roles, Unicode/list/amount validation, audit privacy, no financial/payroll effects';
end $$;
rollback;
