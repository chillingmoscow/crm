-- 374: сверка остатка счёта с банком.
--
-- Пользователь вводит остаток по выписке на дату; база считает остаток по
-- операциям на конец этого дня и хранит сверку в истории.
--
-- Остаток на дату = текущий bank_accounts.balance минус вклад операций с
-- датой не раньше начала следующего дня. Так контрольный остаток Adesk
-- (balance_anchor_*) учитывается сам собой, а права на заведения операций
-- не влияют на цифру: остаток счёта пользователь и так видит целиком.
-- Раньше контрольного остатка посчитать нельзя — там операции не входят в
-- баланс (balance_covered_by_import), такую дату отклоняем.
--
-- Граница дня — пояс аккаунта (accounts.timezone, миграция 370), как в
-- finance_transactions_page (371): «по D включительно» = date < начало D+1.
--
-- Запись: insert / delete под RLS. Триггер перед вставкой сам считает
-- calculated_balance, ставит автора и время — подделать их запросом к API
-- нельзя. Правки сверки нет: ошибочную удаляют и сверяют заново.
--
-- source: 'manual' — ввёл человек; 'bank' зарезервирован под банковские
-- интеграции (остаток по API банка), пишет только сервер.

begin;

-- ─── Таблица ────────────────────────────────────────────────────────────────

create table public.bank_account_reconciliations (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  bank_account_id    uuid not null,
  balance_date       date not null,
  bank_balance       numeric(15, 2) not null,
  calculated_balance numeric(15, 2) not null,
  source             text not null default 'manual',
  note               text,
  created_at         timestamptz not null default now(),
  created_by         uuid references public.profiles(id) on delete set null,

  constraint bank_account_reconciliations_account_id_id_key unique (account_id, id),
  constraint bank_account_reconciliations_bank_account_fkey
    foreign key (account_id, bank_account_id)
    references public.bank_accounts (account_id, id)
    on delete cascade,
  constraint bank_account_reconciliations_source_check
    check (source in ('manual', 'bank')),
  constraint bank_account_reconciliations_note_check
    check (note is null or char_length(note) <= 500)
);

comment on table public.bank_account_reconciliations is
  'Сверки остатка счёта с банком: остаток по выписке на дату и расчётный остаток по операциям на момент сверки. Миграция 374.';
comment on column public.bank_account_reconciliations.calculated_balance is
  'Остаток по операциям на конец balance_date в момент сверки. Считает триггер, не клиент.';
comment on column public.bank_account_reconciliations.source is
  'manual — ввёл пользователь; bank — остаток из банковской интеграции (пишет сервер).';

create index bank_account_reconciliations_account_bank_idx
  on public.bank_account_reconciliations (account_id, bank_account_id, balance_date desc);
create index bank_account_reconciliations_created_by_idx
  on public.bank_account_reconciliations (created_by);

-- Вклад операций в остаток счёта от момента: выборка по счёту и дате.
create index if not exists transactions_bank_account_date_idx
  on public.transactions (bank_account_id, date) where deleted_at is null;
create index if not exists transactions_to_bank_account_date_idx
  on public.transactions (to_bank_account_id, date)
  where deleted_at is null and to_bank_account_id is not null;

-- ─── Граница дня и оборот ──────────────────────────────────────────────────

-- Начало дня, следующего за p_date, в поясе аккаунта.
create or replace function private.bank_account_day_end(p_account_id uuid, p_date date)
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select ((p_date + 1)::timestamp
          at time zone coalesce(
            (select a.timezone from public.accounts a where a.id = p_account_id),
            'Europe/Moscow'))
$$;

