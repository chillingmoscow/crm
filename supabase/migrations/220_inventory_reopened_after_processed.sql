-- F6 (аудит прав инвентаризации): явный сигнал «итоги правились после проведения».
--
-- reopenInventoryResults разблокирует проведённый (processed) акт для правки
-- итогов. После этого управленческие итоги в CRM могут разойтись с тем, что
-- реально проведено в Quick Resto (QR не трогается). В журнале событие есть, но
-- на уровне карточки/списка сигнала не было.
--
-- results_reopened_at сам по себе неоднозначен: акт могли переоткрыть и во время
-- обычной проверки ДО проведения. Поэтому вводим отдельный устойчивый флаг,
-- который выставляется ТОЛЬКО когда переоткрывают уже проведённый акт
-- (reopenInventoryResults, ветка isProcessed).
alter table public.documents
  add column if not exists results_reopened_after_processed boolean not null default false;

comment on column public.documents.results_reopened_after_processed is
  'true, если проведённый (processed) акт переоткрывали для правки итогов. Сигнал: управленческие итоги правились ПОСЛЕ проведения и могут расходиться с Quick Resto.';

-- Бэкфилл: акты, которые УЖЕ переоткрывали в проведённом состоянии, тоже должны
-- быть помечены — иначе именно расходящиеся с QR старые кейсы остались бы
-- невидимыми. Событие reopenInventoryResults пишет payload.processed = true как
-- раз для этой ветки (event_type = 'results_reopened'), поэтому восстанавливаем
-- флаг из журнала.
update public.documents d
set results_reopened_after_processed = true
where not d.results_reopened_after_processed
  and exists (
    select 1
    from public.inventory_result_events e
    where e.document_id = d.id
      and e.event_type = 'results_reopened'
      and (e.payload ->> 'processed') = 'true'
  );
