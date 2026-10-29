begin;
-- A new purchase and its single FOT expense share one database transaction.
-- Legacy archive events deliberately do not create purchases/expenses.
alter table public.payroll_uniform_issues
 add column expense_transaction_id uuid unique references public.transactions(id) on delete restrict,
 add column purchased_on date,
 add column purchase_snapshot jsonb;

-- The original source-only helper is now internal; a browser cannot bypass the expense.
revoke execute on function public.payroll_add_uniform_issue(uuid,text,jsonb,uuid) from authenticated;
create function public.payroll_purchase_uniform(p_input jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare a uuid;v uuid;u uuid;request uuid;emp public.payroll_employees;bank public.bank_accounts;
 existing public.payroll_uniform_issues;cfg public.payroll_automation_settings;
 category uuid;tx uuid;issue uuid;total numeric:=0;part jsonb;part_index integer:=0;base numeric;purchase_day date;due date;previous date;expected date;tz text;
begin
 select s.a,s.v,s.u into a,v,u from private.payroll_scope('payroll.configure') s;
 if not public.has_permission('finance.create_transaction') then raise exception 'Нет доступа к созданию расходов';end if;
 if p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>8192
 or not(p_input ?& array['request_id','employee_id','role_id','bank_account_id','title','purchased_on','amount','installments','settings_version'])
 or p_input-array['request_id','employee_id','role_id','bank_account_id','title','purchased_on','amount','installments','settings_version']<>'{}'::jsonb
 then raise exception 'Проверьте покупку формы';end if;
 request:=(p_input->>'request_id')::uuid;
 if request is null then raise exception 'Не указан ключ покупки';end if;
 perform pg_advisory_xact_lock(hashtextextended('payroll-automation:'||v::text,0));
 select * into existing from public.payroll_uniform_issues where id=request;
 if existing.id is not null then
  if existing.account_id<>a or existing.venue_id<>v or existing.purchase_snapshot is distinct from p_input then raise exception 'Повторный запрос изменён';end if;
  return existing.id;
 end if;
 select * into emp from public.payroll_employees where id=(p_input->>'employee_id')::uuid and account_id=a and venue_id=v for update;
 if emp.id is null or not emp.active then raise exception 'Выберите действующего сотрудника';end if;
 if emp.role_id is null or emp.role_id is distinct from (p_input->>'role_id')::uuid then raise exception 'Должность изменилась. Обновите страницу';end if;
 select c.id into category from public.finance_categories c join public.roles r on r.id=c.payroll_role_id
 join public.finance_category_groups g on g.id=c.group_id and g.account_id=a and g.is_payroll
 where r.id=emp.role_id and r.venue_id=v and r.archived_at is null and c.account_id=a and c.type='expense' and c.archived_at is null;
 if category is null then raise exception 'Проверьте статью должности в ФОТ';end if;
 select * into bank from public.bank_accounts where id=(p_input->>'bank_account_id')::uuid and account_id=a and is_active and deleted_at is null;
 if bank.id is null or bank.currency<>'RUB' or (bank.venue_id is not null and bank.venue_id<>v)
 or (bank.legal_entity_id is distinct from public.get_active_legal_entity_id() and not public.has_permission('finance.view_all_legal_entities'))
 then raise exception 'Счёт недоступен';end if;
 select * into cfg from public.payroll_automation_settings where venue_id=v and account_id=a;
 if cfg.version is null or cfg.version is distinct from (p_input->>'settings_version')::integer then raise exception 'Правила изменились. Обновите страницу';end if;
 if not (cfg.config->'uniform'->>'enabled')::boolean then raise exception 'Возмещение формы отключено в настройках';end if;
 select coalesce(timezone,'Europe/Moscow') into tz from public.venues where id=v;
 purchase_day:=(p_input->>'purchased_on')::date;
 if purchase_day is null or purchase_day>(now() at time zone tz)::date then raise exception 'Проверьте дату покупки';end if;
 if jsonb_typeof(p_input->'amount') is distinct from 'number' or (p_input->>'amount')::numeric<=0
 or (p_input->>'amount')::numeric>1000000 or (p_input->>'amount')::numeric<>round((p_input->>'amount')::numeric,2)
 or jsonb_typeof(p_input->'installments') is distinct from 'array' then raise exception 'Проверьте стоимость';end if;
 if jsonb_array_length(p_input->'installments') is distinct from (cfg.config->'uniform'->>'installments')::integer then raise exception 'Число удержаний не соответствует настройкам';end if;
 base:=trunc((p_input->>'amount')::numeric*100/jsonb_array_length(p_input->'installments'))/100;
 for part in select value from jsonb_array_elements(p_input->'installments') loop
  part_index:=part_index+1;
  if (part->>'amount')::numeric is distinct from (case when part_index=jsonb_array_length(p_input->'installments') then (p_input->>'amount')::numeric-base*(part_index-1) else base end) then raise exception 'Проверьте суммы удержаний';end if;
  due:=(part->>'dueOn')::date;
  if due is null or due<purchase_day or not exists(select 1 from jsonb_array_elements_text(cfg.config->'uniform'->'payment_days') d where d::integer=extract(day from due)) then raise exception 'Проверьте дату удержания';end if;
  if previous is not null then
   select d::date into expected from generate_series(previous+1,previous+40,'1 day'::interval) d
   where exists(select 1 from jsonb_array_elements_text(cfg.config->'uniform'->'payment_days') day_value where day_value::integer=extract(day from d)) order by d limit 1;
   if due is distinct from expected then raise exception 'Удержания должны идти по порядку';end if;
  end if;
  previous:=due;total:=total+(part->>'amount')::numeric;
 end loop;
 if total is distinct from (p_input->>'amount')::numeric then raise exception 'Части не совпадают со стоимостью';end if;
 -- The helper validates each monetary part and the title before either write commits.
 issue:=public.payroll_add_uniform_issue(emp.id,p_input->>'title',p_input->'installments',request);
 insert into public.transactions(account_id,venue_id,legal_entity_id,bank_account_id,type,amount,currency,category_id,description,date,source,source_external_id,created_by)
 values(a,v,bank.legal_entity_id,bank.id,'expense',total,'RUB',category,'Рабочая форма: '||emp.name||' · '||trim(p_input->>'title'),(purchase_day+time '12:00') at time zone tz,'manual','payroll-uniform:'||request::text,u) returning id into tx;
 update public.payroll_uniform_issues set expense_transaction_id=tx,purchased_on=purchase_day,purchase_snapshot=p_input where id=issue;
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details)
 values(a,v,u,'payroll.uniform.expense_linked','payroll_uniform',issue,jsonb_build_object('employee_name',emp.name,'employee_id',emp.id,'title',trim(p_input->>'title'),'amount',total,'transaction_id',tx,'category_id',category));
 return issue;
