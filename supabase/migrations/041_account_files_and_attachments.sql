-- ============================================================
-- 041_account_files_and_attachments.sql
-- Унифицированное хранилище файлов на уровне account + pivot-таблицы
-- для прикрепления к разным сущностям (transactions / counterparties /
-- legal_entities).
--
-- См. docs/MERGE_PLAN.md §3.6.
-- Один storage bucket `account-attachments` для всего этого.
-- ============================================================

create type public.attachment_document_type_enum as enum (
  'receipt',           -- чек
  'contract',          -- договор
  'act',               -- акт выполненных работ
  'invoice',           -- счёт
  'waybill',           -- накладная
  'tax_document',      -- налоговый документ
  'registration_doc',  -- учредительный (ОГРН, выписка ЕГРЮЛ и т.п.)
  'other'
);

-- Общая таблица файлов на уровне account.
create table public.account_files (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  storage_path  text not null,                -- путь в bucket account-attachments
  name          text not null,
  mime_type     text not null,
  size_bytes    bigint not null,
  uploaded_by   uuid not null references public.profiles(id),
  uploaded_at   timestamptz not null default now()
);

create index account_files_account_idx on public.account_files(account_id);

comment on table public.account_files is
  'Каталог загруженных файлов на уровне account. Один файл может быть '
  'привязан к нескольким сущностям через pivot-таблицы. Storage path '
  'шаблон: {account_id}/{yyyy}/{mm}/{uuid}-{name}.';

-- ─── Pivot: транзакции ─────────────────────────────────────────────────────
create table public.transaction_attachments (
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  file_id        uuid not null references public.account_files(id) on delete cascade,
  document_type  public.attachment_document_type_enum not null default 'receipt',
  primary key (transaction_id, file_id)
);

create index transaction_attachments_file_idx on public.transaction_attachments(file_id);

-- ─── Pivot: контрагенты (договоры, акты, накладные) ────────────────────────
create table public.counterparty_attachments (
  counterparty_id uuid not null references public.counterparties(id) on delete cascade,
  file_id         uuid not null references public.account_files(id) on delete cascade,
  document_type   public.attachment_document_type_enum not null default 'contract',
  document_date   date,
  document_number text,
  description     text,
  primary key (counterparty_id, file_id)
);

create index counterparty_attachments_file_idx on public.counterparty_attachments(file_id);

-- ─── Pivot: юрлица (учредительные, выписки ЕГРЮЛ) ──────────────────────────
create table public.legal_entity_attachments (
  legal_entity_id uuid not null references public.legal_entities(id) on delete cascade,
  file_id         uuid not null references public.account_files(id) on delete cascade,
  document_type   public.attachment_document_type_enum not null default 'registration_doc',
  description     text,
  primary key (legal_entity_id, file_id)
);

create index legal_entity_attachments_file_idx on public.legal_entity_attachments(file_id);

-- ─── Storage bucket ────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
  values ('account-attachments', 'account-attachments', false)
  on conflict (id) do nothing;

comment on column public.account_files.storage_path is
  'Путь в bucket account-attachments. Префикс — UUID account_id, '
  'обеспечивает изоляцию папок между тенантами для storage RLS.';
