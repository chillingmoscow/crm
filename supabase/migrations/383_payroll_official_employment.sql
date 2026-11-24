-- Официальное трудоустройство: периоды оформления, версии оклада по договору
-- и «официальный месяц» (одна строка на период и месяц: проведено / на разборе /
-- разобрано / пропущено). Строка месяца — защита от повторного проведения
-- (задача 384): она остаётся и после удаления выплаты.
--
-- Сумма месяца считается только здесь — private.payroll_official_gross:
--   * full  — полный месяц, оклад по договору;
--   * first — оформлен после 1-го числа: оклад × (дней с даты оформления
--             включительно до конца месяца) / дней в месяце, до копеек;
--   * final — месяц официального увольнения или сотрудник уже неактивен в
--             зарплате без даты увольнения: сумма неизвестна (gross null).
-- Оклад месяца — версия с наибольшим valid_from ≤ месяц.
--
-- Ведомость получает ожидаемую (ещё не проведённую) часть через
-- payroll_official_expected; изменения — только через payroll_official_command
-- (право payroll.configure), прямой записи в таблицы у клиента нет.

begin;

-- ────────────────────────────────────────────────────────────
-- 1. Таблицы
-- ────────────────────────────────────────────────────────────
create table public.payroll_official_employments (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null,
  venue_id         uuid not null,
  employee_id      uuid not null,
  starts_on        date not null,
  ends_on          date,
  position         text not null check (length(trim(position)) > 0),
  contract_number  text,
  contract_date    date,
  contract_path    text,
  created_by       uuid references public.profiles(id),
  created_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles(id),
  updated_at       timestamptz not null default now(),
  archived_at      timestamptz,
  archived_by      uuid references public.profiles(id),
  constraint payroll_official_employments_scope_key unique (account_id, venue_id, id),
  constraint payroll_official_employments_dates check (ends_on is null or ends_on >= starts_on),
  constraint payroll_official_employments_employee_fkey foreign key (account_id, venue_id, employee_id)
    references public.payroll_employees (account_id, venue_id, id)
);
create index payroll_official_employments_employee_idx
  on public.payroll_official_employments (account_id, venue_id, employee_id);
-- Один открытый период на карточку зарплаты; на пользователя в аккаунте —
-- проверка в payroll_official_command (карточек у него может быть несколько).
create unique index payroll_official_employments_open_uidx
  on public.payroll_official_employments (employee_id)
  where archived_at is null and ends_on is null;

create table public.payroll_official_salaries (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null,
  venue_id       uuid not null,
  employment_id  uuid not null,
  valid_from     date not null check (extract(day from valid_from) = 1),
  gross          numeric(15,2) not null check (gross > 0),
  document_path  text,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  constraint payroll_official_salaries_version_key unique (employment_id, valid_from),
  constraint payroll_official_salaries_employment_fkey foreign key (account_id, venue_id, employment_id)
    references public.payroll_official_employments (account_id, venue_id, id)
);
create index payroll_official_salaries_employment_idx
  on public.payroll_official_salaries (account_id, venue_id, employment_id);

create table public.payroll_official_months (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null,
  venue_id       uuid not null,
  employment_id  uuid not null,
  employee_id    uuid not null,
  month          date not null check (extract(day from month) = 1),
  kind           text not null check (kind in ('full', 'first', 'final')),
  gross          numeric(15,2) check (gross > 0),
  status         text not null check (status in ('posted', 'review', 'resolved', 'skipped')),
  -- missed_month — прошлый месяц без строки (поздно оформили, крон не работал
  -- дольше месяца): задним числом крон не проводит, только на разбор.
  reason         text check (reason in ('final_month', 'no_bank_account', 'no_category', 'inactive', 'missed_month')),
  payment_id     uuid,
  resolved_by    uuid references public.profiles(id),
  resolved_at    timestamptz,
  created_at     timestamptz not null default now(),
  constraint payroll_official_months_scope_key unique (account_id, venue_id, id),
  constraint payroll_official_months_month_key unique (employment_id, month),
  constraint payroll_official_months_employment_fkey foreign key (account_id, venue_id, employment_id)
    references public.payroll_official_employments (account_id, venue_id, id),
  constraint payroll_official_months_employee_fkey foreign key (account_id, venue_id, employee_id)
    references public.payroll_employees (account_id, venue_id, id),
  constraint payroll_official_months_payment_fkey foreign key (account_id, venue_id, payment_id)
    references public.payroll_payments (account_id, venue_id, id)
);
create index payroll_official_months_employment_idx
  on public.payroll_official_months (account_id, venue_id, employment_id);
create index payroll_official_months_employee_idx
  on public.payroll_official_months (account_id, venue_id, employee_id);
create index payroll_official_months_payment_idx
  on public.payroll_official_months (account_id, venue_id, payment_id);

