begin;

alter table public.payroll_payments
  add column bonus_adjustment_id uuid unique references public.payroll_adjustments(id) on delete restrict;

create table private.payroll_bonus_batches (
  account_id uuid not null references public.accounts(id),
  venue_id uuid not null references public.venues(id),
  request_key uuid not null,
  input_snapshot jsonb not null,
  adjustment_ids uuid[] not null,
  primary key (account_id, venue_id, request_key)
);
revoke all on private.payroll_bonus_batches from public, anon, authenticated;

create function public.payroll_record_bonuses(p_input jsonb) returns uuid[]
language plpgsql security definer set search_path='' as $$
declare
  a uuid;
  v uuid;
  u uuid;
  request uuid := (p_input->>'request_key')::uuid;
  bonus_date date := (p_input->>'date')::date;
  payout_date date := (p_input->>'payout_date')::date;
  bank_id uuid := (p_input->>'bank_account_id')::uuid;
  medium text := p_input->>'medium';
  reason text := trim(p_input->>'reason');
  month date := date_trunc('month', bonus_date)::date;
  batch private.payroll_bonus_batches;
  bank public.bank_accounts;
  recipient jsonb;
  employee public.payroll_employees;
  amount numeric;
  adjustment_id uuid;
  payment_id uuid;
  transaction_id uuid;
  accrual_id uuid;
  category_id uuid;
  tz text;
  note text;
  adjustment_ids uuid[] := '{}';
