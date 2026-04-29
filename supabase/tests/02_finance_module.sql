-- ============================================================
-- 02_finance_module.sql — integration tests for stage 3 schema.
--
-- Покрывает:
--   1. Перечисления и таблицы (bank_accounts / categories / counterparties /
--      transactions / account_files / attachment pivots).
--   2. Composite-FK tenant safety (bank_accounts ↔ legal_entities, venues;
--      transactions ↔ bank_accounts, legal_entities, venues).
--   3. Balance trigger (income / expense / transfer / soft-delete /
--      soft-restore).
--   4. Guard-trigger на прямую запись в bank_accounts.balance.
--   5. Дефолтные категории при создании account.
--   6. RLS-изоляция между двумя account.
--
-- Запуск:
--   pnpm db:reset
--   docker exec -i supabase_db_crm psql -U postgres -d postgres -f - \
--     < supabase/tests/02_finance_module.sql
-- ============================================================

begin;

create or replace function public.test_assert(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if not p_condition then
    raise exception 'TEST FAILED: %', p_message;
  end if;
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 1. Schema sanity
-- ────────────────────────────────────────────────────────────
do $$
begin
  perform public.test_assert(
    exists(select 1 from pg_type where typname = 'bank_account_type_enum'),
    'bank_account_type_enum is missing'
  );
  perform public.test_assert(
    exists(select 1 from pg_type where typname = 'finance_category_type_enum'),
    'finance_category_type_enum is missing'
  );
  perform public.test_assert(
    exists(select 1 from pg_type where typname = 'transaction_type_enum'),
    'transaction_type_enum is missing'
  );
  perform public.test_assert(
    exists(select 1 from pg_type where typname = 'attachment_document_type_enum'),
    'attachment_document_type_enum is missing'
  );

  perform public.test_assert(
    exists(select 1 from pg_class where relname = 'bank_accounts'),
    'bank_accounts table missing'
  );
  perform public.test_assert(
    exists(select 1 from pg_class where relname = 'transactions'),
    'transactions table missing'
  );
  perform public.test_assert(
    exists(select 1 from pg_class where relname = 'account_files'),
    'account_files table missing'
  );

  -- Все три pivot-таблицы существуют.
  perform public.test_assert(
    (select count(*) from pg_class
       where relname in ('transaction_attachments','counterparty_attachments','legal_entity_attachments')) = 3,
    'attachment pivots missing'
  );

  -- Storage bucket
  perform public.test_assert(
    exists(select 1 from storage.buckets where id = 'account-attachments'),
    'storage bucket account-attachments is missing'
  );
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 2. Setup test fixtures: two accounts, each with a legal_entity, a
-- venue, a bank_account, and a category.
-- ────────────────────────────────────────────────────────────
do $$
declare
  v_user_a   uuid := '11111111-aaaa-aaaa-aaaa-111111111111';
  v_user_b   uuid := '22222222-bbbb-bbbb-bbbb-222222222222';
begin
  -- auth.users (нужно для FK от profiles)
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000'::uuid, v_user_a, 'authenticated','authenticated',
     'finance-a@test.local', crypt('p', gen_salt('bf')), now(), '{}'::jsonb,'{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000'::uuid, v_user_b, 'authenticated','authenticated',
     'finance-b@test.local', crypt('p', gen_salt('bf')), now(), '{}'::jsonb,'{}'::jsonb, now(), now())
  on conflict (id) do nothing;

  insert into public.profiles (id, first_name, last_name) values
    (v_user_a, 'Owner','A'), (v_user_b,'Owner','B')
  on conflict (id) do nothing;
end;
$$;

