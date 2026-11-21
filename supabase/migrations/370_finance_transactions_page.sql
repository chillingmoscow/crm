-- ============================================================
-- 370_finance_transactions_page.sql
--
-- Список «Финансы → Транзакции» одной функцией: страница строк, итоги
-- (приход / расход) и счётчики по одним и тем же условиям.
--
-- Почему функция, а не PostgREST-запрос со страницы:
--  - итоги по всем отобранным строкам (design-system: «у денежных таблиц
--    строка итогов с учётом условий»). Через PostgREST их пришлось бы
--    тянуть строками, а он отдаёт не больше max_rows = 1000;
--  - поиск по названиям контрагента, статьи и счёта и сортировка по ним —
--    это соседние таблицы;
--  - список, итоги и CSV-выгрузка обязаны отбирать одинаково. Раньше
--    выгрузка разбирала фильтры по-своему и падала на нескольких счетах
--    или «Без статьи» (строка «id1,id2» уходила в eq по uuid).
--
-- SECURITY INVOKER: строки режет та же политика transactions_select
-- (аккаунт, юрлицо, заведение, право на просмотр, удалённые — только с
-- finance.delete_transaction). Названия для поиска и сортировки — тоже
-- по RLS соседних таблиц.
--
-- p_filters (все ключи необязательны):
--   legal_entity_id, venue_id         uuid
--   venue_none                        boolean — «Без заведения»
--   bank_account_ids                  uuid[]  — счёт списания ИЛИ поступления
--   category_ids, counterparty_ids    uuid[]
--   category_none, counterparty_none  boolean — «Без статьи» / «Без контрагента»
--                                               (переводы сюда не входят:
--                                               у них статьи не бывает)
--   type                              income | expense | transfer
--   date_from, date_to                date
--   amount_min, amount_max            numeric
--   q                                 text — описание, контрагент, статья,
--                                            счёт, номер или сумма
--   deleted                           boolean — только удалённые
--   files                             with | without — есть ли прикреплённые
--                                     файлы (чеки, счета); видны по праву
--                                     finance.view_attachments
-- p_sort: до трёх ключей <поле>_<asc|desc>, поле — date | amount |
--   category | counterparty | account. Пусто — дата по убыванию.
--
-- finance_transaction_lock(id) — к чему операция привязана так, что менять
-- её в финансах нельзя: 'payroll' (выплата зарплаты) или 'uniform' (покупка
-- формы). Такие строки отклоняют триггеры 244 и 265, а интерфейс заранее
-- показывает их только на просмотр. SECURITY DEFINER: бухгалтер без прав
-- на зарплату связей не видит (RLS payroll_*), но знать о блокировке должен.
-- Отдаёт только признак и только по операциям активного аккаунта.
-- ============================================================

begin;

