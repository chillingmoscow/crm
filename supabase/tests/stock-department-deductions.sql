-- Local only. New department-based settings must preserve history and money.
begin;
do $test$
declare u uuid;a uuid;v uuid;d1 uuid;d2 uuid;d3 uuid;other_v uuid;foreign_d uuid;c jsonb;
begin
 select id into strict u from auth.users where email='owner@test.com';
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 insert into public.departments(venue_id,name) values(v,'QA Бар') returning id into d1;
 insert into public.departments(venue_id,name) values(v,'QA Зал') returning id into d2;
 insert into public.departments(venue_id,name,archived_at) values(v,'QA Архив',now()) returning id into d3;
 insert into public.venues(account_id,name) values(a,'QA foreign department scope') returning id into other_v;
 insert into public.departments(venue_id,name) values(other_v,'QA Чужое') returning id into foreign_d;
 c:=jsonb_build_object('enabled',true,'companyAllowance',10000,'multiplier',1.1,'ingredientTolerance',250,
  'distribution','departments','split','once','inventoryExclusions','[]'::jsonb,'roleSpecificCategories','[]'::jsonb,
  'writeoffReasons','["Бой посуды"]'::jsonb,'excludedRoleIds','[]'::jsonb,'excludedDepartmentIds','[]'::jsonb,
  'groups',jsonb_build_array(
   jsonb_build_object('id','bar','name','Бар','share',55,'roleIds','[]'::jsonb,'departmentIds',jsonb_build_array(d1),'categories','[]'::jsonb),
   jsonb_build_object('id','hall','name','Зал','share',45,'roleIds','[]'::jsonb,'departmentIds',jsonb_build_array(d2),'categories','[]'::jsonb)));
 perform set_config('test.dep_cfg',c::text,true);perform set_config('test.dep_venue',v::text,true);
 perform set_config('test.dep_foreign',foreign_d::text,true);perform set_config('test.dep_archived',d3::text,true);
 perform set_config('test.dep_version',(select coalesce(max(version),0)::text from public.stock_deduction_rules where venue_id=v),true);
 perform set_config('test.dep_history',(select coalesce(md5(jsonb_agg(to_jsonb(t) order by id)::text),'empty') from public.stock_deduction_rules t where venue_id=v),true);
 perform set_config('test.dep_money',md5(jsonb_build_object(
  'transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t),
  'accruals',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_accruals t),
  'adjustments',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_adjustments t),
  'banks',(select jsonb_agg(to_jsonb(t) order by id) from public.bank_accounts t),
  'notifications',(select jsonb_agg(to_jsonb(t) order by id) from public.notifications t))::text),true);
end $test$;
set local role authenticated;
do $test$
declare c jsonb:=current_setting('test.dep_cfg')::jsonb;v uuid:=current_setting('test.dep_venue')::uuid;
 n int:=current_setting('test.dep_version')::int;d date:=(now() at time zone 'Europe/Moscow')::date;x uuid;
begin
 x:=public.stock_save_deduction_rules(v,n,d,c,'QA departments');
 if public.stock_save_deduction_rules(v,n,d,c,'QA departments')<>x then raise exception 'Replay duplicated department policy';end if;
 if (select config from public.stock_deduction_rules where id=x)<>c then raise exception 'Department settings were not stored';end if;
 if (select coalesce(md5(jsonb_agg(to_jsonb(t) order by id)::text),'empty') from public.stock_deduction_rules t where venue_id=v and version<=n) is distinct from current_setting('test.dep_history') then raise exception 'Historical settings changed';end if;
 begin perform public.stock_save_deduction_rules(v,n+1,d,jsonb_set(c,'{groups,0,departmentIds}',jsonb_build_array(current_setting('test.dep_foreign'))),'QA foreign');raise exception 'Foreign department accepted';exception when raise_exception then if sqlerrm not like 'Подразделение повторяется%' then raise;end if;end;
 begin perform public.stock_save_deduction_rules(v,n+1,d,jsonb_set(c,'{groups,0,departmentIds}',jsonb_build_array(current_setting('test.dep_archived'))),'QA archived');raise exception 'Archived department accepted';exception when raise_exception then if sqlerrm not like 'Подразделение повторяется%' then raise;end if;end;
 begin perform public.stock_save_deduction_rules(v,n+1,d,jsonb_set(c,'{groups,1,departmentIds}',jsonb_build_array(upper(c#>>'{groups,0,departmentIds,0}'))),'QA duplicate');raise exception 'Department allocated twice';exception when raise_exception then if sqlerrm not like 'Подразделение повторяется%' then raise;end if;end;
 begin perform public.stock_save_deduction_rules(v,n+1,d,jsonb_set(c,'{excludedDepartmentIds}',c#>'{groups,0,departmentIds}'),'QA excluded');raise exception 'Department included and excluded';exception when raise_exception then if sqlerrm not like 'Исключённое подразделение%' then raise;end if;end;
 begin perform public.stock_save_deduction_rules(v,n+1,d,jsonb_set(c,'{groups,0,departmentIds}','[]'),'QA empty');raise exception 'Positive group without department accepted';exception when raise_exception then if sqlerrm not like 'Выберите подразделения%' then raise;end if;end;
 begin perform public.stock_save_deduction_rules(v,n+1,d,jsonb_set(c,'{split}','"two_payments"'),'QA split');raise exception 'Obsolete split accepted for departments';exception when raise_exception then if sqlerrm not like 'Распределение на несколько%' then raise;end if;end;
 begin perform public.stock_save_deduction_rules(v,n+1,d,jsonb_set(c,'{groups,0,departmentIds}','null'),'QA null');raise exception 'Null department IDs accepted';exception when raise_exception then if sqlerrm not like 'Проверьте подразделения%' then raise;end if;end;
 begin perform public.stock_save_deduction_rules(v,n+1,d,jsonb_set(c,'{groups,0,departmentIds}','[123]'),'QA numeric');raise exception 'Invalid department ID accepted';exception when raise_exception then if sqlerrm not like 'Проверьте подразделения%' then raise;end if;end;
 if has_function_privilege('anon','private.stock_validate_deduction_roles_v286(jsonb,uuid,uuid)','EXECUTE') or has_function_privilege('authenticated','private.stock_validate_deduction_rules(jsonb,uuid,uuid)','EXECUTE') then raise exception 'Private validator exposed';end if;
end $test$;
reset role;
do $test$ begin
 if current_setting('test.dep_money') is distinct from md5(jsonb_build_object(
  'transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t),
  'accruals',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_accruals t),
  'adjustments',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_adjustments t),
  'banks',(select jsonb_agg(to_jsonb(t) order by id) from public.bank_accounts t),
  'notifications',(select jsonb_agg(to_jsonb(t) order by id) from public.notifications t))::text) then raise exception 'Settings altered payroll/money';end if;
 raise notice 'PASS: department policies, immutable history, idempotency, scope, archived/duplicate/invalid IDs, no payroll or financial effects';
end $test$;
rollback;