-- Вклад операций в остаток счёта с момента p_since (включительно) — с тем же
-- знаком, что у transaction_balance_recalc. SECURITY DEFINER: остаток счёта
-- не зависит от того, какие операции пользователь видит.
create or replace function private.bank_account_turnover_since(
  p_account_id uuid,
  p_bank_account_id uuid,
  p_since timestamptz
)
returns numeric
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(sum(x.delta), 0)
  from (
    select case when t.type = 'income' then t.amount else -t.amount end as delta
      from public.transactions t
     where t.account_id = p_account_id
       and t.bank_account_id = p_bank_account_id
       and t.deleted_at is null
       and t.date >= p_since
    union all
    select t.amount
      from public.transactions t
     where t.account_id = p_account_id
       and t.to_bank_account_id = p_bank_account_id
       and t.type = 'transfer'
       and t.deleted_at is null
       and t.date >= p_since
  ) x
$$;

revoke all on function private.bank_account_day_end(uuid, date) from public, anon;
revoke all on function private.bank_account_turnover_since(uuid, uuid, timestamptz) from public, anon;
grant execute on function private.bank_account_day_end(uuid, date) to authenticated, service_role;
grant execute on function private.bank_account_turnover_since(uuid, uuid, timestamptz) to authenticated, service_role;

-- ─── Остаток на дату ────────────────────────────────────────────────────────

-- Остаток счёта по операциям на конец p_date. NULL — счёт не виден
-- пользователю или дата раньше контрольного остатка переноса.
-- SECURITY INVOKER: видимость счёта решает политика bank_accounts_select.
create or replace function public.bank_account_balance_at(p_bank_account_id uuid, p_date date)
returns numeric
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select b.balance - private.bank_account_turnover_since(b.account_id, b.id, e.day_end)
    from public.bank_accounts b
   cross join lateral (select private.bank_account_day_end(b.account_id, p_date) as day_end) e
   where b.id = p_bank_account_id
     and (b.balance_anchor_at is null or e.day_end >= b.balance_anchor_at)
$$;

comment on function public.bank_account_balance_at(uuid, date) is
  'Остаток счёта по операциям на конец дня (пояс аккаунта). NULL — счёт не виден или дата раньше контрольного остатка. Миграция 374.';

revoke all on function public.bank_account_balance_at(uuid, date) from public, anon;
grant execute on function public.bank_account_balance_at(uuid, date) to authenticated;