-- Пометка официальной выплаты: месяц, за который она (только зарплата).
alter table public.payroll_payments
  add column official_month date,
  add constraint payroll_payments_official_month_check
    check (official_month is null or (extract(day from official_month) = 1 and kind = 'salary'));

-- Настройки заведения: с какого месяца учитывать, день проведения, расчётный счёт.
alter table public.payroll_settings
  add column official_from date check (official_from is null or extract(day from official_from) = 1),
  add column official_pay_day smallint not null default 5 check (official_pay_day between 1 and 28),
  add column official_bank_account_id uuid,
  add constraint payroll_settings_official_bank_account_fkey foreign key (account_id, official_bank_account_id)
    references public.bank_accounts (account_id, id);
create index payroll_settings_official_bank_account_idx
  on public.payroll_settings (account_id, official_bank_account_id);

-- ────────────────────────────────────────────────────────────
-- 2. RLS: чтение — как у payroll_payments (payroll.view в активном
--    заведении), запись — только функциями ниже.
-- ────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['payroll_official_employments', 'payroll_official_salaries', 'payroll_official_months'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ('
      ' account_id = (select public.get_active_account_id())'
      ' and venue_id = (select public.get_active_venue_id())'
      ' and (select public.has_permission(''payroll.view'')))',
      t || '_read', t);
  end loop;
end $$;

-- Журнал оформления — та же ограничительная политика, что у начислений и переводов.
alter policy payroll_audit_salary_access on public.audit_logs using (
  entity_type <> all (array['payroll_adjustment', 'payroll_transfer', 'payroll_import',
                            'payroll_official_employment', 'payroll_official_month',
                            'payroll_official_run'])
  or (venue_id = (select public.get_active_venue_id())
      and (select public.has_permission('payroll.view')))
);

-- ────────────────────────────────────────────────────────────
-- 3. Сумма месяца
-- ────────────────────────────────────────────────────────────
create or replace function private.payroll_official_gross(p_employment uuid, p_month date)
returns table(kind text, gross numeric, days_paid int, days_in_month int)
language sql
stable
set search_path = public, pg_catalog
as $$
  with m as (
    select date_trunc('month', p_month::timestamp)::date as first_day,
           (date_trunc('month', p_month::timestamp) + interval '1 month')::date as next_day
  ), e as (
    select oe.id, oe.starts_on, oe.ends_on, pe.active, m.first_day, m.next_day,
           (m.next_day - m.first_day) as dim,
           (select s.gross from public.payroll_official_salaries s
             where s.employment_id = oe.id and s.valid_from <= m.first_day
             order by s.valid_from desc limit 1) as salary
    from public.payroll_official_employments oe
    join public.payroll_employees pe
      on pe.account_id = oe.account_id and pe.venue_id = oe.venue_id and pe.id = oe.employee_id
    cross join m
    where oe.id = p_employment
      and oe.archived_at is null
      and oe.starts_on < m.next_day
      and (oe.ends_on is null or oe.ends_on >= m.first_day)
  ), k as (
    select e.*,
           case
             when (e.ends_on is not null and e.ends_on < e.next_day) or (not e.active and e.ends_on is null) then 'final'
             when e.starts_on > e.first_day then 'first'
             else 'full'
           end as kind
    from e
  )
  select k.kind,
         case k.kind
           when 'final' then null
           when 'first' then round(k.salary * (k.next_day - k.starts_on) / k.dim, 2)
           else k.salary
         end,
         case k.kind
           when 'final' then null
           when 'first' then k.next_day - k.starts_on
           else k.dim
         end,
         k.dim
  from k
$$;

-- ────────────────────────────────────────────────────────────
-- 4. Ожидаемая официальная часть для ведомости
-- ────────────────────────────────────────────────────────────
-- Месяцы ≥ official_from заведения, где период активен, а строки месяца нет
-- или она на разборе (при любой причине). У строки на разборе вид и
-- сумма — из неё: последний месяц и неактивный — без суммы («уточняется»),
-- нет счёта / статьи / пропущенный месяц — с суммой. Управляющий с
-- payroll.view видит всех, сотрудник — только себя (как начисления).
-- Без доступа — пусто, без ошибки.
create or replace function public.payroll_official_expected(p_from date, p_to date)
returns table(employee_id uuid, employment_id uuid, month date, kind text, gross numeric, days_paid int, days_in_month int)
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
         x.days_in_month
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

-- ────────────────────────────────────────────────────────────
-- 5. Команда: оформить / исправить / оклад / уволить / отменить
-- ────────────────────────────────────────────────────────────
-- Пересечение с другими периодами того же человека в аккаунте (та же карточка
-- зарплаты или тот же пользователь в другом заведении).
create or replace function private.payroll_official_overlaps(
  p_account uuid, p_employee uuid, p_local_user uuid, p_start date, p_end date, p_except uuid)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.payroll_official_employments oe
    join public.payroll_employees pe on pe.id = oe.employee_id
    where oe.account_id = p_account
      and oe.archived_at is null
      and oe.id is distinct from p_except
      and (oe.employee_id = p_employee or (p_local_user is not null and pe.local_user_id = p_local_user))
      and daterange(oe.starts_on, oe.ends_on, '[]') && daterange(p_start, p_end, '[]'))
