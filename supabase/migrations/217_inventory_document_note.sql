-- Локальный общий комментарий к акту инвентаризации.
-- Отдельно от documents.comment, который приходит из Quick Resto и
-- перезатирается при синхронизации (см. syncQuickRestoInventory). note —
-- наша запись, sync её не трогает (upsert не перечисляет эту колонку).
alter table public.documents
  add column if not exists note text;

comment on column public.documents.note is
  'Локальный общий комментарий к акту (вводится в CRM, не из Quick Resto, не перезатирается синхронизацией).';
