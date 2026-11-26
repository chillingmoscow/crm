-- «Платит агентство» в официальном трудоустройстве (этап 2, решение 27.11.2026).
--
-- Сотрудник, оформленный через аутстафф-агентство (клинер: получает 4 350 в
-- месяц, заведение платит агентству 10 000 вручную), — это то же официальное
-- оформление (383) с галочкой agency. Сумма в месяц хранится как оклад
-- (payroll_official_salaries.gross) и так же уменьшает долг сотрудника, пока
-- месяц не проведён. В день проведения официальных (payroll_official_run)
-- месяц закрывается записью «Получено через агентство» без движения денег:
-- без операции в финансах, без счёта, без статьи, без НДФЛ, без Adesk.
-- Закрыто = выдано = сумма месяца.
--
-- * payroll_official_employments.agency — галочка оформления; меняется
--   командой payroll_official_command ('employ' / 'update'), пишется в журнал.
-- * payroll_payments.agency — запись «Получено через агентство»: официальная
--   (official_month), без операции и инкассации. Метка хранится на самой
--   записи, а не берётся из оформления: снятая потом галочка не переписывает
--   историю. В Adesk не уходит: official_month уже исключает её (384).
-- * private.payroll_official_agency_post — единственное место, где такая
--   запись создаётся: крон, ручное проведение и разбор карточки «На разбор».
-- * payroll_official_expected / _for — возвращают ещё agency, чтобы ведомость,
--   расчётный лист и план выплат подписывали часть «получит через агентство».
--   Набор столбцов меняется — функции пересоздаются (drop + create).
-- * payroll_record_official_payment — для оформления через агентство берёт
--   только сумму и дату (на руки = сумма, счёт не нужен).
-- * payroll_official_change_account — запись через агентство не переносится:
--   счёта у неё нет.
-- * payroll_cancel_payment (последнее тело — 244) — запись через агентство
--   удаляется сама (операции, через которую обычно отменяется выплата, нет).
--
-- Последние тела: payroll_official_command, payroll_official_expected — 383;
-- payroll_record_official_payment, payroll_official_change_account,
-- payroll_official_run — 384; payroll_official_expected_for — 392;
-- payroll_cancel_payment — 244.

begin;

-- ────────────────────────────────────────────────────────────
-- 1. Столбцы
-- ────────────────────────────────────────────────────────────
alter table public.payroll_official_employments
  add column agency boolean not null default false;

alter table public.payroll_payments
  add column agency boolean not null default false,
  add constraint payroll_payments_agency_check
    check (not agency or (official_month is not null and transaction_id is null
                          and cashbox_id is null and legacy_evidence_id is null));

-- ────────────────────────────────────────────────────────────
-- 2. Запись «Получено через агентство»
-- ────────────────────────────────────────────────────────────
-- Без операции в финансах: сразу выплата и одна аллокация (закрыто = выдано).
-- Те же проверки, что у официальной выплаты в payroll_post_payment_scoped:
-- месяц не раньше начала расчёта, одна действующая официальная запись на
-- сотрудника и месяц. Вызывающий держит блокировку заведения.
create or replace function private.payroll_official_agency_post(
  a uuid, v uuid, u uuid, p_employment uuid, p_month date, p_amount numeric, p_date timestamptz)
returns uuid
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  oe public.payroll_official_employments;
  emp public.payroll_employees;
  key uuid;
  payment uuid;
  v_note text;
  month_names text[] := array['январь','февраль','март','апрель','май','июнь',
                              'июль','август','сентябрь','октябрь','ноябрь','декабрь'];
