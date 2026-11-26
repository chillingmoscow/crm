-- 399: один план на выплату за месяц для всех наличных графиков.
--
-- План графика «Основной» (schedule = 'main') теперь включает и сотрудников
-- графика «Клинер»: у каждого свой день, сумма — по своему графику; вторая
-- выплата месяца (payout_no = 2) — тем же планом (Павел, 27.11). «Переводом» —
-- по-прежнему вне плана.
--
-- * private.payroll_payout_in_plan(сотрудник, план) — входит ли график сотрудника
--   в план;
-- * payroll_payout_plan_save (последнее тело — 391) и ядро выдачи
--   private.payroll_payout_issue_core (последнее тело — 392) проверяют график
--   через неё вместо точного равенства.

create or replace function private.payroll_payout_in_plan(p_employee text, p_plan text)
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$
  select coalesce(p_employee, 'main') = p_plan
      or (p_plan = 'main' and coalesce(p_employee, 'main') = 'cleaner');
$$;
revoke all on function private.payroll_payout_in_plan(text, text) from public, anon, authenticated;

create or replace function public.payroll_payout_plan_save(p_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  a uuid; v uuid; u uuid;
  plan public.payroll_payout_plans;
  v_schedule text := p_input->>'schedule';
  v_month date := (p_input->>'month')::date;
  v_no smallint := coalesce((p_input->>'payout_no')::smallint, 1);
  v_from date := (p_input->>'window_from')::date;
  v_to date := (p_input->>'window_to')::date;
  item jsonb; emp public.payroll_employees; amount numeric; pay date;
begin
  select s.a, s.v, s.u into a, v, u from private.payroll_scope('payroll.pay') s;
  if a is null or v is null then raise exception 'Выберите заведение'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v::text, 0));
  if coalesce(v_schedule, '') not in ('main', 'cleaner', 'transfer') then raise exception 'Некорректный график выплат'; end if;
  if v_month is null or date_trunc('month', v_month)::date <> v_month then raise exception 'Некорректный месяц плана'; end if;
  if v_no not in (1, 2) then raise exception 'Некорректный номер выплаты'; end if;
  if v_from is null or v_to is null or v_to < v_from then raise exception 'Некорректное окно выплаты'; end if;
  if v_month < (select starts_on from public.payroll_settings where account_id = a and venue_id = v) then
    raise exception 'Месяц раньше начала учёта';
  end if;
  if jsonb_typeof(p_input->'rows') is distinct from 'array' or jsonb_array_length(p_input->'rows') > 500 then
    raise exception 'Некорректные строки плана';
  end if;
  if exists (select 1 from jsonb_array_elements(p_input->'rows') x group by x->>'employee_id' having count(*) > 1) then
    raise exception 'Сотрудник указан дважды';
  end if;

  select * into plan from public.payroll_payout_plans
   where account_id = a and venue_id = v and schedule = v_schedule and month = v_month and payout_no = v_no and state <> 'cancelled'
   for update;
  if plan.state = 'approved' then raise exception 'План уже утверждён'; end if;
  if plan.id is null then
    insert into public.payroll_payout_plans(account_id, venue_id, schedule, month, payout_no, window_from, window_to, created_by)
    values (a, v, v_schedule, v_month, v_no, v_from, v_to, u) returning * into plan;
  else
    delete from public.payroll_payout_rows where plan_id = plan.id;
    update public.payroll_payout_plans set window_from = v_from, window_to = v_to, version = version + 1
     where id = plan.id returning * into plan;
  end if;

  for item in select * from jsonb_array_elements(p_input->'rows') loop
    select * into emp from public.payroll_employees
     where id = (item->>'employee_id')::uuid and account_id = a and venue_id = v;
    if emp.id is null then raise exception 'Сотрудник недоступен'; end if;
    -- План наличных (main) — общий для всех наличных графиков: «Основной» и
    -- «Клинер», у каждого свой день (Павел, 27.11).
    if not private.payroll_payout_in_plan(emp.payout_schedule, v_schedule) then
      raise exception 'Сотрудник % в другом графике выплат', emp.name;
    end if;
    amount := private.payroll_payout_money(item->'amount', emp.name);
    pay := nullif(item->>'pay_date', '')::date;
    if pay is not null and (pay < v_from or pay > v_to) then raise exception 'День выплаты вне окна: %', emp.name; end if;
    perform private.payroll_payout_guard(emp.id, v_month, amount);
    insert into public.payroll_payout_rows(account_id, venue_id, plan_id, employee_id, pay_date, amount, breakdown, updated_by)
    values (a, v, plan.id, emp.id, pay, amount,
      case when jsonb_typeof(item->'breakdown') = 'object' then item->'breakdown' else '{}'::jsonb end, u);
  end loop;

  insert into public.payroll_events(account_id, venue_id, entity_id, actor_id, action, details)
  values (a, v, plan.id, u, 'payout_plan', jsonb_build_object('schedule', v_schedule, 'month', v_month,
    'payout_no', v_no, 'version', plan.version, 'rows', jsonb_array_length(p_input->'rows')));
  return plan.id;
