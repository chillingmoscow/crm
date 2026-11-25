-- 391: план выплат зарплаты (этап 1).
--
-- * payroll_payout_settings — минимум в кэшбоксе после выдачи, чат менеджеров,
--   счёт выдачи наличными, графики выплат (шаг и запас).
-- * payroll_employees.payout_schedule — график сотрудника: main / cleaner / transfer.
-- * payroll_payout_plans / payroll_payout_rows — план выплаты за месяц и его строки.
-- * payroll_payout_issues — выдача дня (наличными через менеджеров или «Выплачено»
--   по переводу): строки, наличные касс в момент выдачи, сообщение в чат.
--
-- Проведение — через private.payroll_post_payment_scoped (как payroll_record_payments
-- из 247). Защита от переплаты — в базе: строка плана и выдача не больше остатка
-- месяца (private.payroll_month_balance), даже если вручную выплатили после
-- утверждения плана. Выдача переводом (Татьяна, самозанятая) в Adesk не уходит:
-- её платёж по счёту уже приходит в Adesk из банка.

begin;

-- ── Настройки ───────────────────────────────────────────────
create table public.payroll_payout_settings (
  account_id uuid not null,
  venue_id uuid not null,
  min_cash numeric(15,2) not null default 120000 check (min_cash >= 0 and min_cash <= 1000000000),
  chat_id text check (chat_id ~ '^-?\d+$'),
  bank_account_id uuid,
  schedules jsonb not null default '{
    "main":     {"method":"cash",    "first":[25,1],  "second":[10,16], "step":5000, "reserve":5000},
    "cleaner":  {"method":"cash",    "first":[18,22], "second":[3,7],   "step":5000, "reserve":0},
    "transfer": {"method":"transfer","first":[25,1],  "second":[10,16], "step":500,  "reserve":0, "bank_account_id":null}
  }'::jsonb check (jsonb_typeof(schedules) = 'object'),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (account_id, venue_id),
  foreign key (account_id, venue_id) references public.payroll_settings(account_id, venue_id),
  foreign key (account_id, bank_account_id) references public.bank_accounts(account_id, id)
);
create index payroll_payout_settings_bank on public.payroll_payout_settings(account_id, bank_account_id);

alter table public.payroll_employees
  add column payout_schedule text not null default 'main'
  check (payout_schedule in ('main', 'cleaner', 'transfer'));

-- ── План и строки ───────────────────────────────────────────
create table public.payroll_payout_plans (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  venue_id uuid not null,
  schedule text not null check (schedule in ('main', 'cleaner', 'transfer')),
  month date not null check (date_trunc('month', month)::date = month),
  payout_no smallint not null check (payout_no in (1, 2)),
  window_from date not null,
  window_to date not null,
  state text not null default 'draft' check (state in ('draft', 'approved', 'cancelled')),
  version integer not null default 1,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  cancelled_by uuid references public.profiles(id),
  cancelled_at timestamptz,
  check (window_to >= window_from),
  unique (account_id, id),
  foreign key (account_id, venue_id) references public.payroll_settings(account_id, venue_id)
);
create unique index payroll_payout_plans_live
  on public.payroll_payout_plans(venue_id, schedule, month, payout_no) where state <> 'cancelled';
create index payroll_payout_plans_settings on public.payroll_payout_plans(account_id, venue_id);

create table public.payroll_payout_rows (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  venue_id uuid not null,
  plan_id uuid not null,
  employee_id uuid not null,
  pay_date date,
  amount numeric(15,2) not null check (amount >= 0),
  issued numeric(15,2) not null default 0 check (issued >= 0 and issued <= amount),
  state text not null default 'planned' check (state in ('planned', 'partial', 'issued')),
  breakdown jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (plan_id, employee_id),
  foreign key (account_id, plan_id) references public.payroll_payout_plans(account_id, id) on delete cascade,
  foreign key (account_id, venue_id, employee_id) references public.payroll_employees(account_id, venue_id, id)
);
create index payroll_payout_rows_plan on public.payroll_payout_rows(account_id, plan_id);
create index payroll_payout_rows_employee on public.payroll_payout_rows(account_id, venue_id, employee_id);