create or replace function public.finance_transaction_lock(p_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case
    when exists (
      select 1 from public.payroll_payments p
       where p.transaction_id = p_id
         and p.account_id = public.get_active_account_id()
    ) then 'payroll'
    when exists (
      select 1 from public.payroll_uniform_issues u
       where u.expense_transaction_id = p_id
         and u.account_id = public.get_active_account_id()
    ) then 'uniform'
  end
$$;

comment on function public.finance_transaction_lock(uuid) is
  'Признак блокировки операции связью с зарплатой: payroll | uniform | null. Миграция 370.';

revoke all on function public.finance_transaction_lock(uuid) from public, anon;
grant execute on function public.finance_transaction_lock(uuid) to authenticated;

create or replace function public.finance_transactions_page(
  p_filters jsonb   default '{}'::jsonb,
  p_sort    text[]  default '{}'::text[],
  p_limit   integer default 25,
  p_offset  integer default 0
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_catalog
as $$
declare
  f                   jsonb   := coalesce(p_filters, '{}'::jsonb);
  v_le                uuid    := nullif(f->>'legal_entity_id', '')::uuid;
  v_venue             uuid    := nullif(f->>'venue_id', '')::uuid;
  v_venue_none        boolean := coalesce((f->>'venue_none')::boolean, false);
  v_accounts          uuid[];
  v_categories        uuid[];
  v_counterparties    uuid[];
  v_category_none     boolean := coalesce((f->>'category_none')::boolean, false);
  v_counterparty_none boolean := coalesce((f->>'counterparty_none')::boolean, false);
  v_type              text    := nullif(f->>'type', '');
  v_from              date    := nullif(f->>'date_from', '')::date;
  v_to                date    := nullif(f->>'date_to', '')::date;
  v_min               numeric := nullif(f->>'amount_min', '')::numeric;
  v_max               numeric := nullif(f->>'amount_max', '')::numeric;
  v_q                 text    := nullif(btrim(coalesce(f->>'q', '')), '');
  v_deleted           boolean := coalesce((f->>'deleted')::boolean, false);
  v_files             text    := nullif(f->>'files', '');
  v_like              text;
  v_q_number          numeric;
  v_s1                text    := p_sort[1];
  v_s2                text    := p_sort[2];
  v_s3                text    := p_sort[3];
  v_limit             integer := least(greatest(coalesce(p_limit, 25), 1), 10000);
  v_offset            integer := greatest(coalesce(p_offset, 0), 0);
  v_result            jsonb;
begin
  select array_agg(x::uuid) into v_accounts
    from jsonb_array_elements_text(coalesce(f->'bank_account_ids', '[]'::jsonb)) x;
  select array_agg(x::uuid) into v_categories
    from jsonb_array_elements_text(coalesce(f->'category_ids', '[]'::jsonb)) x;
  select array_agg(x::uuid) into v_counterparties
    from jsonb_array_elements_text(coalesce(f->'counterparty_ids', '[]'::jsonb)) x;

  if v_q is not null then
    -- Текст ищется буквально: % и _ из запроса — не шаблоны.
    v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    -- «1 500», «1500,50», «№ 42» — ещё и сумма или номер операции.
    if v_q ~ '^№?\s*[0-9][0-9\s ]*([.,][0-9]{1,2})?\s*₽?$' then
      v_q_number := replace(regexp_replace(v_q, '[№₽\s ]', '', 'g'), ',', '.')::numeric;
    end if;
  end if;

  with filtered as materialized (
    select t.*
      from public.transactions t
     where (case when v_deleted then t.deleted_at is not null else t.deleted_at is null end)
       and (v_le is null or t.legal_entity_id = v_le or t.to_legal_entity_id = v_le)
       and ((v_venue is null and not v_venue_none)
            or t.venue_id = v_venue
            or (v_venue_none and t.venue_id is null))
       and (v_accounts is null
            or t.bank_account_id = any(v_accounts)
            or t.to_bank_account_id = any(v_accounts))
       and ((v_categories is null and not v_category_none)
            or t.category_id = any(v_categories)
            or (v_category_none and t.category_id is null and t.type <> 'transfer'))
       and ((v_counterparties is null and not v_counterparty_none)
            or t.counterparty_id = any(v_counterparties)
            or (v_counterparty_none and t.counterparty_id is null and t.type <> 'transfer'))
       and (v_type is null or t.type::text = v_type)
       and (v_from is null or t.date >= v_from)
       -- Дата операции — момент времени (выплаты зарплаты пишутся с часами),
       -- поэтому «по 21.11» — это всё, что раньше начала 22.11.
       and (v_to   is null or t.date < v_to + 1)
       and (v_min  is null or t.amount >= v_min)
       and (v_max  is null or t.amount <= v_max)
       and (v_files is null
            or (v_files = 'with' and exists (select 1 from public.transaction_attachments a
                                               where a.transaction_id = t.id))
            or (v_files = 'without' and not exists (select 1 from public.transaction_attachments a
                                                      where a.transaction_id = t.id)))
       and (v_q is null
            or t.description ilike v_like
            or (v_q_number is not null and (t.amount = v_q_number or t.public_id = v_q_number))
            or exists (select 1 from public.counterparties c
                        where c.id = t.counterparty_id and c.name ilike v_like)
            or exists (select 1 from public.finance_categories c
                        where c.id = t.category_id and c.name ilike v_like)
            or exists (select 1 from public.bank_accounts b
                        where b.id in (t.bank_account_id, t.to_bank_account_id)
                          and b.name ilike v_like))
  ),
  ranked as (
    select r as tx,
           row_number() over w as rn
      from filtered r
      left join public.finance_categories cat on cat.id = r.category_id
      left join public.counterparties     cp  on cp.id  = r.counterparty_id
      left join public.bank_accounts      ba  on ba.id  = r.bank_account_id
    window w as (
      order by
        case when v_s1 = 'date_asc'          then r.date    end asc,
        case when v_s1 = 'date_desc'         then r.date    end desc,
        case when v_s1 = 'amount_asc'        then r.amount  end asc,
        case when v_s1 = 'amount_desc'       then r.amount  end desc,
        case when v_s1 = 'category_asc'      then cat.name  end asc  nulls last,
        case when v_s1 = 'category_desc'     then cat.name  end desc nulls last,
        case when v_s1 = 'counterparty_asc'  then cp.name   end asc  nulls last,
        case when v_s1 = 'counterparty_desc' then cp.name   end desc nulls last,
        case when v_s1 = 'account_asc'       then ba.name   end asc  nulls last,
        case when v_s1 = 'account_desc'      then ba.name   end desc nulls last,
        case when v_s2 = 'date_asc'          then r.date    end asc,
        case when v_s2 = 'date_desc'         then r.date    end desc,
        case when v_s2 = 'amount_asc'        then r.amount  end asc,
        case when v_s2 = 'amount_desc'       then r.amount  end desc,
        case when v_s2 = 'category_asc'      then cat.name  end asc  nulls last,
        case when v_s2 = 'category_desc'     then cat.name  end desc nulls last,
        case when v_s2 = 'counterparty_asc'  then cp.name   end asc  nulls last,
        case when v_s2 = 'counterparty_desc' then cp.name   end desc nulls last,
        case when v_s2 = 'account_asc'       then ba.name   end asc  nulls last,
        case when v_s2 = 'account_desc'      then ba.name   end desc nulls last,
        case when v_s3 = 'date_asc'          then r.date    end asc,
        case when v_s3 = 'date_desc'         then r.date    end desc,
        case when v_s3 = 'amount_asc'        then r.amount  end asc,
        case when v_s3 = 'amount_desc'       then r.amount  end desc,
        case when v_s3 = 'category_asc'      then cat.name  end asc  nulls last,
        case when v_s3 = 'category_desc'     then cat.name  end desc nulls last,
        case when v_s3 = 'counterparty_asc'  then cp.name   end asc  nulls last,
        case when v_s3 = 'counterparty_desc' then cp.name   end desc nulls last,
        case when v_s3 = 'account_asc'       then ba.name   end asc  nulls last,
        case when v_s3 = 'account_desc'      then ba.name   end desc nulls last,
        -- Порядок по умолчанию и разрешение равных: новые сверху.
        r.date desc,
        r.public_id desc
    )
  )
  select jsonb_build_object(
    'total',   (select count(*) from filtered),
    'income',  (select coalesce(sum(amount), 0) from filtered where type = 'income'),
    'expense', (select coalesce(sum(amount), 0) from filtered where type = 'expense'),
    -- Валюты отобранных строк: итог в разных валютах не складывается.
    'currencies', (select coalesce(jsonb_agg(distinct currency), '[]'::jsonb) from filtered),
    -- Счётчики раздела без условий: «N из M» у заголовка и число удалённых
    -- в подсказке кнопки. Удалённые видит только тот, кто может удалять.
    'all_total',     (select count(*) from public.transactions where deleted_at is null),
    'deleted_total', (select count(*) from public.transactions where deleted_at is not null),
    'rows', coalesce(
      -- attachments_count — число файлов операции, для значка в строке.
      (select jsonb_agg(
                to_jsonb(x.tx) || jsonb_build_object(
                  'attachments_count',
                  (select count(*) from public.transaction_attachments a
                    where a.transaction_id = (x.tx).id),
                  -- locked_by — связь с зарплатой (см. finance_transaction_lock).
                  'locked_by', public.finance_transaction_lock((x.tx).id))
                order by x.rn)
         from ranked x
        where x.rn > v_offset and x.rn <= v_offset + v_limit),
      '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.finance_transactions_page(jsonb, text[], integer, integer) is
  'Список «Финансы → Транзакции»: страница строк, итоги и счётчики по одним условиям. SECURITY INVOKER — строки режет RLS transactions_select. Миграция 370.';

revoke all on function public.finance_transactions_page(jsonb, text[], integer, integer) from public, anon;
grant execute on function public.finance_transactions_page(jsonb, text[], integer, integer) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.finance_transaction_lock(uuid)', 'EXECUTE') then
    raise exception 'finance_transaction_lock доступна anon: применяйте от владельца функции';
  end if;
  if not has_function_privilege('authenticated', 'public.finance_transaction_lock(uuid)', 'EXECUTE') then
    raise exception 'finance_transaction_lock недоступна authenticated';
  end if;
  if has_function_privilege('anon', 'public.finance_transactions_page(jsonb, text[], integer, integer)', 'EXECUTE') then
    raise exception 'finance_transactions_page доступна anon: применяйте от владельца функции';
  end if;
  if not has_function_privilege('authenticated', 'public.finance_transactions_page(jsonb, text[], integer, integer)', 'EXECUTE') then
    raise exception 'finance_transactions_page недоступна authenticated';
  end if;
end $$;

commit;
