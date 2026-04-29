-- ============================================================
-- 038_finance_categories.sql
-- Статьи доходов и расходов. Плоский список + опциональные группы.
-- Без древовидной иерархии (см. docs/MERGE_PLAN.md §1, решение #5).
-- ============================================================

create type public.finance_category_type_enum as enum (
  'income',
  'expense'
);

-- Группы статей на уровне account.
create table public.finance_category_groups (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  name        text not null,
  type        text check (type in ('income', 'expense', 'mixed')),
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

create index finance_category_groups_account_idx on public.finance_category_groups(account_id);

create table public.finance_categories (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,

  name            text not null,
  type            public.finance_category_type_enum not null,
  description     text,
  color           text,                          -- hex без #
  icon            text,                          -- имя иконки lucide-react
  group_id        uuid references public.finance_category_groups(id) on delete set null,

  is_system       boolean not null default false,  -- зарезервировано: из дефолтного сидинга
  sort_order      int     not null default 0,
  is_active       boolean not null default true,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz,
  created_by      uuid references public.profiles(id),
  updated_by      uuid references public.profiles(id)
);

create index finance_categories_account_idx       on public.finance_categories(account_id);
create index finance_categories_type_idx          on public.finance_categories(account_id, type) where is_active = true;
create index finance_categories_group_idx         on public.finance_categories(group_id) where group_id is not null;

comment on table public.finance_categories is
  'Статьи доходов/расходов аккаунта. Привязываются к транзакциям '
  '(transactions.category_id). type=income используется для income-'
  'транзакций, expense — для expense. Для transfer-транзакций '
  'category_id остаётся NULL.';
