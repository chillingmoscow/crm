-- ============================================================
-- 370_account_timezone.sql
--
-- Часовой пояс аккаунта — граница дня в «Финансах».
--
-- Дата операции хранится моментом времени. У ручных операций это полночь
-- UTC выбранного дня, а выплаты зарплаты пишутся с часами. Периоды
-- («Сегодня», «Ноябрь», «по 21.11») раньше резались по дню UTC, поэтому
-- выплата в 01:30 по Москве 22-го попадала в 21-е. Теперь день считается
-- в поясе аккаунта.
--
-- Почему пояс аккаунта, а не заведения: в «Транзакциях» и справочниках
-- видны операции всех заведений и общие, без заведения. Дню нужна одна
-- граница на весь список, иначе итоги за «Сегодня» зависели бы от того,
-- в каком заведении пользователь сейчас.
--
-- Ручные операции (полночь UTC) остаются в своём дне во всех поясах от
-- UTC до UTC+14. Все пояса из списка в интерфейсе (`TIMEZONES` в
-- src/lib/constants.ts) — от UTC+0 до UTC+12.
--
-- Начальное значение — самый частый пояс заведений аккаунта, без
-- заведений — Europe/Moscow.
-- ============================================================

begin;

alter table public.accounts
  add column if not exists timezone text not null default 'Europe/Moscow';

comment on column public.accounts.timezone is
  'IANA-пояс аккаунта (Europe/Moscow): граница дня в периодах «Финансов». Миграция 370.';

update public.accounts a
   set timezone = v.timezone
  from (
    select distinct on (account_id) account_id, timezone
      from public.venues
     where timezone is not null and timezone <> ''
     group by account_id, timezone
     order by account_id, count(*) desc, timezone
  ) v
 where v.account_id = a.id;

-- Неизвестный пояс отклоняем при записи: иначе `at time zone` упал бы
-- позже, на каждом открытии списка.
create or replace function public.accounts_timezone_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Неизвестный часовой пояс: %', new.timezone using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists accounts_timezone_guard on public.accounts;
create trigger accounts_timezone_guard
  before insert or update of timezone on public.accounts
  for each row execute function public.accounts_timezone_guard();

-- Пояс активного аккаунта. SECURITY DEFINER: читать строку accounts
-- целиком сотрудникам не нужно, а пояс нужен каждой функции периода.
create or replace function public.get_active_account_timezone()
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    (select a.timezone from public.accounts a where a.id = public.get_active_account_id()),
    'Europe/Moscow'
  )
$$;

comment on function public.get_active_account_timezone() is
  'Часовой пояс активного аккаунта (accounts.timezone), по умолчанию Europe/Moscow. Миграция 370.';

revoke all on function public.get_active_account_timezone() from public, anon;
grant execute on function public.get_active_account_timezone() to authenticated;

-- Активность статей и контрагентов (369) — тот же день, что в списке
-- операций: по поясу аккаунта, а не по UTC. Остальное без изменений.
create or replace function public.finance_category_activity(
  p_from date default null,
  p_to date default null
)
returns table (
  category_id uuid,
  operations bigint,
  last_date timestamptz,
  total numeric
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  with tz as (select public.get_active_account_timezone() as name),
  ops as (
    select
      t.category_id,
      t.date,
      t.amount,
      -- Операции позже конца периода отсечены в where: здесь только начало.
      (p_from is null or (t.date at time zone tz.name)::date >= p_from) as in_period
    from public.transactions t, tz
    where t.account_id = (select public.get_active_account_id())
      and t.category_id is not null
      and t.deleted_at is null
      and t.type in ('income', 'expense')
      and (p_to is null or (t.date at time zone tz.name)::date <= p_to)
  )
  select
    category_id,
    count(*) filter (where in_period)::bigint as operations,
    max(date) as last_date,
    coalesce(sum(amount) filter (where in_period), 0) as total
  from ops
  group by category_id
$$;

create or replace function public.counterparty_activity(
  p_from date default null,
  p_to date default null
)
returns table (
  counterparty_id uuid,
  operations bigint,
  last_date timestamptz,
  income_total numeric,
  expense_total numeric
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  with tz as (select public.get_active_account_timezone() as name),
  ops as (
    select
      t.counterparty_id,
      t.date,
      t.amount,
      t.type,
      (p_from is null or (t.date at time zone tz.name)::date >= p_from) as in_period
    from public.transactions t, tz
    where t.account_id = (select public.get_active_account_id())
      and t.counterparty_id is not null
      and t.deleted_at is null
      and t.type in ('income', 'expense')
      and (p_to is null or (t.date at time zone tz.name)::date <= p_to)
  )
  select
    counterparty_id,
    count(*) filter (where in_period)::bigint as operations,
    max(date) as last_date,
    coalesce(sum(amount) filter (where in_period and type = 'income'), 0) as income_total,
    coalesce(sum(amount) filter (where in_period and type = 'expense'), 0) as expense_total
  from ops
  group by counterparty_id
$$;

do $$
begin
  if has_function_privilege('anon', 'public.get_active_account_timezone()', 'execute') then
    raise exception 'get_active_account_timezone доступна anon: применяйте от владельца функции';
  end if;
  if not has_function_privilege('authenticated', 'public.get_active_account_timezone()', 'execute') then
    raise exception 'get_active_account_timezone недоступна authenticated';
  end if;
  if has_function_privilege('anon', 'public.finance_category_activity(date, date)', 'execute')
     or has_function_privilege('anon', 'public.counterparty_activity(date, date)', 'execute') then
    raise exception 'anon не должен вызывать функции активности справочников';
  end if;
end $$;

commit;
