-- Вынести вызовы helper-функций в RLS-политиках в InitPlan.
--
-- Конвенция репозитория требует оборачивать `auth.uid()` в `(select auth.uid())`,
-- чтобы PostgreSQL вычислял его один раз на запрос, а не на каждую строку
-- (advisor `auth_rls_initplan`, миграции 161/163). На собственные helper-функции
-- правило не распространили — и они остались голыми:
--
--     has_permission('inventory.view_documents'::text)
--     get_active_account_id()
--     get_active_venue_id()
--
-- Голый вызов в предикате политики попадает в Filter, а не в InitPlan, то есть
-- выполняется НА КАЖДУЮ СТРОКУ. Каждый такой вызов сам делает джойны по
-- user_venue_roles / role_permissions / permissions, а `has_permission` внутри
-- ещё и зовёт `get_active_venue_id()` с джойном profiles/venues.
--
-- Замер на проде до правки:
--   select id, external_id, name, article from ingredients limit 200  →  1654 мс
--   тот же набор данных без per-row вызовов                           →     ~4 мс
--
-- Хуже всего `ingredients_select`: её предикат содержит EXISTS по document_items
-- и documents, а у тех свои 9-10 вызовов на строку. В предикате одной только
-- политики `documents_select` вызов has_permission встречается десять раз.
--
-- Масштаб: helper-функции зовут 153 политики схемы public, обёрнуты были 20.
-- Поэтому тормозила не инвентаризация, а всё приложение разом.
--
-- ── Как это написано ────────────────────────────────────────────────────────
--
-- Паттерн взят из миграции 163: placeholder-pipeline (развернуть известные
-- обёрнутые формы в маркер → свернуть голые в тот же маркер → собрать финальную
-- форму). Он даёт идемпотентность: повторный прогон не породит `(select (select …))`.
--
-- Обрабатываются ОБЕ формы записи, как предписывает CLAUDE.md: на проде функции
-- в pg_policies сериализованы без schema-qualifier'а (`has_permission(…)`),
-- локально — с ним (`public.has_permission(…)`), потому что при создании политик
-- схема была в search_path сессии. Миграция 161 учла только одну форму и на
-- проде оказалась no-op — здесь квалифицированная форма обрабатывается первой,
-- отдельным проходом, чтобы не было неоднозначности с `\m` на границе слова.
--
-- `has_permission` принимает аргумент, поэтому для неё regexp с обратной ссылкой,
-- а не простая замена. Аргумент — строковый литерал с приведением типа, скобок
-- внутри не содержит, поэтому `[^()]*` безопасен.
--
-- Семантика не меняется: обе функции STABLE и вызываются с константами, так что
-- вынос в скалярный подзапрос эквивалентен по результату.

create or replace function pg_temp.hoist_rls_helpers(p_expr text)
returns text
language sql
immutable
as $fn$
  select
    -- 3. Финальная форма.
    replace(
    replace(
    replace(
      regexp_replace(
        -- 2. Голые вызовы — в маркеры. Квалифицированная форма первой.
        regexp_replace(
        regexp_replace(
        regexp_replace(
        regexp_replace(
        regexp_replace(
        regexp_replace(
        regexp_replace(
        regexp_replace(
          -- 1. Уже обёрнутые формы — в те же маркеры (идемпотентность).
          regexp_replace(
          regexp_replace(
          regexp_replace(
          regexp_replace(
            p_expr,
            '\(\s*SELECT\s+(public\.)?has_permission\(([^()]*)\)\s+AS\s+has_permission\s*\)', '<<HP:\2>>', 'gi'),
            '\(\s*SELECT\s+(public\.)?get_active_account_id\(\)\s+AS\s+get_active_account_id\s*\)', '<<ACC>>', 'gi'),
            '\(\s*SELECT\s+(public\.)?get_active_venue_id\(\)\s+AS\s+get_active_venue_id\s*\)', '<<VEN>>', 'gi'),
            '\(\s*SELECT\s+(auth\.)?uid\(\)\s+AS\s+uid\s*\)', '<<UID>>', 'gi'),
          '\mpublic\.has_permission\(([^()]*)\)', '<<HP:\1>>', 'g'),
          '\mhas_permission\(([^()]*)\)',         '<<HP:\1>>', 'g'),
          '\mpublic\.get_active_account_id\(\)',  '<<ACC>>', 'g'),
          '\mget_active_account_id\(\)',          '<<ACC>>', 'g'),
          '\mpublic\.get_active_venue_id\(\)',    '<<VEN>>', 'g'),
          '\mget_active_venue_id\(\)',            '<<VEN>>', 'g'),
          '\mauth\.uid\(\)',                      '<<UID>>', 'g'),
          '\muid\(\)',                            '<<UID>>', 'g'),
        '<<HP:([^>]*)>>', '(select public.has_permission(\1))', 'g'),
      '<<ACC>>', '(select public.get_active_account_id())'),
      '<<VEN>>', '(select public.get_active_venue_id())'),
      '<<UID>>', '(select auth.uid())')