create table public.payroll_payout_issues (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  venue_id uuid not null,
  plan_id uuid not null,
  business_date date not null,
  method text not null check (method in ('cash', 'transfer')),
  request_key uuid not null,
  bank_account_id uuid not null,
  total numeric(15,2) not null check (total >= 0),
  lines jsonb not null,
  cash jsonb,
  input_snapshot jsonb not null,
  message text,
  message_sent_at timestamptz,
  message_error text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (venue_id, request_key),
  foreign key (account_id, plan_id) references public.payroll_payout_plans(account_id, id),
  foreign key (account_id, bank_account_id) references public.bank_accounts(account_id, id)
);
create index payroll_payout_issues_plan on public.payroll_payout_issues(account_id, plan_id);
create index payroll_payout_issues_day on public.payroll_payout_issues(venue_id, business_date);
create index payroll_payout_issues_bank on public.payroll_payout_issues(account_id, bank_account_id);

-- Читают те, кто видит зарплату заведения; пишут только функции ниже и сервер
-- (статус сообщения в чат — admin-клиентом).
do $$
declare t text;
begin
  foreach t in array array['payroll_payout_settings', 'payroll_payout_plans', 'payroll_payout_rows', 'payroll_payout_issues'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.payroll_read(account_id, venue_id)))',
      t || '_read', t);
  end loop;
end $$;

-- ── Общие проверки ──────────────────────────────────────────
-- Остаток месяца сотрудника; строка или выдача больше него — переплата.
create or replace function private.payroll_payout_guard(p_employee uuid, p_month date, p_amount numeric)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare balance numeric;
begin
  if p_amount <= 0 then return; end if;
  balance := private.payroll_month_balance(p_employee, p_month);
  if p_amount > balance then
    raise exception 'Больше, чем сотрудник уже заработал: %',
      (select name from public.payroll_employees where id = p_employee);
  end if;
end $function$;

