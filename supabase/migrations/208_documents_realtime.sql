-- ============================================================
-- 208_documents_realtime.sql
-- Включаем realtime-публикацию для таблицы `documents`, чтобы
-- страница /documents подписывалась на изменения и обновляла
-- список без F5 (assignee получает уведомление о назначении,
-- менеджер видит когда прораб закончил счёт).
--
-- Только SELECT-канал (INSERT/UPDATE/DELETE события).
-- Подписчик в UI просто дёргает router.refresh() — никакой
-- обратной записи в БД, риска write-back loop (как в
-- kb_threads_realtime_writeback_loop incident) нет.
-- ============================================================

alter publication supabase_realtime add table public.documents;
