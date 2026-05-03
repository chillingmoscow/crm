-- ============================================================
-- 084_kb_comments_realtime.sql
-- Sprint D / Phase 5 — Comments realtime sync через Supabase Realtime.
--
-- Зачем: comments сейчас optimistic-only — юзер A видит свой коммент
-- сразу, юзер B видит его только после reload. Для real-time дискуссий
-- по регламенту это плохо. Plan §2.8-E.
--
-- Уточнение vs Real-time editor (Tier 3.2 / Y.js — defer indefinitely):
-- comments ≠ Y.js. Это insert-only rows в kb_comments / kb_threads;
-- Postgres logical replication broadcast'ит row-changes — никаких
-- CRDT, никаких дополнительных серверов. Supabase Realtime built-in.
--
-- Что делает миграция:
--   • alter publication supabase_realtime — добавляет kb_threads и
--     kb_comments в replication-set.
--   • Replica identity full — чтобы UPDATE-events содержали полный
--     row, а не только PK (без этого client получал бы только id и
--     не мог бы apply изменения без re-fetch).
--
-- RLS: уже defined в 076. Realtime уважает RLS — клиент получает
-- только те rows, которые мог бы прочитать через .select(). Без RLS
-- любой anon-юзер ловил бы события всех аккаунтов.
-- ============================================================

-- 1. REPLICA IDENTITY FULL — чтобы UPDATE/DELETE events содержали
--    весь row (старый + новый), а не только PK. Без этого клиент
--    после `update kb_threads set resolved=true` получал бы payload
--    `{id, resolved}` — без metadata / page_id, и не мог бы корректно
--    обновить cache.
alter table public.kb_threads   replica identity full;
alter table public.kb_comments  replica identity full;

-- 2. Добавляем таблицы в supabase_realtime publication.
--    Идемпотентно через DO-block: ALTER PUBLICATION ADD TABLE
--    падает если уже добавлено.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'kb_threads'
  ) then
    alter publication supabase_realtime add table public.kb_threads;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'kb_comments'
  ) then
    alter publication supabase_realtime add table public.kb_comments;
  end if;
end
$$;

comment on table public.kb_threads  is
  'Comment-thread на KB-странице. Sprint D Phase 5: included in '
  'supabase_realtime publication для broadcast row-changes клиентам.';

comment on table public.kb_comments is
  'Comment в kb_threads. Sprint D Phase 5: included в supabase_realtime '
  'publication; клиент SupabaseThreadStore подписан на INSERT/UPDATE '
  'и обновляет cache без reload страницы.';
