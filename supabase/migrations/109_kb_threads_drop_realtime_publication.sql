-- ============================================================
-- Миграция 109: убрать kb_threads из supabase_realtime publication.
--
-- ПРОБЛЕМА (incident 2026-05-07):
--   На проде PG ушёл в 277% CPU, 25/30 PostgREST-коннектов залипли в
--   Lock|tuple на UPDATE kb_threads SET metadata=... При диагностике
--   через pg_stat_statements: 725 158 calls со средним 344мс на
--   UPDATE = ~70 часов CPU time. Юзеры видели «Сохраняем... 30 сек»,
--   tree-клики не реагировали, файлы 2МБ грузились минутами.
--
-- ROOT CAUSE — петля обратной связи через realtime:
--   1. captureCommentMarkPositions (после каждого save'а) пишет
--      kb_threads.metadata = position-info для каждого comment-mark'а.
--   2. supabase_realtime publication эмитит UPDATE'ы как
--      `postgres_changes` event'ы.
--   3. Все клиенты, подписанные на kb_threads — включая ТОГО ЖЕ
--      юзера, который только что сохранил — получают event.
--   4. comments-store.ts:applyAllMarksToEditor пересчитывает позиции
--      и пишет corrected positions обратно (см. lines 1296-1305 +
--      1318-1327 — TWO write-back paths внутри одного cycle'а,
--      причём один из них запускается даже когда identical=true!).
--   5. Этот write — снова UPDATE kb_threads → realtime → goto 3.
--
--   Под N юзеров, каждый с M тредами на странице, шторм
--   усиливается geometric'ески. На 4-CPU/8GB хосте PG исчерпывался
--   мгновенно при 2+ активных юзерах в KB.
--
-- РЕШЕНИЕ:
--   kb_threads.metadata.position — это per-user state коррекции
--   drift'а, НЕ нужный для cross-user sync'а в реальном времени.
--   Убираем kb_threads из realtime publication. Loop break'ается
--   на уровне БД — UPDATE'ы продолжают идти, но не emit'ятся
--   подписчикам, applyAllMarksToEditor не получает echo, не
--   запускает write-back.
--
-- ЧТО ОТКЛЮЧИЛОСЬ:
--   • Новые треды от других юзеров не появятся mgnoвенно у тех кто
--     уже на странице. Появятся при reload'е.
--   • Resolve треда не отобразится в реальном времени.
--   • НИЧЕГО критичного — это всё legacy-affordance'ы, без них
--     KB работает.
--
-- ЧТО ОСТАЛОСЬ:
--   • kb_comments — В publication. Новые комменты в треде
--     по-прежнему видно мгновенно у всех подписчиков (ради
--     этого realtime и нужен).
--
-- ОТКАТ (если в будущем code-fix уберёт write-back loop в
-- comments-store.ts:1296+1318):
--   ALTER PUBLICATION supabase_realtime ADD TABLE public.kb_threads;
--
-- ============================================================

-- Idempotent: на проде runtime-командой kb_threads уже убран до того
-- как миграция применилась файлом, поэтому проверяем pg_publication_tables
-- перед DROP'ом. Без этого ALTER PUBLICATION ... DROP TABLE падает
-- ошибкой "table is not part of the publication".
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'kb_threads'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.kb_threads;
  END IF;
END $$;

COMMENT ON PUBLICATION supabase_realtime IS
  'Realtime publication. kb_threads НАМЕРЕННО исключён — миграция 109, '
  'incident 2026-05-07: write-back loop через postgres_changes echo '
  'грузил PG на 277% CPU. Восстановить только после fix code-loop '
  'в comments-store.ts:applyAllMarksToEditor (write-back при identical=true).';
