-- ============================================================
-- Миграция 110: kb_threads_set_positions_batch — batch UPSERT для
-- thread.metadata.position.
--
-- ПРОБЛЕМА:
--   captureCommentMarkPositions делал N параллельных
--   `UPDATE kb_threads SET metadata=...` через PostgREST — по одному
--   round-trip'у на каждый comment-thread с drift'ом. На странице с
--   M тредами — M PostgREST connections + M отдельных WAL-записей
--   + M отдельных realtime emit'ов. На проде это превратилось в
--   725К вызовов одного UPDATE'а с mean_exec_time 344мс — incident
--   2026-05-07 (см. миграцию 109).
--
-- РЕШЕНИЕ:
--   Один RPC принимает массив { thread_id, position } и батчем
--   UPDATE'ит все строки в ОДНОЙ транзакции. Round-trip footprint:
--   M → 1. WAL-записи по-прежнему M (по одной на UPDATE), но они
--   в одной транзакции → один realtime payload.
--
--   Position может быть jsonb-объектом ({from, to, text?}) или null
--   — последнее значит «убрать metadata.position» (mark исчез из
--   doc'а, см. clearThreadPosition в comments-store.ts).
--
-- БЕЗОПАСНОСТЬ:
--   SECURITY INVOKER — RLS-policy `kb_threads_update` (миграция 076)
--   проверит kb.comment_pages + active account для каждого UPDATE'а.
--   Функция НЕ обходит permissions; только консолидирует round-trip'ы.
--
-- ATOMICITY:
--   Все UPDATE'ы в одной транзакции. Если один валится по RLS — весь
--   батч откатывается. Это safer чем N independent UPDATE'ов: либо
--   все позиции синхронизированы, либо ничего.
-- ============================================================

CREATE OR REPLACE FUNCTION public.kb_threads_set_positions_batch(
  p_positions jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  v_thread_id uuid;
  v_position jsonb;
BEGIN
  IF p_positions IS NULL OR jsonb_typeof(p_positions) <> 'array' THEN
    RAISE EXCEPTION 'p_positions must be a JSON array' USING ERRCODE = '22023';
  END IF;

  -- Пустой массив — no-op (оптимизация для frontend'а: можно вызывать
  -- безусловно, без проверок length > 0 на caller-стороне).
  IF jsonb_array_length(p_positions) = 0 THEN
    RETURN;
  END IF;

  FOR rec IN
    SELECT
      (item->>'thread_id')::uuid AS thread_id,
      item->'position' AS position
    FROM jsonb_array_elements(p_positions) AS item
  LOOP
    v_thread_id := rec.thread_id;
    v_position := rec.position;

    IF v_thread_id IS NULL THEN
      RAISE EXCEPTION 'thread_id is required in batch item' USING ERRCODE = '22023';
    END IF;

    IF v_position IS NULL OR jsonb_typeof(v_position) = 'null' THEN
      -- Clear: mark исчез из doc'а, position больше не валидна.
      UPDATE public.kb_threads
      SET metadata = (COALESCE(metadata, '{}'::jsonb) - 'position'),
          updated_at = now()
      WHERE id = v_thread_id;
    ELSE
      -- Set: новые from/to/text для drift-correction'а или edit-shift'а.
      UPDATE public.kb_threads
      SET metadata = jsonb_set(
            COALESCE(metadata, '{}'::jsonb),
            '{position}',
            v_position
          ),
          updated_at = now()
      WHERE id = v_thread_id;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kb_threads_set_positions_batch(jsonb) TO authenticated;

COMMENT ON FUNCTION public.kb_threads_set_positions_batch(jsonb) IS
  'Батчевый UPDATE kb_threads.metadata.position. SECURITY INVOKER (RLS '
  'kb_threads_update применяется per-row). Заменяет N PostgREST UPDATE''ов '
  'из captureCommentMarkPositions одним RPC. См. миграцию 110.';
