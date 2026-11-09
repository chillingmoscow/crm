-- Financial integration check against a local seeded database. All writes roll back.
begin;
do $$
declare
  actor uuid;
  account uuid;
  venue uuid;
  bank uuid;
  entity uuid;
  first_employee uuid;
  second_employee uuid;
  role_id uuid;
  bonus_date date;
  today date;
  earning_month date;
  first_balance numeric;
  cash_balance numeric;
  payload jsonb;
  invalid_payload jsonb;
  unpaid_ids uuid[];
  paid_ids uuid[];
  payout uuid;
  salary_ids uuid[];
  before_expenses bigint;
  before_entries bigint;
begin
  select id into actor from auth.users where email='owner@test.com';
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('app.ctx_ready','0',true);
  account := public.get_active_account_id();
  venue := public.get_active_venue_id();
  select (now() at time zone coalesce(timezone,'Europe/Moscow'))::date into today
  from public.venues where id=venue;
  insert into public.payroll_settings(venue_id,account_id,starts_on,quickresto_venue_id)
  values(venue,account,date_trunc('month',today)::date,1)
  on conflict (venue_id) do nothing;
  select s.starts_on into bonus_date from public.payroll_settings s where s.venue_id=venue;
  select g.day::date into earning_month
  from generate_series(date_trunc('month', bonus_date),date_trunc('month', today),'1 month') g(day)
  where not exists (select 1 from public.payroll_periods p where p.venue_id=venue and p.month=g.day::date and p.status<>'draft')
  order by g.day desc limit 1;
  bonus_date := greatest(earning_month,bonus_date);
  insert into public.legal_entities(account_id,name,legal_form)
  values(account,'Batch bonus test entity','OTHER') returning id into entity;
  insert into public.bank_accounts(account_id,legal_entity_id,venue_id,name,type)
  values(account,entity,venue,'Batch bonus test cashbox','cash') returning id into bank;
  select b.balance into cash_balance from public.bank_accounts b where b.id=bank;
  if earning_month is null then raise exception 'Missing local payroll period'; end if;

  insert into public.roles(venue_id,name,code)
  values(venue,'Batch bonus test','batch_bonus_test') returning id into role_id;
  insert into public.payroll_employees(account_id,venue_id,name,role_name,role_id,opening_balance,opening_confirmed)
  values(account,venue,'Batch bonus A','Batch bonus test',role_id,1000,false) returning id into first_employee;
  insert into public.payroll_employees(account_id,venue_id,name,role_name,role_id)
  values(account,venue,'Batch bonus B','Batch bonus test',role_id) returning id into second_employee;

  payload := jsonb_build_object(
    'request_key',gen_random_uuid(),'date',bonus_date,'medium','money','reason','Rollback fixture',
    'recipients',jsonb_build_array(jsonb_build_object('employee_id',first_employee,'amount',5000),
                                  jsonb_build_object('employee_id',second_employee,'amount',1700.50))
  );
  unpaid_ids := public.payroll_record_bonuses(payload);
  if cardinality(unpaid_ids)<>2 or exists (
    select 1 from public.payroll_payments p where p.bonus_adjustment_id=any(unpaid_ids)
  ) then raise exception 'Accrual-only mode posted a payment'; end if;
  first_balance := private.payroll_month_balance(first_employee,earning_month);

  payload := payload || jsonb_build_object('request_key',gen_random_uuid(),'bank_account_id',bank,'payout_date',today);
  paid_ids := public.payroll_record_bonuses(payload);
  if cardinality(paid_ids)<>2 or paid_ids is distinct from public.payroll_record_bonuses(payload) then
    raise exception 'Batch retry duplicated or lost entries';
  end if;
  begin
    perform public.payroll_record_bonuses(payload||jsonb_build_object('reason','Changed retry'));
    raise exception 'Expected mismatch rejection';
  exception when others then
    if sqlerrm <> 'Повторный запрос содержит другие данные' then raise; end if;
  end;

  if (
    select count(*) from public.payroll_payments p
    join public.transactions t on t.id=p.transaction_id
    join public.payroll_adjustments j on j.id=p.bonus_adjustment_id
    join public.payroll_allocations al on al.payment_id=p.id and al.employee_id=j.employee_id
    where j.id=any(paid_ids) and p.state='posted' and t.deleted_at is null
      and t.type='expense' and t.bank_account_id=bank and t.amount=j.amount
      and t.date=today::timestamp at time zone 'UTC' and al.month=earning_month
      and al.opening_amount=0 and al.settled_amount=j.amount and al.accrual_id is null
  )<>2 then raise exception 'Incorrect expense, month or bonus linkage'; end if;
  perform private.payroll_link_accruals(p.id) from public.payroll_payments p where p.bonus_adjustment_id=any(paid_ids);
  if exists (
    select 1 from public.payroll_payment_accruals l join public.payroll_payments p on p.id=l.payment_id
    where p.bonus_adjustment_id=any(paid_ids)
  ) then raise exception 'Bonus payout blocks review of daily attendance'; end if;
  if private.payroll_month_balance(first_employee,earning_month)<>first_balance then
    raise exception 'Immediate payout changed outstanding wages';
  end if;
  if (select b.balance from public.bank_accounts b where b.id=bank)<>cash_balance-6700.50 then
    raise exception 'Cashbox was not debited exactly once';
  end if;

  begin
    perform public.payroll_journal_command('delete',jsonb_build_object('id',paid_ids[1],'reason','Rollback fixture'));
    raise exception 'Expected rejection for paid bonus';
  exception when others then
    if sqlerrm <> 'Сначала отмените связанную выплату премии' then raise; end if;
  end;
  select p.id into payout from public.payroll_payments p where p.bonus_adjustment_id=paid_ids[1];
  perform public.payroll_cancel_payment(payout);
  if (select state from public.payroll_payments where id=payout)<>'cancelled'
    or private.payroll_month_balance(first_employee,earning_month)<>first_balance+5000
    or (select b.balance from public.bank_accounts b where b.id=bank)<>cash_balance-1700.50 then
    raise exception 'Cancellation did not restore the amount due';
  end if;
  perform public.payroll_journal_command('delete',jsonb_build_object('id',paid_ids[1],'reason','Rollback fixture'));
  perform public.payroll_journal_command('delete',jsonb_build_object('id',unpaid_ids[1],'reason','Rollback fixture'));
  delete from public.payroll_accruals c where c.employee_id=first_employee and c.business_date=bonus_date;
  if not found then raise exception 'Missing daily accrual to rebuild'; end if;

  select count(*) into before_expenses from public.transactions;
  select count(*) into before_entries from public.payroll_adjustments;
  invalid_payload := jsonb_set(payload||jsonb_build_object('request_key',gen_random_uuid()),'{recipients,1,employee_id}',to_jsonb(gen_random_uuid()));
  begin
    perform public.payroll_record_bonuses(invalid_payload);
    raise exception 'Expected invalid recipient rejection';
  exception when others then
    if sqlerrm <> 'Выберите действующего сотрудника' then raise; end if;
  end;
  if (select count(*) from public.transactions)<>before_expenses
    or (select count(*) from public.payroll_adjustments)<>before_entries then
    raise exception 'Part of the rejected batch leaked';
  end if;

  update public.payroll_accruals set status='approved' where employee_id=second_employee and business_date=bonus_date;
  salary_ids := public.payroll_record_payments(jsonb_build_object(
    'request_key',gen_random_uuid(),'bank_account_id',bank,'date',now(),'month',earning_month,
    'recipients',jsonb_build_array(jsonb_build_object('employee_id',second_employee,'amount',2000))
  ));
  if coalesce((select sum(amount) from public.payroll_payment_accruals where payment_id=any(salary_ids)),0)<>1700.50 then
    raise exception 'Salary payout reused already settled bonus accrual';
  end if;
  if has_function_privilege('anon','public.payroll_record_bonuses(jsonb)','EXECUTE') then
    raise exception 'Anonymous users can access the bonus writer';
  end if;
  raise notice 'PASS: accrued-only, immediate payout, retry, cancellation, rollback, anonymous access';
end $$;
rollback;