-- История сверок счёта с текущим расчётным остатком на ту же дату: если он
-- разошёлся с сохранённым, операции до даты сверки потом меняли.
create or replace function public.bank_account_reconciliation_history(
  p_bank_account_id uuid,
  p_limit integer default 50
)
returns table (
  id uuid,
  balance_date date,
  bank_balance numeric,
  calculated_balance numeric,
  current_calculated_balance numeric,
  source text,
  note text,
  created_at timestamptz,
  created_by uuid
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  with recs as (
    select r.*
      from public.bank_account_reconciliations r
     where r.bank_account_id = p_bank_account_id
     order by r.balance_date desc, r.created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ),
  days as (
    select d.balance_date,
           public.bank_account_balance_at(p_bank_account_id, d.balance_date) as current_balance
      from (select distinct balance_date from recs) d
  )
  select r.id, r.balance_date, r.bank_balance, r.calculated_balance,
         d.current_balance, r.source, r.note, r.created_at, r.created_by
    from recs r
    join days d using (balance_date)
   order by r.balance_date desc, r.created_at desc
$$;

comment on function public.bank_account_reconciliation_history(uuid, integer) is
  'Сверки счёта (новые сверху) и расчётный остаток на их дату сейчас. Миграция 374.';

revoke all on function public.bank_account_reconciliation_history(uuid, integer) from public, anon;
grant execute on function public.bank_account_reconciliation_history(uuid, integer) to authenticated;

-- ─── Триггер: считает остаток и фиксирует автора ───────────────────────────

-- SECURITY INVOKER: current_user — роль вызывающего, а выборка счёта идёт
-- под его RLS. Оборот считает definer-функция.
create or replace function public.bank_account_reconciliation_prepare()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  b public.bank_accounts%rowtype;
  v_tz text;
  v_day_end timestamptz;
begin
  select * into b
    from public.bank_accounts
   where id = new.bank_account_id and account_id = new.account_id;
  if not found then
    raise exception 'Счёт не найден' using errcode = 'P0002';
  end if;
  if b.deleted_at is not null then
    raise exception 'Счёт в архиве. Верните его, чтобы сверять остаток' using errcode = '22023';
  end if;

  select coalesce(a.timezone, 'Europe/Moscow') into v_tz from public.accounts a where a.id = new.account_id;
  if new.balance_date > (now() at time zone coalesce(v_tz, 'Europe/Moscow'))::date then
    raise exception 'Остаток на будущую дату сверить нельзя' using errcode = '22023';
  end if;

  v_day_end := private.bank_account_day_end(new.account_id, new.balance_date);
  if b.balance_anchor_at is not null and v_day_end < b.balance_anchor_at then
    raise exception 'Остаток раньше %: до этой даты счёт перенесён одной суммой',
      to_char(b.balance_anchor_at at time zone coalesce(v_tz, 'Europe/Moscow'), 'DD.MM.YYYY')
      using errcode = '22023';
  end if;

  new.calculated_balance := b.balance
    - private.bank_account_turnover_since(new.account_id, b.id, v_day_end);

  if current_user in ('anon', 'authenticated') then
    new.created_by := (select auth.uid());
    new.created_at := now();
    new.source := 'manual';
  end if;
  return new;
end;
$$;

revoke all on function public.bank_account_reconciliation_prepare() from public, anon, authenticated;

create trigger bank_account_reconciliation_prepare
  before insert on public.bank_account_reconciliations
  for each row execute function public.bank_account_reconciliation_prepare();

-- ─── RLS ────────────────────────────────────────────────────────────────────

alter table public.bank_account_reconciliations enable row level security;

-- Видно тем, кому виден сам счёт (bank_accounts_select внутри exists).
create policy bank_account_reconciliations_select
  on public.bank_account_reconciliations for select to authenticated
  using (
    account_id = (select public.get_active_account_id())
    and exists (
      select 1 from public.bank_accounts b
       where b.account_id = bank_account_reconciliations.account_id
         and b.id = bank_account_reconciliations.bank_account_id
    )
  );

create policy bank_account_reconciliations_insert
  on public.bank_account_reconciliations for insert to authenticated
  with check (
    account_id = (select public.get_active_account_id())
    and (select public.has_permission('finance.manage_bank_accounts'))
    and exists (
      select 1 from public.bank_accounts b
       where b.account_id = bank_account_reconciliations.account_id
         and b.id = bank_account_reconciliations.bank_account_id
         and b.deleted_at is null
    )
  );

create policy bank_account_reconciliations_delete
  on public.bank_account_reconciliations for delete to authenticated
  using (
    account_id = (select public.get_active_account_id())
    and (select public.has_permission('finance.manage_bank_accounts'))
    and exists (
      select 1 from public.bank_accounts b
       where b.account_id = bank_account_reconciliations.account_id
         and b.id = bank_account_reconciliations.bank_account_id
         and b.deleted_at is null
    )
  );

revoke all on table public.bank_account_reconciliations from public, anon, authenticated;
grant select, insert, delete on table public.bank_account_reconciliations to authenticated;
grant all on table public.bank_account_reconciliations to service_role;

-- ─── Проверка прав ─────────────────────────────────────────────────────────

do $$
begin
  if has_table_privilege('anon', 'public.bank_account_reconciliations', 'select') then
    raise exception 'anon не должен читать сверки';
  end if;
  if has_table_privilege('authenticated', 'public.bank_account_reconciliations', 'update') then
    raise exception 'Правки сверок нет: update у authenticated должен быть снят';
  end if;
  if has_function_privilege('anon', 'public.bank_account_balance_at(uuid, date)', 'execute') then
    raise exception 'anon не должен вызывать bank_account_balance_at';
  end if;
  if has_function_privilege('anon', 'private.bank_account_turnover_since(uuid, uuid, timestamptz)', 'execute') then
    raise exception 'anon не должен вызывать bank_account_turnover_since';
  end if;
  if has_function_privilege('authenticated', 'public.bank_account_reconciliation_prepare()', 'execute') then
    raise exception 'Триггерную функцию сверки вызывать напрямую нельзя';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