$fn$;

-- Нужна ли политике правка. Сравнивать свой текст с сохранённым бесполезно:
-- PostgreSQL пересобирает предикат в собственную форму
-- (`( SELECT has_permission('x'::text) AS has_permission)`), и текстовое
-- сравнение всегда даёт «отличается». Поэтому смотрим по существу: вырезаем
-- уже обёрнутые вызовы и проверяем, остались ли голые.
create or replace function pg_temp.needs_hoist(p_expr text)
returns boolean
language sql
immutable
as $fn$
  select coalesce(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
      p_expr,
      '\(\s*SELECT\s+(public\.)?has_permission\(([^()]*)\)\s+AS\s+has_permission\s*\)', '', 'gi'),
      '\(\s*SELECT\s+(public\.)?get_active_account_id\(\)\s+AS\s+get_active_account_id\s*\)', '', 'gi'),
      '\(\s*SELECT\s+(public\.)?get_active_venue_id\(\)\s+AS\s+get_active_venue_id\s*\)', '', 'gi'),
      '\(\s*SELECT\s+(auth\.)?uid\(\)\s+AS\s+uid\s*\)', '', 'gi')
    ~ '\m(public\.|auth\.)?(has_permission|get_active_account_id|get_active_venue_id|uid)\(',
    false)
$fn$;

do $migration$
declare
  r record;
  v_qual text;
  v_check text;
  v_sql text;
  v_changed int := 0;
begin
  for r in
    select schemaname, tablename, policyname, cmd, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
             ~ '\m(public\.|auth\.)?(has_permission|get_active_account_id|get_active_venue_id|uid)\('
     order by tablename, policyname
  loop
    -- Всё уже обёрнуто — политику не трогаем вовсе.
    if not pg_temp.needs_hoist(coalesce(r.qual, '')) and not pg_temp.needs_hoist(coalesce(r.with_check, '')) then
      continue;
    end if;

    v_qual  := case when r.qual is null then null else pg_temp.hoist_rls_helpers(r.qual) end;
    v_check := case when r.with_check is null then null else pg_temp.hoist_rls_helpers(r.with_check) end;

    v_sql := 'alter policy ' || quote_ident(r.policyname)
          || ' on ' || quote_ident(r.schemaname) || '.' || quote_ident(r.tablename);

    if r.cmd in ('SELECT', 'DELETE') then
      v_sql := v_sql || ' using (' || v_qual || ')';
    elsif r.cmd = 'INSERT' then
      v_sql := v_sql || ' with check (' || v_check || ')';
    else
      -- UPDATE / ALL
      if r.qual is not null then
        v_sql := v_sql || ' using (' || v_qual || ')';
      end if;
      if r.with_check is not null then
        v_sql := v_sql || ' with check (' || v_check || ')';
      end if;
    end if;

    execute v_sql;
    v_changed := v_changed + 1;
  end loop;

  raise notice 'rls_initplan_helper_functions: переписано % policies', v_changed;
end
$migration$;

-- Временная функция жила только на время прогона этой миграции.
drop function if exists pg_temp.hoist_rls_helpers(text);
drop function if exists pg_temp.needs_hoist(text);