create or replace function private.payroll_payout_money(p_value jsonb, p_label text)
returns numeric
language plpgsql
immutable
set search_path = public, pg_catalog
as $function$
declare n numeric;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'number' then raise exception 'Укажите сумму: %', p_label; end if;
  n := (p_value #>> '{}')::numeric;
  if n < 0 or n > 1000000000 or round(n, 2) <> n then raise exception 'Некорректная сумма: %', p_label; end if;
  return n;
end $function$;

-- ── Настройки графика выплат ────────────────────────────────
create or replace function public.payroll_payout_save_settings(p_input jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  a uuid; v uuid; u uuid;
  defaults jsonb := '{
    "main":     {"method":"cash",    "first":[25,1],  "second":[10,16], "step":5000, "reserve":5000},
    "cleaner":  {"method":"cash",    "first":[18,22], "second":[3,7],   "step":5000, "reserve":0},
    "transfer": {"method":"transfer","first":[25,1],  "second":[10,16], "step":500,  "reserve":0, "bank_account_id":null}
  }'::jsonb;
  result jsonb := '{}'::jsonb;
  code text; given jsonb; step numeric; reserve numeric; transfer_bank uuid;
  cash_bank uuid := nullif(p_input->>'bank_account_id', '')::uuid;
  chat text := nullif(trim(coalesce(p_input->>'chat_id', '')), '');
  min_cash numeric;
  item jsonb; emp uuid;
begin
  select s.a, s.v, s.u into a, v, u from private.payroll_scope('payroll.configure') s;
  if a is null or v is null then raise exception 'Выберите заведение'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v::text, 0));
  if not exists (select 1 from public.payroll_settings where account_id = a and venue_id = v) then
    raise exception 'Начальная настройка не выполнена';
  end if;

  min_cash := private.payroll_payout_money(coalesce(p_input->'min_cash', '120000'::jsonb), 'минимум в кэшбоксе');
  if chat is not null and chat !~ '^-?\d+$' then raise exception 'Укажите числовой ID чата'; end if;
  if cash_bank is not null and not exists (
    select 1 from public.bank_accounts b where b.id = cash_bank and b.account_id = a and b.is_active
      and b.currency = 'RUB' and b.type = 'cash' and (b.venue_id is null or b.venue_id = v)) then
    raise exception 'Для выдачи наличными выберите кассу';
  end if;

  -- Способ и окна графиков в этом этапе фиксированы: меняются только шаг, запас и счёт перевода.
  for code in select jsonb_object_keys(defaults) loop
    given := coalesce(p_input->'schedules'->code, '{}'::jsonb);
    if jsonb_typeof(given) <> 'object' then raise exception 'Некорректный график выплат'; end if;
    step := private.payroll_payout_money(coalesce(given->'step', defaults->code->'step'), 'шаг округления');
    reserve := private.payroll_payout_money(coalesce(given->'reserve', defaults->code->'reserve'), 'запас');
    if step < 1 or step > 100000 or step <> trunc(step) then raise exception 'Шаг округления — от 1 до 100 000 ₽'; end if;
    if reserve > 1000000 then raise exception 'Запас — не больше 1 000 000 ₽'; end if;
    result := result || jsonb_build_object(code, (defaults->code) || jsonb_build_object('step', step, 'reserve', reserve));
    if code = 'transfer' then
      transfer_bank := nullif(given->>'bank_account_id', '')::uuid;
      if transfer_bank is not null and not exists (
        select 1 from public.bank_accounts b where b.id = transfer_bank and b.account_id = a and b.is_active
          and b.currency = 'RUB' and b.type = 'checking' and (b.venue_id is null or b.venue_id = v)) then
        raise exception 'Для выплат переводом выберите расчётный счёт';
      end if;
      result := jsonb_set(result, '{transfer,bank_account_id}', coalesce(to_jsonb(transfer_bank), 'null'::jsonb));
    end if;
  end loop;

  insert into public.payroll_payout_settings(account_id, venue_id, min_cash, chat_id, bank_account_id, schedules, updated_by, updated_at)
  values (a, v, min_cash, chat, cash_bank, result, u, now())
  on conflict (account_id, venue_id) do update
    set min_cash = excluded.min_cash, chat_id = excluded.chat_id, bank_account_id = excluded.bank_account_id,
        schedules = excluded.schedules, updated_by = u, updated_at = now();

  if p_input ? 'assignments' then
    if jsonb_typeof(p_input->'assignments') <> 'array' or jsonb_array_length(p_input->'assignments') > 1000 then
      raise exception 'Некорректный список сотрудников';
    end if;
    for item in select * from jsonb_array_elements(p_input->'assignments') loop
      if coalesce(item->>'schedule', '') not in ('main', 'cleaner', 'transfer') then raise exception 'Некорректный график выплат'; end if;
      update public.payroll_employees set payout_schedule = item->>'schedule'
       where id = (item->>'employee_id')::uuid and account_id = a and venue_id = v
       returning id into emp;
      if emp is null then raise exception 'Сотрудник недоступен'; end if;
    end loop;
  end if;

  insert into public.payroll_events(account_id, venue_id, entity_id, actor_id, action, details)
  values (a, v, v, u, 'payout_settings', jsonb_build_object('min_cash', min_cash, 'chat_id', chat, 'bank_account_id', cash_bank,
    'schedules', result, 'assignments', coalesce(p_input->'assignments', '[]'::jsonb)));
end $function$;

-- ── Сохранить план (черновик) ───────────────────────────────
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
    if emp.payout_schedule <> v_schedule then raise exception 'Сотрудник % в другом графике выплат', emp.name; end if;
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

