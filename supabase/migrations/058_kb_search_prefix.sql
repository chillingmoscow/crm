-- ============================================================
-- 058_kb_search_prefix.sql
-- Stage 8.5 follow-up — prefix search в kb_search.
--
-- Было: websearch_to_tsquery → ищет только целые слова через
-- стемминг. Запрос «прог» НЕ находит «программа».
--
-- Стало: вручную строим tsquery вида `term1:* & term2:*`. Ввод
-- санитизируется (всё кроме букв/цифр заменяется пробелом),
-- разбивается на слова, к каждому добавляется `:*` (prefix match),
-- джоинятся через `&` (AND).
--
-- Trade-off: теряем поддержку `OR`, кавычек-фраз, `-` (исключение).
-- Для MVP не жалко — prefix-match нужнее.
-- ============================================================

create or replace function public.kb_search(
  p_query text,
  p_limit integer default 20
)
returns table (
  id      uuid,
  slug    text,
  title   text,
  icon    text,
  snippet text,
  rank    real
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_clean   text;
  v_terms   text[];
  v_parts   text[] := array[]::text[];
  v_term    text;
  v_tsquery tsquery;
begin
  -- 1. Нормализуем ввод: lower-case + всё кроме letters/digits/whitespace
  --    заменяем пробелом. POSIX [:alnum:] в utf-8 ловит и кириллицу.
  v_clean := lower(
    regexp_replace(coalesce(p_query, ''), '[^[:alnum:][:space:]]+', ' ', 'g')
  );

  -- 2. Разбиваем на токены, дропаем пустые.
  v_terms := array(
    select t
    from unnest(string_to_array(trim(v_clean), ' ')) as t
    where length(t) > 0
  );

  if array_length(v_terms, 1) is null then
    return;
  end if;

  -- 3. К каждому токену — `:*` (prefix). Затем join `&`.
  --    Token уже содержит только [a-z0-9а-я], поэтому безопасен
  --    для прямого включения в to_tsquery.
  foreach v_term in array v_terms loop
    v_parts := array_append(v_parts, v_term || ':*');
  end loop;

  v_tsquery := to_tsquery('russian', array_to_string(v_parts, ' & '));

  return query
    select
      kp.id,
      kp.slug,
      kp.title,
      kp.icon,
      ts_headline(
        'russian',
        coalesce(kp.plain_text, ''),
        v_tsquery,
        'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MaxWords=18, MinWords=5'
      ) as snippet,
      ts_rank(kp.search_tsv, v_tsquery) as rank
    from public.kb_pages kp
    where kp.account_id = public.get_active_account_id()
      and kp.deleted_at is null
      and public.has_permission('kb.view_pages')
      and kp.search_tsv @@ v_tsquery
    order by rank desc, kp.updated_at desc nulls last
    limit greatest(1, least(coalesce(p_limit, 20), 50));
end;
$$;

comment on function public.kb_search(text, integer) is
  'Full-text search по KB активного account с prefix-match (term:*) '
  'и ts_headline-снипетами. Заменяет websearch_to_tsquery из 057.';

grant execute on function public.kb_search(text, integer) to authenticated;