begin
  perform pg_advisory_xact_lock(hashtextextended(v::text, 0));
  select * into oe from public.payroll_official_employments
   where id = p_employment and account_id = a and venue_id = v and archived_at is null;
  if oe.id is null then raise exception 'Официальное оформление не найдено'; end if;
  if not oe.agency then raise exception 'Сотрудник оформлен не через агентство'; end if;
  select * into emp from public.payroll_employees where id = oe.employee_id and account_id = a and venue_id = v;
  if emp.id is null then raise exception 'Сотрудник не найден в зарплате заведения'; end if;
  if p_month is null or date_trunc('month', p_month)::date <> p_month then
    raise exception 'Некорректный месяц официальной выплаты';
  end if;
  if p_month < (select starts_on from public.payroll_settings where venue_id = v) then
    raise exception 'Получатель или период недоступен';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000000 or round(p_amount, 2) <> p_amount then
    raise exception 'Укажите сумму, которую сотрудник получил через агентство';
  end if;
  if p_date is null then raise exception 'Укажите дату выплаты'; end if;
  if exists (select 1 from public.payroll_payments op join public.payroll_allocations oa on oa.payment_id = op.id
              where op.account_id = a and op.venue_id = v and op.state = 'posted'
                and op.official_month = p_month and oa.employee_id = emp.id) then
    raise exception 'За этот месяц уже проведена официальная выплата';
  end if;

  -- Первое проведение месяца — устойчивый ключ (как у official_post); повтор после удаления — новый.
  key := md5('official:' || p_employment::text || p_month::text)::uuid;
  if exists (select 1 from public.payroll_payments where account_id = a and venue_id = v and request_key = key) then
    key := gen_random_uuid();
  end if;
  v_note := 'Получено через агентство за ' || month_names[extract(month from p_month)::int] || ' '
            || extract(year from p_month)::int;

  insert into public.payroll_payments(account_id, venue_id, request_key, transaction_id, cashbox_id, kind, amount,
    note, created_by, input_snapshot, occurred_at, official_month, agency)
  values (a, v, key, null, null, 'salary', p_amount, v_note, u,
    jsonb_build_object('request_key', key, 'kind', 'salary', 'agency', true, 'employment_id', p_employment,
      'official_month', p_month, 'amount', p_amount, 'date', p_date),
    p_date, p_month, true)
  returning id into payment;
  insert into public.payroll_allocations(account_id, venue_id, payment_id, employee_id, month, amount, settled_amount)
  values (a, v, payment, emp.id, p_month, p_amount, p_amount);
  perform private.payroll_link_accruals(payment);
  insert into public.payroll_events(account_id, venue_id, entity_id, actor_id, action, details)
  values (a, v, payment, u, 'payment', jsonb_build_object('amount', p_amount, 'kind', 'salary', 'rounding', 0, 'agency', true));
  return payment;
end $$;