$$;

create or replace function private.payroll_official_audit(
  p_employment public.payroll_official_employments, p_user uuid, p_code text, p_details jsonb)
returns void
language sql
set search_path = public, pg_catalog
as $$
  insert into public.audit_logs(account_id, venue_id, user_id, action_code, entity_type, entity_id, details)
  select p_employment.account_id, p_employment.venue_id, p_user, p_code, 'payroll_official_employment', p_employment.id,
         jsonb_build_object('employee_id', pe.id, 'employee_name', pe.name) || p_details
  from public.payroll_employees pe
  where pe.id = p_employment.employee_id
$$;

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
      contract_number, contract_date, contract_path, created_by, updated_by)
    values (a, v, emp.id, v_start, v_position,
      nullif(trim(p_input->>'contract_number'), ''), nullif(p_input->>'contract_date', '')::date,
      nullif(trim(p_input->>'contract_path'), ''), u, u)
    returning * into oe;
    insert into public.payroll_official_salaries(account_id, venue_id, employment_id, valid_from, gross, created_by)
    values (a, v, oe.id, date_trunc('month', v_start::timestamp)::date, v_gross, u);

    perform private.payroll_official_audit(oe, u, 'payroll.official_employment.created', jsonb_build_object(
      'starts_on', oe.starts_on, 'position', oe.position, 'gross', v_gross,
      'contract_number', oe.contract_number, 'contract_date', oe.contract_date));
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

    update public.payroll_official_employments set
      starts_on = v_start,
      position = coalesce(v_position, position),
      contract_number = case when p_input ? 'contract_number' then nullif(trim(p_input->>'contract_number'), '') else contract_number end,
      contract_date = case when p_input ? 'contract_date' then nullif(p_input->>'contract_date', '')::date else contract_date end,
      contract_path = case when p_input ? 'contract_path' then nullif(trim(p_input->>'contract_path'), '') else contract_path end,
      updated_by = u, updated_at = now()
    where id = oe.id
    returning * into oe;

    select coalesce(jsonb_agg(jsonb_build_object('field', k, 'old', before_row->k, 'new', to_jsonb(oe)->k)), '[]')
      into changes
      from unnest(array['starts_on', 'position', 'contract_number', 'contract_date', 'contract_path']) k
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
      'document_path', nullif(trim(p_input->>'document_path'), '')));
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
-- 6. Права на функции и проверка результата
-- ────────────────────────────────────────────────────────────
revoke all on function private.payroll_official_gross(uuid, date) from public, anon, authenticated;
grant execute on function private.payroll_official_gross(uuid, date) to service_role;
revoke all on function private.payroll_official_overlaps(uuid, uuid, uuid, date, date, uuid) from public, anon, authenticated;
revoke all on function private.payroll_official_audit(public.payroll_official_employments, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.payroll_official_expected(date, date) from public, anon;
grant execute on function public.payroll_official_expected(date, date) to authenticated, service_role;
revoke all on function public.payroll_official_command(text, jsonb) from public, anon;
grant execute on function public.payroll_official_command(text, jsonb) to authenticated;

-- От роли-не-владельца REVOKE/GRANT дают только WARNING — проверяем итог.
do $$
declare
  t text;
begin
  if has_function_privilege('anon', 'private.payroll_official_gross(uuid, date)', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.payroll_official_gross(uuid, date)', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.payroll_official_overlaps(uuid, uuid, uuid, date, date, uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.payroll_official_audit(public.payroll_official_employments, uuid, text, jsonb)', 'EXECUTE')
    or has_function_privilege('anon', 'public.payroll_official_expected(date, date)', 'EXECUTE')
    or has_function_privilege('anon', 'public.payroll_official_command(text, jsonb)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.payroll_official_expected(date, date)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.payroll_official_command(text, jsonb)', 'EXECUTE')
  then
    raise exception 'payroll_official_*: права на функции не применились — применяйте от supabase_admin';
  end if;
  foreach t in array array['payroll_official_employments', 'payroll_official_salaries', 'payroll_official_months'] loop
    if has_table_privilege('anon', 'public.' || t, 'SELECT')
      or has_table_privilege('authenticated', 'public.' || t, 'INSERT')
      or has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
      or has_table_privilege('authenticated', 'public.' || t, 'DELETE')
      or not has_table_privilege('authenticated', 'public.' || t, 'SELECT')
      or not has_table_privilege('service_role', 'public.' || t, 'INSERT')
    then
      raise exception '%: права на таблицу не применились — применяйте от supabase_admin', t;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
