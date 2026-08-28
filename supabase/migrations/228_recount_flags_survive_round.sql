-- Авто-маркер не снимает пометку пересчёта, пока акт на пересчёте.
--
-- Проблема. Пока акт в статусе recount_pending, синхронизация продолжает
-- импортировать его строки (акт непроведённый и свежий — фильтр её пропускает),
-- а на каждом upsert'е срабатывает inventory_apply_recount_threshold. Если
-- Quick Resto пересчитал расчётные остатки и расхождение по отмеченной строке
-- ушло ниже порога, триггер снимал АВТО-флаг. Отметки круга исчезали прямо во
-- время пересчёта: исполнителю открывался весь акт вместо четырёх позиций, а
-- сервер терял признак, по которому ограничивает отправку в Quick Resto.
--
-- Правило. Пока документ на пересчёте, триггер может ПОСТАВИТЬ авто-флаг
-- (новое расхождение — законный повод пересчитать и эту строку), но не может
-- СНЯТЬ его: набор строк круга — решение проверяющего, и снимает его только
-- сам пересчёт (submitInventoryDocumentDraft чистит флаги по отправленным
-- строкам явным UPDATE'ом, до смены статуса).
--
-- Остальная логика — как в миграции 211 (несосчитанные строки не флажим,
-- ручные пометки не трогаем).

create or replace function public.inventory_apply_recount_threshold()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_threshold_sum     numeric;
  v_threshold_percent numeric;
  v_document_status   text;
  v_on_recount        boolean;
  v_sum_breached      boolean;
  v_pct_breached      boolean;
  v_breached          boolean;
begin
  -- venue thresholds через денормализованный documents.venue_id (миграция 194)
  -- + статус акта: он решает, можно ли снимать пометку.
  select v.inventory_recount_threshold_sum, v.inventory_recount_threshold_percent, d.status
    into v_threshold_sum, v_threshold_percent, v_document_status
    from public.documents d
    join public.venues v on v.id = d.venue_id
   where d.id = new.document_id;

  v_on_recount := v_document_status = 'recount_pending';

  -- Несосчитанная строка (факт не введён) — пересчитывать нечего.
  -- Снимаем устаревший АВТО-флаг (ручные пометки не трогаем), иначе строка,
  -- помеченная раньше или сброшенная синком в NULL, осталась бы с ложным
  -- сигналом пересчёта (Codex P2 #405).
  if new.actual_amount is null then
    if new.recount_auto_flagged = true and new.recount_marked_by is null and not v_on_recount then
      new.needs_recount        := false;
      new.recount_auto_flagged := false;
    end if;
    return new;
  end if;

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
    -- Снимаем только авто-флаг; ручные оставляем. И только когда акт НЕ на
    -- пересчёте — иначе отметки круга исчезали бы у исполнителя под руками.
    if new.recount_auto_flagged = true and new.recount_marked_by is null and not v_on_recount then
      new.needs_recount        := false;
      new.recount_auto_flagged := false;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.inventory_apply_recount_threshold() from public;
