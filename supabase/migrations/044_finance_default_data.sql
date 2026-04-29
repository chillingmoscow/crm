-- ============================================================
-- 044_finance_default_data.sql
-- Дефолтные финансовые сущности при онбординге нового аккаунта:
-- категории доходов и расходов + основная касса.
--
-- См. docs/MERGE_PLAN.md §6 «Этап 3 → миграция 042».
-- (Здесь номер 044, потому что 042 у нас занят RLS-политиками,
-- а 043 — onboarding RPC.)
--
-- Триггер вешается на accounts AFTER INSERT и работает на ВСЕ
-- последующие создания аккаунтов через complete_owner_onboarding.
-- ============================================================

create or replace function public.seed_default_finance_data()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Категории доходов (3)
  insert into public.finance_categories (account_id, name, type, is_system, sort_order) values
    (NEW.id, 'Выручка POS',           'income', true, 10),
    (NEW.id, 'Прочие доходы',         'income', true, 20),
    (NEW.id, 'Возвраты от поставщиков','income', true, 30);

  -- Категории расходов (12)
  insert into public.finance_categories (account_id, name, type, is_system, sort_order) values
    (NEW.id, 'Закупка продуктов',     'expense', true, 10),
    (NEW.id, 'Закупка алкоголя',      'expense', true, 20),
    (NEW.id, 'Закупка инвентаря',     'expense', true, 30),
    (NEW.id, 'Аренда',                'expense', true, 40),
    (NEW.id, 'Зарплата',              'expense', true, 50),
    (NEW.id, 'Налоги',                'expense', true, 60),
    (NEW.id, 'Коммунальные',          'expense', true, 70),
    (NEW.id, 'Маркетинг',             'expense', true, 80),
    (NEW.id, 'Бухгалтерия',           'expense', true, 90),
    (NEW.id, 'Связь и интернет',      'expense', true, 100),
    (NEW.id, 'Эквайринг',             'expense', true, 110),
    (NEW.id, 'Прочие расходы',        'expense', true, 120);

  -- Группа «Прочее» — пример, чтобы UI не был совсем пустым.
  -- bank_account и кассу НЕ создаём здесь: без legal_entity_id это
  -- невозможно (в момент INSERT в accounts юрлица ещё нет). Кассу
  -- «Основная касса» создаст complete_owner_onboarding после
  -- создания legal_entity (см. миграция 043 + апдейт ниже, не в этой
  -- миграции — пока просто оставляем onboarding без банковского счёта).

  return NEW;
end;
$$;

drop trigger if exists trg_accounts_seed_finance on public.accounts;
create trigger trg_accounts_seed_finance
after insert on public.accounts
for each row
execute function public.seed_default_finance_data();

comment on function public.seed_default_finance_data() is
  'Создаёт стандартный набор финансовых категорий для нового account. '
  'Запускается триггером после INSERT в accounts.';

-- ============================================================
-- Бэкфилл существующих аккаунтов: для уже созданных accounts заводим
-- те же дефолтные категории, если их у аккаунта ещё нет. Идемпотентно.
-- ============================================================

do $$
declare
  v_account_id uuid;
begin
  for v_account_id in
    select a.id from public.accounts a
    where not exists (
      select 1 from public.finance_categories fc
      where fc.account_id = a.id and fc.is_system = true
    )
  loop
    insert into public.finance_categories (account_id, name, type, is_system, sort_order) values
      (v_account_id, 'Выручка POS',            'income',  true, 10),
      (v_account_id, 'Прочие доходы',          'income',  true, 20),
      (v_account_id, 'Возвраты от поставщиков','income',  true, 30),
      (v_account_id, 'Закупка продуктов',      'expense', true, 10),
      (v_account_id, 'Закупка алкоголя',       'expense', true, 20),
      (v_account_id, 'Закупка инвентаря',      'expense', true, 30),
      (v_account_id, 'Аренда',                 'expense', true, 40),
      (v_account_id, 'Зарплата',               'expense', true, 50),
      (v_account_id, 'Налоги',                 'expense', true, 60),
      (v_account_id, 'Коммунальные',           'expense', true, 70),
      (v_account_id, 'Маркетинг',              'expense', true, 80),
      (v_account_id, 'Бухгалтерия',            'expense', true, 90),
      (v_account_id, 'Связь и интернет',       'expense', true, 100),
      (v_account_id, 'Эквайринг',              'expense', true, 110),
      (v_account_id, 'Прочие расходы',         'expense', true, 120);
  end loop;
end;
$$;
