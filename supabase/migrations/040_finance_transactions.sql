-- ============================================================
-- 040_finance_transactions.sql
-- Главная сущность блока Finance: денежные операции (доход/расход/перевод)
-- с автоматическим пересчётом баланса банковских счетов через триггер.
--
-- См. docs/MERGE_PLAN.md §3.5 (#transactions).
-- Решение #4: внутрикомпанейские переводы — одной транзакцией (не двойная запись).
-- Решение #10: soft delete; UI «корзины» — позже.
-- ============================================================

create type public.transaction_type_enum   as enum ('income', 'expense', 'transfer');
create type public.transaction_source_enum as enum ('manual', 'quickresto', 'import', 'bank_sync');

create table public.transactions (
  id              uuid primary key default gen_random_uuid(),
  -- Человеко-читаемый номер для UI (через bigserial, не uuid).
  public_id       bigserial unique,

  account_id      uuid not null references public.accounts(id) on delete cascade,
  legal_entity_id uuid not null,
  venue_id        uuid,

  type            public.transaction_type_enum not null,
  amount          numeric(15, 2) not null check (amount > 0),
  currency        text not null default 'RUB',

  bank_account_id uuid not null,

  -- Поля только для transfer
  to_bank_account_id uuid,
  to_legal_entity_id uuid,
  -- to_legal_entity_id = legal_entity_id → внутренний перевод одного юрлица
  -- to_legal_entity_id != legal_entity_id → перевод между юрлицами одного account

  -- Поля только для income/expense
  category_id     uuid references public.finance_categories(id) on delete set null,
  counterparty_id uuid references public.counterparties(id) on delete set null,

  description     text,
  date            timestamptz not null,

  source             public.transaction_source_enum not null default 'manual',
  source_external_id text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz,
  created_by      uuid references public.profiles(id),
  updated_by      uuid references public.profiles(id),
  deleted_at      timestamptz,
  deleted_by      uuid references public.profiles(id),

  -- Composite FK для tenant-консистентности
  constraint transactions_legal_entity_tenant_fkey
    foreign key (account_id, legal_entity_id)
    references public.legal_entities (account_id, id)
    on delete restrict,
  constraint transactions_venue_tenant_fkey
    foreign key (account_id, venue_id)
    references public.venues (account_id, id)
    on delete set null,
  constraint transactions_bank_account_tenant_fkey
    foreign key (account_id, bank_account_id)
    references public.bank_accounts (account_id, id)
    on delete restrict,
  constraint transactions_to_bank_account_tenant_fkey
    foreign key (account_id, to_bank_account_id)
    references public.bank_accounts (account_id, id)
    on delete restrict,
  constraint transactions_to_legal_entity_tenant_fkey
    foreign key (account_id, to_legal_entity_id)
    references public.legal_entities (account_id, id)
    on delete restrict,

  -- Транзакция типа transfer обязана иметь to_*; income/expense — нет.
  constraint transfer_requires_to_account
    check (type != 'transfer' or to_bank_account_id is not null),
  constraint transfer_requires_to_legal_entity
    check (type != 'transfer' or to_legal_entity_id is not null),
  constraint income_expense_no_to_account
    check (type = 'transfer' or to_bank_account_id is null),
  constraint income_expense_no_to_legal_entity
    check (type = 'transfer' or to_legal_entity_id is null),

  -- Дедупликация по внешнему источнику (например, QuickResto webhook).
  constraint transactions_external_unique
    unique (account_id, source, source_external_id)
);

create index transactions_account_idx       on public.transactions(account_id);
create index transactions_legal_entity_idx  on public.transactions(legal_entity_id);
create index transactions_venue_idx         on public.transactions(venue_id) where venue_id is not null;
create index transactions_bank_account_idx  on public.transactions(bank_account_id);
create index transactions_to_bank_acc_idx   on public.transactions(to_bank_account_id) where to_bank_account_id is not null;
create index transactions_category_idx      on public.transactions(category_id) where category_id is not null;
create index transactions_counterparty_idx  on public.transactions(counterparty_id) where counterparty_id is not null;
create index transactions_date_desc_idx     on public.transactions(date desc);
create index transactions_type_idx          on public.transactions(type);
create index transactions_source_idx        on public.transactions(source) where source != 'manual';
create index transactions_not_deleted_idx   on public.transactions(account_id, date desc) where deleted_at is null;

comment on table public.transactions is
  'Денежные операции аккаунта: доходы / расходы / переводы. Балансы '
  'bank_accounts пересчитываются автоматически триггером — НЕ писать '
  'в bank_accounts.balance напрямую.';

-- ============================================================
-- Balance recalc trigger.
--
-- INSERT/UPDATE/DELETE/soft-delete транзакции → пересчёт
-- bank_accounts.balance.
--   income:   +amount к bank_account_id
--   expense:  -amount от bank_account_id
--   transfer: -amount от bank_account_id, +amount к to_bank_account_id
--
-- Soft delete (deleted_at становится NOT NULL) откатывает эффект.
-- Soft restore (deleted_at становится NULL) повторно применяет эффект.
-- ============================================================

create or replace function public.apply_transaction_balance_delta(
  p_bank_account_id uuid,
  p_delta           numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_bank_account_id is null or p_delta = 0 then
    return;
  end if;
  -- Помечаем источник изменения, чтобы guard-trigger пропустил его.
  perform set_config('app.balance_apply', 'true', true);
  update public.bank_accounts
  set balance = balance + p_delta
  where id = p_bank_account_id;
  perform set_config('app.balance_apply', '', true);
end;
$$;

create or replace function public.transaction_balance_recalc()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Эффект транзакции считается «активным», когда строка в актуальном
  -- состоянии (NEW при INSERT/UPDATE-restore) НЕ помечена как удалённая.
  v_old_active boolean := false;
  v_new_active boolean := false;
begin
  if (tg_op = 'INSERT') then
    v_new_active := (NEW.deleted_at is null);
  elsif (tg_op = 'UPDATE') then
    v_old_active := (OLD.deleted_at is null);
    v_new_active := (NEW.deleted_at is null);
  elsif (tg_op = 'DELETE') then
    v_old_active := (OLD.deleted_at is null);
  end if;

  -- Откатываем эффект OLD (если он был активен).
  if v_old_active then
    if OLD.type = 'income' then
      perform public.apply_transaction_balance_delta(OLD.bank_account_id, -OLD.amount);
    elsif OLD.type = 'expense' then
      perform public.apply_transaction_balance_delta(OLD.bank_account_id, OLD.amount);
    elsif OLD.type = 'transfer' then
      perform public.apply_transaction_balance_delta(OLD.bank_account_id, OLD.amount);
      perform public.apply_transaction_balance_delta(OLD.to_bank_account_id, -OLD.amount);
    end if;
  end if;

  -- Применяем эффект NEW (если он активен).
  if v_new_active then
    if NEW.type = 'income' then
      perform public.apply_transaction_balance_delta(NEW.bank_account_id, NEW.amount);
    elsif NEW.type = 'expense' then
      perform public.apply_transaction_balance_delta(NEW.bank_account_id, -NEW.amount);
    elsif NEW.type = 'transfer' then
      perform public.apply_transaction_balance_delta(NEW.bank_account_id, -NEW.amount);
      perform public.apply_transaction_balance_delta(NEW.to_bank_account_id, NEW.amount);
    end if;
  end if;

  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists trg_transactions_balance_recalc on public.transactions;
create trigger trg_transactions_balance_recalc
after insert or update or delete on public.transactions
for each row
execute function public.transaction_balance_recalc();

-- ============================================================
-- Guard-trigger: запрещает прямую запись в bank_accounts.balance
-- из приложения. Только apply_transaction_balance_delta() (которая
-- сетит app.balance_apply = 'true' через GUC) может менять balance.
-- ============================================================

create or replace function public.bank_account_balance_guard()
returns trigger
language plpgsql
as $$
begin
  if NEW.balance is distinct from OLD.balance
     and coalesce(current_setting('app.balance_apply', true), '') != 'true' then
    -- Откатываем самовольное изменение balance, не блокируя остальной UPDATE.
    NEW.balance := OLD.balance;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_bank_accounts_balance_guard on public.bank_accounts;
create trigger trg_bank_accounts_balance_guard
before update on public.bank_accounts
for each row
execute function public.bank_account_balance_guard();

comment on function public.transaction_balance_recalc() is
  'Триггер пересчёта bank_accounts.balance. Применяется AFTER INSERT/UPDATE/DELETE '
  'на public.transactions. Учитывает soft-delete: если deleted_at NULL → активна, '
  'иначе эффект откатывается.';

comment on function public.bank_account_balance_guard() is
  'Защита от прямой записи в bank_accounts.balance из приложения. '
  'Разрешает изменение только через apply_transaction_balance_delta().';
