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
-- Без этой миграции страницы работают: столбцы активности показывают «—».

begin;

create or replace function public.finance_category_activity()
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
  select
    t.category_id,
    count(*)::bigint as operations,
    max(t.date) as last_date,
    sum(t.amount) as total
  from public.transactions t
  where t.account_id = (select public.get_active_account_id())
    and t.category_id is not null
    and t.deleted_at is null
    and t.type in ('income', 'expense')
  group by t.category_id
$$;

comment on function public.finance_category_activity() is
  'Число операций, дата последней и сумма по каждой статье активного аккаунта. '
  'SECURITY INVOKER: считает только операции, видимые пользователю по RLS transactions.';

create or replace function public.counterparty_activity()
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
  select
    t.counterparty_id,
    count(*)::bigint as operations,
    max(t.date) as last_date,
    coalesce(sum(t.amount) filter (where t.type = 'income'), 0) as income_total,
    coalesce(sum(t.amount) filter (where t.type = 'expense'), 0) as expense_total
  from public.transactions t
  where t.account_id = (select public.get_active_account_id())
    and t.counterparty_id is not null
    and t.deleted_at is null
    and t.type in ('income', 'expense')
  group by t.counterparty_id
$$;

comment on function public.counterparty_activity() is
  'Число операций, дата последней, поступления и выплаты по каждому контрагенту '
  'активного аккаунта. SECURITY INVOKER: только операции, видимые пользователю по RLS.';

-- Аноним активного аккаунта не имеет, но вызывать функции ему незачем.
revoke all on function public.finance_category_activity() from public, anon;
revoke all on function public.counterparty_activity() from public, anon;
grant execute on function public.finance_category_activity() to authenticated;
grant execute on function public.counterparty_activity() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.finance_category_activity()', 'execute')
     or has_function_privilege('anon', 'public.counterparty_activity()', 'execute') then
    raise exception 'anon не должен вызывать функции активности справочников';
  end if;
  if not has_function_privilege('authenticated', 'public.finance_category_activity()', 'execute')
     or not has_function_privilege('authenticated', 'public.counterparty_activity()', 'execute') then
    raise exception 'authenticated должен вызывать функции активности справочников';
  end if;
end $$;

commit;
