-- ============================================================
-- 163_rls_initplan_uid_fixup.sql
--
-- Фиксап для миграции 161. На проде функции в pg_policies сериализованы
-- как голые `uid()` (без schema-qualifier'а), потому что при создании
-- этих политик схема `auth` была в search_path сессии и PostgreSQL
-- отбросил префикс при записи в pg_node_tree. Локально (supabase CLI)
-- они хранятся как `auth.uid()`.
--
-- 161 искал в qual подстроку `auth.uid()` и на проде не находил ничего —
-- миграция была no-op и advisor продолжал ругаться `auth_rls_initplan`.
--
-- Эта миграция обрабатывает оба паттерна (`auth.uid()` и `uid()`) с
-- идемпотентностью через placeholder-замены: даже на повторном прогоне
-- результат стабильный, никакого `(select (select auth.uid()))` не будет.
--
-- Сканирует все RLS policies в `public` (не только список из 161) —
-- безопасно: где `uid()` уже обёрнут, placeholder-pipeline это распознаёт.
-- ============================================================

do $migration$
declare
  r record;
  q text;
  wc text;
  sql text;
  v_changed int := 0;
begin
  for r in
    select schemaname, tablename, policyname, cmd, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and (
         qual       ~ '\muid\('
         or with_check ~ '\muid\('
       )
  loop
    q  := r.qual;
    wc := r.with_check;

    -- Pipeline: unwrap → marker → re-wrap. Гарантирует идемпотентность.
    if q is not null then
      q := replace(q, '( SELECT auth.uid() AS uid)', '<<AUTHUID>>');
      q := replace(q, '(SELECT auth.uid() AS uid)',  '<<AUTHUID>>');
      q := replace(q, '( SELECT uid() AS uid)',      '<<AUTHUID>>');
      q := replace(q, '(SELECT uid() AS uid)',       '<<AUTHUID>>');
      q := replace(q, 'auth.uid()',                  '<<AUTHUID>>');
      q := regexp_replace(q, '\muid\(\)',            '<<AUTHUID>>', 'g');
      q := replace(q, '<<AUTHUID>>', '(select auth.uid())');
    end if;
    if wc is not null then
      wc := replace(wc, '( SELECT auth.uid() AS uid)', '<<AUTHUID>>');
      wc := replace(wc, '(SELECT auth.uid() AS uid)',  '<<AUTHUID>>');
      wc := replace(wc, '( SELECT uid() AS uid)',      '<<AUTHUID>>');
      wc := replace(wc, '(SELECT uid() AS uid)',       '<<AUTHUID>>');
      wc := replace(wc, 'auth.uid()',                  '<<AUTHUID>>');
      wc := regexp_replace(wc, '\muid\(\)',            '<<AUTHUID>>', 'g');
      wc := replace(wc, '<<AUTHUID>>', '(select auth.uid())');
    end if;

    -- Если ничего не изменилось — пропускаем (избегаем NOOP ALTER).
    if q is not distinct from r.qual and wc is not distinct from r.with_check then
      continue;
    end if;

    sql := 'alter policy ' || quote_ident(r.policyname)
        || ' on '  || quote_ident(r.schemaname) || '.' || quote_ident(r.tablename);

    if r.cmd in ('SELECT', 'DELETE') then
      sql := sql || ' using (' || q || ')';
    elsif r.cmd = 'INSERT' then
      sql := sql || ' with check (' || wc || ')';
    else
      -- UPDATE / ALL
      if r.qual is not null then
        sql := sql || ' using (' || q || ')';
      end if;
      if r.with_check is not null then
        sql := sql || ' with check (' || wc || ')';
      end if;
    end if;

    execute sql;
    v_changed := v_changed + 1;
  end loop;

  raise notice 'rls_initplan_uid_fixup: переписано % policies', v_changed;
end
$migration$;