begin
  select s.a,s.v,s.u into a,v,u from private.payroll_scope('payroll.review') s;
  if request is null or bonus_date is null or medium is null or medium not in ('money','bonus')
    or coalesce(length(reason),0) not between 3 and 4000
    or jsonb_typeof(p_input->'recipients') is distinct from 'array'
  then raise exception 'Проверьте дату, основание и получателей'; end if;
  if jsonb_array_length(p_input->'recipients') not between 1 and 500
    or exists (
      select 1 from jsonb_array_elements(p_input->'recipients') r
      group by (r->>'employee_id')::uuid having count(*) > 1
    )
  then raise exception 'Выберите сотрудников без повторов'; end if;

  if bank_id is not null then
    if medium <> 'money' or payout_date is null then
      raise exception 'Укажите дату выдачи денежной премии';
    end if;
    if not public.has_permission('payroll.pay') or not public.has_permission('finance.create_transaction') then
      raise exception 'Нет доступа к выплате премии';
    end if;
  elsif payout_date is not null then
    raise exception 'Выберите счёт списания';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v::text,0));
  select * into batch from private.payroll_bonus_batches b
  where b.account_id=a and b.venue_id=v and b.request_key=request;
  if found then
    if batch.input_snapshot is distinct from p_input then
      raise exception 'Повторный запрос содержит другие данные';
    end if;
    return batch.adjustment_ids;
  end if;

  if bank_id is not null then
    select * into bank from public.bank_accounts
    where id=bank_id and account_id=a and is_active and deleted_at is null
      and currency='RUB' and (venue_id is null or venue_id=v)
      and (legal_entity_id=public.get_active_legal_entity_id() or public.has_permission('finance.view_all_legal_entities'))
    for update;
    if bank.id is null then raise exception 'Счёт недоступен'; end if;
    select coalesce(timezone,'Europe/Moscow') into tz from public.venues where id=v;
    if payout_date > (now() at time zone tz)::date then
      raise exception 'Укажите фактическую дату выплаты';
    end if;
  end if;

  for recipient in select value from jsonb_array_elements(p_input->'recipients') loop
    select * into employee from public.payroll_employees
    where id=(recipient->>'employee_id')::uuid and account_id=a and venue_id=v and active;
    if employee.id is null then raise exception 'Выберите действующего сотрудника'; end if;
    amount := (recipient->>'amount')::numeric;
    if jsonb_typeof(recipient->'amount') is distinct from 'number'
      or amount <= 0 or amount > 1000000000 or round(amount,2) <> amount
    then raise exception 'Проверьте сумму для сотрудника %', employee.name; end if;

    adjustment_id := md5('payroll-bonus:'||request::text||':'||employee.id::text)::uuid;
    perform public.payroll_journal_command('create', jsonb_build_object(
      'id',adjustment_id,'request_key',adjustment_id,'employee_id',employee.id,
      'date',bonus_date,'kind','bonus','medium',medium,'amount',amount,'reason',reason
    ));
    adjustment_ids := array_append(adjustment_ids, adjustment_id);

    if bank.id is not null then
      select c.id into category_id
      from public.finance_categories c join public.roles r on r.id=c.payroll_role_id
      where r.id=employee.role_id and r.venue_id=v and r.archived_at is null
        and c.account_id=a and c.archived_at is null and c.type='expense';
      if category_id is null then raise exception 'Проверьте статью ФОТ сотрудника %', employee.name; end if;
      -- The journal must have included this bonus in the actual statement.
      select c.id into accrual_id from public.payroll_accruals c
      where c.employee_id=employee.id and c.venue_id=v and c.business_date=bonus_date
        and c.components @> jsonb_build_array(jsonb_build_object('source','payroll-entry:'||adjustment_id::text,'amount',amount));
      if accrual_id is null then raise exception 'Премия сотрудника % не попала в начисления', employee.name; end if;

      note := 'Выплата премии: '||employee.name;
      insert into public.transactions(
        account_id,venue_id,legal_entity_id,bank_account_id,category_id,type,amount,currency,date,description,source,source_external_id,created_by
      ) values (
        a,v,bank.legal_entity_id,bank.id,category_id,'expense',amount,'RUB',
        payout_date::timestamp at time zone 'UTC',note,'manual','payroll-bonus:'||adjustment_id::text,u
      ) returning id into transaction_id;

      insert into public.payroll_payments(
        account_id,venue_id,request_key,transaction_id,kind,amount,note,created_by,input_snapshot,occurred_at,bonus_adjustment_id
      ) values (
        a,v,adjustment_id,transaction_id,'salary',amount,note,u,
        jsonb_build_object('bonus_adjustment_id',adjustment_id,'bank_account_id',bank.id,'date',payout_date,'amount',amount),
        payout_date::timestamp at time zone 'UTC',adjustment_id
      ) returning id into payment_id;

      insert into public.payroll_allocations(account_id,venue_id,payment_id,employee_id,month,amount,settled_amount)
      values(a,v,payment_id,employee.id,month,amount,amount);
      -- Attribute the money to this bonus date without settling older wages or opening debt.
      insert into public.payroll_payment_accruals(payment_id,accrual_id,account_id,venue_id,employee_id,amount)
      values(payment_id,accrual_id,a,v,employee.id,amount);
      insert into public.payroll_events(account_id,venue_id,entity_id,actor_id,action,details)
      values(a,v,payment_id,u,'payment',jsonb_build_object('amount',amount,'kind','salary','bonus_adjustment_id',adjustment_id));
    end if;
  end loop;

  insert into private.payroll_bonus_batches values (a,v,request,p_input,adjustment_ids);
  return adjustment_ids;
end $$;

revoke all on function public.payroll_record_bonuses(jsonb) from public,anon,authenticated;
grant execute on function public.payroll_record_bonuses(jsonb) to authenticated;

create function private.payroll_paid_bonus_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if (new.amount is distinct from old.amount or new.deleted_at is distinct from old.deleted_at)
    and exists (
      select 1 from public.payroll_payments
      where bonus_adjustment_id=old.id and state='posted'
    )
  then raise exception 'Сначала отмените связанную выплату премии'; end if;
  return new;
end $$;
revoke all on function private.payroll_paid_bonus_guard() from public,anon,authenticated;
create trigger payroll_paid_bonus_guard
before update of amount,deleted_at on public.payroll_adjustments
for each row execute function private.payroll_paid_bonus_guard();

notify pgrst,'reload schema';
commit;