end $$;
revoke all on function public.payroll_purchase_uniform(jsonb) from public,anon;
grant execute on function public.payroll_purchase_uniform(jsonb) to authenticated;

-- Linked expenses cannot drift from the purchase or disappear while future
-- installments remain due. Finance still owns the money/balance cancellation.
create function private.payroll_uniform_transaction_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare issue public.payroll_uniform_issues;
begin
 select * into issue from public.payroll_uniform_issues where expense_transaction_id=old.id;
 if issue.id is null then if tg_op='DELETE' then return old;else return new;end if;end if;
 if tg_op='DELETE' then raise exception 'Связанный расход можно только отменить';end if;
 if (to_jsonb(old)-array['deleted_at','deleted_by','updated_at','updated_by']) is distinct from (to_jsonb(new)-array['deleted_at','deleted_by','updated_at','updated_by']) then raise exception 'Реквизиты связаны с покупкой формы. Для исправления отмените покупку и создайте новую';end if;
 if old.deleted_at is not null and new.deleted_at is null then raise exception 'Отменённую покупку нельзя восстановить напрямую. Создайте новую';end if;
 if old.deleted_at is null and new.deleted_at is not null and issue.cancelled_at is null then raise exception 'Сначала отмените будущие удержания в покупке формы';end if;
 return new;
end $$;
revoke all on function private.payroll_uniform_transaction_guard() from public,anon,authenticated;
create trigger payroll_uniform_linked_transaction before update or delete on public.transactions for each row execute function private.payroll_uniform_transaction_guard();
notify pgrst,'reload schema';
commit;
