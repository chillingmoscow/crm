-- ============================================================
-- 207_list_inventory_documents_rpc.sql
-- RPC `list_inventory_documents` — единая точка серверного
-- получения списка актов инвентаризации с фильтрами, поиском,
-- сортировкой и пагинацией.
--
-- Зачем не PostgREST: нужен поиск по document_items.product_name
-- через EXISTS и агрегация matched_ingredients для UI-хайлайта.
-- Это в PostgREST либо невозможно, либо требует склейки 2-3
-- запросов на клиенте. RPC даёт один round-trip и переиспользует
-- RLS (security invoker → политика documents_select из миграции 195
-- применяется автоматически).
--
-- Параметры:
--   p_filter_venue     — venue_id (uuid в виде text) | 'unassigned' | NULL/'all' (без фильтра)
--   p_filter_status    — text[] статусов | NULL
--   p_filter_assigned  — 'me' | 'none' | 'any' | user_id (uuid в виде text) | NULL
--   p_filter_store     — text[] store_id (uuid в виде text) | NULL
--   p_filter_date_from / p_filter_date_to — даты (включительно)
--   p_filter_q         — поисковая строка (>=2 символов после trim)
--   p_sort             — text[] из режимов сортировки в порядке приоритета.
--                        Поддерживаются: 'date_desc', 'date_asc',
--                        'number_desc', 'number_asc',
--                        'status_desc', 'status_asc'.
--                        До 3 ключей применяются как ORDER BY с tiebreaker
--                        по id desc. Пустой массив / NULL → дефолт
--                        'date_desc'.
--   p_page, p_page_size — 1-based страница, размер 1..200
--
-- Возвращает row-per-document. Все строки текущей страницы содержат
-- одинаковый `total` (count over window) — клиент берёт его из первой
-- строки или 0, если строк нет.
-- ============================================================

-- Подчищаем любые предыдущие сигнатуры (промежуточные итерации PR1
-- держали 9-параметровый вариант без store, потом возвращали 10-й).
-- На fresh-апплае оба DROP'a — no-op.
drop function if exists public.list_inventory_documents(
  text, text[], text, date, date, text, text, int, int
);
drop function if exists public.list_inventory_documents(
  text, text[], text, text[], date, date, text, text, int, int
);
drop function if exists public.list_inventory_documents(
  text, text[], text, text[], date, date, text, text[], int, int
);

create or replace function public.list_inventory_documents(
  p_filter_venue text default null,
  p_filter_status text[] default null,
  p_filter_assigned text default null,
  p_filter_store text[] default null,
  p_filter_date_from date default null,
  p_filter_date_to date default null,
  p_filter_q text default null,
  p_sort text[] default array['date_desc']::text[],
  p_page int default 1,
  p_page_size int default 25
)
returns table (
  total bigint,
  id uuid,
  document_number text,
  invoice_date timestamptz,
  status text,
  processed boolean,
  assigned_to uuid,
  shortfall_sum numeric,
  surplus_sum numeric,
  results_has_line_amounts boolean,
  store_id uuid,
  store_title text,
  venue_id uuid,
  comment text,
  matched_ingredients text[]
)
language plpgsql
security invoker
stable
set search_path = public, pg_catalog
as $$
#variable_conflict use_column
declare
  v_account_id uuid := public.get_active_account_id();
  v_user_id   uuid := (select auth.uid());

  v_offset int := greatest(0, (coalesce(p_page, 1) - 1) * coalesce(p_page_size, 25));
  v_limit  int := least(200, greatest(1, coalesce(p_page_size, 25)));

  v_q text := nullif(trim(coalesce(p_filter_q, '')), '');
  v_q_pattern text := case
    when v_q is not null and length(v_q) >= 2 then '%' || v_q || '%'
    else null
  end;

  v_assigned_kind text := coalesce(nullif(p_filter_assigned, ''), 'any');
  v_assigned_uuid uuid := null;

  v_venue_unassigned boolean := p_filter_venue = 'unassigned';
  v_venue_uuid uuid := null;

  -- Невалидные UUID'ы в p_filter_store ловим в exception (Codex P2 #394);
  -- иначе прямой cast text[]::uuid[] в WHERE падает с invalid_text_representation
  -- и пользователь видит пустую таблицу или 500 вместо отфильтрованных строк.
  v_store_uuids uuid[] := null;

  -- До 3 ключей сортировки; «лишние» NULL → CASE-branches no-op'нутся.
  v_sort_keys text[] := case
    when p_sort is null or array_length(p_sort, 1) is null
      then array['date_desc']::text[]
    else p_sort
  end;
  v_s1 text := v_sort_keys[1];
  v_s2 text := v_sort_keys[2];
  v_s3 text := v_sort_keys[3];
