-- ============================================================
-- 377_finance_recurring_payments.sql
--
-- Повторяющиеся платежи, этап 1 (docs/superpowers/specs/
-- 2026-11-21-recurring-payments-design.md):
--   * finance_recurring_templates   — шаблон с расписанием;
--   * finance_recurring_occurrences — ожидаемый платёж (снимок шаблона
--     на срок), UNIQUE (template_id, due_date) делает порождение идемпотентным;
--   * private.finance_recurring_due_dates — сроки шаблона в интервале;
--   * private.finance_recurring_materialize_account + публичные обёртки
--     materialize_all (cron, service_role) и materialize_mine (страница);
--   * finance_recurring_next_due — ближайший срок для списка шаблонов;
--   * триггер на transactions: удалённая проведённая операция возвращает
--     платёж в pending.
--
-- «Сегодня» аккаунта — по accounts.timezone (370).
-- Применять от supabase_admin, без `psql -1` (свои begin/commit).
-- ============================================================

begin;

-- ────────────────────────────────────────────────────────────
-- 1. Шаблоны
-- ────────────────────────────────────────────────────────────
create table public.finance_recurring_templates (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references public.accounts(id) on delete cascade,
  legal_entity_id       uuid not null,
  venue_id              uuid,
  bank_account_id       uuid not null,
  category_id           uuid,
  counterparty_id       uuid,
  type                  public.transaction_type_enum not null
                          check (type in ('income', 'expense')),
  amount                numeric(14, 2) not null check (amount > 0),
  amount_varies         boolean not null default false,
  currency              text not null default 'RUB',
  description           text,
  name                  text not null,
  frequency             text not null check (frequency in ('monthly', 'weekly', 'quarterly')),
  day_of_month          smallint check (day_of_month between 1 and 31),
  weekday               smallint check (weekday between 1 and 7),
  quarter_month         smallint check (quarter_month between 1 and 3),
  starts_on             date not null,
  ends_on               date,
  paused_at             timestamptz,
  -- Точка отсчёта порождения: прошлое задним числом не догоняется.
  materialize_from      date not null,
  source_transaction_id uuid,
  created_by            uuid references public.profiles(id),
  created_at            timestamptz not null default now(),
  updated_by            uuid references public.profiles(id),
  updated_at            timestamptz,
  archived_at           timestamptz,
  archived_by           uuid references public.profiles(id),

  constraint finance_recurring_templates_account_id_id_key unique (account_id, id),
  constraint finance_recurring_templates_schedule_check check (
    case frequency
      when 'monthly'   then day_of_month is not null
      when 'quarterly' then day_of_month is not null and quarter_month is not null
      when 'weekly'    then weekday is not null
    end
  ),
  constraint finance_recurring_templates_period_check
    check (ends_on is null or ends_on >= starts_on),

  constraint finance_recurring_templates_legal_entity_fk
    foreign key (account_id, legal_entity_id)
    references public.legal_entities (account_id, id),
  constraint finance_recurring_templates_venue_fk
    foreign key (account_id, venue_id)
    references public.venues (account_id, id) on delete set null (venue_id),
  constraint finance_recurring_templates_bank_account_fk
    foreign key (account_id, bank_account_id)
    references public.bank_accounts (account_id, id),
  constraint finance_recurring_templates_category_fk
    foreign key (account_id, category_id)
    references public.finance_categories (account_id, id) on delete set null (category_id),
  constraint finance_recurring_templates_counterparty_fk
    foreign key (account_id, counterparty_id)
    references public.counterparties (account_id, id) on delete set null (counterparty_id),
  constraint finance_recurring_templates_source_tx_fk
    foreign key (account_id, source_transaction_id)
    references public.transactions (account_id, id) on delete set null (source_transaction_id)
);

create index finance_recurring_templates_legal_entity_idx
  on public.finance_recurring_templates (account_id, legal_entity_id);
create index finance_recurring_templates_venue_idx
  on public.finance_recurring_templates (account_id, venue_id);
create index finance_recurring_templates_bank_account_idx
  on public.finance_recurring_templates (account_id, bank_account_id);
create index finance_recurring_templates_category_idx
  on public.finance_recurring_templates (account_id, category_id);
create index finance_recurring_templates_counterparty_idx
  on public.finance_recurring_templates (account_id, counterparty_id);
create index finance_recurring_templates_source_tx_idx
  on public.finance_recurring_templates (account_id, source_transaction_id);
-- Порождение перебирает активные шаблоны аккаунта.
create index finance_recurring_templates_active_idx
  on public.finance_recurring_templates (account_id)
  where archived_at is null and paused_at is null;

