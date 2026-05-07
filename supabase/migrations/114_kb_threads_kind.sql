-- ============================================================
-- 114_kb_threads_kind.sql
-- Page-level комментарии: добавляем `kind` колонку в kb_threads.
--
-- До этой миграции kb_threads хранил только inline-thread'ы (anchored
-- к ProseMirror-mark в kb_pages.content, управляются BlockNote
-- ThreadStore). Notion-style top-level discussion (см. скриншот в
-- задаче) — это отдельный поток комментариев на странице, не привязанный
-- к выделению текста. Различаем их через kind:
--
--   inline (default) — существующие thread'ы; mark в документе указывает
--                      на thread.id; UI рендерит floating-thread/composer
--                      рядом с выделением (kb-floating-thread.tsx).
--   page             — новые top-level thread'ы; рендерятся в блоке
--                      «Комментарии» между properties и body страницы
--                      (KbPageComments компонент). Не имеют mark'а в
--                      документе, BlockNote ThreadStore их не видит.
--
-- RLS, kb_comment_react/unreact RPC, realtime publication — kind-agnostic,
-- остаются без изменений. kb_comments через FK ссылается на kb_threads;
-- его страница-trigger (kb_comments_set_page_id, мигр. 106) тоже работает
-- одинаково для обоих kinds.
-- ============================================================

alter table public.kb_threads
  add column kind text not null default 'inline'
  check (kind in ('inline', 'page'));

-- Узкий partial index для часто запрашиваемого «page-level threads
-- одной страницы, ordered desc, без soft-deleted». Существующий
-- kb_threads_page_idx (мигр. 076) тоже подходит, но он покрывает оба
-- kind'а — а UI page-comments читает только kind='page'.
create index kb_threads_page_kind_idx
  on public.kb_threads(page_id, created_at desc)
  where kind = 'page' and deleted_at is null;

comment on column public.kb_threads.kind is
  'Тип thread''a: inline (anchored в документе через BlockNote mark) или '
  'page (top-level Notion-style discussion на странице).';
