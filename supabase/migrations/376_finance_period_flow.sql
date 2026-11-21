-- ============================================================
-- 376_finance_period_flow.sql
--
-- Итоги дашборда «Финансы» за период одной функцией: приход, расход,
-- число операций, расходы по статьям и те же итоги по прошедшие дни
-- (для сравнения с прошлым периодом).
--
-- Почему функция: раньше дашборд читал операции периода строками и
-- складывал их в приложении. PostgREST отдаёт не больше max_rows = 1000
-- строк, так что за год итоги и топ статей были занижены. Постраничное
-- чтение это лечило ценой десятков запросов. Здесь сумма считается в базе
-- одним запросом.
--
-- Условия те же, что у «Транзакций» (finance_transactions_page, 371), —
-- итоги дашборда и списка за один период обязаны совпадать:
--  - переводы в поток не входят, удалённые не считаются;
--  - день — в поясе аккаунта (get_active_account_timezone, 370), конец
--    периода включительно: «по 21.11» — всё, что раньше начала 22.11;
--  - юрлицо — счёт операции или счёт поступления; заведение — venue_id.
--
-- SECURITY INVOKER: строки режет политика transactions_select (аккаунт,
-- юрлицо, заведение, право на просмотр).
--
-- Аргументы:
--   p_date_from, p_date_to  date — календарные дни включительно
--   p_legal_entity_id       uuid — одно юрлицо, null — все
--   p_venue_id              uuid — одно заведение, null — все
--   p_cutoff                date — последний прошедший день идущего
--                           периода; итоги по него — в `elapsed`.
--                           null — `elapsed` нет.
--
-- Результат (jsonb):
--   income, expense, income_count, expense_count
--   categories: [{category_id, amount, count}] — расходы по статьям, все,
--               по убыванию суммы; category_id null — «Без статьи»
--   elapsed:    {income, expense, income_count, expense_count} | null
-- ============================================================

begin;

create or replace function public.finance_period_flow(
  p_date_from       date,
  p_date_to         date,
  p_legal_entity_id uuid default null,
  p_venue_id        uuid default null,
  p_cutoff          date default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  with tz as (
    select public.get_active_account_timezone() as name
  ),
  flow as materialized (
    select t.type, t.amount, t.category_id, t.date
      from public.transactions t, tz
     where t.deleted_at is null
       and t.type in ('income', 'expense')
       and (p_date_from is null or t.date >= (p_date_from::timestamp at time zone tz.name))
       and (p_date_to   is null or t.date <  ((p_date_to + 1)::timestamp at time zone tz.name))
       and (p_legal_entity_id is null
            or t.legal_entity_id = p_legal_entity_id
            or t.to_legal_entity_id = p_legal_entity_id)
       and (p_venue_id is null or t.venue_id = p_venue_id)
  )
  select jsonb_build_object(
    'income',        coalesce(sum(f.amount) filter (where f.type = 'income'), 0),
    'expense',       coalesce(sum(f.amount) filter (where f.type = 'expense'), 0),
    'income_count',  count(*) filter (where f.type = 'income'),
    'expense_count', count(*) filter (where f.type = 'expense'),
    'categories', coalesce(
      (select jsonb_agg(jsonb_build_object('category_id', c.category_id,
                                           'amount', c.amount,
                                           'count', c.n)
                        order by c.amount desc, c.n desc, c.category_id nulls last)
         from (select category_id, sum(amount) as amount, count(*) as n
                 from flow
                where type = 'expense'
                group by category_id) c),
      '[]'::jsonb),
    'elapsed', case when p_cutoff is null then null else (
      select jsonb_build_object(
        'income',        coalesce(sum(e.amount) filter (where e.type = 'income'), 0),
        'expense',       coalesce(sum(e.amount) filter (where e.type = 'expense'), 0),
        'income_count',  count(*) filter (where e.type = 'income'),
        'expense_count', count(*) filter (where e.type = 'expense'))
        from flow e, tz
       where e.date < ((p_cutoff + 1)::timestamp at time zone tz.name)
    ) end
  )
  from flow f
$$;

comment on function public.finance_period_flow(date, date, uuid, uuid, date) is
  'Итоги дашборда «Финансы» за период: приход, расход, число операций, расходы по статьям, итоги по прошедшие дни. Условия как у finance_transactions_page. SECURITY INVOKER — строки режет RLS transactions_select. Миграция 376.';

revoke all on function public.finance_period_flow(date, date, uuid, uuid, date) from public, anon;
grant execute on function public.finance_period_flow(date, date, uuid, uuid, date) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.finance_period_flow(date, date, uuid, uuid, date)', 'EXECUTE') then
    raise exception 'finance_period_flow доступна anon: применяйте от владельца функции';
  end if;
  if not has_function_privilege('authenticated', 'public.finance_period_flow(date, date, uuid, uuid, date)', 'EXECUTE') then
    raise exception 'finance_period_flow недоступна authenticated';
  end if;
end $$;

commit;
