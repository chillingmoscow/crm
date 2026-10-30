begin;
do $test$
declare u uuid;a uuid;v uuid;e uuid;role_id uuid;bank public.bank_accounts;cfg public.payroll_automation_settings;
 today date;first_day date;part_date date;parts jsonb:='[]';input jsonb;key uuid:=gen_random_uuid();issue uuid;tx public.transactions;category uuid;before_balance numeric;before_tx bigint;n integer;
begin
 select id into u from auth.users where email='owner@test.com';
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 select id into role_id from public.roles where venue_id=v and archived_at is null order by id limit 1;
 if role_id is null then raise exception 'A local role fixture is required';end if;
 insert into public.payroll_employees(account_id,venue_id,name,role_name,role_id,active,quickresto_id)
 values(a,v,'Uniform financial fixture','Бармен',role_id,true,999999982) returning id into e;
 select * into bank from public.bank_accounts where account_id=a and is_active and deleted_at is null and currency='RUB' and (venue_id is null or venue_id=v) order by id limit 1;
 if bank.id is null then raise exception 'A local bank account fixture is required';end if;
 select * into cfg from public.payroll_automation_settings where venue_id=v;
 if cfg.version is null then raise exception 'Save local automation settings first';end if;
 update public.payroll_automation_settings set config=jsonb_set(jsonb_set(config,'{uniform,installments}','4'),'{uniform,payment_days}','[3,18]') where venue_id=v;
 select * into cfg from public.payroll_automation_settings where venue_id=v;
 today:=(now() at time zone 'Europe/Moscow')::date;
 select d::date into first_day from generate_series(today,today+35,'1 day') d where extract(day from d) in (3,18) order by d limit 1;
 part_date:=first_day;
 for n in 1..4 loop
  parts:=parts||jsonb_build_array(jsonb_build_object('dueOn',part_date,'amount',case when n=4 then 250.03 else 250.00 end));
  select d::date into part_date from generate_series(part_date+1,part_date+35,'1 day') d where extract(day from d) in (3,18) order by d limit 1;
 end loop;
 input:=jsonb_build_object('request_id',key,'employee_id',e,'role_id',role_id,'bank_account_id',bank.id,'title','Футболка','purchased_on',today,'amount',1000.03,'installments',parts,'settings_version',cfg.version);
 before_balance:=bank.balance;select count(*) into before_tx from public.transactions;
 issue:=public.payroll_purchase_uniform(input);
 select t.* into tx from public.transactions t join public.payroll_uniform_issues i on i.expense_transaction_id=t.id where i.id=issue;
 select id into category from public.finance_categories where payroll_role_id=role_id;
 if tx.amount<>1000.03 or tx.category_id<>category or tx.type<>'expense' or tx.bank_account_id<>bank.id then raise exception 'Wrong linked FOT expense';end if;
 if (select balance from public.bank_accounts where id=bank.id)<>before_balance-1000.03 then raise exception 'Expense did not reduce account once';end if;
 if public.payroll_purchase_uniform(input)<>issue or (select count(*) from public.transactions)<>before_tx+1 then raise exception 'Lost-response retry duplicated expense';end if;
 update public.payroll_automation_settings set version=version+1 where venue_id=v;
 if public.payroll_purchase_uniform(input)<>issue then raise exception 'Completed retry depends on current settings';end if;
 begin
  perform public.payroll_purchase_uniform(jsonb_set(input,'{amount}','1000.04'));raise exception 'Changed retry accepted';
 exception when raise_exception then if sqlerrm<>'Повторный запрос изменён' then raise;end if;end;
 begin
  update public.transactions set amount=amount+1 where id=tx.id;raise exception 'Linked expense edited';
 exception when raise_exception then if sqlerrm not like 'Реквизиты связаны%' then raise;end if;end;
 begin
  perform public.finance_soft_delete_transaction(tx.id);raise exception 'Live installments lost expense';
 exception when raise_exception then if sqlerrm not like 'Сначала отмените будущие%' then raise;end if;end;
 begin
  perform public.payroll_purchase_uniform(jsonb_set(input,'{request_id}',to_jsonb(gen_random_uuid())));raise exception 'Stale settings accepted';
 exception when raise_exception then if sqlerrm not like 'Правила изменились%' then raise;end if;end;
 begin
  perform public.payroll_purchase_uniform(jsonb_set(jsonb_set(input,'{request_id}',to_jsonb(gen_random_uuid())),'{role_id}',to_jsonb(gen_random_uuid())));raise exception 'Changed employee role accepted';
 exception when raise_exception then if sqlerrm not like 'Должность изменилась%' then raise;end if;end;
 begin
  perform public.payroll_purchase_uniform(jsonb_set(jsonb_set(input,'{request_id}',to_jsonb(gen_random_uuid())),'{bank_account_id}',to_jsonb(gen_random_uuid())));raise exception 'Unavailable bank accepted';
 exception when raise_exception then if sqlerrm<>'Счёт недоступен' then raise;end if;end;
 if (select count(*) from public.transactions)<>before_tx+1 or (select count(*) from public.payroll_uniform_issues where employee_id=e)<>1 then raise exception 'Rejected purchase left a partial write';end if;
 perform public.payroll_cancel_uniform_issue(issue,'Проверка прекращения удержаний');
 perform public.finance_soft_delete_transaction(tx.id);
 if (select balance from public.bank_accounts where id=bank.id)<>before_balance then raise exception 'Expense cancellation did not return money once';end if;
 begin
  perform public.finance_restore_transaction(tx.id);raise exception 'Cancelled purchase restored directly';
 exception when raise_exception then if sqlerrm not like 'Отменённую покупку нельзя%' then raise;end if;end;
 if not exists(select 1 from public.audit_logs where entity_id=issue and action_code='payroll.uniform.expense_linked' and user_id=u)
 or not exists(select 1 from public.audit_logs where entity_id=tx.id and action_code='finance.transaction.created' and user_id=u) then raise exception 'Purchase/expense actor history missing';end if;
 if has_function_privilege('authenticated','public.payroll_add_uniform_issue(uuid,text,jsonb,uuid)','EXECUTE') or has_function_privilege('anon','public.payroll_purchase_uniform(jsonb)','EXECUTE') then raise exception 'Unsafe purchase grants';end if;
 raise notice 'PASS: atomic linked FOT expense, exact residual, balance once, lost response, changed retry, settings version, protected edits, cancellation and audit';
end $test$;
rollback;
