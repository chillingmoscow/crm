-- Individual payroll payments are financial transactions, one per recipient.
begin;
alter table public.finance_category_groups add column is_payroll boolean not null default false;
create unique index finance_payroll_group_account on public.finance_category_groups(account_id) where is_payroll;
alter table public.finance_categories add column payroll_role_id uuid references public.roles(id) on delete restrict;
create unique index finance_category_payroll_role on public.finance_categories(payroll_role_id) where payroll_role_id is not null;
alter table public.payroll_employees add column role_id uuid references public.roles(id) on delete restrict;

create function private.ensure_payroll_role_category(p_role uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.roles;a uuid;g uuid;c uuid;
begin
 select * into r from public.roles where id=p_role;
 if r.id is null or r.venue_id is null then raise exception 'Должность заведения не найдена';end if;
 select account_id into a from public.venues where id=r.venue_id;
 perform pg_advisory_xact_lock(hashtextextended('payroll-categories:'||a::text,0));
 select id into g from public.finance_category_groups where account_id=a and is_payroll;
 if g is null then
  select id into g from public.finance_category_groups where account_id=a and name='Фонд оплаты труда' and type='expense' order by created_at limit 1;
  if g is null then insert into public.finance_category_groups(account_id,name,type,is_payroll) values(a,'Фонд оплаты труда','expense',true) returning id into g;
  else update public.finance_category_groups set is_payroll=true where id=g;end if;
 end if;
 select id into c from public.finance_categories where payroll_role_id=r.id;
 if c is null then
  insert into public.finance_categories(account_id,name,type,group_id,payroll_role_id) values(a,r.name,'expense',g,r.id) returning id into c;
 else update public.finance_categories set name=r.name,group_id=g where id=c;end if;
 return c;
end $$;
revoke all on function private.ensure_payroll_role_category(uuid) from public,anon,authenticated;
create function private.payroll_role_category_trigger() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.venue_id is not null then perform private.ensure_payroll_role_category(new.id);end if;
 return new;
end $$;
revoke all on function private.payroll_role_category_trigger() from public,anon,authenticated;
create trigger payroll_role_category after insert or update of name on public.roles for each row execute function private.payroll_role_category_trigger();
-- Import missing business positions without granting application permissions.
insert into public.roles(venue_id,name,code)
select distinct e.venue_id,e.role_name,'payroll_'||md5(e.venue_id::text||e.role_name)
from public.payroll_employees e where trim(e.role_name)<>'' and e.role_name<>'Не назначена'
and not exists(select 1 from public.roles r where r.venue_id=e.venue_id and r.name=e.role_name);
select private.ensure_payroll_role_category(id) from public.roles where venue_id is not null and archived_at is null;
-- One-time exact, unambiguous name mapping. Runtime posting uses the stored role ID.
update public.payroll_employees e set role_id=r.id from public.roles r where r.venue_id=e.venue_id and r.name=e.role_name
and (select count(*) from public.roles x where x.venue_id=e.venue_id and x.name=e.role_name)=1;
alter table public.payroll_models add column role_id uuid references public.roles(id) on delete restrict;
update public.payroll_models m set role_id=r.id from public.roles r where r.venue_id=m.venue_id and r.name=m.role_name and (select count(*) from public.roles x where x.venue_id=m.venue_id and x.name=m.role_name)=1;
create function private.payroll_model_role_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' or new.role_name is distinct from old.role_name then
  -- Resolve only while configuring a model; payments use the resulting stable IDs.
  new.role_id:=(select min(r.id::text)::uuid from public.roles r where r.venue_id=new.venue_id and r.name=new.role_name and r.archived_at is null having count(*)=1);
 end if;
 if new.role_id is not null and not exists(select 1 from public.roles where id=new.role_id and venue_id=new.venue_id) then raise exception 'Должность другого заведения недоступна';end if;
 return new;
end $$;
revoke all on function private.payroll_model_role_guard() from public,anon,authenticated;
create trigger payroll_model_role_guard before insert or update on public.payroll_models for each row execute function private.payroll_model_role_guard();
create function private.payroll_employee_role_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.model_id is not null and (tg_op='INSERT' or new.model_id is distinct from old.model_id or new.role_name is distinct from old.role_name) then
  new.role_id:=(select role_id from public.payroll_models where id=new.model_id and venue_id=new.venue_id);
 end if;
 if new.role_id is not null and not exists(select 1 from public.roles where id=new.role_id and venue_id=new.venue_id) then raise exception 'Должность другого заведения недоступна';end if;
 return new;
end $$;
revoke all on function private.payroll_employee_role_guard() from public,anon,authenticated;
create trigger payroll_employee_role_guard before insert or update on public.payroll_employees for each row execute function private.payroll_employee_role_guard();
create or replace function private.payroll_post_payment_scoped(p_input jsonb,a uuid,v uuid,u uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare existing uuid;existing_snapshot jsonb;payment uuid;tx uuid;bank public.bank_accounts;c public.payroll_cashbox;linked public.transactions;
 row jsonb;emp public.payroll_employees;amount numeric:=(p_input->>'amount')::numeric;total numeric:=0;settled numeric:=0;
 kind text:=p_input->>'kind';v_month date;category uuid:=(p_input->>'category_id')::uuid;cash uuid:=(p_input->>'cashbox_id')::uuid;evidence public.payroll_legacy_payments;
begin

 perform pg_advisory_xact_lock(hashtextextended(v::text,0));
 select pp.id,pp.input_snapshot into existing,existing_snapshot from public.payroll_payments pp where pp.account_id=a and pp.venue_id=v and pp.request_key=(p_input->>'request_key')::uuid;
 if existing is not null then if existing_snapshot is distinct from p_input then raise exception 'Этот ключ уже использован для другой выплаты';end if;return existing;end if;
 if kind not in ('salary','advance','tips') or amount is null or amount<=0 or amount>1000000000 or round(amount,2)<>amount then raise exception 'Некорректная выплата';end if;
 select * into bank from public.bank_accounts where id=(p_input->>'bank_account_id')::uuid and account_id=a and is_active;
 if bank.id is null or bank.currency<>'RUB' or (bank.venue_id is not null and bank.venue_id<>v) then raise exception 'Счёт недоступен';end if;
 if not exists(select 1 from public.finance_categories where id=category and account_id=a and type='expense' and archived_at is null) then raise exception 'Выберите статью расхода';end if;
 if cash is not null then
  select * into c from public.payroll_cashbox where id=cash and venue_id=v and account_id=a for update;
  if c.id is null or c.state not in ('ready','review') or kind<>'tips' or c.amount<>amount then raise exception 'Инкассация недоступна';end if;
  if exists(select 1 from public.payroll_payments where cashbox_id=cash) then raise exception 'Инкассация уже проведена';end if;
 end if;
 if p_input->>'legacy_evidence_id' is not null then
  if not public.has_permission('payroll.approve') then raise exception 'Нет доступа к подтверждению истории';end if;
  select * into evidence from public.payroll_legacy_payments where id=(p_input->>'legacy_evidence_id')::uuid and account_id=a and venue_id=v and state='review' for update;
  if evidence.id is null or evidence.amount<>amount or evidence.kind<>kind or (p_input->>'date')::timestamptz<>evidence.occurred_at or jsonb_array_length(p_input->'allocations')<>1 then raise exception 'Историческая выплата не соответствует источнику';end if;
 end if;
 if jsonb_typeof(p_input->'allocations')<>'array' or jsonb_array_length(p_input->'allocations')=0 then raise exception 'Укажите получателей';end if;
 for row in select * from jsonb_array_elements(p_input->'allocations') loop
  select * into emp from public.payroll_employees where id=(row->>'employee_id')::uuid and account_id=a and venue_id=v;
  v_month:=(row->>'month')::date;
  if emp.id is null or date_trunc('month',v_month)::date<>v_month or v_month<(select starts_on from public.payroll_settings where venue_id=v) then raise exception 'Получатель или период недоступен';end if;
  if row->>'amount' is null or row->>'settled_amount' is null or v_month is null or (row->>'amount')::numeric<0 or (row->>'settled_amount')::numeric<0 or round((row->>'amount')::numeric,2)<>(row->>'amount')::numeric or round((row->>'settled_amount')::numeric,2)<>(row->>'settled_amount')::numeric then raise exception 'Некорректное распределение';end if;
  if kind<>'tips' and (row->>'amount')::numeric<>(row->>'settled_amount')::numeric then raise exception 'Округление доступно только для чаевых';end if;
  if kind='tips' then
   if cash is null or row->>'accrual_id' is null or v_month<>date_trunc('month',c.business_date)::date then raise exception 'Чаевые должны быть связаны с инкассацией и начислением';end if;
   if not exists(select 1 from public.payroll_accruals where id=(row->>'accrual_id')::uuid and employee_id=emp.id and venue_id=v and business_date=c.business_date and status in ('ready','approved') and cardinality(issues)=0) then raise exception 'Начисление ещё не проверено';end if;
   if (row->>'settled_amount')::numeric>(select tips from public.payroll_accruals where id=(row->>'accrual_id')::uuid)-coalesce((select sum(x.settled_amount) from public.payroll_allocations x join public.payroll_payments y on y.id=x.payment_id where x.accrual_id=(row->>'accrual_id')::uuid and y.state='posted'),0) then raise exception 'Чаевые уже выданы';end if;
  end if;
  if row ? 'accrual_id' and not exists(select 1 from public.payroll_accruals where id=(row->>'accrual_id')::uuid and employee_id=emp.id and venue_id=v and (cash is null or business_date=c.business_date)) then raise exception 'Начисление недоступно';end if;
  if evidence.id is not null and (emp.id<>evidence.employee_id or v_month<>evidence.month) then raise exception 'Получатель исторической выплаты изменён';end if;
  if exists(select 1 from jsonb_array_elements(p_input->'allocations') recipient where recipient->>'employee_id'=row->>'employee_id' and recipient->>'month'=row->>'month' group by recipient->>'employee_id' having count(*)>1) then raise exception 'Сотрудник указан дважды';end if;
  total:=total+(row->>'amount')::numeric;settled:=settled+(row->>'settled_amount')::numeric;
 end loop;
 if total<>amount then raise exception 'Распределение не совпадает с суммой выплаты';end if;
 if cash is not null and abs(settled-amount)>(select tip_tolerance from public.payroll_settings where venue_id=v) and coalesce(length(trim(p_input->>'reason')),0)<3 then raise exception 'Подтвердите расхождение с причиной';end if;
 if cash is not null then
  if (select count(*) from public.transactions t where t.account_id=a and t.source_external_id='quickresto:encashment:'||v::text||':'||c.external_id)>1 then raise exception 'Найдено несколько расходов инкассации: требуется сверка';end if;
  select * into linked from public.transactions t where t.account_id=a and t.source_external_id='quickresto:encashment:'||v::text||':'||c.external_id for update;
  if linked.id is not null then
   if linked.venue_id is distinct from v or linked.bank_account_id<>bank.id or linked.category_id is distinct from category or linked.type<>'expense' or linked.currency<>'RUB' or linked.legal_entity_id<>bank.legal_entity_id or linked.amount<>amount or linked.date<>(p_input->>'date')::timestamptz or linked.deleted_at is not null then raise exception 'Существующий расход не совпадает с инкассацией';end if;
   tx:=linked.id;
  end if;
 end if;
 if tx is null then
 insert into public.transactions(account_id,legal_entity_id,venue_id,bank_account_id,category_id,type,amount,date,description,source,source_external_id,created_by)
  values(a,bank.legal_entity_id,v,bank.id,category,'expense',amount,(p_input->>'date')::timestamptz,coalesce(p_input->>'note','Выплата сотрудникам'),'manual',case when cash is not null then 'quickresto:encashment:'||v::text||':'||c.external_id else 'payroll:'||(p_input->>'request_key') end,u) returning id into tx;
 end if;
 insert into public.payroll_payments(account_id,venue_id,request_key,transaction_id,cashbox_id,kind,amount,note,created_by,legacy_evidence_id,input_snapshot,occurred_at)
  values(a,v,(p_input->>'request_key')::uuid,tx,cash,kind,amount,coalesce(p_input->>'note',''),u,evidence.id,p_input,(p_input->>'date')::timestamptz) returning id into payment;
 if evidence.id is not null then update public.payroll_legacy_payments set state='posted',payment_id=payment where id=evidence.id;end if;
 for row in select * from jsonb_array_elements(p_input->'allocations') loop
  insert into public.payroll_allocations(account_id,venue_id,payment_id,employee_id,accrual_id,month,amount,settled_amount)
   values(a,v,payment,(row->>'employee_id')::uuid,(row->>'accrual_id')::uuid,(row->>'month')::date,(row->>'amount')::numeric,(row->>'settled_amount')::numeric);
 end loop;
 perform private.payroll_link_accruals(payment);
 if cash is not null then update public.payroll_cashbox set state='posted',rounding=settled-(p_input->>'amount')::numeric where id=cash;end if;
 insert into public.payroll_events(account_id,venue_id,entity_id,actor_id,action,details) values(a,v,payment,u,'payment',jsonb_build_object('amount',amount,'kind',kind,'rounding',settled-amount,'reason',p_input->>'reason'));
 return payment;
end $$;
revoke all on function private.payroll_post_payment_scoped(jsonb,uuid,uuid,uuid) from public,anon,authenticated;

-- Private idempotency envelope: no REST exposure or direct client writes.
create table private.payroll_payment_batches (
 account_id uuid not null references public.accounts(id),venue_id uuid not null references public.venues(id),
 request_key uuid primary key,input_snapshot jsonb not null,result uuid[] not null
);
revoke all on private.payroll_payment_batches from public,anon,authenticated;
create function public.payroll_record_payments(p_input jsonb) returns uuid[]
language plpgsql security definer set search_path='' as $$
declare a uuid;v uuid;u uuid;prev private.payroll_payment_batches;row jsonb;emp public.payroll_employees;
 category uuid;payment uuid;result uuid[]:='{}';child_key uuid;child jsonb;
begin
 select s.a,s.v,s.u into a,v,u from private.payroll_scope('payroll.pay') s;
 if not public.has_permission('finance.create_transaction') then raise exception 'Нет доступа к финансовым операциям';end if;
 perform pg_advisory_xact_lock(hashtextextended(v::text,0));
 select * into prev from private.payroll_payment_batches where request_key=(p_input->>'request_key')::uuid;
 if prev.request_key is not null then
  if prev.account_id<>a or prev.venue_id<>v or prev.input_snapshot is distinct from p_input then raise exception 'Ключ уже использован для другой выплаты';end if;
  return prev.result;
 end if;
 if jsonb_typeof(p_input->'recipients') is distinct from 'array' or jsonb_array_length(p_input->'recipients') not between 1 and 500 then raise exception 'Выберите сотрудников';end if;
 if length(coalesce(p_input->>'note',''))>2000 then raise exception 'Слишком длинный комментарий';end if;
 if exists(select 1 from jsonb_array_elements(p_input->'recipients') x group by x->>'employee_id' having count(*)>1) then raise exception 'Сотрудник указан дважды';end if;
 for row in select * from jsonb_array_elements(p_input->'recipients') loop
  select * into emp from public.payroll_employees where id=(row->>'employee_id')::uuid and account_id=a and venue_id=v;
  if emp.id is null then raise exception 'Сотрудник недоступен';end if;
  if emp.role_id is null then raise exception 'У сотрудника % не указана должность',emp.name;end if;
  select c.id into category from public.finance_categories c join public.roles r on r.id=c.payroll_role_id
   where r.id=emp.role_id and r.venue_id=v and r.archived_at is null and c.account_id=a and c.archived_at is null and c.type='expense';
  if category is null then raise exception 'Проверьте статью ФОТ для должности сотрудника %',emp.name;end if;
  child_key:=md5((p_input->>'request_key')||emp.id::text)::uuid;
  child:=jsonb_build_object('request_key',child_key,'kind','salary','bank_account_id',p_input->>'bank_account_id','category_id',category,
   'date',p_input->>'date','amount',(row->>'amount')::numeric,'note',coalesce(nullif(p_input->>'note',''),'Выплата: '||emp.name),
   'allocations',jsonb_build_array(jsonb_build_object('employee_id',emp.id,'month',p_input->>'month','amount',(row->>'amount')::numeric,'settled_amount',(row->>'amount')::numeric)));
  payment:=private.payroll_post_payment_scoped(child,a,v,u);result:=array_append(result,payment);
 end loop;
 insert into private.payroll_payment_batches values(a,v,(p_input->>'request_key')::uuid,p_input,result);
 return result;
end $$;
revoke all on function public.payroll_record_payments(jsonb) from public,anon;
grant execute on function public.payroll_record_payments(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
