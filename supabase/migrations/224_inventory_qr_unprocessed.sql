-- Распроведение акта в Quick Resto не должно откатывать наши итоги.
--
-- Отмена проведения — штатная операция бухгалтера в Quick Resto. После неё
-- акт снова выглядит непроведённым и свежим, поэтому проходит фильтр
-- синхронизации (isRecentOpenInventoryDocument пропускает только
-- непроведённые акты за последнюю неделю). Дальше синхронизация:
--   * ставила status = 'synced' — акт с зафиксированными итогами
--     «раззавершался», хотя results_finalized_at оставался заполненным;
--   * перезаписывала results_has_line_amounts и суммы по ответу для
--     непроведённого акта (нули), пряча утверждённые итоги.
-- Состояние получалось противоречивым, а последующее переоткрытие итогов
-- теряло метку «итоги правились после проведения»: ветка isProcessed в
-- reopenInventoryResults уже не срабатывала, статус ведь больше не 'processed'.
--
-- Решение: статус не понижаем, а сам факт распроведения фиксируем отдельным
-- полем и событием журнала — чтобы это было видно человеку, а не молча.

alter table public.documents
  add column if not exists qr_unprocessed_at timestamptz;

comment on column public.documents.qr_unprocessed_at is
  'Когда синхронизация увидела, что акт с зафиксированными итогами распровели в Quick Resto. Сбрасывается в null, как только QR снова отдаёт акт проведённым.';

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
      'resort_recalculated',
      'results_finalized',
      'results_reopened',
      'results_refreshed',
      'results_recheck_drift',
      'recount_split',
      'qr_unprocessed',
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
