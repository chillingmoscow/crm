-- ============================================================
-- 187_document_kind.sql
-- Этап 2 разведения «Номенклатура»/«Документы»: структурный шов
-- document_kind. Сейчас единственный реализованный тип —
-- 'inventory' (акт инвентаризации). write_off/transfer объявлены
-- в enum как задел (реализуются позже отдельными этапами).
-- Аддитивно: таблицу не переименовываем (Этап 4), RLS не трогаем.
-- ============================================================

create type public.document_kind_enum as enum
  ('inventory', 'write_off', 'transfer');

alter table public.inventory_documents
  add column if not exists document_kind public.document_kind_enum
    not null default 'inventory';

comment on column public.inventory_documents.document_kind is
  'Тип учётного документа. inventory — акт инвентаризации (единственный '
  'реализованный). write_off/transfer — задел, реализуются позже.';

create index if not exists inventory_documents_kind_idx
  on public.inventory_documents(account_id, document_kind, status);

grant usage on type public.document_kind_enum to authenticated, service_role;