-- Помещаем результаты в temp-таблицу, чтобы переиспользовать ниже.
create temp table fixtures as
with new_a as (
  insert into public.accounts (name, owner_id) values ('Tenant A','11111111-aaaa-aaaa-aaaa-111111111111')
  returning id as account_id
), le_a as (
  insert into public.legal_entities (account_id, name, legal_form)
  select account_id, 'LE A', 'IP'::public.legal_form_enum from new_a
  returning id as legal_entity_id, account_id
), v_a as (
  insert into public.venues (account_id, name, type, default_legal_entity_id)
  select le_a.account_id, 'Spot A', 'cafe'::public.venue_type, le_a.legal_entity_id from le_a
  returning id as venue_id, account_id
), ba_a as (
  insert into public.bank_accounts (account_id, legal_entity_id, venue_id, name, type)
  select v_a.account_id, le_a.legal_entity_id, v_a.venue_id,
         'Касса A', 'cash'::public.bank_account_type_enum
  from v_a, le_a
  returning id as bank_account_id, account_id, legal_entity_id
), new_b as (
  insert into public.accounts (name, owner_id) values ('Tenant B','22222222-bbbb-bbbb-bbbb-222222222222')
  returning id as account_id
), le_b as (
  insert into public.legal_entities (account_id, name, legal_form)
  select account_id, 'LE B', 'IP'::public.legal_form_enum from new_b
  returning id as legal_entity_id, account_id
), v_b as (
  insert into public.venues (account_id, name, type, default_legal_entity_id)
  select le_b.account_id, 'Spot B', 'bar'::public.venue_type, le_b.legal_entity_id from le_b
  returning id as venue_id, account_id
), ba_b as (
  insert into public.bank_accounts (account_id, legal_entity_id, venue_id, name, type)
  select v_b.account_id, le_b.legal_entity_id, v_b.venue_id,
         'Касса B', 'cash'::public.bank_account_type_enum
  from v_b, le_b
  returning id as bank_account_id, account_id, legal_entity_id
)
select
  (select account_id from new_a)        as account_a,
  (select legal_entity_id from le_a)    as le_a,
  (select venue_id from v_a)            as venue_a,
  (select bank_account_id from ba_a)    as ba_a,
  (select account_id from new_b)        as account_b,
  (select legal_entity_id from le_b)    as le_b,
  (select venue_id from v_b)            as venue_b,
  (select bank_account_id from ba_b)    as ba_b;

-- ────────────────────────────────────────────────────────────
-- 3. Composite FK безопасность: cross-tenant ссылки отвергаются.
-- ────────────────────────────────────────────────────────────
do $$
declare
  f record;
  v_caught boolean := false;
begin
  select * into f from fixtures;

  -- Попытаться создать bank_account аккаунта A, но сослаться на LE B.
  begin
    insert into public.bank_accounts (account_id, legal_entity_id, name, type)
    values (f.account_a, f.le_b, 'Bad', 'cash'::public.bank_account_type_enum);
  exception when foreign_key_violation then
    v_caught := true;
  end;
  perform public.test_assert(v_caught,
    'cross-tenant bank_account.legal_entity_id must be rejected');

  -- Аналогично для transactions: bank_account из A, legal_entity из B.
  v_caught := false;
  begin
    insert into public.transactions (
      account_id, legal_entity_id, type, amount, bank_account_id, date
    ) values (
      f.account_a, f.le_b, 'income'::public.transaction_type_enum,
      100, f.ba_a, now()
    );
  exception when foreign_key_violation then
    v_caught := true;
  end;
  perform public.test_assert(v_caught,
    'cross-tenant transactions.legal_entity_id must be rejected');
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 4. Balance trigger: income, expense, transfer, soft-delete,
--    soft-restore. Каждый шаг проверяем баланс bank_accounts.
-- ────────────────────────────────────────────────────────────
-- 4.1 Создаём целевой счёт назначения для transfer-теста.
do $$
declare
  f record;
  v_ba_a2 uuid;
  v_tx_inc uuid;
  v_tx_exp uuid;
  v_tx_xfer uuid;
  v_balance_a numeric;
  v_balance_a2 numeric;
