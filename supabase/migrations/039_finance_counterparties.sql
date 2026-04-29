-- ============================================================
-- 039_finance_counterparties.sql
-- Контрагенты — поставщики, клиенты, партнёры аккаунта.
--
-- См. docs/MERGE_PLAN.md §3.5 (#counterparties).
-- ИНН контрагента может совпадать с ИНН юрлица аккаунта (cross-table
-- UNIQUE по ИНН не нужен — решение #13 в плане).
-- ============================================================

create table public.counterparty_groups (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  name        text not null,
  description text,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

create index counterparty_groups_account_idx on public.counterparty_groups(account_id);

create table public.counterparties (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,

  name            text not null,
  legal_form      public.legal_form_enum not null default 'OOO',
  inn             text,
  kpp             text,
  ogrn            text,
  contact_person  text,
  phone           text,
  email           text,
  address         text,
  description     text,
  group_id        uuid references public.counterparty_groups(id) on delete set null,

  -- DaData кэш (как у legal_entities). NULL = введено вручную.
  dadata_synced_at timestamptz,

  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz,
  created_by      uuid references public.profiles(id),
  updated_by      uuid references public.profiles(id),
  deleted_at      timestamptz,
  deleted_by      uuid references public.profiles(id)
);

-- Composite UNIQUE для будущих composite FK из transactions (миграция 040).
-- Гарантирует, что transaction.counterparty_id всегда принадлежит тому
-- же account, что и сама транзакция.
alter table public.counterparties
  add constraint counterparties_account_id_id_key unique (account_id, id);

create index counterparties_account_idx     on public.counterparties(account_id);
create index counterparties_inn_idx         on public.counterparties(account_id, inn) where inn is not null;
create index counterparties_group_idx       on public.counterparties(group_id) where group_id is not null;
create index counterparties_not_deleted_idx on public.counterparties(account_id) where deleted_at is null;

comment on table public.counterparties is
  'Контрагенты (поставщики/клиенты/партнёры) аккаунта. Привязываются '
  'к expense/income-транзакциям через transactions.counterparty_id.';

comment on column public.counterparties.dadata_synced_at is
  'Когда запись была обогащена через DaData (по аналогии с legal_entities). '
  'NULL = введено вручную.';