begin
  -- Если активного аккаунта нет (anon / не залогинен) — возвращаем пусто.
  if v_account_id is null then
    return;
  end if;

  -- Раскрытие assigned-фильтра.
  if v_assigned_kind = 'me' then
    v_assigned_uuid := v_user_id;
    v_assigned_kind := 'specific';
  elsif v_assigned_kind not in ('any', 'none') then
    begin
      v_assigned_uuid := v_assigned_kind::uuid;
      v_assigned_kind := 'specific';
    exception when invalid_text_representation then
      v_assigned_kind := 'any';
    end;
  end if;

  -- Venue: uuid либо unassigned-sentinel.
  if p_filter_venue is not null
     and p_filter_venue not in ('all', 'unassigned', '') then
    begin
      v_venue_uuid := p_filter_venue::uuid;
    exception when invalid_text_representation then
      v_venue_uuid := null;
    end;
  end if;

  -- Store: text[] → uuid[]. Если хотя бы один элемент — мусор, fail-soft
  -- (игнорируем весь фильтр). На текущих объёмах фильтр всё равно
  -- multi-select из существующих в БД stores, malformed-кейс — это
  -- только ручной /documents?store=foo от пользователя.
  if p_filter_store is not null
     and array_length(p_filter_store, 1) is not null then
    begin
      v_store_uuids := p_filter_store::uuid[];
    exception when invalid_text_representation then
      v_store_uuids := null;
    end;
  end if;

  return query
  with filtered as (
    select
      d.id,
      d.document_number,
      d.invoice_date,
      d.status::text as status,
      d.processed,
      d.assigned_to,
      d.shortfall_sum,
      d.surplus_sum,
      d.results_has_line_amounts,
      d.store_id,
      s.title as store_title,
      d.venue_id,
      d.comment
    from public.documents d
    left join public.stores s on s.id = d.store_id
    where d.account_id = v_account_id
      and d.document_kind = 'inventory'
      -- venue filter
      and (
        p_filter_venue is null
        or p_filter_venue = 'all'
        or p_filter_venue = ''
        or (v_venue_unassigned and d.venue_id is null)
        or (v_venue_uuid is not null and d.venue_id = v_venue_uuid)
      )
      -- status filter (status — enum, кастим в text для сравнения с text[])
      and (
        p_filter_status is null
        or array_length(p_filter_status, 1) is null
        or d.status::text = any(p_filter_status)
      )
      -- assigned filter
      and (
        v_assigned_kind = 'any'
        or (v_assigned_kind = 'none' and d.assigned_to is null)
        or (v_assigned_kind = 'specific' and d.assigned_to is not distinct from v_assigned_uuid)
      )
      -- store filter (использует pre-cast'енный uuid[] из declare-блока,
      -- malformed-инпут уже отсеян в exception handler)
      and (
        v_store_uuids is null
        or array_length(v_store_uuids, 1) is null
        or d.store_id = any(v_store_uuids)
      )
      -- date range (inclusive)
      and (p_filter_date_from is null or d.invoice_date >= p_filter_date_from)
      and (p_filter_date_to   is null or d.invoice_date <= p_filter_date_to)
      -- search
      and (
        v_q_pattern is null
        or d.document_number ilike v_q_pattern
        or coalesce(d.comment, '') ilike v_q_pattern
        or exists (
          select 1
          from public.document_items di
          where di.document_id = d.id
            and di.product_name ilike v_q_pattern
        )
      )
  ),
  windowed as (
    select f.*, count(*) over () as total_count
    from filtered f
  ),
  ordered as (
    select * from windowed
    order by
      -- Слот 1
      case when v_s1 = 'date_desc'   then invoice_date    end desc nulls last,
      case when v_s1 = 'date_asc'    then invoice_date    end asc  nulls last,
      case when v_s1 = 'number_desc' then document_number end desc nulls last,
      case when v_s1 = 'number_asc'  then document_number end asc  nulls last,
      case when v_s1 = 'status_desc' then status          end desc nulls last,
      case when v_s1 = 'status_asc'  then status          end asc  nulls last,
      -- Слот 2
      case when v_s2 = 'date_desc'   then invoice_date    end desc nulls last,
      case when v_s2 = 'date_asc'    then invoice_date    end asc  nulls last,
      case when v_s2 = 'number_desc' then document_number end desc nulls last,
      case when v_s2 = 'number_asc'  then document_number end asc  nulls last,
      case when v_s2 = 'status_desc' then status          end desc nulls last,
      case when v_s2 = 'status_asc'  then status          end asc  nulls last,
      -- Слот 3
      case when v_s3 = 'date_desc'   then invoice_date    end desc nulls last,
      case when v_s3 = 'date_asc'    then invoice_date    end asc  nulls last,
      case when v_s3 = 'number_desc' then document_number end desc nulls last,
      case when v_s3 = 'number_asc'  then document_number end asc  nulls last,
      case when v_s3 = 'status_desc' then status          end desc nulls last,
      case when v_s3 = 'status_asc'  then status          end asc  nulls last,
      -- Tiebreaker
      id desc
  ),
  paged as (
    select * from ordered offset v_offset limit v_limit
  )
  select
    p.total_count as total,
    p.id,
    p.document_number,
    p.invoice_date,
    p.status,
    p.processed,
    p.assigned_to,
    p.shortfall_sum,
    p.surplus_sum,
    p.results_has_line_amounts,
    p.store_id,
    p.store_title,
    p.venue_id,
    p.comment,
    case
      when v_q_pattern is null then null
      else (
        select array_agg(name)
        from (
          select distinct di.product_name as name
          from public.document_items di
          where di.document_id = p.id
            and di.product_name ilike v_q_pattern
          order by di.product_name
          limit 3
        ) m
      )
    end as matched_ingredients
  from paged p;
end;
$$;

revoke all on function public.list_inventory_documents(
  text, text[], text, text[], date, date, text, text[], int, int
) from public;

grant execute on function public.list_inventory_documents(
  text, text[], text, text[], date, date, text, text[], int, int
) to authenticated;
