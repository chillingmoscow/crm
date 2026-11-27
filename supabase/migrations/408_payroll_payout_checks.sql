-- План выплат, этап 3 (Павел, 27.11.2026): утренняя сверка выдачи с изъятием
-- из кассы, автоперенос остатка месяца после второй выплаты и карточки
-- «Финансы → На разбор» обо всём, что требует человека.
--
-- Пишет всё сервер (крон /api/cron/payroll-payout-check и автовыдача) —
-- service_role. Пользователь только читает карточки (payroll.pay в активном
-- заведении) и закрывает их «Всё верно» через payroll_payout_alert_resolve.

-- 1. Карточки «На разбор» по выплатам зарплаты. Ключ (заведение, вид, key)
-- не даёт завести одну и ту же карточку дважды: закрытая не откроется снова.
create table public.payroll_payout_alerts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  venue_id uuid not null,
  kind text not null check (kind in ('reconcile', 'short', 'carry', 'transfer', 'failed', 'message')),
  key text not null check (length(key) between 1 and 200),
  plan_id uuid,
  business_date date,
  title text not null check (length(title) between 1 and 300),
  lines jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array'),
  copy_text text check (copy_text is null or length(copy_text) <= 4000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  unique (account_id, id),
  unique (venue_id, kind, key),
  foreign key (account_id, venue_id) references public.payroll_settings(account_id, venue_id),
  foreign key (account_id, plan_id) references public.payroll_payout_plans(account_id, id) on delete cascade
);
create index payroll_payout_alerts_venue on public.payroll_payout_alerts (account_id, venue_id, status);
create index payroll_payout_alerts_plan on public.payroll_payout_alerts (account_id, plan_id);
create index payroll_payout_alerts_resolved_by on public.payroll_payout_alerts (resolved_by);

-- 2. Сверка дня выдачи с изъятиями Quick Resto: одна строка на день.
-- movement_ids — изъятия, засчитанные этому дню (одно изъятие — не больше
-- чем одному дню; проверяет сверка).
create table public.payroll_payout_withdrawals (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  venue_id uuid not null,
  business_date date not null,
  issued numeric(15,2) not null check (issued >= 0),
  withdrawn numeric(15,2) not null check (withdrawn >= 0),
  state text not null check (state in ('matched', 'mismatch')),
  movement_ids bigint[] not null default '{}',
  checked_at timestamptz not null default now(),
  unique (account_id, id),
  unique (venue_id, business_date),
  foreign key (account_id, venue_id) references public.payroll_settings(account_id, venue_id)
);
create index payroll_payout_withdrawals_venue on public.payroll_payout_withdrawals (account_id, venue_id);

-- 3. Когда остаток месяца по второму плану перенесён целиком.
alter table public.payroll_payout_plans add column carried_at timestamptz;

do $$declare t text;begin
  foreach t in array array['payroll_payout_alerts', 'payroll_payout_withdrawals'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    -- Карточки и сверка — только тем, кто выплачивает зарплату (как официальные, 384).
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.payroll_read(account_id, venue_id)) and (select public.has_permission(''payroll.pay'')))',
      t || '_select', t);
  end loop;
end $$;

-- 4. Перенос остатка: тело payroll_transfer (245) — в общее ядро, чтобы им
-- пользовались и человек (payroll_transfer), и сервер (перенос по плану).
-- Проверки «месяц готов» не обходятся.
create or replace function private.payroll_transfer_core(p_input jsonb, a uuid, v uuid, u uuid)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare e public.payroll_employees;t public.payroll_transfers;x uuid;
 f date:=(p_input->>'from_month')::date;dest date:=(p_input->>'to_month')::date;n numeric:=(p_input->>'amount')::numeric;balance numeric;
