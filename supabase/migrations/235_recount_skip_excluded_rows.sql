-- Не гонять на пересчёт строку, исключённую из управленческих итогов.
--
-- Автомаркер пересчёта (миграции 209, 211, 228) смотрел на сумму расхождения
-- и порог заведения, но не смотрел на исключение строки из итогов. В
-- результате на одной строке уживались два взаимоисключающих сигнала:
-- «Не учитывать» в колонке учёта и включённый тумблер пересчёта рядом.
-- Считать позицию, которая по решению человека или по правилу в итог не
-- входит, незачем.
--
-- Правок две, и обе нужны.
--
-- 1. Функция. Исключённая строка выходит раньше расчёта порога, а
--    залежавшийся АВТО-флаг с неё снимается. Ручную пометку не трогаем: её
--    ставил человек и мог иметь причины помимо суммы.
--
-- 2. Триггер. Он висел на INSERT и на UPDATE OF difference_sum,
--    difference_amount, calculated_amount — то есть на изменение
--    excluded_from_totals не срабатывал вовсе. Именно поэтому флаг и
--    застревал: человек исключал строку из итогов отдельным экшеном, ни одна
--    из трёх колонок не менялась, и автомаркер не пересматривал решение.
--    Добавляем excluded_from_totals в список — тогда и снятие исключения
--    вернёт флаг, если расхождение по-прежнему выше порога.

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

  -- Строка, исключённая из управленческих итогов, на пересчёт не идёт.
  -- Её расхождение сознательно не учитывают — правилом «Исключать всегда»
  -- или разовой отметкой, — так что требовать пересчёта бессмысленно:
  -- сколько её ни считай, в управленческий итог она не попадёт. Раньше
  -- проверяющий видел на одной строке два взаимоисключающих сигнала:
  -- «Не учитывать» и одновременно «на пересчёт».
  --
  -- Авто-флаг снимаем, ручной не трогаем: если человек отметил строку сам,
  -- у него могли быть причины помимо суммы расхождения.
  if new.excluded_from_totals then
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

drop trigger if exists trg_inventory_apply_recount_threshold on public.document_items;
create trigger trg_inventory_apply_recount_threshold
  before insert or update of
    difference_sum, difference_amount, calculated_amount, excluded_from_totals
  on public.document_items
  for each row
  execute function public.inventory_apply_recount_threshold();

-- Разовый бэкфилл для строк, где флаг уже застрял. Триггер на этих колонках
-- не висит, так что автомаркер от такого update не перезапускается.
update public.document_items
   set needs_recount        = false,
       recount_auto_flagged = false
 where excluded_from_totals = true
   and recount_auto_flagged = true
   and recount_marked_by is null;