-- ────────────────────────────────────────────────────────────
-- 3. Команда оформления: галочка «Платит агентство»
-- ────────────────────────────────────────────────────────────
-- Последнее тело — 383. Новое: ключ agency в 'employ' и 'update'.
create or replace function public.payroll_official_command(p_action text, p_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  a uuid; v uuid; u uuid;
  emp public.payroll_employees;
  oe public.payroll_official_employments;
  before_row jsonb;
  changes jsonb;
  v_start date; v_end date; v_from date; v_gross numeric; v_position text;
  v_agency boolean;
  first_salary public.payroll_official_salaries;
  next_from date;
  prev_gross numeric;
  x uuid;
begin
  select s.a, s.v, s.u into a, v, u from private.payroll_scope('payroll.configure') s;
  if a is null or v is null then raise exception 'Выберите заведение'; end if;
  -- Пересечения проверяются по всему аккаунту — сериализуем команды аккаунта.
  perform pg_advisory_xact_lock(hashtextextended('payroll_official:' || a::text, 0));

  if p_input ? 'gross' then
    v_gross := nullif(p_input->>'gross', '')::numeric;
    if v_gross is null or v_gross <= 0 or v_gross > 1000000000 or round(v_gross, 2) <> v_gross then
      raise exception 'Укажите оклад по договору больше нуля';
    end if;
  end if;
  if p_input ? 'agency' then
    if jsonb_typeof(p_input->'agency') is distinct from 'boolean' then
      raise exception 'Укажите, платит ли агентство';
    end if;
    v_agency := (p_input->>'agency')::boolean;
  end if;

  if p_action = 'employ' then
    select * into emp from public.payroll_employees
     where id = (p_input->>'employee_id')::uuid and account_id = a and venue_id = v for update;
    if emp.id is null then raise exception 'Сотрудник не найден в зарплате заведения'; end if;
    if not emp.active then raise exception 'Сотрудник не работает в заведении'; end if;
    v_start := nullif(p_input->>'starts_on', '')::date;
    if v_start is null then raise exception 'Укажите дату оформления'; end if;
    v_position := nullif(trim(p_input->>'position'), '');
    if v_position is null then raise exception 'Укажите должность по договору'; end if;
    if v_gross is null then raise exception 'Укажите оклад по договору больше нуля'; end if;
    if private.payroll_official_overlaps(a, emp.id, emp.local_user_id, v_start, null, null) then
      raise exception 'Сотрудник уже оформлен официально на эти даты';
    end if;

    insert into public.payroll_official_employments(account_id, venue_id, employee_id, starts_on, position,
      contract_number, contract_date, contract_path, agency, created_by, updated_by)
    values (a, v, emp.id, v_start, v_position,
      nullif(trim(p_input->>'contract_number'), ''), nullif(p_input->>'contract_date', '')::date,
      nullif(trim(p_input->>'contract_path'), ''), coalesce(v_agency, false), u, u)
    returning * into oe;
    insert into public.payroll_official_salaries(account_id, venue_id, employment_id, valid_from, gross, created_by)
    values (a, v, oe.id, date_trunc('month', v_start::timestamp)::date, v_gross, u);

    perform private.payroll_official_audit(oe, u, 'payroll.official_employment.created', jsonb_build_object(
      'starts_on', oe.starts_on, 'position', oe.position, 'gross', v_gross,
      'contract_number', oe.contract_number, 'contract_date', oe.contract_date, 'agency', oe.agency));
    return oe.id;
  end if;

  if p_action not in ('update', 'salary', 'end', 'cancel') then
    raise exception 'Неизвестное действие';
  end if;

  select * into oe from public.payroll_official_employments
   where id = (p_input->>'employment_id')::uuid and account_id = a and venue_id = v and archived_at is null
   for update;
  if oe.id is null then raise exception 'Официальное оформление не найдено'; end if;
  select * into emp from public.payroll_employees where id = oe.employee_id;
  before_row := to_jsonb(oe);

  if p_action = 'update' then
    if p_input ? 'position' then
      v_position := nullif(trim(p_input->>'position'), '');
      if v_position is null then raise exception 'Укажите должность по договору'; end if;
    end if;
    v_start := case when p_input ? 'starts_on' then nullif(p_input->>'starts_on', '')::date else oe.starts_on end;
    if v_start is null then raise exception 'Укажите дату оформления'; end if;

    if v_start <> oe.starts_on then
      if oe.ends_on is not null and v_start > oe.ends_on then
        raise exception 'Дата оформления позже даты увольнения';
      end if;
      if exists (select 1 from public.payroll_official_months where employment_id = oe.id) then
        raise exception 'Месяцы этого оформления уже обработаны — дату оформления изменить нельзя';
      end if;
      if private.payroll_official_overlaps(a, emp.id, emp.local_user_id, v_start, oe.ends_on, oe.id) then
        raise exception 'Сотрудник уже оформлен официально на эти даты';
      end if;
      -- Первый оклад действует с месяца оформления — переносим его вместе с датой.
      select * into first_salary from public.payroll_official_salaries
       where employment_id = oe.id order by valid_from limit 1;
      select min(valid_from) into next_from from public.payroll_official_salaries
       where employment_id = oe.id and valid_from > first_salary.valid_from;
      if next_from is not null and date_trunc('month', v_start::timestamp)::date >= next_from then
        raise exception 'Дата оформления позже изменения оклада';
      end if;
      update public.payroll_official_salaries
         set valid_from = date_trunc('month', v_start::timestamp)::date
       where id = first_salary.id;
    end if;

    -- Галочка действует на месяцы, которые ещё не проведены: проведённые
    -- записи хранят свою метку (payroll_payments.agency).
    update public.payroll_official_employments set
      starts_on = v_start,
      position = coalesce(v_position, position),
      contract_number = case when p_input ? 'contract_number' then nullif(trim(p_input->>'contract_number'), '') else contract_number end,
      contract_date = case when p_input ? 'contract_date' then nullif(p_input->>'contract_date', '')::date else contract_date end,
      contract_path = case when p_input ? 'contract_path' then nullif(trim(p_input->>'contract_path'), '') else contract_path end,
      agency = coalesce(v_agency, agency),
      updated_by = u, updated_at = now()
    where id = oe.id
    returning * into oe;

    select coalesce(jsonb_agg(jsonb_build_object('field', k, 'old', before_row->k, 'new', to_jsonb(oe)->k)), '[]')
      into changes
      from unnest(array['starts_on', 'position', 'contract_number', 'contract_date', 'contract_path', 'agency']) k
     where before_row->k is distinct from to_jsonb(oe)->k;
    if jsonb_array_length(changes) > 0 then
      perform private.payroll_official_audit(oe, u, 'payroll.official_employment.updated',
        jsonb_build_object('changes', changes));
    end if;
    return oe.id;

  elsif p_action = 'salary' then
    v_from := nullif(p_input->>'valid_from', '')::date;
    if v_from is null then raise exception 'Укажите, с какого месяца действует оклад'; end if;
    if extract(day from v_from) <> 1 then raise exception 'Оклад меняется с первого числа месяца'; end if;
    if v_gross is null then raise exception 'Укажите оклад по договору больше нуля'; end if;
    if v_from < date_trunc('month', oe.starts_on::timestamp)::date then
      raise exception 'Оклад не может действовать раньше оформления';
    end if;
    if oe.ends_on is not null and v_from > oe.ends_on then
      raise exception 'Месяц нового оклада позже даты увольнения';
    end if;
    if exists (select 1 from public.payroll_official_months
                where employment_id = oe.id and month >= v_from and status in ('posted', 'resolved')) then
      raise exception 'За этот месяц уже проведена официальная выплата — оклад прошлых месяцев не меняется';
    end if;

    select gross into prev_gross from public.payroll_official_salaries
     where employment_id = oe.id and valid_from <= v_from order by valid_from desc limit 1;
    -- Тот же месяц — исправление опечатки в окладе, а не новая версия.
    insert into public.payroll_official_salaries(account_id, venue_id, employment_id, valid_from, gross, document_path, created_by)
    values (a, v, oe.id, v_from, v_gross, nullif(trim(p_input->>'document_path'), ''), u)
    on conflict (employment_id, valid_from) do update
      set gross = excluded.gross, document_path = excluded.document_path,
          created_by = excluded.created_by, created_at = now()
    returning id into x;

    perform private.payroll_official_audit(oe, u, 'payroll.official_salary.created', jsonb_build_object(
      'valid_from', v_from, 'gross', v_gross, 'previous_gross', prev_gross,
      'document_path', nullif(trim(p_input->>'document_path'), ''), 'agency', oe.agency));
    return x;

  elsif p_action = 'end' then
    v_end := nullif(p_input->>'ends_on', '')::date;
    if v_end is null then raise exception 'Укажите дату официального увольнения'; end if;
    if v_end < oe.starts_on then raise exception 'Дата увольнения раньше даты оформления'; end if;
    if exists (select 1 from public.payroll_official_months
                where employment_id = oe.id and month > v_end and status in ('posted', 'resolved')) then
      raise exception 'После этой даты уже проведены официальные выплаты';
    end if;
    if private.payroll_official_overlaps(a, emp.id, emp.local_user_id, oe.starts_on, v_end, oe.id) then
      raise exception 'Сотрудник уже оформлен официально на эти даты';
    end if;

    update public.payroll_official_employments
       set ends_on = v_end, updated_by = u, updated_at = now()
     where id = oe.id
    returning * into oe;
    perform private.payroll_official_audit(oe, u, 'payroll.official_employment.ended', jsonb_build_object(
      'ends_on', v_end, 'previous_ends_on', before_row->'ends_on'));
    return oe.id;

  else -- cancel
    if exists (
      select 1
      from public.payroll_payments p
      join public.payroll_allocations al on al.payment_id = p.id
      where p.account_id = a and p.venue_id = v and p.state = 'posted'
        and p.official_month is not null
        and al.employee_id = oe.employee_id
        and p.official_month >= date_trunc('month', oe.starts_on::timestamp)::date
        and (oe.ends_on is null or p.official_month <= oe.ends_on)) then
      raise exception 'По оформлению есть официальные выплаты — сначала удалите их';
    end if;

    update public.payroll_official_employments
       set archived_at = now(), archived_by = u, updated_by = u, updated_at = now()
     where id = oe.id
    returning * into oe;
    perform private.payroll_official_audit(oe, u, 'payroll.official_employment.cancelled', jsonb_build_object(
      'starts_on', oe.starts_on, 'ends_on', oe.ends_on, 'position', oe.position));
    return oe.id;
  end if;
end $$;

-- ────────────────────────────────────────────────────────────
-- 4. Ожидаемая часть: ещё и agency
-- ────────────────────────────────────────────────────────────
-- Последние тела — 383 и 392; новый столбец agency (из оформления).
drop function public.payroll_official_expected(date, date);
create function public.payroll_official_expected(p_from date, p_to date)
returns table(employee_id uuid, employment_id uuid, month date, kind text, gross numeric, days_paid int, days_in_month int, agency boolean)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with scope as (
    select s.account_id, s.venue_id, s.official_from,
           public.has_permission('payroll.view') as viewer
    from public.payroll_settings s
    where (select auth.uid()) is not null
      and s.account_id = public.get_active_account_id()
      and s.venue_id = public.get_active_venue_id()
      and s.official_from is not null
  )
  select oe.employee_id, oe.id, g.m::date,
         coalesce(om.kind, x.kind),
         case when om.id is null then x.gross else om.gross end,
         case when coalesce(om.kind, x.kind) = 'final' then null else x.days_paid end,
         x.days_in_month,
         oe.agency
  from scope
  join public.payroll_official_employments oe
    on oe.account_id = scope.account_id and oe.venue_id = scope.venue_id and oe.archived_at is null
  cross join lateral generate_series(
    greatest(date_trunc('month', p_from::timestamp), scope.official_from::timestamp,
             date_trunc('month', oe.starts_on::timestamp)),
    least(date_trunc('month', p_to::timestamp),
          coalesce(date_trunc('month', oe.ends_on::timestamp), date_trunc('month', p_to::timestamp))),
    interval '1 month') g(m)
  cross join lateral private.payroll_official_gross(oe.id, g.m::date) x
  left join public.payroll_official_months om
    on om.employment_id = oe.id and om.month = g.m::date
  where (scope.viewer or oe.employee_id = any ((select private.payroll_own_employee_ids())::uuid[]))
    and (om.id is null or om.status = 'review')
  order by oe.employee_id, g.m
$$;

drop function public.payroll_official_expected_for(uuid, uuid, date, date);
create function public.payroll_official_expected_for(p_account uuid, p_venue uuid, p_from date, p_to date)
returns table(employee_id uuid, employment_id uuid, month date, kind text, gross numeric, days_paid int, days_in_month int, agency boolean)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select oe.employee_id, oe.id, g.m::date,
         coalesce(om.kind, x.kind),
         case when om.id is null then x.gross else om.gross end,
         case when coalesce(om.kind, x.kind) = 'final' then null else x.days_paid end,
         x.days_in_month,
         oe.agency
  from public.payroll_settings s
  join public.payroll_official_employments oe
    on oe.account_id = s.account_id and oe.venue_id = s.venue_id and oe.archived_at is null
  cross join lateral generate_series(
    greatest(date_trunc('month', p_from::timestamp), s.official_from::timestamp,
             date_trunc('month', oe.starts_on::timestamp)),
    least(date_trunc('month', p_to::timestamp),
          coalesce(date_trunc('month', oe.ends_on::timestamp), date_trunc('month', p_to::timestamp))),
    interval '1 month') g(m)
  cross join lateral private.payroll_official_gross(oe.id, g.m::date) x
  left join public.payroll_official_months om
    on om.employment_id = oe.id and om.month = g.m::date
  where s.account_id = p_account and s.venue_id = p_venue and s.official_from is not null
    and (om.id is null or om.status = 'review')
  order by oe.employee_id, g.m
$$;

-- ────────────────────────────────────────────────────────────
-- 5. Ручное проведение, смена счёта, удаление
-- ────────────────────────────────────────────────────────────
-- Последнее тело — 384. Через агентство: сумма и дата, на руки = сумма, без счёта.
create or replace function public.payroll_record_official_payment(p_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  a uuid; v uuid; u uuid;
  oe public.payroll_official_employments;
  m public.payroll_official_months;
  v_month date; v_gross numeric; v_net numeric; v_date timestamptz;
  v_kind text; prev_status text; payment uuid;
begin
  select s.a, s.v, s.u into a, v, u from private.payroll_scope('payroll.pay') s;
  if a is null or v is null then raise exception 'Выберите заведение'; end if;
  if not public.has_permission('finance.create_transaction') then raise exception 'Нет доступа к финансовым операциям'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v::text, 0));

  select * into oe from public.payroll_official_employments
   where id = nullif(p_input->>'employment_id', '')::uuid and account_id = a and venue_id = v and archived_at is null;
  if oe.id is null then raise exception 'Официальное оформление не найдено'; end if;
  v_month := nullif(p_input->>'month', '')::date;
  if v_month is null or extract(day from v_month) <> 1 then raise exception 'Укажите месяц официальной выплаты'; end if;
  if oe.starts_on >= (v_month + interval '1 month')::date or (oe.ends_on is not null and oe.ends_on < v_month) then
    raise exception 'Сотрудник не оформлен официально в этом месяце';
  end if;
  v_gross := nullif(p_input->>'gross', '')::numeric;
  v_date := nullif(p_input->>'date', '')::timestamptz;

  if oe.agency then
    -- Без налога: получено через агентство = закрыто по зарплате.
    if v_gross is null or v_gross <= 0 or v_gross > 1000000000 or round(v_gross, 2) <> v_gross then
      raise exception 'Укажите сумму, которую сотрудник получил через агентство';
    end if;
    v_net := v_gross;
    if v_date is null then raise exception 'Укажите дату выплаты'; end if;
    payment := private.payroll_official_agency_post(a, v, u, oe.id, v_month, v_gross, v_date);
  else
    v_net := nullif(p_input->>'net', '')::numeric;
    if v_gross is null or v_net is null or v_net <= 0 or v_gross > 1000000000
       or round(v_gross, 2) <> v_gross or round(v_net, 2) <> v_net then
      raise exception 'Укажите сумму на руки и оклад с налогом';
    end if;
    if v_net > v_gross then raise exception 'Сумма на руки больше оклада с налогом'; end if;
    if v_date is null then raise exception 'Укажите дату выплаты'; end if;
    -- «Одна действующая официальная выплата за месяц» проверяет
    -- payroll_post_payment_scoped — для всех путей проведения сразу.
    payment := private.payroll_official_post(a, v, u, oe.id, v_month, v_gross, v_net,
      nullif(p_input->>'bank_account_id', '')::uuid, v_date);
  end if;

  select status into prev_status from public.payroll_official_months
   where employment_id = oe.id and month = v_month for update;
  select g.kind into v_kind from private.payroll_official_gross(oe.id, v_month) g;
  insert into public.payroll_official_months(account_id, venue_id, employment_id, employee_id, month, kind, gross,
    status, payment_id, resolved_by, resolved_at)
  values (a, v, oe.id, oe.employee_id, v_month, coalesce(v_kind, 'full'), v_gross, 'resolved', payment, u, now())
  on conflict (employment_id, month) do update
    set status = 'resolved', payment_id = excluded.payment_id, gross = excluded.gross,
        resolved_by = excluded.resolved_by, resolved_at = excluded.resolved_at
  returning * into m;

  perform private.payroll_official_month_audit(m, u,
    case when prev_status = 'review' then 'payroll.official_month.resolved' else 'payroll.official_payment.created' end,
    jsonb_build_object('payment_id', payment, 'gross', v_gross, 'net', v_net, 'tax', v_gross - v_net,
      'date', v_date, 'previous_status', prev_status, 'agency', oe.agency,
      'bank_account_id', (select bank_account_id from public.transactions t join public.payroll_payments p on p.transaction_id = t.id where p.id = payment),
      'bank_name', (select b.name from public.bank_accounts b join public.transactions t on t.bank_account_id = b.id
                     join public.payroll_payments p on p.transaction_id = t.id where p.id = payment)));
  return payment;