end $function$;

create or replace function private.payroll_payout_issue_core(p_input jsonb, a uuid, v uuid, u uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  prev public.payroll_payout_issues;
  plan public.payroll_payout_plans;
  r public.payroll_payout_rows;
  emp public.payroll_employees;
  bank public.bank_accounts;
  v_key uuid := (p_input->>'request_key')::uuid;
  v_method text := p_input->>'method';
  v_business date := (p_input->>'business_date')::date;
  item jsonb; v_amount numeric; next_date date; category uuid; payment uuid;
  stored jsonb := '[]'::jsonb; total numeric := 0; issue uuid;
  applied jsonb := '[]'::jsonb; moved public.payroll_payout_rows;
begin
  if a is null or v is null then raise exception 'Выберите заведение'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v::text, 0));
  if v_key is null then raise exception 'Нет ключа выдачи'; end if;

  select * into prev from public.payroll_payout_issues where venue_id = v and request_key = v_key;
  -- Повтор той же выдачи (обрыв связи, второй запрос, пока шёл первый): отметка
  -- времени и наличные в нём другие, а план, способ и строки — те же.
  if prev.id is not null then
    if prev.account_id <> a or prev.plan_id is distinct from (p_input->>'plan_id')::uuid
       or prev.method is distinct from v_method
       or (select coalesce(jsonb_agg(jsonb_build_array(x->>'row_id', (x->>'amount')::numeric) order by x->>'row_id'), '[]')
             from jsonb_array_elements(prev.input_snapshot->'lines') x)
          is distinct from
          (select coalesce(jsonb_agg(jsonb_build_array(x->>'row_id', (x->>'amount')::numeric) order by x->>'row_id'), '[]')
             from jsonb_array_elements(p_input->'lines') x) then
      raise exception 'Ключ уже использован для другой выдачи';
    end if;
    return prev.id;
  end if;

  select * into plan from public.payroll_payout_plans
   where id = (p_input->>'plan_id')::uuid and account_id = a and venue_id = v for update;
  if plan.id is null then raise exception 'План недоступен'; end if;
  if plan.state <> 'approved' then raise exception 'Сначала утвердите план'; end if;
  if coalesce(v_method, '') not in ('cash', 'transfer')
     or (v_method = 'transfer') <> (plan.schedule = 'transfer') then
    raise exception 'Способ выдачи не совпадает с графиком';
  end if;
  if v_business is null or (p_input->>'date') is null then raise exception 'Укажите дату выдачи'; end if;

  select * into bank from public.bank_accounts
   where id = (p_input->>'bank_account_id')::uuid and account_id = a and is_active and currency = 'RUB'
     and (venue_id is null or venue_id = v);
  if bank.id is null or bank.type::text <> (case v_method when 'cash' then 'cash' else 'checking' end) then
    raise exception 'Выберите счёт выплаты';
  end if;

  if jsonb_typeof(p_input->'lines') is distinct from 'array' or jsonb_array_length(p_input->'lines') not between 1 and 500 then
    raise exception 'Нет строк к выдаче';
  end if;
  if exists (select 1 from jsonb_array_elements(p_input->'lines') x group by x->>'row_id' having count(*) > 1) then
    raise exception 'Строка указана дважды';
  end if;
  -- Наличные: предпросмотр видел «уже выдано сегодня». Если с тех пор выдал
  -- кто-то ещё (вторая вкладка, другой человек), минимум в кассе мог нарушиться.
  if v_method = 'cash' and (
       jsonb_typeof(p_input->'cash'->'issued_today') is distinct from 'number'
       or (p_input->'cash'->>'issued_today')::numeric <> (
         select coalesce(sum(i.total), 0) from public.payroll_payout_issues i
          where i.venue_id = v and i.business_date = v_business and i.method = 'cash')) then
    raise exception 'Наличные изменились, проверьте ещё раз';
  end if;

  for item in select * from jsonb_array_elements(p_input->'lines') loop
    select * into r from public.payroll_payout_rows
     where id = (item->>'row_id')::uuid and plan_id = plan.id for update;
    if r.id is null then raise exception 'Строка плана недоступна'; end if;
    select * into emp from public.payroll_employees where id = r.employee_id;
    v_amount := private.payroll_payout_money(item->'amount', emp.name);
    if v_amount <= 0 then raise exception 'Некорректная сумма: %', emp.name; end if;
    if not private.payroll_payout_in_plan(emp.payout_schedule, plan.schedule) then
      raise exception 'Сотрудник % перешёл на другой график выплат: поправьте план', emp.name;
    end if;
    -- Наличные — не больше строки плана. Переводом — по сумме счёта, она может
    -- быть больше плана; потолок тогда — только заработанное (проверка ниже).
    if v_method = 'cash' and v_amount > r.amount - r.issued then
      raise exception 'Больше, чем осталось выдать: %', emp.name;
    end if;
    perform private.payroll_payout_guard(emp.id, plan.month, v_amount);
    next_date := nullif(item->>'next_pay_date', '')::date;
    if next_date is not null and (next_date < plan.window_from or next_date > plan.window_to) then
      raise exception 'День выплаты вне окна: %', emp.name;
    end if;

    if emp.role_id is null then raise exception 'У сотрудника % не указана должность', emp.name; end if;
    select c.id into category from public.finance_categories c join public.roles ro on ro.id = c.payroll_role_id
     where ro.id = emp.role_id and ro.venue_id = v and ro.archived_at is null
       and c.account_id = a and c.archived_at is null and c.type = 'expense';
    if category is null then raise exception 'Проверьте статью ФОТ для должности сотрудника %', emp.name; end if;

    payment := private.payroll_post_payment_scoped(jsonb_build_object(
      'request_key', md5(v_key::text || r.id::text)::uuid,
      'kind', 'salary',
      'bank_account_id', bank.id,
      'category_id', category,
      'date', p_input->>'date',
      'amount', v_amount,
      'note', 'План выплат: ' || emp.name,
      'allocations', jsonb_build_array(jsonb_build_object(
        'employee_id', emp.id, 'month', plan.month, 'amount', v_amount, 'settled_amount', v_amount))
    ), a, v, u);
    -- Платёж по счёту самозанятой уже есть в Adesk из банка: вторую операцию не ставим.
    -- Строка очереди ещё не зафиксирована — обработчик Adesk её не видел.
    if v_method = 'transfer' then
      delete from public.payroll_adesk_sync where account_id = a and payment_id = payment;
    end if;

    -- close: сумму урезал потолок (ручная выплата, штраф) — строка закрывается на выданном.
    update public.payroll_payout_rows
       set amount = case when coalesce((item->>'close')::boolean, false) then issued + v_amount
                         else greatest(amount, issued + v_amount) end,
           issued = issued + v_amount,
           state = case when issued + v_amount >= r.amount or coalesce((item->>'close')::boolean, false)
                        then 'issued' else 'partial' end,
           pay_date = coalesce(next_date, pay_date),
           updated_by = u, updated_at = now()
     where id = r.id;
    stored := stored || jsonb_build_array(jsonb_build_object(
      'row_id', r.id, 'employee_id', emp.id, 'name', emp.name, 'amount', v_amount,
      'next_pay_date', next_date, 'payment_id', payment));
    total := total + v_amount;
  end loop;

  -- Кому сегодня не досталось ничего — день переносится на следующую смену в окне.
  if jsonb_typeof(p_input->'moves') = 'array' then
    for item in select * from jsonb_array_elements(p_input->'moves') loop
      next_date := nullif(item->>'pay_date', '')::date;
      if next_date is null or next_date < plan.window_from or next_date > plan.window_to then
        raise exception 'День выплаты вне окна';
      end if;
      select * into moved from public.payroll_payout_rows
       where id = (item->>'row_id')::uuid and plan_id = plan.id and state <> 'issued' for update;
      if moved.id is null then continue; end if;  -- строку успели выдать — переносить нечего
      update public.payroll_payout_rows set pay_date = next_date, updated_by = u, updated_at = now() where id = moved.id;
      applied := applied || jsonb_build_array(jsonb_build_object(
        'row_id', moved.id, 'employee_id', moved.employee_id,
        'name', (select name from public.payroll_employees where id = moved.employee_id),
        'from', moved.pay_date, 'to', next_date));
      insert into public.payroll_events(account_id, venue_id, employee_id, entity_id, actor_id, action, details)
      values (a, v, moved.employee_id, plan.id, u, 'payout_row', jsonb_build_object('row_id', moved.id,
        'reason', 'move', 'pay_date', next_date, 'previous_pay_date', moved.pay_date));
    end loop;
  end if;

  insert into public.payroll_payout_issues(account_id, venue_id, plan_id, business_date, method, request_key,
    bank_account_id, total, lines, moves, cash, input_snapshot, message, created_by)
  values (a, v, plan.id, v_business, v_method, v_key, bank.id, total, stored, applied,
    case when jsonb_typeof(p_input->'cash') = 'object' then p_input->'cash' end, p_input,
    nullif(p_input->>'message', ''), u)
  returning id into issue;

  insert into public.payroll_events(account_id, venue_id, entity_id, actor_id, action, details)
  values (a, v, issue, u, 'payout_issue', jsonb_build_object('plan_id', plan.id, 'method', v_method,
    'total', total, 'lines', jsonb_array_length(stored), 'business_date', v_business));
  return issue;
end $function$;

