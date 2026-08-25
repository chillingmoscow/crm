-- Событие журнала: перед проведением данные Quick Resto разъехались с тем,
-- что видел проверяющий.
--
-- «Подвести итоги» теперь перечитывает строки из Quick Resto и сравнивает их с
-- тем, что было на экране. Если расчётный остаток по каким-то позициям успел
-- измениться (правки в учёте за период до даты акта), акт НЕ проводится —
-- вместо этого таблица обновляется, а проверяющему показывается разница.
-- Прецедент: акт СВ340 — на экране был итог +89,25 ₽, провелось +16 301,75 ₽.
--
-- Само событие нужно в журнале: это отказ провести акт, и он должен быть
-- объясним постфактум.
--
-- Вторым типом добавляется 'resort_recalculated': импорт строк приводит активные
-- пересорты к свежим значениям difference_* (иначе управленческий итог считал бы
-- зачёт по вчерашним объёмам), и такой автоматический пересчёт тоже должен быть
-- виден в журнале.

alter table public.inventory_result_events
  drop constraint if exists inventory_result_events_event_type_check;

alter table public.inventory_result_events
  add constraint inventory_result_events_event_type_check check (
    event_type = any (array[
      'comment_updated',
      'exclude_enabled',
      'exclude_disabled',
      'persistent_exclusion_enabled',
      'persistent_exclusion_disabled',
      'resort_created',
      'resort_voided',
      'results_finalized',
      'results_reopened',
      'results_refreshed',
      'results_recheck_drift',
      'resort_recalculated',
      'suggestion_applied',
      'suggestion_dismissed',
      'recount_marked',
      'recount_unmarked',
      'returned_for_recount',
      'assignee_changed',
      'reviewer_changed',
      'draft_started',
      'submitted'
    ])
  );
