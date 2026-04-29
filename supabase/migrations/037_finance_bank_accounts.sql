-- ============================================================
-- 037_finance_bank_accounts.sql
-- Банковские счета, кассы, фонды, карты. Привязаны к юрлицу,
-- опционально — к конкретному venue.
--
-- См. docs/MERGE_PLAN.md §3.5 (#bank_accounts).
-- RLS добавляется в миграции 042 вместе со всеми политиками блока Finance.
-- ============================================================

create type public.bank_account_type_enum as enum (
  'checking',     -- расчётный счёт
  'debit_card',   -- дебетовая карта
  'cash',         -- наличная касса
  'fund',         -- денежный фонд
  'safe'          -- сейф
);

-- Группы счетов на уровне account (для UI-сортировки).
create table public.bank_account_groups (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  name        text not null,
  description text,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

create index bank_account_groups_account_idx on public.bank_account_groups(account_id);

-- Composite UNIQUE on venues так что bank_accounts может ссылаться
-- через композитный FK (account_id, venue_id) и Postgres гарантирует
-- что venue принадлежит тому же account, что и bank_account.
alter table public.venues
  add constraint venues_account_id_id_key unique (account_id, id);

create table public.bank_accounts (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  legal_entity_id uuid not null,
  venue_id        uuid,
  -- venue_id NULL = счёт общий для юрлица; NOT NULL = касса конкретной точки.
  -- Композитные FK ниже гарантируют tenant-консистентность.

  name            text not null,
  type            public.bank_account_type_enum not null,
  currency        text not null default 'RUB',  -- зарезервировано на будущее
  balance         numeric(15, 2) not null default 0,
  description     text,
  group_id        uuid references public.bank_account_groups(id) on delete set null,

  -- Поля для расчётного счёта / карты / эквайринга
  bank_name             text,
  bik                   text,
  account_number        text,
  correspondent_account text,
  acquiring_percentage  numeric(5, 2),

  -- Поля карты
  card_holder           text,
  card_number_last4     text,

  -- Аудит / soft delete
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz,
  created_by      uuid references public.profiles(id),
  updated_by      uuid references public.profiles(id),
  deleted_at      timestamptz,
  deleted_by      uuid references public.profiles(id),

  -- Composite FK гарантирует что legal_entity и venue принадлежат
  -- тому же account, что и bank_account. ON DELETE RESTRICT — нельзя
  -- удалить юрлицо/venue, если на них есть счета: сначала перепривяжите.
  constraint bank_accounts_legal_entity_tenant_fkey
    foreign key (account_id, legal_entity_id)
    references public.legal_entities (account_id, id)
    on delete restrict,
  constraint bank_accounts_venue_tenant_fkey
    foreign key (account_id, venue_id)
    references public.venues (account_id, id)
    on delete set null
);

-- Composite UNIQUE для будущих composite FK из transactions (миграция 040).
alter table public.bank_accounts
  add constraint bank_accounts_account_id_id_key unique (account_id, id);

create index bank_accounts_account_idx        on public.bank_accounts(account_id);
create index bank_accounts_legal_entity_idx   on public.bank_accounts(legal_entity_id);
create index bank_accounts_venue_idx          on public.bank_accounts(venue_id) where venue_id is not null;
create index bank_accounts_not_deleted_idx    on public.bank_accounts(account_id) where deleted_at is null;
create index bank_accounts_group_idx          on public.bank_accounts(group_id) where group_id is not null;

comment on table public.bank_accounts is
  'Банковские счета / кассы / фонды / карты юрлица. Транзакции '
  'привязываются к bank_account_id и движут balance через trigger '
  'из миграции 040.';

comment on column public.bank_accounts.balance is
  'Текущий баланс. Изменяется ТОЛЬКО триггером из миграции 040 '
  '(пересчёт по транзакциям). Прямая запись в balance из приложения '
  'отвергается тем же триггером.';
