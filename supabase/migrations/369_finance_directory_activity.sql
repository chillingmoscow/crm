-- 369 · Активность статей и контрагентов для справочников «Финансов».
--
-- Списки «Статьи» и «Контрагенты» показывают, сколько операций прошло по
-- каждой записи, когда была последняя и на какую сумму. По этим цифрам
-- видно, чем пользуются, а что можно отправить в архив.
--
-- Обе функции — SECURITY INVOKER: считают только те операции, которые
-- пользователь и так видит в «Транзакциях» (политика transactions_select:
-- право finance.view_transactions, активное юрлицо и заведение или
-- view_all_*). Новых данных они не раскрывают — только сворачивают видимое.
-- Удалённые операции и переводы (у перевода нет статьи и контрагента) не
-- считаются.
--
-- Период: p_from / p_to — календарные дни включительно (дата операции —
-- полночь UTC, сравниваем по дню UTC). Без границ — всё время. Число
-- операций и суммы — за период; дата последней операции — последняя на
-- конец периода, чтобы у статьи без операций в периоде было видно, когда
-- ею пользовались раньше.
--
-- Без этой миграции страницы работают: столбцы активности показывают «—».

begin;

-- Ранняя версия без периода жила только в локальных базах разработки.
drop function if exists public.finance_category_activity();
drop function if exists public.counterparty_activity();

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
  with ops as (
    select
      t.category_id,
      t.date,
      t.amount,
      -- Операции позже конца периода отсечены в where: здесь только начало.
      (p_from is null or (t.date at time zone 'UTC')::date >= p_from) as in_period
    from public.transactions t
    where t.account_id = (select public.get_active_account_id())
      and t.category_id is not null
      and t.deleted_at is null
      and t.type in ('income', 'expense')
      and (p_to is null or (t.date at time zone 'UTC')::date <= p_to)
  )
  select
    category_id,
    count(*) filter (where in_period)::bigint as operations,
    max(date) as last_date,
    coalesce(sum(amount) filter (where in_period), 0) as total
  from ops
  group by category_id
$$;

comment on function public.finance_category_activity(date, date) is
  'Число операций и сумма по каждой статье активного аккаунта за период (без границ — всё время), '
  'дата последней операции на конец периода. SECURITY INVOKER: только операции, видимые по RLS transactions.';

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
  with ops as (
    select
      t.counterparty_id,
      t.date,
      t.amount,
      t.type,
      (p_from is null or (t.date at time zone 'UTC')::date >= p_from) as in_period
    from public.transactions t
    where t.account_id = (select public.get_active_account_id())
      and t.counterparty_id is not null
      and t.deleted_at is null
      and t.type in ('income', 'expense')
      and (p_to is null or (t.date at time zone 'UTC')::date <= p_to)
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

comment on function public.counterparty_activity(date, date) is
  'Число операций, поступления и выплаты по каждому контрагенту активного аккаунта за период '
  '(без границ — всё время), дата последней операции на конец периода. SECURITY INVOKER: только '
  'операции, видимые пользователю по RLS.';

-- Аноним активного аккаунта не имеет, но вызывать функции ему незачем.
revoke all on function public.finance_category_activity(date, date) from public, anon;
revoke all on function public.counterparty_activity(date, date) from public, anon;
grant execute on function public.finance_category_activity(date, date) to authenticated;
grant execute on function public.counterparty_activity(date, date) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.finance_category_activity(date, date)', 'execute')
     or has_function_privilege('anon', 'public.counterparty_activity(date, date)', 'execute') then
    raise exception 'anon не должен вызывать функции активности справочников';
  end if;
  if not has_function_privilege('authenticated', 'public.finance_category_activity(date, date)', 'execute')
     or not has_function_privilege('authenticated', 'public.counterparty_activity(date, date)', 'execute') then
    raise exception 'authenticated должен вызывать функции активности справочников';
  end if;
end $$;

commit;
