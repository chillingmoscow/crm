-- ============================================================
-- Миграция 111: вернуть kb_threads в supabase_realtime publication.
--
-- КОНТЕКСТ:
--   Миграция 109 (incident 2026-05-07) экстренно убрала kb_threads из
--   publication для разрыва write-back loop'а. После этого:
--     • PR #165 — revert await captureCommentMarkPositions (UX-relief).
--     • PR #168 + миграция 110 — batch RPC + 30s throttle + удалён
--       write-back loop в applyAllMarksToEditor.
--
--   Теперь все три условия write-back loop'а закрыты на уровне кода:
--     1. apply больше не пишет correctedPositions обратно в БД.
--     2. capture батчево пишет ОДИН RPC раз в 30с (вместо N parallel).
--     3. realtime echo, попадая в applyAllMarksToEditor, не запускает
--        повторный write — нет write-path'а в apply вообще.
--
--   Можно безопасно вернуть kb_threads в publication. Realtime новых
--   тредов / resolve'ов от других юзеров снова заработает.
--
-- ИДЕМПОТЕНТНОСТЬ:
--   `ALTER PUBLICATION ... ADD TABLE` падает ошибкой если таблица уже
--   в publication. Заворачиваем в DO-блок с проверкой
--   `pg_publication_tables`.
--
-- ОТКАТ:
--   Если каким-то чудом всё-таки полетит шторм — тот же DO-блок,
--   только DROP вместо ADD (см. миграцию 109).
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'kb_threads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.kb_threads;
  END IF;
END $$;

COMMENT ON PUBLICATION supabase_realtime IS
  'Realtime publication. kb_threads восстановлен миграцией 111 после '
  'устранения write-back loop''а в comments-store.ts (PR #168) и батчинга '
  'persistThreadPosition (миграция 110). Если loop вернётся — DROP '
  'TABLE kb_threads через ALTER PUBLICATION (см. миграцию 109).';
