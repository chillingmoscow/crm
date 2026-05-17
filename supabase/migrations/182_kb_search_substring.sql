-- ============================================================
-- 182_kb_search_substring.sql
--
-- Issue 2 — поиск/`@`-упоминания не находят страницы по началу
-- слова. `kb_search` (058/062) строит `to_tsquery('russian', term:*)`.
-- Конфиг `russian`:
--   • удаляет стоп-слова — «за» это предлог-стоп-слово → tsquery
--     пустой → `search_tsv @@ v_tsquery` не матчит ничего;
--   • стемминг → подстрока внутри слова не ищется.
-- → запрос «за» не находит «заточка ножей», «е» не фильтрует.
--
-- Фикс: рядом с FTS добавляем substring-fallback по `title`
-- (Notion-style: набрал несколько букв заголовка — нашёл). FTS
-- остаётся для релевантности по телу. Один RPC обслуживает и
-- палитру Cmd+K, и `@`-меню — фикс чинит оба экрана.
--
-- Issue 5 — рядовой сотрудник без `kb.delete_pages` на URL
-- удалённой страницы получает 404 (RLS прячет soft-deleted строку,
-- `getDeletedKbPageBySlug` → null → notFound). Чтобы показать
-- «недостаточно прав» вместо 404, нужна привилегированная проверка
-- существования, НЕ отдающая контент → `kb_deleted_page_slug_exists`
-- возвращает только boolean.
-- ============================================================

create or replace function public.kb_search(
  p_query text,
  p_limit integer default 20
)
returns table (
  id          uuid,
  slug        text,
  title       text,
  icon        text,
  icon_color  text,
  snippet     text,
  rank        real
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_clean   text;
  v_terms   text[];
  v_parts   text[] := array[]::text[];
  v_term    text;
  v_tsquery tsquery;
  v_has_fts boolean;
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

  -- 3. К каждому токену — `:*` (prefix). Затем join `&`. Токены уже
  --    содержат только [[:alnum:]], безопасны для to_tsquery.
  foreach v_term in array v_terms loop
    v_parts := array_append(v_parts, v_term || ':*');
  end loop;

  v_tsquery := to_tsquery('russian', array_to_string(v_parts, ' & '));

  -- numnode = 0, когда все токены отсеялись как стоп-слова («за») —
  -- тогда FTS не применяем, полагаемся только на substring по title.
  v_has_fts := numnode(v_tsquery) > 0;

  return query
    select
      kp.id,
      kp.slug,
      kp.title,
      kp.icon,
      kp.icon_color,
      case
        when v_has_fts then ts_headline(
          'russian',
          coalesce(kp.plain_text, ''),
          v_tsquery,
          'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MaxWords=18, MinWords=5'
        )
        else ''
      end as snippet,
      case
        when v_has_fts then ts_rank(kp.search_tsv, v_tsquery)
        else 0::real
      end as rank
    from public.kb_pages kp
    where kp.account_id = public.get_active_account_id()
      and kp.deleted_at is null
      and public.has_permission('kb.view_pages')
      and (
        (v_has_fts and kp.search_tsv @@ v_tsquery)
        -- substring-fallback: ВСЕ токены входят в lower(title).
        -- `position(... ) = 0` = токен не найден; not exists такого
        -- токена ⇒ совпали все слова запроса. position() не трактует
        -- спецсимволы LIKE (и токены alnum-only — двойная защита).
        or not exists (
          select 1
          from unnest(v_terms) as tk
          where position(tk in lower(coalesce(kp.title, ''))) = 0
        )
      )
    order by rank desc, kp.updated_at desc nulls last
    limit greatest(1, least(coalesce(p_limit, 20), 50));
end;
$$;

comment on function public.kb_search(text, integer) is
  'Full-text search по KB активного account: FTS prefix-match (term:*) '
  'ИЛИ substring-fallback по title (Notion-style, обходит стоп-слова '
  'и стемминг конфига russian). Заменяет 062.';

grant execute on function public.kb_search(text, integer) to authenticated;

-- ------------------------------------------------------------
-- kb_deleted_page_slug_exists — привилегированная проверка: есть ли
-- в активном account soft-deleted страница с таким slug. Отдаёт
-- ТОЛЬКО boolean (ни title, ни content) — контент не утекает
-- рядовому сотруднику без kb.delete_pages. Нужна, чтобы отличить
-- «удалённая страница есть, но нет прав» (→ экран «нет прав») от
-- «slug не существует» (→ 404).
-- ------------------------------------------------------------
create or replace function public.kb_deleted_page_slug_exists(
  p_slug text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select public.has_permission('kb.view_pages') and exists (
    select 1
    from public.kb_pages kp
    where kp.slug = p_slug
      and kp.account_id = public.get_active_account_id()
      and kp.deleted_at is not null
  );
$$;

comment on function public.kb_deleted_page_slug_exists(text) is
  'True если у юзера есть kb.view_pages И в активном account есть '
  'soft-deleted страница с таким slug. Только boolean — контент не '
  'утекает; без kb.view_pages всегда false (юзер без доступа к БЗ '
  'получает честный 404, не enumeration удалённых slug). Для экрана '
  '«нет прав» вместо 404 на /knowledge/<slug> удалённой страницы.';

grant execute on function public.kb_deleted_page_slug_exists(text) to authenticated;
