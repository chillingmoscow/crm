-- ============================================================
-- 211_recount_skip_uncounted.sql
-- Авто-маркер пересчёта не должен флажить НЕсосчитанные строки.
--
-- Проблема: триггер inventory_apply_recount_threshold (миграция 209)
-- ставил needs_recount по |расхождению| > порога. Но у несосчитанной
-- строки actual_amount пустой, а «расхождение» = весь книжный остаток
-- (calculated), т.е. 100% → строка ошибочно помечалась на пересчёт ещё
-- до подсчёта. Гейт: пропускаем строки без actual_amount.
--
-- syncDocumentItems пишет actual_amount и difference_* одним upsert'ом, так
-- что на момент срабатывания триггера new.actual_amount уже актуален.
-- CREATE OR REPLACE сохраняет привязку триггера; SET search_path обязателен
-- (memory feedback_create_or_replace_search_path).
-- ============================================================

create or replace function public.inventory_apply_recount_threshold()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_threshold_sum     numeric;
  v_threshold_percent numeric;
  v_sum_breached      boolean;
  v_pct_breached      boolean;
  v_breached          boolean;
begin
  -- Несосчитанная строка (факт не введён) — пересчитывать нечего.
  -- Снимаем устаревший АВТО-флаг (ручные пометки не трогаем), иначе строка,
  -- помеченная раньше или сброшенная синком в NULL, осталась бы с ложным
  -- сигналом пересчёта (Codex P2 #405).
  if new.actual_amount is null then
    if new.recount_auto_flagged = true and new.recount_marked_by is null then
      new.needs_recount        := false;
      new.recount_auto_flagged := false;
    end if;
    return new;
  end if;

  -- venue thresholds через денормализованный documents.venue_id (миграция 194).
  select v.inventory_recount_threshold_sum, v.inventory_recount_threshold_percent
    into v_threshold_sum, v_threshold_percent
    from public.documents d
    join public.venues v on v.id = d.venue_id
   where d.id = new.document_id;

  -- Если у акта нет venue (rare/legacy data) — пропускаем автомаркер.
  if v_threshold_sum is null then
    return new;
  end if;

  v_sum_breached := abs(coalesce(new.difference_sum, 0)) > v_threshold_sum;
  v_pct_breached := coalesce(new.calculated_amount, 0) > 0
                    and abs(coalesce(new.difference_amount, 0)) / new.calculated_amount * 100 > v_threshold_percent;
  v_breached := v_sum_breached or v_pct_breached;

  if v_breached then
    -- Авто-флаг ставим только если не было ручной пометки.
    if new.recount_marked_by is null then
      new.needs_recount        := true;
      new.recount_auto_flagged := true;
    end if;
  else
    -- Снимаем только авто-флаг; ручные оставляем.
    if new.recount_auto_flagged = true and new.recount_marked_by is null then
      new.needs_recount        := false;
      new.recount_auto_flagged := false;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.inventory_apply_recount_threshold() from public;

-- Одноразовый backfill: снимаем устаревшие АВТО-флаги с уже существующих
-- несосчитанных строк (триггер на них не сработает, пока их кто-то не
-- обновит). Ручные пометки (recount_marked_by) не трогаем. Меняем НЕ
-- trigger-колонки → автомаркер не перезапускается.
update public.document_items
   set needs_recount        = false,
       recount_auto_flagged = false
 where actual_amount is null
   and recount_auto_flagged = true
   and recount_marked_by is null;
