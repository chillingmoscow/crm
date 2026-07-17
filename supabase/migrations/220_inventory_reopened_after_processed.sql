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
