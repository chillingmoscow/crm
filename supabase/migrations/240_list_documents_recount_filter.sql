-- Фильтр «Акты пересчёта» в списке актов инвентаризации.
--
-- Акт пересчёта — дочерний, вынесенный из другого акта (миграция 223). В списке
-- он помечен бейджем, но отобрать только такие акты или, наоборот, спрятать их
-- было нельзя: RPC о них не знала. На складе, где пересчёты делают регулярно,
-- дочерние акты подмешиваются к обычным и мешают читать список (#513).
--
-- Схема не меняется — только тело RPC. Параметр добавлен В КОНЕЦ списка
-- намеренно: вставка в середину сдвинула бы позиции p_sort / p_page /
-- p_page_size и сломала бы любой позиционный вызов.
--
-- Пересоздаём через drop + create, а не CREATE OR REPLACE: у функции меняется
-- сигнатура, и REPLACE создал бы вторую перегрузку вместо замены — вызовы без
-- нового параметра стали бы неоднозначными. Тот же приём в миграции 207.

drop function if exists public.list_inventory_documents(
  text, text[], text, text, text[], date, date, text, text[], integer, integer
);

CREATE OR REPLACE FUNCTION public.list_inventory_documents(p_filter_venue text DEFAULT NULL::text, p_filter_status text[] DEFAULT NULL::text[], p_filter_assigned text DEFAULT NULL::text, p_filter_reviewer text DEFAULT NULL::text, p_filter_store text[] DEFAULT NULL::text[], p_filter_date_from date DEFAULT NULL::date, p_filter_date_to date DEFAULT NULL::date, p_filter_q text DEFAULT NULL::text, p_sort text[] DEFAULT ARRAY['date_desc'::text], p_page integer DEFAULT 1, p_page_size integer DEFAULT 25, p_filter_recount text DEFAULT NULL::text)
 RETURNS TABLE(total bigint, id uuid, document_number text, invoice_date timestamp with time zone, status text, processed boolean, assigned_to uuid, reviewer_id uuid, results_has_line_amounts boolean, store_id uuid, store_title text, venue_id uuid, comment text, matched_ingredients text[])
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
#variable_conflict use_column
declare
  v_account_id uuid := public.get_active_account_id();
  v_user_id   uuid := (select auth.uid());

  v_offset int := greatest(0, (coalesce(p_page, 1) - 1) * coalesce(p_page_size, 25));
  v_limit  int := least(200, greatest(1, coalesce(p_page_size, 25)));

  -- Отбор актов пересчёта. Неизвестное значение трактуем как 'any': фильтр
  -- приходит из URL, и опечатка в адресе не должна прятать половину списка.
  v_recount text := case lower(coalesce(p_filter_recount, 'any'))
                      when 'only' then 'only'
                      when 'exclude' then 'exclude'
                      else 'any'
                    end;

  v_q text := nullif(trim(coalesce(p_filter_q, '')), '');
  v_q_pattern text := case
    when v_q is not null and length(v_q) >= 2 then '%' || v_q || '%'
    else null
  end;

  v_assigned_kind text := coalesce(nullif(p_filter_assigned, ''), 'any');
  v_assigned_uuid uuid := null;

  v_reviewer_kind text := coalesce(nullif(p_filter_reviewer, ''), 'any');
  v_reviewer_uuid uuid := null;

  v_venue_unassigned boolean := p_filter_venue = 'unassigned';
  v_venue_uuid uuid := null;

  v_store_uuids uuid[] := null;

  v_sort_keys text[] := case
    when p_sort is null or array_length(p_sort, 1) is null
      then array['date_desc']::text[]
    else p_sort
  end;
  v_s1 text := v_sort_keys[1];
  v_s2 text := v_sort_keys[2];
  v_s3 text := v_sort_keys[3];
begin
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

  -- Раскрытие reviewer-фильтра (зеркало assigned).
  if v_reviewer_kind = 'me' then
    v_reviewer_uuid := v_user_id;
    v_reviewer_kind := 'specific';
  elsif v_reviewer_kind not in ('any', 'none') then
    begin
      v_reviewer_uuid := v_reviewer_kind::uuid;
      v_reviewer_kind := 'specific';
    exception when invalid_text_representation then
      v_reviewer_kind := 'any';
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

  -- Store: text[] → uuid[], fail-soft на мусор.
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
      -- Ранг статуса по жизненному циклу — для осмысленной сортировки.
      case d.status::text
        when 'synced'           then 1
        when 'assigned'         then 2
        when 'in_progress'      then 3
        when 'ready_for_review' then 4
        when 'recount_pending'  then 5
        when 'results_blocked'  then 6
        when 'processed'        then 7
        else 99
      end as status_rank,
      d.processed,
      d.assigned_to,
      d.reviewer_id,
      d.results_has_line_amounts,
      d.store_id,
      s.title as store_title,
      d.venue_id,
      d.comment
    from public.documents d
    left join public.stores s on s.id = d.store_id
    where d.account_id = v_account_id
      and d.document_kind = 'inventory'
      -- Системно-архивные акты (удалены в Quick Resto) скрыты из списка.
      and d.archived_at is null
      and (
        p_filter_venue is null
        or p_filter_venue = 'all'
        or p_filter_venue = ''
        or (v_venue_unassigned and d.venue_id is null)
        or (v_venue_uuid is not null and d.venue_id = v_venue_uuid)
      )
      and (
        p_filter_status is null
        or array_length(p_filter_status, 1) is null
        or d.status::text = any(p_filter_status)
      )
      and (
        v_assigned_kind = 'any'
        or (v_assigned_kind = 'none' and d.assigned_to is null)
        or (v_assigned_kind = 'specific' and d.assigned_to is not distinct from v_assigned_uuid)
      )
      and (
        v_reviewer_kind = 'any'
        or (v_reviewer_kind = 'none' and d.reviewer_id is null)
        or (v_reviewer_kind = 'specific' and d.reviewer_id is not distinct from v_reviewer_uuid)
      )
      and (
        v_store_uuids is null
        or array_length(v_store_uuids, 1) is null
        or d.store_id = any(v_store_uuids)
      )
      -- Акт пересчёта — тот, у которого заполнен recount_of_document_id
      -- (миграция 223): он вынесен из другого акта.
      and (
        v_recount = 'any'
        or (v_recount = 'only'    and d.recount_of_document_id is not null)
        or (v_recount = 'exclude' and d.recount_of_document_id is null)
      )
      and (p_filter_date_from is null or d.invoice_date >= p_filter_date_from)
      and (p_filter_date_to   is null or d.invoice_date <= p_filter_date_to)
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
      case when v_s1 = 'date_desc'   then invoice_date    end desc nulls last,
      case when v_s1 = 'date_asc'    then invoice_date    end asc  nulls last,
      case when v_s1 = 'number_desc' then document_number end desc nulls last,
      case when v_s1 = 'number_asc'  then document_number end asc  nulls last,
      case when v_s1 = 'status_desc' then status_rank     end desc nulls last,
      case when v_s1 = 'status_asc'  then status_rank     end asc  nulls last,
      case when v_s2 = 'date_desc'   then invoice_date    end desc nulls last,
      case when v_s2 = 'date_asc'    then invoice_date    end asc  nulls last,
      case when v_s2 = 'number_desc' then document_number end desc nulls last,
      case when v_s2 = 'number_asc'  then document_number end asc  nulls last,
      case when v_s2 = 'status_desc' then status_rank     end desc nulls last,
      case when v_s2 = 'status_asc'  then status_rank     end asc  nulls last,
      case when v_s3 = 'date_desc'   then invoice_date    end desc nulls last,
      case when v_s3 = 'date_asc'    then invoice_date    end asc  nulls last,
      case when v_s3 = 'number_desc' then document_number end desc nulls last,
      case when v_s3 = 'number_asc'  then document_number end asc  nulls last,
      case when v_s3 = 'status_desc' then status_rank     end desc nulls last,
      case when v_s3 = 'status_asc'  then status_rank     end asc  nulls last,
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
    p.reviewer_id,
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
$function$;

-- Права теряются вместе со старой функцией — выдаём заново (как в 207).
grant execute on function public.list_inventory_documents(
  text, text[], text, text, text[], date, date, text, text[], integer, integer, text
) to anon, authenticated, service_role;