-- ────────────────────────────────────────────────────────────
-- 2. Ожидаемые платежи
-- ────────────────────────────────────────────────────────────
create table public.finance_recurring_occurrences (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  template_id     uuid not null,
  due_date        date not null,
  -- Снимок шаблона на момент появления: правка шаблона карточки не меняет.
  legal_entity_id uuid not null,
  venue_id        uuid,
  bank_account_id uuid not null,
  category_id     uuid,
  counterparty_id uuid,
  type            public.transaction_type_enum not null
                    check (type in ('income', 'expense')),
  amount          numeric(14, 2) not null check (amount > 0),
  amount_varies   boolean not null default false,
  currency        text not null default 'RUB',
  description     text,
  name            text not null,
  status          text not null default 'pending'
                    check (status in ('pending', 'posted', 'skipped')),
  postponed_to    date,
  transaction_id  uuid,
  resolved_by     uuid references public.profiles(id),
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),

  constraint finance_recurring_occurrences_account_id_id_key unique (account_id, id),
  constraint finance_recurring_occurrences_template_due_key unique (template_id, due_date),

  constraint finance_recurring_occurrences_template_fk
    foreign key (account_id, template_id)
    references public.finance_recurring_templates (account_id, id) on delete cascade,
  constraint finance_recurring_occurrences_legal_entity_fk
    foreign key (account_id, legal_entity_id)
    references public.legal_entities (account_id, id),
  constraint finance_recurring_occurrences_venue_fk
    foreign key (account_id, venue_id)
    references public.venues (account_id, id) on delete set null (venue_id),
  constraint finance_recurring_occurrences_bank_account_fk
    foreign key (account_id, bank_account_id)
    references public.bank_accounts (account_id, id),
  constraint finance_recurring_occurrences_category_fk
    foreign key (account_id, category_id)
    references public.finance_categories (account_id, id) on delete set null (category_id),
  constraint finance_recurring_occurrences_counterparty_fk
    foreign key (account_id, counterparty_id)
    references public.counterparties (account_id, id) on delete set null (counterparty_id),
  constraint finance_recurring_occurrences_transaction_fk
    foreign key (account_id, transaction_id)
    references public.transactions (account_id, id) on delete set null (transaction_id)
);

create index finance_recurring_occurrences_pending_idx
  on public.finance_recurring_occurrences (account_id, due_date)
  where status = 'pending';
create index finance_recurring_occurrences_template_idx
  on public.finance_recurring_occurrences (account_id, template_id);
create index finance_recurring_occurrences_legal_entity_idx
  on public.finance_recurring_occurrences (account_id, legal_entity_id);
create index finance_recurring_occurrences_venue_idx
  on public.finance_recurring_occurrences (account_id, venue_id);
create index finance_recurring_occurrences_bank_account_idx
  on public.finance_recurring_occurrences (account_id, bank_account_id);
create index finance_recurring_occurrences_category_idx
  on public.finance_recurring_occurrences (account_id, category_id);
create index finance_recurring_occurrences_counterparty_idx
  on public.finance_recurring_occurrences (account_id, counterparty_id);
create index finance_recurring_occurrences_transaction_idx
  on public.finance_recurring_occurrences (account_id, transaction_id);

-- ────────────────────────────────────────────────────────────
-- 3. RLS: видимость как у операции (transactions_select, 373, без
--    ветки deleted_at). Платежи клиент только читает и обновляет
--    (разбор); создают и удаляют их функции.
-- ────────────────────────────────────────────────────────────
alter table public.finance_recurring_templates enable row level security;
alter table public.finance_recurring_occurrences enable row level security;

revoke all on public.finance_recurring_templates from anon;
revoke all on public.finance_recurring_occurrences from anon;
revoke insert, delete on public.finance_recurring_occurrences from authenticated;

create policy finance_recurring_templates_select
  on public.finance_recurring_templates for select
  using (
    account_id = (select public.get_active_account_id())
    and (
      legal_entity_id = (select public.get_active_legal_entity_id())
      or (select public.has_permission('finance.view_all_legal_entities'))
    )
    and (
      venue_id is null
      or venue_id = (select public.get_active_venue_id())
      or (select public.has_permission('finance.view_all_venues'))
    )
    and (select public.has_permission('finance.view_transactions'))
  );

create policy finance_recurring_templates_insert
  on public.finance_recurring_templates for insert
  with check (
    account_id = (select public.get_active_account_id())
    and (
      legal_entity_id = (select public.get_active_legal_entity_id())
      or (select public.has_permission('finance.view_all_legal_entities'))
    )
    and (
      venue_id is null
      or venue_id = (select public.get_active_venue_id())
      or (select public.has_permission('finance.view_all_venues'))
    )
    and (select public.has_permission('finance.view_transactions'))
    and (select public.has_permission('finance.create_transaction'))
  );