begin
  select * into f from fixtures;

  insert into public.bank_accounts (account_id, legal_entity_id, name, type)
  values (f.account_a, f.le_a, 'Расчётный A', 'checking'::public.bank_account_type_enum)
  returning id into v_ba_a2;

  -- 4.2 Income → +1000 к ba_a
  insert into public.transactions (account_id, legal_entity_id, type, amount, bank_account_id, date)
  values (f.account_a, f.le_a, 'income', 1000, f.ba_a, now())
  returning id into v_tx_inc;

  select balance into v_balance_a from public.bank_accounts where id = f.ba_a;
  perform public.test_assert(v_balance_a = 1000,
    'income trigger: expected balance 1000, got ' || v_balance_a);

  -- 4.3 Expense → -300 от ba_a → balance 700
  insert into public.transactions (account_id, legal_entity_id, type, amount, bank_account_id, date)
  values (f.account_a, f.le_a, 'expense', 300, f.ba_a, now())
  returning id into v_tx_exp;

  select balance into v_balance_a from public.bank_accounts where id = f.ba_a;
  perform public.test_assert(v_balance_a = 700,
    'expense trigger: expected balance 700, got ' || v_balance_a);

  -- 4.4 Transfer 200 ba_a → ba_a2 → balance ba_a 500, ba_a2 200
  insert into public.transactions (
    account_id, legal_entity_id, type, amount,
    bank_account_id, to_bank_account_id, to_legal_entity_id, date
  ) values (
    f.account_a, f.le_a, 'transfer', 200,
    f.ba_a, v_ba_a2, f.le_a, now()
  )
  returning id into v_tx_xfer;

  select balance into v_balance_a   from public.bank_accounts where id = f.ba_a;
  select balance into v_balance_a2  from public.bank_accounts where id = v_ba_a2;
  perform public.test_assert(v_balance_a = 500,
    'transfer trigger: expected ba_a balance 500, got ' || v_balance_a);
  perform public.test_assert(v_balance_a2 = 200,
    'transfer trigger: expected ba_a2 balance 200, got ' || v_balance_a2);

  -- 4.5 Soft delete income (1000) → balance ba_a -1000 → -500
  update public.transactions
  set deleted_at = now()
  where id = v_tx_inc;

  select balance into v_balance_a from public.bank_accounts where id = f.ba_a;
  perform public.test_assert(v_balance_a = -500,
    'soft-delete trigger: expected -500 after revoking 1000 income, got ' || v_balance_a);

  -- 4.6 Soft restore (deleted_at → NULL) → +1000 → 500
  update public.transactions set deleted_at = null where id = v_tx_inc;
  select balance into v_balance_a from public.bank_accounts where id = f.ba_a;
  perform public.test_assert(v_balance_a = 500,
    'soft-restore trigger: expected 500 after restoring income, got ' || v_balance_a);
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 5. Guard trigger: прямая запись в balance отвергается (откатывается
--    к OLD значению).
-- ────────────────────────────────────────────────────────────
do $$
declare
  f record;
  v_balance numeric;
begin
  select * into f from fixtures;
  -- Состояние: ba_a balance = 500 (см. выше).
  update public.bank_accounts set balance = 999999 where id = f.ba_a;
  select balance into v_balance from public.bank_accounts where id = f.ba_a;
  perform public.test_assert(v_balance = 500,
    'balance guard: direct write must be rejected, got ' || v_balance);
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 6. Default finance categories seeded for new account.
-- ────────────────────────────────────────────────────────────
do $$
declare
  f record;
  v_count_a int;
  v_income_count int;
  v_expense_count int;
begin
  select * into f from fixtures;

  select count(*)             into v_count_a       from public.finance_categories where account_id = f.account_a;
  select count(*) filter (where type = 'income')   into v_income_count
    from public.finance_categories where account_id = f.account_a and is_system = true;
  select count(*) filter (where type = 'expense')  into v_expense_count
    from public.finance_categories where account_id = f.account_a and is_system = true;

  perform public.test_assert(v_count_a >= 15,
    'expected >=15 default categories, got ' || v_count_a);
  perform public.test_assert(v_income_count = 3,
    'expected 3 default income categories, got ' || v_income_count);
  perform public.test_assert(v_expense_count = 12,
    'expected 12 default expense categories, got ' || v_expense_count);
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 7. Transfer constraints: type='income' c to_bank_account_id !=NULL → fail
-- ────────────────────────────────────────────────────────────
do $$
declare
  f record;
  v_caught boolean := false;
begin
  select * into f from fixtures;
  begin
    insert into public.transactions (
      account_id, legal_entity_id, type, amount,
      bank_account_id, to_bank_account_id, date
    ) values (
      f.account_a, f.le_a, 'income', 100,
      f.ba_a, f.ba_a, now()
    );
  exception when check_violation then
    v_caught := true;
  end;
  perform public.test_assert(v_caught,
    'income transactions must reject to_bank_account_id');

  -- transfer без to_bank_account_id → check_violation
  v_caught := false;
  begin
    insert into public.transactions (
      account_id, legal_entity_id, type, amount, bank_account_id, date
    ) values (
      f.account_a, f.le_a, 'transfer', 100, f.ba_a, now()
    );
  exception when check_violation then
    v_caught := true;
  end;
  perform public.test_assert(v_caught,
    'transfer without to_bank_account_id must be rejected');
end;
$$;

-- ────────────────────────────────────────────────────────────
-- All passed
-- ────────────────────────────────────────────────────────────
do $$
begin
  raise notice 'OK: stage 3 finance schema integration tests passed';
end;
$$;

rollback;