-- ── Правка строки ───────────────────────────────────────────
create or replace function public.payroll_payout_row_update(p_row uuid, p_amount numeric, p_pay_date date)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare a uuid; v uuid; u uuid; r public.payroll_payout_rows; plan public.payroll_payout_plans; name text;
begin
  select s.a, s.v, s.u into a, v, u from private.payroll_scope('payroll.pay') s;
  if a is null or v is null then raise exception 'Выберите заведение'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v::text, 0));
  select * into r from public.payroll_payout_rows where id = p_row and account_id = a and venue_id = v for update;
  if r.id is null then raise exception 'Строка плана недоступна'; end if;
  select * into plan from public.payroll_payout_plans where id = r.plan_id for update;
  select e.name into name from public.payroll_employees e where e.id = r.employee_id;
  if plan.state = 'cancelled' then raise exception 'План отменён'; end if;
  if r.state = 'issued' then raise exception 'Строка уже выдана'; end if;
  if p_amount is null or p_amount < 0 or p_amount > 1000000000 or round(p_amount, 2) <> p_amount then
    raise exception 'Некорректная сумма: %', name;
  end if;
  if p_amount < r.issued then raise exception 'Уже выдано больше'; end if;
  if p_pay_date is not null and (p_pay_date < plan.window_from or p_pay_date > plan.window_to) then
    raise exception 'День выплаты вне окна: %', name;
  end if;
  perform private.payroll_payout_guard(r.employee_id, plan.month, p_amount - r.issued);
  update public.payroll_payout_rows
     set amount = p_amount, pay_date = p_pay_date, updated_by = u, updated_at = now(),
         state = case when r.issued = 0 then 'planned' when r.issued = p_amount then 'issued' else 'partial' end
   where id = r.id;
  insert into public.payroll_events(account_id, venue_id, employee_id, entity_id, actor_id, action, details)
  values (a, v, r.employee_id, plan.id, u, 'payout_row', jsonb_build_object('row_id', r.id,
    'amount', p_amount, 'previous_amount', r.amount, 'pay_date', p_pay_date, 'previous_pay_date', r.pay_date));
end $function$;

-- ── Утвердить / отменить ────────────────────────────────────
create or replace function public.payroll_payout_plan_state(p_plan uuid, p_state text)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare a uuid; v uuid; u uuid; plan public.payroll_payout_plans;
begin
  select s.a, s.v, s.u into a, v, u from private.payroll_scope('payroll.pay') s;
  if a is null or v is null then raise exception 'Выберите заведение'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v::text, 0));
  select * into plan from public.payroll_payout_plans where id = p_plan and account_id = a and venue_id = v for update;
  if plan.id is null then raise exception 'План недоступен'; end if;
  if p_state = 'approved' then
    if plan.state <> 'draft' then raise exception 'План уже утверждён или отменён'; end if;
    if not exists (select 1 from public.payroll_payout_rows where plan_id = plan.id and amount > 0) then
      raise exception 'В плане нет сумм к выдаче';
    end if;
    update public.payroll_payout_plans set state = 'approved', approved_by = u, approved_at = now() where id = plan.id;
  elsif p_state = 'cancelled' then
    if plan.state = 'cancelled' then raise exception 'План уже отменён'; end if;
    update public.payroll_payout_plans set state = 'cancelled', cancelled_by = u, cancelled_at = now() where id = plan.id;
  else
    raise exception 'Недопустимое состояние плана';
  end if;
  insert into public.payroll_events(account_id, venue_id, entity_id, actor_id, action, details)
  values (a, v, plan.id, u, 'payout_plan_state', jsonb_build_object('state', p_state, 'previous', plan.state));
end $function$;