create policy finance_recurring_templates_update
  on public.finance_recurring_templates for update
  using (
    account_id = (select public.get_active_account_id())
    and (
      legal_entity_id = (select public.get_active_legal_entity_id())
      or (select public.has_permission('finance.view_all_legal_entities'))
    )
    and (
      venue_id is null
      or venue_id = (select public.get_active_venue_id())
      or (select public.has_permission('finance.view_all_venues'))
    )
    and (select public.has_permission('finance.view_transactions'))
    and (select public.has_permission('finance.create_transaction'))
  )
  with check (
    account_id = (select public.get_active_account_id())
    and (select public.has_permission('finance.create_transaction'))
  );

create policy finance_recurring_templates_delete
  on public.finance_recurring_templates for delete
  using (
    account_id = (select public.get_active_account_id())
    and (
      legal_entity_id = (select public.get_active_legal_entity_id())
      or (select public.has_permission('finance.view_all_legal_entities'))
    )
    and (
      venue_id is null
      or venue_id = (select public.get_active_venue_id())
      or (select public.has_permission('finance.view_all_venues'))
    )
    and (select public.has_permission('finance.view_transactions'))
    and (select public.has_permission('finance.create_transaction'))
  );

create policy finance_recurring_occurrences_select
  on public.finance_recurring_occurrences for select
  using (
    account_id = (select public.get_active_account_id())
    and (
      legal_entity_id = (select public.get_active_legal_entity_id())
      or (select public.has_permission('finance.view_all_legal_entities'))
    )
    and (
      venue_id is null
      or venue_id = (select public.get_active_venue_id())
      or (select public.has_permission('finance.view_all_venues'))
    )
    and (select public.has_permission('finance.view_transactions'))
  );

create policy finance_recurring_occurrences_update
  on public.finance_recurring_occurrences for update
  using (
    account_id = (select public.get_active_account_id())
    and (
      legal_entity_id = (select public.get_active_legal_entity_id())
      or (select public.has_permission('finance.view_all_legal_entities'))
    )
    and (
      venue_id is null
      or venue_id = (select public.get_active_venue_id())
      or (select public.has_permission('finance.view_all_venues'))
    )
    and (select public.has_permission('finance.view_transactions'))
    and (select public.has_permission('finance.create_transaction'))
  )
  with check (
    account_id = (select public.get_active_account_id())
    and (select public.has_permission('finance.create_transaction'))
  );

-- ────────────────────────────────────────────────────────────
-- 4. Сроки
-- ────────────────────────────────────────────────────────────
-- «Сегодня» аккаунта по его часовому поясу.
create or replace function private.finance_account_today(p_account uuid)
returns date
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select (now() at time zone coalesce(
    (select a.timezone from public.accounts a where a.id = p_account),
    'Europe/Moscow'))::date
$$;

-- Сроки шаблона в [p_from; p_to] с учётом starts_on / ends_on.
-- Число 29–31 в коротком месяце сдвигается на последний день месяца.
create or replace function private.finance_recurring_due_dates(
  p_template public.finance_recurring_templates,
  p_from date,
  p_to date
)
returns setof date
language sql
immutable
set search_path = public, pg_catalog
as $$
  with bounds as (
    select greatest(p_from, p_template.starts_on) as lo,
           least(p_to, coalesce(p_template.ends_on, p_to)) as hi
  ), candidates as (
    select (m::date + (least(
             p_template.day_of_month,
             extract(day from (m::date + interval '1 month - 1 day'))::int
           ) - 1))::date as d
      from generate_series(date_trunc('month', p_from)::date, p_to, interval '1 month') m
     where p_template.frequency in ('monthly', 'quarterly')
       and (
         p_template.frequency = 'monthly'
         or (extract(month from m)::int - 1) % 3 = p_template.quarter_month - 1
       )
    union all
    select g::date
      from generate_series(p_from, p_to, interval '1 day') g
     where p_template.frequency = 'weekly'
       and extract(isodow from g)::int = p_template.weekday
  )
  select c.d
    from candidates c, bounds b
   where c.d between b.lo and b.hi
   order by c.d
$$;