begin
 if a is null or v is null then raise exception 'Выберите заведение';end if;
 perform pg_advisory_xact_lock(hashtextextended(v::text,0));
 select * into t from public.payroll_transfers where account_id=a and venue_id=v and request_key=(p_input->>'request_key')::uuid;
 if t.id is not null then if t.input_snapshot is distinct from p_input then raise exception 'Ключ уже использован для другого переноса';end if;return t.id;end if;
 select * into e from public.payroll_employees where id=(p_input->>'employee_id')::uuid and account_id=a and venue_id=v for update;
 if e.id is null then raise exception 'Сотрудник недоступен';end if;
 if not e.opening_confirmed then raise exception 'Сначала укажите начальный долг или переплату';end if;
 if exists(select 1 from public.payroll_legacy_payments where employee_id=e.id and month=f and state='review') then raise exception 'Сначала внесите прежние выплаты этого месяца';end if;
 if f is null or dest is null or dest<=f or date_trunc('month',f)::date<>f or date_trunc('month',dest)::date<>dest or f<(select starts_on from public.payroll_settings where venue_id=v) then raise exception 'Выберите следующий месяц';end if;
 if not exists(select 1 from public.payroll_periods where venue_id=v and month=f) then raise exception 'Расчёт исходного месяца не готов';end if;
 if exists(select 1 from public.payroll_periods where venue_id=v and month=dest and status='closed') then raise exception 'Месяц назначения уже закрыт';end if;
 if n is null or n=0 or abs(n)>1000000000 or round(n,2)<>n or coalesce(length(trim(p_input->>'reason')),0)<3 or p_input->>'request_key' is null then raise exception 'Укажите сумму и причину переноса';end if;
 if exists(select 1 from public.payroll_source_days where venue_id=v and business_date>=f and business_date<f+interval '1 month' and state<>'complete') or exists(select 1 from public.payroll_accruals where employee_id=e.id and business_date>=f and business_date<f+interval '1 month' and cardinality(issues)>0) or exists(select 1 from public.payroll_adjustments where employee_id=e.id and business_date>=f and business_date<f+interval '1 month' and not approved) then raise exception 'Сначала завершите расчёт сотрудника за исходный месяц';end if;
 balance:=private.payroll_month_balance(e.id,f);
 if sign(n)<>sign(balance) or abs(n)>abs(balance) then raise exception 'Сумма превышает остаток этого месяца';end if;
 insert into public.payroll_transfers(account_id,venue_id,employee_id,from_month,to_month,amount,reason,request_key,input_snapshot,created_by)
 values(a,v,e.id,f,dest,n,trim(p_input->>'reason'),(p_input->>'request_key')::uuid,p_input,u) returning id into x;
 insert into public.payroll_events(account_id,venue_id,employee_id,entity_id,actor_id,action,details) values(a,v,e.id,x,u,'transfer',jsonb_build_object('from_month',f,'to_month',dest,'amount',n,'reason',p_input->>'reason'));
 return x;
end $$;

