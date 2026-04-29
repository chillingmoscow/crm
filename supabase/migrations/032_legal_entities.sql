-- ============================================================
-- 032_legal_entities.sql
-- Юридические лица аккаунта (3-й уровень иерархии).
--
-- Иерархия после этой миграции:
--   accounts            (тенант, неизменно)
--     ├── legal_entities (новое — юрлица: ИП, ООО, АО ...)
--     └── venues          (физические точки; 033 свяжет с default_legal_entity_id)
--
-- См. docs/MERGE_PLAN.md §3.3.
-- RLS на эту таблицу включается в миграции 034 (вместе с новой моделью permissions).
-- ============================================================

create type public.legal_form_enum as enum (
  'IP',     -- Индивидуальный предприниматель
  'OOO',    -- Общество с ограниченной ответственностью
  'AO',     -- Акционерное общество
  'PAO',    -- Публичное акционерное общество
  'NKO',    -- Некоммерческая организация
  'OTHER'
);

create type public.tax_system_enum as enum (
  'OSN',                 -- Общая система
  'USN_INCOME',          -- УСН «Доходы»
  'USN_INCOME_EXPENSE',  -- УСН «Доходы минус расходы»
  'PSN',                 -- Патент
  'NPD',                 -- Налог на профессиональный доход (самозанятый)
  'AUSN'                 -- Автоматизированная УСН
);

create table public.legal_entities (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,

  -- Идентификация
  name            text not null,
  legal_form      public.legal_form_enum not null,
  short_name      text,

  -- Реквизиты (РФ)
  inn             text,
  kpp             text,
  ogrn            text,
  okpo            text,
  okved           text,

  -- Налоговая система
  tax_system      public.tax_system_enum,
  vat_payer       boolean not null default false,

  -- Адреса
  legal_address   text,
  actual_address  text,
  postal_address  text,

  -- Подписанты
  director_name           text,
  director_position       text default 'Директор',
  accountant_name         text,
  signature_basis         text,        -- "Устав" / "Доверенность №..."

  -- Контакты
  phone           text,
  email           text,
  website         text,

  -- Банковские реквизиты по умолчанию (для документов)
  default_bank_name      text,
  default_bik            text,
  default_account_number text,
  default_corr_account   text,

  -- DaData кэш: когда последний раз синхронизировались с DaData.
  -- NULL = данные введены вручную.
  dadata_synced_at timestamptz,

  -- Аудит
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz,
  created_by      uuid references public.profiles(id),
  updated_by      uuid references public.profiles(id)
);

create index legal_entities_account_id_idx
  on public.legal_entities(account_id);

create index legal_entities_inn_idx
  on public.legal_entities(account_id, inn) where inn is not null;

comment on table public.legal_entities is
  'Юридические лица аккаунта. У одного account может быть несколько legal_entities. '
  'Финансовые операции и счета привязываются к legal_entity_id.';

comment on column public.legal_entities.dadata_synced_at is
  'Когда запись была обогащена через DaData cleaner/findById/party. '
  'NULL = введено вручную.';