end $$;

-- Последнее тело — 384. Новое: запись через агентство (без счёта) не переносится.
create or replace function public.payroll_official_change_account(p_input jsonb)
returns uuid[]
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  a uuid; v uuid; u uuid;
  bank public.bank_accounts;
  pid uuid; new_pid uuid;
  p public.payroll_payments; t public.transactions; al public.payroll_allocations;
  month_ids uuid[] := '{}'; moved jsonb := '[]'; result uuid[] := '{}';
begin
  select s.a, s.v, s.u into a, v, u from private.payroll_scope('payroll.pay') s;
  if a is null or v is null then raise exception 'Выберите заведение'; end if;
  if not public.has_permission('finance.create_transaction') then raise exception 'Нет доступа к финансовым операциям'; end if;
  -- Старая операция удаляется — нужно то же право, что у payroll_cancel_payment.
  if not public.has_permission('finance.delete_transaction') then raise exception 'Нет доступа к отмене финансовой операции'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v::text, 0));

  if jsonb_typeof(p_input->'payment_ids') is distinct from 'array'
     or jsonb_array_length(p_input->'payment_ids') not between 1 and 500 then
    raise exception 'Выберите официальные выплаты';
  end if;
  select * into bank from public.bank_accounts
   where id = nullif(p_input->>'bank_account_id', '')::uuid and account_id = a and is_active and deleted_at is null;
  if bank.id is null or bank.currency <> 'RUB' or (bank.venue_id is not null and bank.venue_id <> v) then
    raise exception 'Счёт недоступен';
  end if;
  if bank.type <> 'checking' then raise exception 'Официальную выплату можно провести только с расчётного счёта'; end if;

  for pid in select distinct x::uuid from jsonb_array_elements_text(p_input->'payment_ids') x loop
    select * into p from public.payroll_payments where id = pid and account_id = a and venue_id = v for update;
    if p.id is null or p.state <> 'posted' or p.official_month is null then
      raise exception 'Выплата недоступна для смены счёта';
    end if;
    if p.agency then
      raise exception 'Запись «Получено через агентство» проведена без счёта — сменить его нельзя';
    end if;
    select * into t from public.transactions where id = p.transaction_id;
    if t.bank_account_id = bank.id then
      result := array_append(result, p.id);
      continue;
    end if;
    if (select count(*) from public.payroll_allocations where payment_id = p.id) <> 1 then
      raise exception 'Выплата недоступна для смены счёта';
    end if;
    select * into al from public.payroll_allocations where payment_id = p.id;

    -- Мягкое удаление операции отменяет выплату (payroll_transaction_guard).
    update public.transactions set deleted_at = now(), deleted_by = u where id = t.id and deleted_at is null;
    if (select state from public.payroll_payments where id = p.id) <> 'cancelled' then
      raise exception 'Не удалось отменить выплату на прежнем счёте';
    end if;

    new_pid := private.payroll_post_payment_scoped(jsonb_build_object(
      'request_key', gen_random_uuid(), 'kind', 'salary', 'bank_account_id', bank.id, 'category_id', t.category_id,
      'date', p.occurred_at, 'amount', p.amount, 'note', nullif(p.note, ''), 'official_month', p.official_month,
      'allocations', jsonb_build_array(jsonb_build_object(
        'employee_id', al.employee_id, 'month', al.month, 'amount', al.amount, 'settled_amount', al.settled_amount))),
      a, v, u);

    month_ids := month_ids || array(
      select id from public.payroll_official_months where account_id = a and venue_id = v and payment_id = p.id);
    update public.payroll_official_months set payment_id = new_pid
     where account_id = a and venue_id = v and payment_id = p.id;
    moved := moved || jsonb_build_array(jsonb_build_object(
      'previous_payment_id', p.id, 'payment_id', new_pid, 'employee_id', al.employee_id,
      'employee_name', (select name from public.payroll_employees where id = al.employee_id),
      'month', p.official_month, 'amount', p.amount, 'previous_bank_account_id', t.bank_account_id));
    result := array_append(result, new_pid);
  end loop;

  -- Одна строка журнала на команду.
  if jsonb_array_length(moved) > 0 then
    insert into public.audit_logs(account_id, venue_id, user_id, action_code, entity_type, entity_id, details)
    values (a, v, u, 'payroll.official_payment.account_changed', 'payroll_official_month',
      case when cardinality(month_ids) = 1 then month_ids[1] end,
      jsonb_build_object('bank_account_id', bank.id, 'bank_name', bank.name,
        'count', jsonb_array_length(moved), 'payments', moved));
  end if;
  return result;