create or replace function public.payroll_transfer(p_input jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare a uuid;v uuid;u uuid;
begin
 select s.a,s.v,s.u into a,v,u from private.payroll_scope('payroll.review') s;
 return private.payroll_transfer_core(p_input,a,v,u);
end $$;

-- 5. Перенос остатка по второму плану — сервер, без пользователя. Автор
-- переноса — кто утвердил план (как у выплат по плану). Каждый сотрудник —
-- отдельно: если у одного месяц не готов, остальные переносятся, а он
-- возвращается в blocked с причиной. Уже перенесённый по этому плану не
-- переносится второй раз (ключ — план + сотрудник).
create or replace function public.payroll_payout_carry_system(p_account uuid, p_venue uuid, p_plan uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  plan public.payroll_payout_plans;
  item jsonb;
  emp uuid;
  amount numeric;
  k uuid;
  x uuid;
  carried jsonb := '[]'::jsonb;
  blocked jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_items) <> 'array' then raise exception 'Нет списка переноса';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_venue::text,0));
  select * into plan from public.payroll_payout_plans
   where id = p_plan and account_id = p_account and venue_id = p_venue for update;
  if plan.id is null then raise exception 'План недоступен';end if;
  if plan.state <> 'approved' or plan.payout_no <> 2 then raise exception 'Переносится только утверждённый план второй выплаты';end if;
  if plan.approved_by is null then raise exception 'У плана нет утвердившего';end if;
  if plan.carried_at is not null then return jsonb_build_object('carried', carried, 'blocked', blocked, 'done', true);end if;
  for item in select * from jsonb_array_elements(p_items) loop
    emp := (item->>'employee_id')::uuid;
    amount := (item->>'amount')::numeric;
    if not exists (select 1 from public.payroll_payout_rows where plan_id = plan.id and employee_id = emp) then
      blocked := blocked || jsonb_build_object('employee_id', emp, 'reason', 'Сотрудника нет в плане');
      continue;
    end if;
    k := md5('payout-carry:' || plan.id::text || ':' || emp::text)::uuid;
    -- Новый остаток после переноса (позднее начисление) — забота следующего плана.
    if exists (select 1 from public.payroll_transfers where venue_id = p_venue and request_key = k) then continue;end if;
    begin
      x := private.payroll_transfer_core(jsonb_build_object(
        'request_key', k,
        'employee_id', emp,
        'from_month', plan.month,
        'to_month', (plan.month + interval '1 month')::date,
        'amount', amount,
        'reason', coalesce(nullif(trim(item->>'reason'), ''), 'Остаток после второй выплаты')
      ), p_account, p_venue, plan.approved_by);
      carried := carried || jsonb_build_object('employee_id', emp, 'amount', amount, 'transfer_id', x);
    exception when others then
      blocked := blocked || jsonb_build_object('employee_id', emp, 'reason', sqlerrm);
    end;
  end loop;
  if jsonb_array_length(blocked) = 0 then
    update public.payroll_payout_plans set carried_at = now() where id = plan.id;
  end if;
  return jsonb_build_object('carried', carried, 'blocked', blocked, 'done', jsonb_array_length(blocked) = 0);
end $$;

-- 6. «Всё верно» на карточке: закрыть. true — закрыли сейчас, false — уже была закрыта.
create or replace function public.payroll_payout_alert_resolve(p_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_catalog as $$
declare a uuid;v uuid;u uuid;found_id uuid;
begin
  select s.a,s.v,s.u into a,v,u from private.payroll_scope('payroll.pay') s;
  if a is null or v is null then raise exception 'Выберите заведение';end if;
  if not exists (select 1 from public.payroll_payout_alerts where id = p_id and account_id = a and venue_id = v) then
    raise exception 'Карточка не найдена';
  end if;
  update public.payroll_payout_alerts
     set status = 'resolved', resolved_by = u, resolved_at = now(), updated_at = now()
   where id = p_id and account_id = a and venue_id = v and status = 'open'
   returning id into found_id;
  return found_id is not null;
end $$;

revoke all on function private.payroll_transfer_core(jsonb, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.payroll_transfer(jsonb) from public, anon;
grant execute on function public.payroll_transfer(jsonb) to authenticated;
revoke all on function public.payroll_payout_carry_system(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.payroll_payout_carry_system(uuid, uuid, uuid, jsonb) to service_role;
revoke all on function public.payroll_payout_alert_resolve(uuid) from public, anon;
grant execute on function public.payroll_payout_alert_resolve(uuid) to authenticated;

do $$begin
  if has_function_privilege('anon', 'public.payroll_payout_carry_system(uuid, uuid, uuid, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.payroll_payout_carry_system(uuid, uuid, uuid, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'private.payroll_transfer_core(jsonb, uuid, uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public.payroll_payout_alert_resolve(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.payroll_payout_alert_resolve(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.payroll_transfer(jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.payroll_payout_carry_system(uuid, uuid, uuid, jsonb)', 'execute') then
    raise exception 'Права на функции плана выплат выставлены не так';
  end if;
end $$;