-- ────────────────────────────────────────────────────────────
-- 5. Порождение
-- ────────────────────────────────────────────────────────────
create or replace function private.finance_recurring_materialize_account(p_account uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_today date := private.finance_account_today(p_account);
  v_inserted int := 0;
  v_n int;
  t public.finance_recurring_templates;
begin
  for t in
    select * from public.finance_recurring_templates
     where account_id = p_account
       and archived_at is null
       and paused_at is null
       and materialize_from <= v_today
     for update
  loop
    insert into public.finance_recurring_occurrences (
      account_id, template_id, due_date, legal_entity_id, venue_id, bank_account_id,
      category_id, counterparty_id, type, amount, amount_varies, currency, description, name
    )
    select t.account_id, t.id, d, t.legal_entity_id, t.venue_id, t.bank_account_id,
           t.category_id, t.counterparty_id, t.type, t.amount, t.amount_varies, t.currency,
           t.description, t.name
      from private.finance_recurring_due_dates(t, t.materialize_from, v_today) d
    on conflict (template_id, due_date) do nothing;
    get diagnostics v_n = row_count;
    v_inserted := v_inserted + v_n;

    update public.finance_recurring_templates
       set materialize_from = v_today + 1
     where id = t.id;
  end loop;
  return v_inserted;
end;
$$;

create or replace function public.finance_recurring_materialize_all()
returns int
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_total int := 0;
  a uuid;
begin
  for a in
    select distinct account_id from public.finance_recurring_templates
     where archived_at is null and paused_at is null
  loop
    v_total := v_total + private.finance_recurring_materialize_account(a);
  end loop;
  return v_total;
end;
$$;

create or replace function public.finance_recurring_materialize_mine()
returns int
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_account uuid := public.get_active_account_id();
begin
  if v_account is null or not public.has_permission('finance.view_transactions') then
    return 0;
  end if;
  return private.finance_recurring_materialize_account(v_account);
end;
$$;

-- Ближайший будущий срок шаблона; null на паузе, в архиве и после ends_on.
create or replace function public.finance_recurring_next_due(p_template_id uuid)
returns date
language sql
stable
set search_path = public, pg_catalog
as $$
  select (
    select min(d)
      from private.finance_recurring_due_dates(
        t, greatest(t.materialize_from, today.d + 1), today.d + 400) d
  )
    from public.finance_recurring_templates t
   cross join lateral (select private.finance_account_today(t.account_id) as d) today
   where t.id = p_template_id
     and t.archived_at is null
     and t.paused_at is null
$$;

-- ────────────────────────────────────────────────────────────
-- 6. Удалённая операция возвращает проведённый платёж в очередь
-- ────────────────────────────────────────────────────────────
create or replace function public.finance_recurring_release_transaction()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' or (old.deleted_at is null and new.deleted_at is not null) then
    update public.finance_recurring_occurrences
       set status = 'pending', transaction_id = null,
           resolved_by = null, resolved_at = null
     where account_id = old.account_id
       and transaction_id = old.id
       and status = 'posted';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger finance_recurring_release_on_soft_delete
  before update of deleted_at on public.transactions
  for each row
  execute function public.finance_recurring_release_transaction();

create trigger finance_recurring_release_on_delete
  before delete on public.transactions
  for each row
  execute function public.finance_recurring_release_transaction();

-- ────────────────────────────────────────────────────────────
-- 7. Права на функции
-- ────────────────────────────────────────────────────────────
revoke all on function public.finance_recurring_materialize_all() from public, anon, authenticated;
grant execute on function public.finance_recurring_materialize_all() to service_role;

revoke all on function public.finance_recurring_materialize_mine() from public, anon, authenticated;
grant execute on function public.finance_recurring_materialize_mine() to authenticated;

revoke all on function public.finance_recurring_next_due(uuid) from public, anon;
grant execute on function public.finance_recurring_next_due(uuid) to authenticated;

revoke all on function public.finance_recurring_release_transaction() from public, anon, authenticated;

revoke all on function private.finance_recurring_materialize_account(uuid) from public, anon, authenticated;
grant execute on function private.finance_recurring_materialize_account(uuid) to service_role;

-- next_due — SECURITY INVOKER, поэтому вызывающему нужны эти две функции.
revoke all on function private.finance_account_today(uuid) from public, anon;
grant execute on function private.finance_account_today(uuid) to authenticated, service_role;
revoke all on function private.finance_recurring_due_dates(public.finance_recurring_templates, date, date) from public, anon;
grant execute on function private.finance_recurring_due_dates(public.finance_recurring_templates, date, date) to authenticated, service_role;

-- Проверяем результат: от роли-не-владельца REVOKE/GRANT дают только WARNING.
do $$
begin
  if has_function_privilege('anon', 'public.finance_recurring_materialize_all()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.finance_recurring_materialize_all()', 'EXECUTE')
    or has_function_privilege('anon', 'public.finance_recurring_materialize_mine()', 'EXECUTE')
    or has_function_privilege('anon', 'public.finance_recurring_next_due(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'private.finance_recurring_materialize_account(uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.finance_recurring_materialize_account(uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.finance_recurring_release_transaction()', 'EXECUTE')
  then
    raise exception 'finance_recurring_*: функции доступны лишним ролям: применяйте от supabase_admin';
  end if;
  if not has_function_privilege('service_role', 'public.finance_recurring_materialize_all()', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.finance_recurring_materialize_mine()', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.finance_recurring_next_due(uuid)', 'EXECUTE')
  then
    raise exception 'finance_recurring_*: не выданы нужные права';
  end if;
end $$;

commit;