end $$;

-- Последнее тело — 244. Обычная выплата отменяется удалением своей операции
-- (payroll_transaction_guard); у записи через агентство операции нет —
-- отменяем её здесь с той же записью в событиях зарплаты.
create or replace function public.payroll_cancel_payment(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare a uuid; v uuid; u uuid; p public.payroll_payments;
begin
  select s.a, s.v, s.u into a, v, u from private.payroll_scope('payroll.pay') s;
  if not public.has_permission('finance.delete_transaction') then raise exception 'Нет доступа к отмене финансовой операции'; end if;
  select * into p from public.payroll_payments where id = p_id and account_id = a and venue_id = v for update;
  if p.id is null then raise exception 'Выплата не найдена'; end if;
  if p.agency then
    if p.state = 'posted' then
      update public.payroll_payments set state = 'cancelled' where id = p.id;
      insert into public.payroll_events(account_id, venue_id, entity_id, actor_id, action)
      values (p.account_id, p.venue_id, p.id, u, 'payment_cancelled');
    end if;
    return;
  end if;
  update public.transactions set deleted_at = now(), deleted_by = u where id = p.transaction_id and account_id = a and deleted_at is null;
end $$;

-- ────────────────────────────────────────────────────────────
-- 6. Крон: через агентство — без счёта, статьи и налога
-- ────────────────────────────────────────────────────────────
-- Последнее тело — 384. Порядок разбора тот же (неактивный, месяц увольнения,
-- пропущенный месяц); дальше оформление через агентство проводится записью
-- «Получено через агентство» на сумму месяца, проверки счёта и статьи к нему
-- не относятся. В ответе заведения — ещё agency (сколько таких записей);
-- amount по-прежнему сумма на руки, ушедшая со счетов (агентские не входят).
create or replace function public.payroll_official_run(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  s record;
  today date; m date; mm date; pay_date timestamptz;
  oe public.payroll_official_employments;
  emp public.payroll_employees;
  g record;
  bank_ok boolean;
  posted int; review int; agency_posted int; total numeric; net numeric;
  st text; rs text; pid uuid; via_agency boolean;
  errors jsonb;
  result jsonb := '[]';
begin
  for s in
    select ps.account_id, ps.venue_id, ps.official_from, ps.official_pay_day, ps.official_bank_account_id,
           coalesce(acc.timezone, 'Europe/Moscow') as tz
    from public.payroll_settings ps
    join public.accounts acc on acc.id = ps.account_id
    join public.venues place on place.id = ps.venue_id
    where ps.official_from is not null and place.archived_at is null
    order by ps.account_id, ps.venue_id
  loop
    today := (p_now at time zone s.tz)::date;
    if extract(day from today) < s.official_pay_day then continue; end if;
    m := (date_trunc('month', today::timestamp) - interval '1 month')::date;
    if m < s.official_from then continue; end if;
    pay_date := (((m + interval '1 month')::date + (s.official_pay_day - 1)) + time '12:00') at time zone s.tz;

    begin
      perform pg_advisory_xact_lock(hashtextextended(s.venue_id::text, 0));
      select exists (
        select 1 from public.bank_accounts b
        where b.id = s.official_bank_account_id and b.account_id = s.account_id
          and b.is_active and b.deleted_at is null and b.currency = 'RUB' and b.type = 'checking'
          and (b.venue_id is null or b.venue_id = s.venue_id)) into bank_ok;
      posted := 0; review := 0; agency_posted := 0; total := 0; errors := '[]';

      for oe in
        select e.* from public.payroll_official_employments e
        where e.account_id = s.account_id and e.venue_id = s.venue_id and e.archived_at is null
          and e.starts_on < (m + interval '1 month')::date
          and (e.ends_on is null or e.ends_on >= s.official_from)
        order by e.starts_on, e.id
      loop
        -- Месяцы периода от official_from (и месяца оформления) до M, без строки месяца, по порядку.
        for mm in
          select x::date from generate_series(
            greatest(s.official_from::timestamp, date_trunc('month', oe.starts_on::timestamp)),
            least(m::timestamp, coalesce(date_trunc('month', oe.ends_on::timestamp), m::timestamp)),
            interval '1 month') x
          where not exists (select 1 from public.payroll_official_months om
                             where om.employment_id = oe.id and om.month = x::date)
        loop
          begin
            select * into g from private.payroll_official_gross(oe.id, mm);
            if g.kind is null then continue; end if;
            select * into emp from public.payroll_employees where id = oe.employee_id;
            st := 'review'; rs := null; pid := null; net := 0; via_agency := false;

            if not emp.active and oe.ends_on is null then
              -- Уже висит карточка «проверьте увольнение» — вторую не создаём.
              if exists (select 1 from public.payroll_official_months om
                          where om.employment_id = oe.id and om.status = 'review' and om.reason = 'inactive' and om.month < mm) then
                continue;
              end if;
              rs := 'inactive';
            elsif g.kind = 'final' then
              rs := 'final_month';
            elsif mm < m then
              rs := 'missed_month';
            elsif oe.agency then
              pid := private.payroll_official_agency_post(s.account_id, s.venue_id, null, oe.id, mm, g.gross, pay_date);
              st := 'posted';
              via_agency := true;
            elsif not bank_ok then
              rs := 'no_bank_account';
            elsif private.payroll_official_category(s.account_id, s.venue_id, emp.id) is null then
              rs := 'no_category';
            else
              net := g.gross - round(g.gross * 0.13, 0);
              pid := private.payroll_official_post(s.account_id, s.venue_id, null, oe.id, mm, g.gross, net,
                                                   s.official_bank_account_id, pay_date);
              st := 'posted';
            end if;

            insert into public.payroll_official_months(account_id, venue_id, employment_id, employee_id, month,
              kind, gross, status, reason, payment_id)
            values (s.account_id, s.venue_id, oe.id, oe.employee_id, mm, g.kind, g.gross, st, rs, pid);
            -- Счётчики — только после успешной записи (переменные не откатываются).
            if st = 'posted' then
              posted := posted + 1;
              total := total + net;
              if via_agency then agency_posted := agency_posted + 1; end if;
            else
              review := review + 1;
            end if;
          exception when others then
            raise warning 'payroll_official_run: account %, venue %, employment %, month %: %',
              s.account_id, s.venue_id, oe.id, mm, sqlerrm;
            errors := errors || jsonb_build_array(jsonb_build_object('employment_id', oe.id, 'month', mm, 'message', sqlerrm));
          end;
        end loop;
      end loop;

      if posted + review > 0 or jsonb_array_length(errors) > 0 then
        result := result || jsonb_build_array(jsonb_build_object(
          'account_id', s.account_id, 'venue_id', s.venue_id, 'month', m,
          'posted', posted, 'review', review, 'agency', agency_posted, 'amount', total, 'errors', errors));
      end if;
    exception when others then
      raise warning 'payroll_official_run: account %, venue %, month %: %', s.account_id, s.venue_id, m, sqlerrm;
      result := result || jsonb_build_array(jsonb_build_object(
        'account_id', s.account_id, 'venue_id', s.venue_id, 'month', m,
        'posted', 0, 'review', 0, 'agency', 0, 'amount', 0, 'error', sqlerrm));
    end;
  end loop;
  return result;
end $$;

-- ────────────────────────────────────────────────────────────
-- 7. Права на функции и проверка результата
-- ────────────────────────────────────────────────────────────
revoke all on function private.payroll_official_agency_post(uuid, uuid, uuid, uuid, date, numeric, timestamptz) from public, anon, authenticated;
revoke all on function public.payroll_official_expected(date, date) from public, anon;
grant execute on function public.payroll_official_expected(date, date) to authenticated, service_role;
revoke all on function public.payroll_official_expected_for(uuid, uuid, date, date) from public, anon, authenticated;
grant execute on function public.payroll_official_expected_for(uuid, uuid, date, date) to service_role;
revoke all on function public.payroll_cancel_payment(uuid) from public, anon;
grant execute on function public.payroll_cancel_payment(uuid) to authenticated;

-- От роли-не-владельца REVOKE/GRANT дают только WARNING — проверяем итог
-- (и то, что create or replace не сбросил права прежних функций).
do $$
begin
  if has_function_privilege('anon', 'private.payroll_official_agency_post(uuid, uuid, uuid, uuid, date, numeric, timestamptz)', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.payroll_official_agency_post(uuid, uuid, uuid, uuid, date, numeric, timestamptz)', 'EXECUTE')
    or has_function_privilege('anon', 'public.payroll_official_expected(date, date)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.payroll_official_expected(date, date)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.payroll_official_expected(date, date)', 'EXECUTE')
    or has_function_privilege('anon', 'public.payroll_official_expected_for(uuid, uuid, date, date)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.payroll_official_expected_for(uuid, uuid, date, date)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.payroll_official_expected_for(uuid, uuid, date, date)', 'EXECUTE')
    or has_function_privilege('anon', 'public.payroll_cancel_payment(uuid)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.payroll_cancel_payment(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.payroll_official_command(text, jsonb)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.payroll_official_command(text, jsonb)', 'EXECUTE')
    or has_function_privilege('anon', 'public.payroll_record_official_payment(jsonb)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.payroll_record_official_payment(jsonb)', 'EXECUTE')
    or has_function_privilege('anon', 'public.payroll_official_change_account(jsonb)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.payroll_official_change_account(jsonb)', 'EXECUTE')
    or has_function_privilege('anon', 'public.payroll_official_run(timestamptz)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.payroll_official_run(timestamptz)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.payroll_official_run(timestamptz)', 'EXECUTE')
  then
    raise exception 'payroll_official_*: права на функции не применились — применяйте от supabase_admin';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