-- ── Выдача дня ──────────────────────────────────────────────
-- Наличными (method cash, счёт-касса) — строки дня одним проведением; переводом
-- (method transfer, расчётный счёт) — «Выплачено» по одной строке, без Adesk.
create or replace function public.payroll_payout_issue(p_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  a uuid; v uuid; u uuid;
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
begin
  select s.a, s.v, s.u into a, v, u from private.payroll_scope('payroll.pay') s;
  if a is null or v is null then raise exception 'Выберите заведение'; end if;
  if not public.has_permission('finance.create_transaction') then raise exception 'Нет доступа к финансовым операциям'; end if;
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
    if emp.payout_schedule <> plan.schedule then
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

  insert into public.payroll_payout_issues(account_id, venue_id, plan_id, business_date, method, request_key,
    bank_account_id, total, lines, cash, input_snapshot, message, created_by)
  values (a, v, plan.id, v_business, v_method, v_key, bank.id, total, stored,
    case when jsonb_typeof(p_input->'cash') = 'object' then p_input->'cash' end, p_input,
    nullif(p_input->>'message', ''), u)
  returning id into issue;

  insert into public.payroll_events(account_id, venue_id, entity_id, actor_id, action, details)
  values (a, v, issue, u, 'payout_issue', jsonb_build_object('plan_id', plan.id, 'method', v_method,
    'total', total, 'lines', jsonb_array_length(stored), 'business_date', v_business));
  return issue;
end $function$;

-- ── Удалённая выплата возвращает строку плана ──────────────
-- Выплату плана исправляют удалением (payroll_cancel_payment). Тогда выданное по
-- строке и итог выдачи уменьшаются, строку снова можно выдать или поправить.
create or replace function private.payroll_payout_payment_cancelled()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare hit record;
begin
  if old.state = 'posted' and new.state = 'cancelled' then
    for hit in
      select i.id as issue_id, (l->>'row_id')::uuid as row_id, (l->>'amount')::numeric as amount
        from public.payroll_payout_issues i, jsonb_array_elements(i.lines) l
       where i.account_id = new.account_id and i.venue_id = new.venue_id
         and l->>'payment_id' = new.id::text
    loop
      update public.payroll_payout_rows
         set issued = greatest(0, issued - hit.amount),
             state = case when greatest(0, issued - hit.amount) = 0 then 'planned' else 'partial' end,
             updated_at = now()
       where id = hit.row_id;
      update public.payroll_payout_issues set total = greatest(0, total - hit.amount) where id = hit.issue_id;
    end loop;
  end if;
  return null;
end $function$;
create trigger payroll_payout_payment_cancelled
  after update of state on public.payroll_payments
  for each row execute function private.payroll_payout_payment_cancelled();

-- ── Права ───────────────────────────────────────────────────
revoke all on function private.payroll_payout_guard(uuid, date, numeric) from public, anon, authenticated;
revoke all on function private.payroll_payout_money(jsonb, text) from public, anon, authenticated;
revoke all on function private.payroll_payout_payment_cancelled() from public, anon, authenticated;
revoke all on function public.payroll_payout_save_settings(jsonb) from public, anon;
revoke all on function public.payroll_payout_plan_save(jsonb) from public, anon;
revoke all on function public.payroll_payout_row_update(uuid, numeric, date) from public, anon;
revoke all on function public.payroll_payout_plan_state(uuid, text) from public, anon;
revoke all on function public.payroll_payout_issue(jsonb) from public, anon;
grant execute on function public.payroll_payout_save_settings(jsonb) to authenticated;
grant execute on function public.payroll_payout_plan_save(jsonb) to authenticated;
grant execute on function public.payroll_payout_row_update(uuid, numeric, date) to authenticated;
grant execute on function public.payroll_payout_plan_state(uuid, text) to authenticated;
grant execute on function public.payroll_payout_issue(jsonb) to authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.payroll_payout_save_settings(jsonb)',
    'public.payroll_payout_plan_save(jsonb)',
    'public.payroll_payout_row_update(uuid, numeric, date)',
    'public.payroll_payout_plan_state(uuid, text)',
    'public.payroll_payout_issue(jsonb)'
  ] loop
    if has_function_privilege('anon', f, 'execute') or not has_function_privilege('authenticated', f, 'execute') then
      raise exception 'Права на % выставлены неверно', f;
    end if;
  end loop;
  foreach f in array array['private.payroll_payout_guard(uuid, date, numeric)', 'private.payroll_payout_money(jsonb, text)', 'private.payroll_payout_payment_cancelled()'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception 'Права на % выставлены неверно', f;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
